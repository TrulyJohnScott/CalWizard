"""Independent oracles for the Cal Wizard black-box suite.

Everything here is written from SPEC.md only.  Nothing imports from ``app``.

* ``parse_to_sympy``  - recursive-descent parser of the spec grammar producing an *unevaluated*
  sympy tree (so sympy cannot simplify away e.g. 0*1/0).
* ``evaluate``        - evaluates that tree with mpmath (50 digits) but with IEEE-754 double
  semantics at the edges (overflow -> inf, domain errors -> nan).  Also returns a magnitude scale
  of the intermediates, used for a principled floating-point tolerance.
* ``excel_eval``      - a tiny evaluator with *real Excel* semantics (unary minus binds tighter
  than ^, ^ is left associative) for the emitted formula strings.
* table / metrics oracles built on scipy.
"""
from __future__ import annotations

import math
import re

import mpmath as mp
import numpy as np
import sympy as sp
from scipy import integrate, optimize, stats
from scipy.interpolate import PchipInterpolator

mp.mp.dps = 50
DBL_MAX = 1.7976931348623157e308

# ----------------------------------------------------------------------------------------------
# parser (spec §2)
# ----------------------------------------------------------------------------------------------


class OracleSyntaxError(Exception):
    def __init__(self, msg: str, pos: int):
        super().__init__(f"{msg} at {pos}")
        self.msg, self.pos = msg, pos


_TOKEN = re.compile(
    r"\s*(?:(?P<num>(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)|(?P<id>[A-Za-z_][A-Za-z_0-9]*)|(?P<op>\S))"
)

FUNCS1 = {"sqrt", "exp", "ln", "log", "log10", "abs"}
FUNCSN = {"min", "max"}


def _tokenize(src: str):
    toks, i = [], 0
    while True:
        m = _TOKEN.match(src, i)
        if not m or m.end() == i:
            break
        i = m.end()
        if m.group("num") is not None:
            toks.append(("num", m.group("num"), m.start("num")))
        elif m.group("id") is not None:
            toks.append(("id", m.group("id"), m.start("id")))
        else:
            toks.append(("op", m.group("op"), m.start("op")))
    toks.append(("end", "", len(src)))
    return toks


class _P:
    def __init__(self, src: str, variable: str):
        self.src, self.t, self.i = src, _tokenize(src), 0
        self.var = variable  # 'c' or 'S'
        self.sym = sp.Symbol("v")

    def peek(self):
        return self.t[self.i]

    def eat(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def expr(self):
        left = self.term()
        while self.peek()[0] == "op" and self.peek()[1] in "+-":
            op = self.eat()[1]
            right = self.term()
            if op == "+":
                left = sp.Add(left, right, evaluate=False)
            else:
                left = sp.Add(left, sp.Mul(sp.Integer(-1), right, evaluate=False), evaluate=False)
        return left

    def term(self):
        left = self.unary()
        while self.peek()[0] == "op" and self.peek()[1] in "*/":
            op = self.eat()[1]
            right = self.unary()
            if op == "*":
                left = sp.Mul(left, right, evaluate=False)
            else:
                left = sp.Mul(left, sp.Pow(right, sp.Integer(-1), evaluate=False), evaluate=False)
        return left

    def unary(self):
        k, v, _ = self.peek()
        if k == "op" and v in "+-":
            self.eat()
            inner = self.unary()
            return inner if v == "+" else sp.Mul(sp.Integer(-1), inner, evaluate=False)
        return self.power()

    def power(self):
        base = self.atom()
        k, v, _ = self.peek()
        if k == "op" and v == "^":
            self.eat()
            return sp.Pow(base, self.unary(), evaluate=False)
        return base

    def atom(self):
        k, v, pos = self.eat()
        if k == "num":
            return sp.Float(float(v), 30)
        if k == "id":
            low = v.lower()
            nk, nv, _ = self.peek()
            if nk == "op" and nv == "(":
                if low not in FUNCS1 and low not in FUNCSN:
                    raise OracleSyntaxError(f"unknown function {v}", pos)
                self.eat()
                args = [self.expr()]
                while self.peek()[0] == "op" and self.peek()[1] == ",":
                    self.eat()
                    args.append(self.expr())
                k2, v2, p2 = self.eat()
                if not (k2 == "op" and v2 == ")"):
                    raise OracleSyntaxError("expected )", p2)
                return self._func(low, args, pos)
            if low == "pi":
                return sp.pi
            if (self.var == "c" and v == "c") or (self.var == "S" and v in ("S", "s")):
                return self.sym
            raise OracleSyntaxError(f"unknown identifier {v}", pos)
        if k == "op" and v == "(":
            e = self.expr()
            k2, v2, p2 = self.eat()
            if not (k2 == "op" and v2 == ")"):
                raise OracleSyntaxError("expected )", p2)
            return e
        raise OracleSyntaxError("unexpected token", pos)

    def _func(self, name, args, pos):
        if name in FUNCS1:
            if len(args) != 1:
                raise OracleSyntaxError("arity", pos)
            a = args[0]
            if name == "sqrt":
                return sp.Pow(a, sp.Rational(1, 2), evaluate=False)
            if name == "exp":
                return sp.exp(a, evaluate=False)
            if name == "ln":
                return sp.log(a, evaluate=False)
            if name in ("log", "log10"):
                return sp.Mul(sp.log(a, evaluate=False),
                              sp.Pow(sp.log(sp.Integer(10), evaluate=False), sp.Integer(-1), evaluate=False),
                              evaluate=False)
            if name == "abs":
                return sp.Abs(a, evaluate=False)
        if len(args) < 2:
            raise OracleSyntaxError("arity", pos)
        return (sp.Min if name == "min" else sp.Max)(*args, evaluate=False)


def parse_to_sympy(src: str, variable: str = "c"):
    p = _P(src, variable)
    e = p.expr()
    k, v, pos = p.peek()
    if k != "end":
        raise OracleSyntaxError("unexpected trailing input", pos)
    return e, p.sym


def is_valid(src: str, variable: str = "c") -> bool:
    try:
        parse_to_sympy(src, variable)
        return True
    except OracleSyntaxError:
        return False


# ----------------------------------------------------------------------------------------------
# evaluation: mpmath with IEEE edge semantics
# ----------------------------------------------------------------------------------------------

_NAN = float("nan")


def _fin(x) -> bool:
    return isinstance(x, mp.mpf) and mp.isfinite(x) or (isinstance(x, float) and math.isfinite(x))


def _norm(x):
    """Round an mp result to double-overflow semantics."""
    if isinstance(x, float):
        return x
    if mp.isnan(x):
        return _NAN
    if mp.isinf(x):
        return math.inf if x > 0 else -math.inf
    if abs(x) > DBL_MAX:
        return math.inf if x > 0 else -math.inf
    return x


class _Ev:
    def __init__(self):
        self.scale = 0.0
        self.ambiguous = False
        self.nonfinite = False

    def note(self, x):
        if _fin(x):
            self.scale = max(self.scale, float(abs(x)))
        elif isinstance(x, (float, mp.mpf)):
            self.nonfinite = True
        return x

    def ev(self, n, env):
        if n.is_Symbol:
            return env
        if n is sp.pi:
            return mp.pi
        if n.is_Number:
            return mp.mpf(float(n))
        if n.is_Add:
            acc = self.ev(n.args[0], env)
            for a in n.args[1:]:
                acc = self.note(self._add(acc, self.ev(a, env)))
            return acc
        if n.is_Mul:
            acc = self.ev(n.args[0], env)
            for a in n.args[1:]:
                acc = self.note(self._mul(acc, self.ev(a, env)))
            return acc
        if n.is_Pow:
            b, e = self.ev(n.args[0], env), self.ev(n.args[1], env)
            if n.args[1] == sp.Rational(1, 2):
                return self.note(self._sqrt(b))
            return self.note(self._pow(b, e))
        if isinstance(n, sp.exp):
            x = self.ev(n.args[0], env)
            return self.note(self._exp(x))
        if isinstance(n, sp.log):
            return self.note(self._log(self.ev(n.args[0], env)))
        if isinstance(n, sp.Abs):
            x = self.ev(n.args[0], env)
            return self.note(abs(x) if isinstance(x, mp.mpf) else abs(x))
        if isinstance(n, (sp.Min, sp.Max)):
            vals = [self.ev(a, env) for a in n.args]
            if any(isinstance(v, float) and math.isnan(v) for v in vals):
                self.ambiguous = True
                return _NAN
            fv = [float(v) if isinstance(v, mp.mpf) else v for v in vals]
            pick = min if isinstance(n, sp.Min) else max
            return self.note(vals[fv.index(pick(fv))])
        raise TypeError(f"unhandled node {type(n)}")

    # scalar ops on mp.mpf, or python floats (non-finite values and signed zeros)
    @staticmethod
    def _spec(x):
        return isinstance(x, float) and not math.isfinite(x)

    @staticmethod
    def _m(x):
        return mp.mpf(x) if isinstance(x, float) else x

    @staticmethod
    def _sgn(x):
        return math.copysign(1.0, x) if isinstance(x, float) else (-1.0 if x < 0 else 1.0)

    def _add(self, a, b):
        if self._spec(a) or self._spec(b):
            with np.errstate(all="ignore"):
                return float(np.float64(float(a)) + np.float64(float(b)))
        return _norm(self._m(a) + self._m(b))

    def _mul(self, a, b):
        if self._spec(a) or self._spec(b):
            with np.errstate(all="ignore"):
                return float(np.float64(float(a)) * np.float64(float(b)))
        r = self._m(a) * self._m(b)
        if r == 0:  # IEEE signed zero: (-1)*0 = -0.0, which matters for 1/(-0.0) = -inf
            return math.copysign(0.0, self._sgn(a) * self._sgn(b))
        return _norm(r)

    def _pow(self, a, b):
        if self._spec(a) or self._spec(b) or (isinstance(a, float) and a == 0.0):
            with np.errstate(all="ignore"):
                return float(np.power(np.float64(float(a)), np.float64(float(b))))
        a, b = self._m(a), self._m(b)
        if a == 0:
            if b == 0:
                return mp.mpf(1)
            return mp.mpf(0) if b > 0 else math.inf
        if a < 0:
            b = mp.mpf(float(b))  # integrality of the exponent is decided on the *double*, as libm does
            if b != mp.floor(b):
                return _NAN
        try:
            r = a ** b
        except (ZeroDivisionError, ValueError, OverflowError):
            return _NAN
        if isinstance(r, mp.mpc):
            return _NAN
        return _norm(r)

    def _sqrt(self, a):
        if self._spec(a):
            return math.inf if a == math.inf else _NAN
        a = self._m(a)
        return _NAN if a < 0 else mp.sqrt(a)

    def _exp(self, a):
        if self._spec(a):
            return 0.0 if a == -math.inf else (math.inf if a == math.inf else _NAN)
        a = self._m(a)
        if a > 710:
            return math.inf
        return _norm(mp.exp(a))

    def _log(self, a):
        if self._spec(a):
            return math.inf if a == math.inf else _NAN
        a = self._m(a)
        if a < 0:
            return _NAN
        if a == 0:
            return -math.inf
        return mp.log(a)


def evaluate(src: str, x: float, variable: str = "c"):
    """-> (value or None if invalid (nan/inf), scale, ambiguous)."""
    tree, _ = parse_to_sympy(src, variable)
    return eval_tree(tree, x)


def eval_tree(tree, x: float):
    return eval_full(tree, x)[:3]


def eval_full(tree, x: float):
    """-> (value|None, scale, ambiguous, saw_nonfinite_intermediate)"""
    e = _Ev()
    v = e.ev(tree, mp.mpf(float(x)))
    v = _norm(v) if not isinstance(v, float) else v
    if isinstance(v, float):
        val = v if math.isfinite(v) else None
    else:
        val = float(v)
        if not math.isfinite(val):
            val = None
    e.note(val if val is not None else 0.0)
    return val, e.scale, e.ambiguous, e.nonfinite


def tol_ok(got, ref, scale, rel=1e-9, scale_rel=1e-12):
    return abs(got - ref) <= rel * abs(ref) + scale_rel * scale + 1e-300


# ----------------------------------------------------------------------------------------------
# Excel evaluator (real Excel semantics)
# ----------------------------------------------------------------------------------------------

_XTOK = re.compile(r"\s*(?:(?P<num>(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(?P<id>[A-Za-z_][A-Za-z_0-9.]*)|(?P<op>\S))")


class ExcelError(Exception):
    pass


def excel_eval(formula: str, a1: float) -> float:
    """Evaluate an Excel expression (no leading '=') with A1 bound.  nan/inf -> #NUM!/#DIV/0!."""
    toks, i = [], 0
    while i < len(formula):
        m = _XTOK.match(formula, i)
        if not m or m.end() == i:
            break
        i = m.end()
        for kind in ("num", "id", "op"):
            if m.group(kind) is not None:
                toks.append((kind, m.group(kind)))
                break
    toks.append(("end", ""))
    pos = [0]

    def peek():
        return toks[pos[0]]

    def eat():
        t = toks[pos[0]]
        pos[0] += 1
        return t

    def need(v):
        k, t = eat()
        if t != v:
            raise ExcelError(f"expected {v} got {t}")

    def add():
        left = mul()
        while peek() in (("op", "+"), ("op", "-")):
            op = eat()[1]
            r = mul()
            left = left + r if op == "+" else left - r
        return left

    def mul():
        left = pw()
        while peek() in (("op", "*"), ("op", "/")):
            op = eat()[1]
            r = pw()
            if op == "*":
                left = left * r
            else:
                if r == 0:
                    raise ExcelError("#DIV/0!")
                left = left / r
        return left

    def pw():  # Excel: left-associative, operands are *prefix-unary* expressions
        left = pre()
        while peek() == ("op", "^"):
            eat()
            r = pre()
            left = xpow(left, r)
        return left

    def pre():  # unary minus binds tighter than ^ in Excel
        if peek() == ("op", "-"):
            eat()
            return -pre()
        if peek() == ("op", "+"):
            eat()
            return pre()
        return atom()

    def atom():
        k, t = eat()
        if k == "num":
            return float(t)
        if k == "op" and t == "(":
            v = add()
            need(")")
            return v
        if k == "id":
            up = t.upper()
            if peek() == ("op", "("):
                eat()
                args = []
                if peek() != ("op", ")"):
                    args.append(add())
                    while peek() == ("op", ","):
                        eat()
                        args.append(add())
                need(")")
                return call(up, args)
            if up == "A1":
                return a1
            raise ExcelError(f"name {t}")
        raise ExcelError(f"unexpected {t!r}")

    def call(name, args):
        if name == "PI":
            return math.pi
        if name in ("SQRT", "EXP", "LN", "LOG10", "ABS") and len(args) != 1:
            raise ExcelError("arity")
        if name == "SQRT":
            if args[0] < 0:
                raise ExcelError("#NUM!")
            return math.sqrt(args[0])
        if name == "EXP":
            try:
                return math.exp(args[0])
            except OverflowError:
                raise ExcelError("#NUM!")
        if name == "LN":
            if args[0] <= 0:
                raise ExcelError("#NUM!")
            return math.log(args[0])
        if name == "LOG10":
            if args[0] <= 0:
                raise ExcelError("#NUM!")
            return math.log10(args[0])
        if name == "ABS":
            return abs(args[0])
        if name == "MIN":
            return min(args)
        if name == "MAX":
            return max(args)
        raise ExcelError(f"function {name}")

    def xpow(a, b):
        if a == 0 and b == 0:
            return 1.0  # real Excel gives #NUM!; spec float semantics give 1 - tests avoid relying on it
        if a == 0 and b < 0:
            raise ExcelError("#DIV/0!")
        if a < 0 and b != math.floor(b):
            raise ExcelError("#NUM!")
        try:
            return math.pow(a, b)
        except OverflowError:
            raise ExcelError("#NUM!")
        except ValueError:
            raise ExcelError("#NUM!")

    try:
        v = add()
        if peek()[0] != "end":
            raise ExcelError("trailing")
    except ExcelError as e:
        if str(e).startswith("#"):
            return float("nan")
        raise
    except (OverflowError, ZeroDivisionError):
        return float("nan")
    return v if math.isfinite(v) else float("nan")


# ----------------------------------------------------------------------------------------------
# tables (spec §3)
# ----------------------------------------------------------------------------------------------


def _avg_dups(pts):
    d: dict[float, list[float]] = {}
    for c, v in pts:
        d.setdefault(float(c), []).append(float(v))
    return sorted((c, float(np.mean(v))) for c, v in d.items())


class Interp:
    """PCHIP on linear c; flat below; above the last point flat, or linear with the end slope if `extend`."""

    def __init__(self, pts, extend=False):
        pts = _avg_dups(pts)
        self.x = np.array([p[0] for p in pts])
        self.y = np.array([p[1] for p in pts])
        if len(pts) >= 2:
            self.f = PchipInterpolator(self.x, self.y)
        else:
            self.f = None
        self.k = float(self.f.derivative()(self.x[-1])) if (extend and self.f is not None) else 0.0

    def __call__(self, c):
        c = np.asarray(c, dtype=float)
        if len(self.x) == 0:
            return np.zeros_like(c)
        if self.f is None:
            return np.full_like(c, self.y[0])
        return self.f(np.clip(c, self.x[0], self.x[-1])) + self.k * np.maximum(c - self.x[-1], 0.0)


def replicate_model(concs, cells):
    """-> (mean Interp, sd Interp, per-column stats list)."""
    mean_pts, sd_pts, stats_ = [], [], []
    for c, col in zip(concs, cells):
        vals = [float(v) for v in col if v is not None and math.isfinite(float(v))]
        if not vals:
            stats_.append((c, None, None, 0))
            continue
        m = float(np.mean(vals))
        mean_pts.append((c, m))
        s = float(np.std(vals, ddof=1)) if len(vals) >= 2 else None
        if s is not None:
            sd_pts.append((c, s))
        stats_.append((c, m, s, len(vals)))
    return Interp(mean_pts, extend=True), Interp(sd_pts), stats_


def summary_model(rows):
    return Interp([(r["c"], r["mean"]) for r in rows], extend=True), Interp([(r["c"], r["sd"]) for r in rows])


# ----------------------------------------------------------------------------------------------
# separation metrics (spec §5)
# ----------------------------------------------------------------------------------------------


def exact_ovl(mu1, s1, mu2, s2):
    """integral of min(pdf1, pdf2) over the real line, exact: split at the pdf crossings, and on each
    piece the minimum is a single Gaussian whose mass is a cdf difference."""
    if s1 <= 0 or s2 <= 0:
        return None
    n1, n2 = stats.norm(mu1, s1), stats.norm(mu2, s2)
    a = 1 / s1**2 - 1 / s2**2
    b = -2 * mu1 / s1**2 + 2 * mu2 / s2**2
    cc = mu1**2 / s1**2 - mu2**2 / s2**2 - 2 * math.log(s2 / s1)
    roots = []
    if abs(a) < 1e-13 * max(1 / s1**2, 1 / s2**2):
        if b != 0:
            roots = [-cc / b]
    else:
        disc = b * b - 4 * a * cc
        if disc >= 0:
            sq = math.sqrt(disc)
            roots = [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
    pts = [-math.inf] + sorted(set(roots)) + [math.inf]
    total = 0.0
    for x0, x1 in zip(pts[:-1], pts[1:]):
        if x0 == -math.inf and x1 == math.inf:
            mid = 0.5 * (mu1 + mu2)
        elif x0 == -math.inf:
            mid = x1 - 1.0 * max(s1, s2)
        elif x1 == math.inf:
            mid = x0 + 1.0 * max(s1, s2)
        else:
            mid = 0.5 * (x0 + x1)
        n = n1 if n1.logpdf(mid) < n2.logpdf(mid) else n2
        # mass of n on [x0, x1], computed from the lighter tail for accuracy
        if x0 >= n.mean():
            total += n.sf(x0) - n.sf(x1)
        else:
            total += n.cdf(x1) - n.cdf(x0)
    return total


def exact_err(mu1, s1, mu2, s2):
    """0.5*(P(X_lo wrong side) + P(X_hi wrong side)) at the pdf crossing between the means."""
    if s1 <= 0 or s2 <= 0:
        return None
    if mu1 == mu2:
        return 0.5
    (ma, sa), (mb, sb) = sorted([(mu1, s1), (mu2, s2)])  # a is lower mean
    if abs(sa - sb) <= 1e-12 * (sa + sb):
        t = 0.5 * (ma + mb)
    else:
        def g(x):
            return stats.norm.logpdf(x, ma, sa) - stats.norm.logpdf(x, mb, sb)
        ga, gb = g(ma), g(mb)
        if ga * gb < 0:
            t = optimize.brentq(g, ma, mb, xtol=1e-14 * max(1.0, abs(ma), abs(mb)), rtol=1e-14, maxiter=500)
        else:
            t = 0.5 * (ma + mb)
    return 0.5 * (stats.norm.sf(t, ma, sa) + stats.norm.cdf(t, mb, sb))


def metric_row(mu1, mu2, s1, s2):
    dmu = mu2 - mu1
    with np.errstate(all="ignore"):
        dsum = dmu / (s1 + s2)
        ssmd = dmu / math.sqrt(s1 * s1 + s2 * s2)
        zp = 1 - 3 * (s1 + s2) / abs(dmu)
    return dict(dmu=dmu, dsum=dsum, ssmd=ssmd, zprime=zp)


def passes(metric, value, k):
    if metric == "zprime":
        return value >= k
    return abs(value) >= k
