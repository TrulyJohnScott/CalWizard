"""Spec §2 (expression language) and the Excel emission, checked against a sympy/mpmath oracle."""
from __future__ import annotations

import math

import pytest
from hypothesis import HealthCheck, Verbosity, given, settings, strategies as st

from . import oracle as O

pytestmark = pytest.mark.filterwarnings("ignore::RuntimeWarning")  # see test_infinite_mean_leaks_no_runtime_warning

GRID = [-2.0, -0.5, 0.0, 0.25, 0.5, 1.0, 2.0, 3.7, 10.0, 40.0, 123.456]
POS_GRID = [0.37, 1.13, 2.71, 6.9, 13.3, 41.7]

CURATED = [
    # precedence of unary minus / power / associativity
    "c", "-c", "+c", "--c", "-+-c", "+-+c", "-2^2", "(-2)^2", "-(2)^2", "2^3^2", "2^-1", "2^-3^2",
    "-c^2", "(-c)^2", "-(c)^2", "-(c^2)", "c^2^0.5", "c^-1", "2^c^2", "2^-c", "-2^-2", "(2^3)^2",
    "c^0", "0^c", "c^2*3", "3*c^2", "2*c^2/3", "-c^2+c",
    # additive / multiplicative chains
    "c+1", "c-1", "1-c", "c - -c", "c - - - c", "c--c", "c+-c", "c*-c", "c/-2", "c*+2", "8/4/2",
    "2-3-4", "2-(3-4)", "1/2/4", "2*3/4*5", "c/2/c", "10-c-c-c", "1-2+3-4+5",
    # numbers
    "1e3", "1E3", "1e+3", "1e-3*c", "2.5e2+c", ".5", ".5*c", ".25e1", "0.5e-1", "007", "1.50", "1e0",
    "12345.678e-2",
    # whitespace
    " c + 1 ", "c\t+\n2", "sqrt ( c + 1 )", "  -  c  ", "2 ^ - 1", "1  +  2",
    # functions & case-insensitivity
    "sqrt(c)", "SQRT(c+1)", "Sqrt(c*c)", "sQrT(4)", "exp(c/10)", "EXP(-c)", "Exp(0)",
    "ln(c+3)", "LN(c+3)", "log(c+3)", "LOG(c+3)", "Log(100)", "log(1000)", "log10(c+3)", "LOG10(1000*c+1)",
    "abs(c-3)", "ABS(-c)", "Abs(c)^2", "min(c,3)", "MAX(c,3)", "Min(c,3,1)", "max(c, 2, 5, 1)",
    "min(max(c,1),4)", "max(min(c,1),-1)", "pi", "pi*c", "2*pi", "pi^2", "-pi", "pi/2",
    "-exp(c)^2", "exp(-c^2)", "ln(exp(c))", "log(10^c)", "sqrt(abs(c))", "abs(-abs(c))",
    "((((c))))", "(((c+1)))*(((2)))", "sqrt(15^2 + (0.08*c)^2)",
    # presets from the spec
    "4000 + (50 - 4000)/(1 + (c/40)^1.2)",
    "4000 + (50 - 4000)/(1 + (c/40)^1.2)^0.8",
    "50 + 12*c^0.8", "50 + 900*ln(1 + c/20)", "5 + 2*c + 0.3*c^2", "50 + 10*(exp(0.05*c) - 1)",
    "2 + 0.05*c^1.1",
    # domain edges (must come back invalid == null, not crash)
    "ln(0)", "ln(c)", "log(c)", "sqrt(c)", "1/c", "1/(c-1)", "c^0.5", "(-8)^(1/3)", "0^-1", "exp(1000)",
    "exp(710)", "1e308*10", "-1e308*10", "(1e308*10)-(1e308*10)", "1/(1/c)",
]
CURATED = [e for e in CURATED if e]


def _series_mean(expr):
    return {"name": "x", "mode": "equations", "meanExpr": expr, "sdExpr": "1", "levels": [0, 1], "cMax": 1}


def _series_sd(expr):
    return {"name": "x", "mode": "equations", "meanExpr": "c", "sdExpr": expr, "levels": [0, 1], "cMax": 1}


def _evaluate(client, series, grid):
    r = client.post("/api/evaluate", json={"series": series, "grid": grid})
    return r


def _check_series(vals, expr, variable, grid, got, what):
    """Compare list `got` with oracle at the S/c = grid points; returns list of problems."""
    tree, _ = O.parse_to_sympy(expr, variable)
    problems = []
    for x, g in zip(grid, got):
        ref, scale, amb = O.eval_tree(tree, x)
        if amb:
            continue
        if ref is None:
            if g is not None:
                problems.append(f"{what}({x}): expected invalid(null) got {g!r}")
        else:
            if g is None or not O.tol_ok(g, ref, scale):
                problems.append(f"{what}({x}): expected {ref!r} got {g!r}")
    return problems


# ---------------------------------------------------------------------------------------------
# 1. value agreement
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("expr", CURATED)
def test_mean_expression_matches_sympy(client, expr):
    r = _evaluate(client, _series_mean(expr), GRID)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["grid"] == GRID
    assert _check_series(None, expr, "c", GRID, d["mean"], "mean") == []


def _to_sd_var(expr, var):
    """rename the variable c -> S/s (only whole-word `c`, not inside `exp` etc.)."""
    import re
    return re.sub(r"(?<![A-Za-z0-9_])c(?![A-Za-z0-9_(])", var, expr)


@pytest.mark.parametrize("var", ["S", "s"])
@pytest.mark.parametrize("expr", [e for e in CURATED if "pi" not in e or True])
def test_sd_expression_matches_sympy(client, expr, var):
    sdexpr = _to_sd_var(expr, var)
    # S = mean(c) = c on the grid; keep S >= 0 like a real signal
    grid = [g for g in GRID if g >= 0]
    r = _evaluate(client, _series_sd(sdexpr), grid)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mean"] == pytest.approx(grid)
    tree, _ = O.parse_to_sympy(sdexpr, "S")
    for x, g in zip(grid, d["sd"]):
        ref, scale, amb = O.eval_tree(tree, x)
        if amb:
            continue
        if ref is None:
            assert g is None, f"sd({x}) of {sdexpr!r}: expected null, got {g!r}"
        else:
            assert g is not None and O.tol_ok(g, ref, scale), f"sd({x}) of {sdexpr!r}: {g!r} vs {ref!r}"


def test_known_constants():
    """Sanity of the oracle itself against hand-computed truth."""
    assert O.evaluate("-2^2", 0)[0] == -4
    assert O.evaluate("2^3^2", 0)[0] == 512
    assert O.evaluate("2^-1", 0)[0] == 0.5
    assert O.evaluate("log(1000)", 0)[0] == pytest.approx(3)
    assert O.evaluate("ln(exp(2))", 0)[0] == pytest.approx(2)
    assert O.evaluate("8/4/2", 0)[0] == 1
    assert O.evaluate("2-3-4", 0)[0] == -5
    assert O.evaluate("1e3", 0)[0] == 1000
    assert O.evaluate(".5", 0)[0] == 0.5
    assert O.evaluate("-c^2", 3)[0] == -9


def test_hand_values_through_api(client):
    """Truth known by hand (not through any oracle code)."""
    cases = {"-2^2": -4.0, "(-2)^2": 4.0, "2^3^2": 512.0, "2^-1": 0.5, "-c^2": -9.0, "log(1000)": 3.0,
             "ln(1)": 0.0, "log10(100)": 2.0, "max(1,2,3)": 3.0, "min(4,2,9)": 2.0, "abs(-7)": 7.0,
             "sqrt(16)": 4.0, "2-3-4": -5.0, "100/10/5": 2.0, "1e2": 100.0, ".5+.5": 1.0,
             "2*3^2": 18.0, "-2^-2": -0.25, "exp(0)": 1.0, "10-2-3": 5.0}
    r = _evaluate(client, _series_mean("0"), [3.0]).json()  # warm
    for expr, want in cases.items():
        d = _evaluate(client, _series_mean(expr), [3.0]).json()
        assert d["mean"][0] == pytest.approx(want, rel=1e-12), expr
    d = _evaluate(client, _series_mean("pi"), [0.0]).json()
    assert d["mean"][0] == pytest.approx(math.pi, rel=1e-14)


# ---------------------------------------------------------------------------------------------
# errors
# ---------------------------------------------------------------------------------------------

BAD_C = ["", "   ", "x", "1+x", "c+", "*c", "(c", "c)", "c+)", "()", "c ++* 2", "sin(c)", "sqrt()", "1..2",
         "c^", "c^^2", "c,2", "2 3", "c c", "(c)(c)", "c=1", "#", "S", "s", "e", "1+S", "foo(c)", "c+*2",
         "max(,c)", "max(c,)", "2*", "-", "+", "((c)", "c))", "1e", "$c", "c%", "c!", "[c]", "c**2",
         "sqrt(c", "log(c))", "exp c", "pi(", "ln()", "2 +* 3"]
_S_MAP = {"S": "c", "s": "c", "1+S": "1+c"}
BAD_S = [_S_MAP.get(e, e.replace("c", "S")) for e in BAD_C]


@pytest.mark.parametrize("expr", BAD_C)
def test_parse_rejects_bad_mean_expr(client, expr):
    r = client.post("/api/parse", json={"expr": expr, "variable": "c"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is False, f"{expr!r} accepted: {d}"
    assert isinstance(d.get("pos"), int) and 0 <= d["pos"] <= len(expr), d
    assert isinstance(d.get("error"), str) and d["error"]


@pytest.mark.parametrize("expr", BAD_S)
def test_parse_rejects_bad_sd_expr(client, expr):
    r = client.post("/api/parse", json={"expr": expr, "variable": "S"})
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is False, f"{expr!r} accepted: {d}"
    assert isinstance(d.get("pos"), int) and 0 <= d["pos"] <= len(expr)


@pytest.mark.parametrize("expr,idx", [("1+x", 2), ("2^-1+a", 5), ("  foo + 1", 2), ("c + S", 4),
                                      ("sqrt(c) * q", 10)])
def test_error_position_points_at_offending_identifier(client, expr, idx):
    d = client.post("/api/parse", json={"expr": expr, "variable": "c"}).json()
    assert d["ok"] is False
    # SPEC AMBIGUITY: "character position" is not stated to be 0- or 1-based; accept either.
    assert d["pos"] in (idx, idx + 1)


@pytest.mark.parametrize("expr,idx", [("c)", 1), ("1 + * 2", 4), ("(1+2", 4)])
def test_error_position_for_syntax_errors(client, expr, idx):
    d = client.post("/api/parse", json={"expr": expr, "variable": "c"}).json()
    assert d["ok"] is False
    assert d["pos"] in (idx, idx + 1, idx - 1) and 0 <= d["pos"] <= len(expr)


def test_wrong_variable_in_each_field(client):
    base = {"name": "x", "mode": "equations", "levels": [0, 1], "cMax": 1}
    for mean, sd in [("S + 1", "1"), ("s", "1"), ("c", "c + 1"), ("c", "2*c"), ("c", "1 + (")]:
        r = client.post("/api/evaluate", json={"series": {**base, "meanExpr": mean, "sdExpr": sd}})
        assert r.status_code in (400, 422), (mean, sd, r.status_code, r.text)
        assert "pos" in r.text
        r2 = client.post("/api/export", json={"series": {**base, "meanExpr": mean, "sdExpr": sd}})
        assert r2.status_code in (400, 422), (mean, sd, r2.status_code)


def test_variable_accepted_in_the_right_field_only(client):
    for expr, var, ok in [("c", "c", True), ("S", "c", False), ("s", "c", False), ("S", "S", True),
                          ("s", "S", True), ("c", "S", False), ("pi", "c", True), ("pi", "S", True)]:
        d = client.post("/api/parse", json={"expr": expr, "variable": var}).json()
        assert d["ok"] is ok, (expr, var, d)


def test_variable_defaults_and_case(client):
    # variable field may be given as 's' lowercase
    d = client.post("/api/parse", json={"expr": "s+1", "variable": "s"}).json()
    assert d["ok"] is True


def test_function_names_case_insensitive_everywhere(client):
    for name, arg in [("sqrt", "c"), ("exp", "c"), ("ln", "c"), ("log", "c"), ("log10", "c"), ("abs", "c"),
                      ("min", "c,1"), ("max", "c,1")]:
        for variant in (name.upper(), name.capitalize(), name.swapcase()):
            d = client.post("/api/parse", json={"expr": f"{variant}({arg})", "variable": "c"}).json()
            assert d["ok"] is True, variant


# ---------------------------------------------------------------------------------------------
# 2. Excel emission
# ---------------------------------------------------------------------------------------------


def _excel_for(client, expr, var="c"):
    d = client.post("/api/parse", json={"expr": expr, "variable": var}).json()
    assert d["ok"] is True, (expr, d)
    return d["excel"]


def _check_excel(expr, excel, var, grid):
    tree, _ = O.parse_to_sympy(expr, var)
    for x in grid:
        ref, scale, amb, nonfin = O.eval_full(tree, x)
        if amb:
            continue
        got = O.excel_eval(excel, x)
        if ref is None:
            assert math.isnan(got), f"{expr!r} at {x}: oracle invalid, excel {excel!r} gave {got}"
        elif math.isnan(got) and nonfin:
            continue  # IEEE inf intermediates (1/(1/0)) are #DIV/0!/#NUM! in Excel by design
        else:
            assert not math.isnan(got) and O.tol_ok(got, ref, scale), \
                f"{expr!r} -> {excel!r} at {x}: excel {got!r} vs sympy {ref!r}"


@pytest.mark.parametrize("expr", CURATED)
def test_excel_string_equals_sympy_value(client, expr):
    # 0^0 differs between Excel (#NUM!) and plain floats; the spec doesn't define it -> avoid
    if expr in ("c^0", "0^c"):
        grid = [g for g in GRID if g != 0.0]
    else:
        grid = GRID
    _check_excel(expr, _excel_for(client, expr), "c", grid)


@pytest.mark.parametrize("expr", [e for e in CURATED if "c" in e][:60])
def test_excel_string_equals_sympy_value_sd_variable(client, expr):
    sd = _to_sd_var(expr, "S")
    _check_excel(sd, _excel_for(client, sd, "S"), "S", [g for g in GRID if g > 0])


@pytest.mark.parametrize("expr,at,want", [
    ("-2^2", 0, -4), ("2^-1", 0, 0.5), ("-c^2", 3, -9), ("-(c)^2", 3, -9), ("(-c)^2", 3, 9),
    ("c - -c", 3, 6), ("c - - - c", 3, 0), ("2^-c", 2, 0.25), ("-2^-2", 0, -0.25), ("2^3^2", 0, 512),
    ("c^2^2", 3, 81), ("-c^-c", 2, -0.25), ("--c^2", 3, 9), ("1-c^2", 3, -8), ("2*-c^2", 3, -18),
    ("c/-c^2", 2, -0.5),
])
def test_excel_unary_minus_trap(client, expr, at, want):
    excel = _excel_for(client, expr)
    got = O.excel_eval(excel, at)
    assert got == pytest.approx(want, rel=1e-12), f"{expr!r} -> {excel!r} evaluates (Excel semantics) to {got}, want {want}"
    assert O.evaluate(expr, at)[0] == pytest.approx(want)  # oracle agrees with hand truth


def test_excel_uses_spec_function_names(client):
    mapping = {"sqrt(c)": "SQRT(", "exp(c)": "EXP(", "ln(c)": "LN(", "log(c)": "LOG10(", "log10(c)": "LOG10(",
               "abs(c)": "ABS(", "min(c,1)": "MIN(", "max(c,1)": "MAX(", "pi": "PI()"}
    for expr, token in mapping.items():
        x = _excel_for(client, expr)
        assert token in x, (expr, x)
        assert "A1" in x or expr == "pi"
        assert not any(w in x.lower().replace("log10", "").replace("pi()", "") for w in ("ln(" if token != "LN(" else "zzz",))
    assert "log(" not in _excel_for(client, "log(c)").lower().replace("log10(", "")
    assert "LN(" in _excel_for(client, "ln(c)")


def test_excel_variable_cell_is_A1_and_no_python_artifacts(client):
    for expr in ["c", "c*2", "4000 + (50 - 4000)/(1 + (c/40)^1.2)", "sqrt(c)+exp(-c)"]:
        x = _excel_for(client, expr)
        assert "A1" in x
        assert not any(bad in x for bad in ("**", "inf", "nan", "math.", "np."))
        assert x.count("(") == x.count(")")
    x = _excel_for(client, "sqrt(15^2 + (0.08*S)^2)", "S")
    assert "A1" in x and "S" not in x.replace("SQRT", "")


@pytest.mark.parametrize("expr", ["1e-5*c", "1e5*c", "2.5E-3+c", "1e22", "1e-22", "123456789.123456789*c", "1e15+c"])
def test_excel_number_formats_are_excel_parsable(client, expr):
    x = _excel_for(client, expr)
    for v in (0.0, 1.0, 7.5):
        got = O.excel_eval(x, v)
        ref, scale, _ = O.evaluate(expr, v)
        assert O.tol_ok(got, ref, scale), (expr, x, got, ref)


def test_excel_matches_formulas_package(client):
    """cross-check my tiny Excel evaluator (and the emitted text) against the `formulas` engine."""
    formulas = pytest.importorskip("formulas")
    exprs = ["-2^2", "2^-1", "-c^2", "(-c)^2", "c - -c", "4000 + (50 - 4000)/(1 + (c/40)^1.2)",
             "sqrt(15^2 + (0.08*c)^2)", "log(c+3)+ln(c+3)+log10(c+3)", "max(c,2)-min(c,2)+abs(-c)",
             "50 + 900*ln(1 + c/20)", "exp(-c)*pi", "2^3^2", "-exp(c)^2", "2^-c^2"]
    for expr in exprs:
        x = _excel_for(client, expr)
        func = formulas.Parser().ast("=" + x)[1].compile()
        for v in (0.5, 1.0, 3.0, 7.25):
            got = float(func(v) if func.inputs else func())  # A1 is the single input
            mine = O.excel_eval(x, v)
            assert got == pytest.approx(mine, rel=1e-12, abs=1e-12), (expr, x, v, got, mine)
            ref, scale, _ = O.evaluate(expr, v)
            assert O.tol_ok(got, ref, scale), (expr, x, v, got, ref)


# ---------------------------------------------------------------------------------------------
# hypothesis: random expressions from the grammar
# ---------------------------------------------------------------------------------------------

NUMS = ["0", "1", "2", "3", "5", "0.5", ".5", "1.5", "2.5", "10", "100", "1e2", "1E-2", "2.5e+1", ".25e1",
        "0.001", "7", "13", "1e3", "3.14159"]


def leaf(var):
    return st.one_of(st.sampled_from(NUMS).map(lambda s: ("num", s)), st.just(("var", var)),
                     st.just(("var", var)), st.just(("pi",)))


def build(var, depth):
    if depth == 0:
        return leaf(var)
    sub = st.deferred(lambda: build(var, depth - 1))
    return st.one_of(
        leaf(var),
        st.tuples(st.just("bin"), st.sampled_from(["+", "-", "*", "/"]), sub, sub),
        st.tuples(st.just("pow"), sub, sub),
        st.tuples(st.just("neg"), st.sampled_from(["-", "+"]), sub),
        st.tuples(st.just("f1"), st.sampled_from(sorted(O.FUNCS1)), st.sampled_from([0, 1, 2]), sub),
        st.tuples(st.just("fn"), st.sampled_from(sorted(O.FUNCSN)), st.lists(sub, min_size=2, max_size=3)),
        st.tuples(st.just("paren"), sub),
    )


ADD, MUL, UN, POW, ATOM = 1, 2, 3, 4, 5


def prec(n):
    k = n[0]
    if k == "bin":
        return ADD if n[1] in "+-" else MUL
    if k == "neg":
        return UN
    if k == "pow":
        return POW
    return ATOM


def render(n, need, ws):
    s, p = _render(n, ws)
    return f"({s})" if p < need else s


def _render(n, ws):
    sp_ = ws
    k = n[0]
    if k == "num":
        return n[1], ATOM
    if k == "var":
        return n[1], ATOM
    if k == "pi":
        return "pi", ATOM
    if k == "paren":
        return f"({render(n[1], 0, ws)})", ATOM
    if k == "neg":
        return f"{n[1]}{sp_}{render(n[2], UN, ws)}", UN
    if k == "pow":
        return f"{render(n[1], ATOM, ws)}{sp_}^{sp_}{render(n[2], UN, ws)}", POW
    if k == "bin":
        op = n[1]
        lp = ADD if op in "+-" else MUL
        rp = lp + 1
        return f"{render(n[2], lp, ws)}{sp_}{op}{sp_}{render(n[3], rp, ws)}", lp
    if k == "f1":
        name = n[1]
        name = [name, name.upper(), name.capitalize()][n[2]]
        return f"{name}{sp_}({render(n[3], 0, ws)})", ATOM
    if k == "fn":
        name = n[1]
        return f"{name}({(',' + sp_).join(render(a, 0, ws) for a in n[2])})", ATOM
    raise AssertionError(k)


def direct_eval(n, x):
    """Evaluate the generated AST with *no parsing at all* (python floats) to validate the parser oracle."""
    import numpy as np
    k = n[0]
    with np.errstate(all="ignore"):
        if k == "num":
            return np.float64(float(n[1]))
        if k == "var":
            return np.float64(x)
        if k == "pi":
            return np.float64(math.pi)
        if k == "paren":
            return direct_eval(n[1], x)
        if k == "neg":
            v = direct_eval(n[2], x)
            return -v if n[1] == "-" else v
        if k == "pow":
            return np.power(direct_eval(n[1], x), direct_eval(n[2], x))
        if k == "bin":
            a, b = direct_eval(n[2], x), direct_eval(n[3], x)
            return {"+": a + b, "-": a - b, "*": a * b, "/": a / b}[n[1]]
        if k == "f1":
            v = direct_eval(n[3], x)
            f = {"sqrt": np.sqrt, "exp": np.exp, "ln": np.log, "log": np.log10, "log10": np.log10,
                 "abs": np.abs}[n[1]]
            return f(v)
        if k == "fn":
            vals = [direct_eval(a, x) for a in n[2]]
            out = vals[0]
            for v in vals[1:]:
                out = np.minimum(out, v) if n[1] == "min" else np.maximum(out, v)
            return out
    raise AssertionError(k)


HSET = dict(max_examples=150, derandomize=True, deadline=None,
            suppress_health_check=list(HealthCheck), database=None)


@st.composite
def rich(draw, var):
    """longer operator chains (3-6 operands) so precedence/associativity interplay is exercised hard."""
    operands = draw(st.lists(build(var, 2), min_size=3, max_size=6))
    ops = draw(st.lists(st.sampled_from(["+", "-", "*", "/", "^", "^"]), min_size=len(operands) - 1,
                        max_size=len(operands) - 1))
    tree = operands[0]
    for op, o in zip(ops, operands[1:]):
        tree = ("pow", tree, o) if op == "^" else ("bin", op, tree, o)
        if draw(st.integers(0, 3)) == 0:
            tree = ("neg", "-", tree)
    return tree


@settings(**HSET)
@given(tree=rich("c"), ws=st.sampled_from(["", " "]))
def test_random_rich_mean_expressions(client, tree, ws):
    _random_mean_case(client, tree, ws)


@settings(**HSET)
@given(tree=rich("S"), ws=st.sampled_from(["", " "]))
def test_random_rich_sd_expressions(client, tree, ws):
    _random_sd_case(client, tree, ws)


@settings(**HSET)
@given(tree=build("c", 4), ws=st.sampled_from(["", " ", "  "]))
def test_random_mean_expressions(client, tree, ws):
    _random_mean_case(client, tree, ws)


def _random_mean_case(client, tree, ws):
    expr = render(tree, 0, ws)
    if len(expr) > 400:
        return
    # oracle self-check: my parser must agree with the generator's own AST evaluation
    ptree, _ = O.parse_to_sympy(expr, "c")
    for x in POS_GRID[:3]:
        ref, scale, amb = O.eval_tree(ptree, x)
        direct = float(direct_eval(tree, x))
        if not amb and ref is not None and math.isfinite(direct):
            assert O.tol_ok(direct, ref, scale, rel=1e-9, scale_rel=1e-11), (expr, x, direct, ref)
    r = _evaluate(client, _series_mean(expr), POS_GRID)
    assert r.status_code == 200, (expr, r.text)
    problems = _check_series(None, expr, "c", POS_GRID, r.json()["mean"], "mean")
    assert not problems, (expr, problems)
    excel = _excel_for(client, expr)
    _check_excel(expr, excel, "c", POS_GRID)


@settings(**HSET)
@given(tree=build("S", 4), ws=st.sampled_from(["", " "]))
def test_random_sd_expressions(client, tree, ws):
    _random_sd_case(client, tree, ws)


def _random_sd_case(client, tree, ws):
    expr = render(tree, 0, ws)
    if len(expr) > 400:
        return
    r = _evaluate(client, _series_sd(expr), POS_GRID)
    assert r.status_code == 200, (expr, r.text)
    d = r.json()
    tree_, _ = O.parse_to_sympy(expr, "S")
    for x, g in zip(POS_GRID, d["sd"]):
        ref, scale, amb = O.eval_tree(tree_, x)
        if amb:
            continue
        if ref is None:
            assert g is None, (expr, x, g)
        else:
            assert g is not None and O.tol_ok(g, ref, scale), (expr, x, g, ref)
    _check_excel(expr, _excel_for(client, expr, "S"), "S", POS_GRID)


_junk = st.text(alphabet="c S0123456789.+-*/^(),eE_pilnsqrtxabmfg\t", max_size=30)


@settings(**HSET)
@given(s=_junk, var=st.sampled_from(["c", "S"]))
def test_random_junk_never_500_and_agrees_on_validity(client, s, var):
    r = client.post("/api/parse", json={"expr": s, "variable": var})
    assert r.status_code == 200, (s, r.status_code)
    d = r.json()
    mine = O.is_valid(s, var)
    if d["ok"] and not mine:
        # SPEC AMBIGUITY (recorded): the app also accepts a number with a bare trailing dot ("2.", "0.E0");
        # the grammar says digits '.' digits.  Anything else the app accepts but the oracle rejects is a bug.
        import re
        assert re.search(r"\d\.(?!\d)", s), f"{s!r} var={var}: app accepted, spec grammar rejects ({d})"
        return
    assert d["ok"] is mine, f"{s!r} var={var}: app ok={d['ok']} oracle valid={mine} ({d})"
    if not d["ok"]:
        assert isinstance(d["pos"], int) and 0 <= d["pos"] <= len(s)


def test_trailing_dot_number_is_accepted_spec_ambiguity(client):
    """Recorded, not asserted either way beyond 'no 5xx': grammar says digits ['.' digits]."""
    for s in ("2.", "2.*c", "0.E0"):
        r = client.post("/api/parse", json={"expr": s, "variable": "c"})
        assert r.status_code == 200 and "ok" in r.json()


def test_infinite_mean_leaks_no_runtime_warning(client):
    """Infinite means must not make numpy emit RuntimeWarnings (the project runs pytest with
    filterwarnings=error, so they surface as HTTP 500s in tests of the same input)."""
    import warnings
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        r = _evaluate(client, _series_mean("ln(0)"), [0.0, 1.0])
    assert r.status_code == 200
    assert not [x for x in w if issubclass(x.category, RuntimeWarning)], [str(x.message) for x in w]
