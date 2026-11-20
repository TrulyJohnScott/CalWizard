"""Spec section 17: client requirements checked against the curve (met or not, the measured value, and how much
tighter the noise would have to be). Ported to frontend/src/math/requirements.ts (parity via the fixtures)."""
from __future__ import annotations

import math

from . import analysis as A
from . import limits as L
from . import metrics as K
from .series import Model, Requirement, Series

KINDS = ("detect", "distinguish", "precision", "range", "levels")
SD_BISECT = 40
SD_FLOOR = 0.01


class _Scaled:
    """The model with every SD multiplied by `s` (what tighter noise would give)."""

    def __init__(self, model: Model, s: float):
        self._m, self._s = model, s
        self.series, self.c_max, self.levels, self.adjusted = model.series, model.c_max, model.levels, model.adjusted

    def mean(self, c):
        return self._m.mean(c)

    def sd(self, c):
        return self._s * self._m.sd(c)

    def inverse(self, signals):
        return self._m.inverse(signals)


def _valid(r: Requirement) -> str | None:
    def pos(v, zero_ok=False):
        return v is not None and math.isfinite(v) and (v >= 0 if zero_ok else v > 0)

    if r.kind == "detect" and not pos(r.c):
        return "needs a concentration c > 0"
    if r.kind == "distinguish" and not (pos(r.c, True) and pos(r.c2, True) and r.c != r.c2):
        return "needs two different concentrations c and c2"
    if r.kind == "precision" and not (pos(r.c) and pos(r.cv)):
        return "needs a concentration c > 0 and a cv > 0"
    if r.kind == "range" and not (pos(r.c) and pos(r.c2) and r.c2 > r.c):
        return "needs c < c2 (both > 0)"
    if r.kind == "levels" and not (r.n is not None and r.n >= 1):
        return "needs n >= 1"
    return None


def _evaluate(model, r: Requirement, s: Series, quick: bool = False) -> tuple[bool, float | None]:
    """(met, measured value) for one valid requirement."""
    lim = s.limits
    if r.kind == "detect":
        lod = L.limits(model, lim.alpha, lim.beta, lim.cv, lim.reads, profile=False)["lod"]
        return (lod is not None and lod["c"] <= r.c), (None if lod is None else lod["c"])
    if r.kind == "distinguish":
        v = float(A.metric_value(model, r.c, r.c2, s.metric))
        return K.passes(s.metric, v, s.k_target), v
    if r.kind == "precision":
        v = L.conc_cv(model, r.c, lim.reads)
        return bool(v <= r.cv), v
    if r.kind == "range":
        cv = lim.cv if r.cv is None else r.cv
        res = L.limits(model, lim.alpha, lim.beta, cv, lim.reads, profile=False)
        loq, uloq = res["loq"], res["uloq"]
        ok = loq is not None and uloq is not None and loq["c"] <= r.c and uloq["c"] >= r.c2
        return ok, (None if loq is None else loq["c"])
    if quick:  # only "does it reach n levels": stop climbing the ladder there
        return len(A.ladder(model, s.metric, s.k_target, max_levels=min(r.n, A.MAX_LEVELS))) >= r.n, None
    n = len(A.ladder(model, s.metric, s.k_target))
    return n >= r.n, float(n)


def check(model: Model) -> dict:
    """Every requirement of the series: {results: [{..., ok, value, sdScale, error}], met, total}.

    `sdScale`: 1 when met; otherwise the largest factor in [0.01, 1) that, multiplied into every SD, makes it
    met (40 bisections), or None when even x0.01 does not."""
    s = model.series
    out = []
    for r in s.requirements:
        base = {"kind": r.kind, "c": r.c, "c2": r.c2, "cv": r.cv, "n": r.n, "label": r.label}
        err = _valid(r)
        if err:
            out.append({**base, "ok": False, "value": None, "sdScale": None, "error": err})
            continue
        ok, value = _evaluate(model, r, s)
        scale = 1.0 if ok else None
        if not ok and _evaluate(_Scaled(model, SD_FLOOR), r, s, True)[0]:
            lo, hi = SD_FLOOR, 1.0
            for _ in range(SD_BISECT):
                mid = 0.5 * (lo + hi)
                if _evaluate(_Scaled(model, mid), r, s, True)[0]:
                    lo = mid
                else:
                    hi = mid
            scale = lo
        out.append({**base, "ok": bool(ok), "value": value, "sdScale": scale, "error": None})
    return {"results": out, "met": sum(1 for r in out if r["ok"]), "total": len(out)}
