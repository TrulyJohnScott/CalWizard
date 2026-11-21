"""Spec section 8: fit mean models (vs c) and SD models (vs signal). Never raises; failures give ok=False.

Every fit returns an `expr` in the section 2 language (4 significant digits) that reproduces the curve.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
from scipy.optimize import least_squares


def fmt(v: float) -> str:
    return f"{v:.4g}"


def _sum(terms) -> str:
    """Join (coef, render) terms with explicit signs; render(abs_text) -> text."""
    out = ""
    for i, (coef, render) in enumerate(terms):
        body = render(fmt(abs(coef)))
        neg = coef < 0 and float(fmt(coef)) != 0
        out += (("-" if neg else "") + body) if i == 0 else (" - " if neg else " + ") + body
    return out


def _const(s):
    return s


def _times(body):
    return lambda s: f"{s}*{body}"


def _over(den):
    return lambda s: f"{s}/{den}"


# --------------------------------------------------------------------------- mean models
def _logistic(c, a, d, C, B, g=1.0):
    return d + (a - d) / (1 + (c / C) ** B) ** g


def _expr_logistic(p, five):
    a, d, C, B = p[:4]
    den = f"(1 + (c/{fmt(C)})^{fmt(B)})"
    if five:
        den = f"{den}^{fmt(p[4])}"
    return _sum([(d, _const), (a - d, _over(den))])


MEAN_MODELS = {
    "linear": dict(label="Linear", names=["a", "b"], f=lambda c, a, b: a + b * c,
                   expr=lambda p: _sum([(p[0], _const), (p[1], _times("c"))])),
    "quadratic": dict(label="Quadratic", names=["a", "b", "q"], f=lambda c, a, b, q: a + b * c + q * c**2,
                      expr=lambda p: _sum([(p[0], _const), (p[1], _times("c")), (p[2], _times("c^2"))])),
    "power": dict(label="Power", names=["a", "b", "p"], f=lambda c, a, b, p: a + b * c**p,
                  expr=lambda p: _sum([(p[0], _const), (p[1], _times(f"c^{fmt(p[2])}"))])),
    "exponential": dict(label="Exponential", names=["a", "b", "k"],
                        f=lambda c, a, b, k: a + b * np.expm1(k * c),
                        expr=lambda p: _sum([(p[0], _const), (p[1], _times(f"(exp({fmt(p[2])}*c) - 1)"))])),
    "log": dict(label="Log", names=["a", "b", "k"], f=lambda c, a, b, k: a + b * np.log1p(c / k),
                expr=lambda p: _sum([(p[0], _const), (p[1], _times(f"ln(1 + c/{fmt(p[2])})"))])),
    "4pl": dict(label="4PL", names=["a", "d", "C", "B"], f=_logistic, expr=lambda p: _expr_logistic(p, False)),
    "5pl": dict(label="5PL", names=["a", "d", "C", "B", "g"], f=_logistic, expr=lambda p: _expr_logistic(p, True)),
}


def _mid_c(c, y, y0, y1):
    """A positive c where the curve is about half way between y0 and y1."""
    uc = np.unique(c)
    pos = uc[uc > 0]
    if not pos.size:
        return 1.0
    m = np.array([y[c == u].mean() for u in pos])
    frac = (m - y0) / (y1 - y0) if y1 != y0 else np.zeros_like(m)
    return float(pos[np.argmin(np.abs(frac - 0.5))])


def _starts(kind, c, y, cmax):
    y0, y1 = float(y[c == c.min()].mean()), float(y[c == c.max()].mean())
    rng = y1 - y0 if y1 != y0 else 1.0
    if kind in ("linear", "quadratic"):
        deg = 1 if kind == "linear" else 2
        co = np.polyfit(c / cmax, y, min(deg, max(len(np.unique(c)) - 1, 0)))
        co = np.concatenate([np.zeros(deg + 1 - len(co)), co])[::-1]
        return [[co[i] / cmax**i for i in range(deg + 1)]]
    if kind == "exponential":
        return [[y0, rng / np.expm1(k * cmax), k] for k in (1 / cmax, 3 / cmax, 6 / cmax)]
    if kind == "power":
        return [[y0, rng / cmax**p, p] for p in (0.5, 1.0, 2.0)]
    if kind == "log":
        return [[y0, rng / np.log1p(cmax / k), k] for k in (cmax * 1e-3, cmax * 1e-2, cmax * 1e-1)]
    d = y1 + 0.1 * rng
    cm = _mid_c(c, y, y0, d)
    base = [[y0, d, cm * f, B] for f in (0.1, 1.0, 10.0) for B in (1.0, 2.0)]
    return [s + [1.0] for s in base] if kind == "5pl" else base


def _bounds(kind, c, y, cmax):
    big = 10 * (np.ptp(y) + abs(y).max() + 1)
    pos = c[c > 0]
    cpos = float(pos.min()) if pos.size else cmax * 1e-3
    free, inf = (-big, big), (-np.inf, np.inf)
    spec = {
        "linear": [free, free], "quadratic": [free, free, inf],
        "exponential": [free, free, (1e-3 / cmax, 50 / cmax)], "power": [free, free, (0.05, 5.0)],
        "log": [free, free, (cmax * 1e-6, cmax * 10)],
        "4pl": [free, free, (cpos * 1e-3, cmax * 100), (0.1, 10.0)],
        "5pl": [free, free, (cpos * 1e-3, cmax * 100), (0.1, 10.0), (0.05, 20.0)],
    }[kind]
    return [b[0] for b in spec], [b[1] for b in spec]


def _clip_start(x0, lo, hi):
    return [float(min(max(v, l + 1e-12 * (abs(l) + 1)), h - 1e-12 * (abs(h) + 1)))
            if np.isfinite(l) or np.isfinite(h) else float(v) for v, l, h in zip(x0, lo, hi)]


def _aicc(n, k, rss):
    if n - k - 1 <= 0:
        return math.inf
    return n * math.log(max(rss, 1e-300) / n) + 2 * k + 2 * k * (k + 1) / (n - k - 1)


def _best_lsq(resid, starts, lo, hi):
    best = None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for x0 in starts:
            try:
                r = least_squares(resid, _clip_start(x0, lo, hi), bounds=(lo, hi), max_nfev=2000)
            except Exception:  # noqa: BLE001 - robust by design
                continue
            if np.isfinite(r.cost) and (best is None or r.cost < best.cost):
                best = r
    return best


def _fail(kind, label):
    return {"kind": kind, "label": label, "params": {}, "expr": None, "r2": None, "aicc": None, "ok": False}


def _result(kind, label, names, x, expr_fn, r2, aicc):
    ok = bool(np.all(np.isfinite(x)))
    return {"kind": kind, "label": label, "params": dict(zip(names, (float(v) for v in x))),
            "expr": expr_fn(list(x)) if ok else None, "r2": r2,
            "aicc": aicc if np.isfinite(aicc) else None, "ok": ok}


def fit_mean(kind, c, y, w, cmax):
    m = MEAN_MODELS[kind]
    names = m["names"]
    if len(c) < len(names) or len(np.unique(c)) < 2:
        return _fail(kind, m["label"])
    lo, hi = _bounds(kind, c, y, cmax)
    best = _best_lsq(lambda x: (m["f"](c, *x) - y) * w, _starts(kind, c, y, cmax), lo, hi)
    if best is None:
        return _fail(kind, m["label"])
    pred = m["f"](c, *best.x)
    rss = float(np.sum((y - pred) ** 2))
    tss = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - rss / tss if tss > 0 else None
    return _result(kind, m["label"], names, best.x, m["expr"], r2, _aicc(len(y), len(names), 2 * best.cost))


# --------------------------------------------------------------------------- sd models (vs signal S)
SD_MODELS = {
    "floor_cv": dict(label="Floor + CV", names=["s0", "cv"], positive_s=False,
                     f=lambda s, s0, cv: np.sqrt(s0**2 + (cv * s) ** 2),
                     expr=lambda p: f"sqrt({fmt(p[0])}^2 + ({fmt(p[1])}*S)^2)"),
    "constant": dict(label="Constant", names=["s0"], positive_s=False,
                     f=lambda s, s0: np.full_like(s, s0), expr=lambda p: fmt(p[0])),
    "cv": dict(label="CV only", names=["cv"], positive_s=True, f=lambda s, cv: cv * s,
               expr=lambda p: f"{fmt(p[0])}*S"),
    "power": dict(label="Power", names=["a", "b", "p"], positive_s=True,
                  f=lambda s, a, b, p: a + b * s**p,
                  expr=lambda p: _sum([(p[0], _const), (p[1], _times(f"S^{fmt(p[2])}"))])),
}


def _sd_starts(kind, s, sd):
    smax = max(float(np.max(np.abs(s))), 1e-9)
    s0, span = float(sd.min()), float(sd.max() - sd.min())
    if kind == "floor_cv":
        return [[max(s0, 1e-6), max(span / smax, 1e-6)], [max(s0, 1e-6), 0.05]]
    if kind == "constant":
        return [[float(np.exp(np.mean(np.log(sd))))]]
    if kind == "cv":
        return [[float(np.median(sd / s))]]
    return [[max(s0, 1e-6), max(span / smax**p, 1e-9), p] for p in (0.5, 1.0, 1.5)]


def fit_sd(kind, s, sd):
    m = SD_MODELS[kind]
    names = m["names"]
    if m["positive_s"]:
        keep = s > 0
        s, sd = s[keep], sd[keep]
    if len(sd) < max(2, len(names)):
        return _fail(kind, m["label"])
    n = len(names)
    lo = [0.0, 0.0, 0.1][:n] if kind == "power" else [0.0] * n
    hi = [np.inf, np.inf, 3.0][:n] if kind == "power" else [np.inf] * n

    def resid(x):
        return np.log(np.maximum(m["f"](s, *x), 1e-12)) - np.log(sd)

    best = _best_lsq(resid, _sd_starts(kind, s, sd), lo, hi)
    if best is None:
        return _fail(kind, m["label"])
    pred = m["f"](s, *best.x)
    tss = float(np.sum((sd - sd.mean()) ** 2))
    r2 = 1 - float(np.sum((sd - pred) ** 2)) / tss if tss > 0 else None
    return _result(kind, m["label"], names, best.x, m["expr"], r2, _aicc(len(sd), n, 2 * best.cost))


def _rank(fits):
    fits.sort(key=lambda f: (not f["ok"], f["aicc"] if f["aicc"] is not None else math.inf))
    return fits


# --------------------------------------------------------------------------- driver
def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _prepare(body: dict):
    """Returns (levels, c, y, w) from `points` (replicates) or `summary` rows."""
    by: dict[float, list[float]] = {}
    for p in body.get("points") or []:
        c, y = _num(p.get("c")), _num(p.get("y"))
        if c is not None and y is not None and c >= 0:
            by.setdefault(c, []).append(y)
    if by:
        levels = []
        for c in sorted(by):
            v = np.array(by[c])
            levels.append({"c": c, "mean": float(v.mean()), "sd": float(v.std(ddof=1)) if v.size > 1 else None,
                           "n": int(v.size)})
        c = np.array([k for k in sorted(by) for _ in by[k]])
        y = np.array([v for k in sorted(by) for v in by[k]])
    else:
        rows = {}
        for r in body.get("summary") or []:
            c, m = _num(r.get("c")), _num(r.get("mean"))
            if c is not None and m is not None and c >= 0:
                rows[c] = (m, _num(r.get("sd")))
        levels = [{"c": k, "mean": rows[k][0], "sd": rows[k][1], "n": 1} for k in sorted(rows)]
        c = np.array([lv["c"] for lv in levels])
        y = np.array([lv["mean"] for lv in levels])
    sd_of = {lv["c"]: lv["sd"] for lv in levels}
    pos = [s for s in sd_of.values() if s and s > 0]
    if levels and pos and all(s is not None for s in sd_of.values()):
        floor = 0.1 * min(pos)
        w = np.array([1.0 / max(sd_of[x], floor) for x in c])
    else:
        w = np.ones_like(c)
    return levels, c, y, w


#: models that may define the curve from data (core design); quadratic is left out: it bends where data stop
CURVE_KINDS = ("4pl", "5pl", "linear", "log", "power", "exponential")
CLEARLY_BETTER = 2.0  # AICc units


def choose(mean_fits: list[dict]) -> dict | None:
    """The curve to use from data: 4PL unless another candidate's AICc is lower by more than CLEARLY_BETTER."""
    ok = [f for f in mean_fits if f["ok"] and f["kind"] in CURVE_KINDS and f["aicc"] is not None and f["expr"]]
    if not ok:
        return None
    best = min(ok, key=lambda f: f["aicc"])
    four = next((f for f in ok if f["kind"] == "4pl"), None)
    pick = four if four is not None and best["aicc"] >= four["aicc"] - CLEARLY_BETTER else best
    return {"kind": pick["kind"], "label": pick["label"], "meanExpr": pick["expr"]}


def run_fit(body: dict) -> dict:
    """Body for POST /api/fit: {points?, summary?} -> {levels, meanFits, sdFits}. Never raises."""
    try:
        levels, c, y, w = _prepare(body if isinstance(body, dict) else {})
    except Exception:  # noqa: BLE001
        return {"levels": [], "meanFits": [], "sdFits": [], "chosen": None}
    cmax = float(c.max()) if len(c) and c.max() > 0 else 1.0
    mean_fits = []
    for kind, m in MEAN_MODELS.items():
        try:
            mean_fits.append(fit_mean(kind, c, y, w, cmax) if len(c) else _fail(kind, m["label"]))
        except Exception:  # noqa: BLE001
            mean_fits.append(_fail(kind, m["label"]))
    lv = [x for x in levels if x["sd"] is not None and x["sd"] > 0]
    s = np.array([x["mean"] for x in lv])
    sd = np.array([x["sd"] for x in lv])
    sd_fits = []
    for kind, m in SD_MODELS.items():
        try:
            sd_fits.append(fit_sd(kind, s, sd))
        except Exception:  # noqa: BLE001
            sd_fits.append(_fail(kind, m["label"]))
    return {"levels": levels, "meanFits": _rank(mean_fits), "sdFits": _rank(sd_fits), "chosen": choose(mean_fits)}
