"""Spec section 23: conditions. Several curves of the same assay (lots, readers, days, sites) compared against a
reference, and the spread between them turned into one variability layer.

Pure functions of compiled Models; ported to frontend/src/math/conditions.ts (parity via the fixtures).
"""
from __future__ import annotations

import math
import statistics

from . import analysis as A
from . import limits as L
from .series import Model


def _sd(v: list[float]) -> float:
    return statistics.stdev(v) if len(v) > 1 else 0.0


def compare(models: list[Model], concs=None) -> dict:
    """The first model is the reference. Per condition: headline claims. Per concentration (default: the
    reference's levels): each condition's mean signal, its bias against the reference as a fraction of the reference
    signal, and the concentration the reference curve would report for it. `between` sizes the spread as a layer:
    offsetSd = SD of the blank signals, gainCv = median over c > 0 of SD(rise_i(c)) / mean(rise_i(c)), where
    rise_i(c) = mean_i(c) - mean_i(0). None with fewer than two conditions."""
    if not models:
        raise ValueError("compare needs at least one series")
    ref = models[0]
    cs = [float(c) for c in (ref.levels if concs is None else concs)]
    if not all(math.isfinite(c) and c >= 0 for c in cs):
        raise ValueError("concentrations must be finite and >= 0")
    summary = []
    for m in models:
        s = m.series
        lim = L.limits(m, s.limits.alpha, s.limits.beta, s.limits.cv, s.limits.reads, profile=False)
        summary.append({"name": s.name, "levels": len(A.ladder(m, s.metric, s.k_target)),
                        "lod": None if lim["lod"] is None else lim["lod"]["c"],
                        "loq": None if lim["loq"] is None else lim["loq"]["c"]})
    rows = []
    for c in cs:
        means = [float(m.mean(c)) for m in models]
        back = ref.inverse(means)
        rows.append({"c": c, "mean": means,
                     "bias": [(mu - means[0]) / means[0] if means[0] != 0 else None for mu in means],
                     "readsAs": back,
                     "concBias": [None if (b is None or c == 0) else (b - c) / c for b in back]})
    between = None
    if len(models) > 1:
        blanks = [float(m.mean(0.0)) for m in models]
        ratios = []
        for c in cs:
            if c <= 0:
                continue
            rise = [float(m.mean(c)) - b for m, b in zip(models, blanks)]
            avg = sum(rise) / len(rise)
            if avg != 0:
                ratios.append(_sd(rise) / abs(avg))
        between = {"units": len(models), "offsetSd": _sd(blanks),
                   "gainCv": statistics.median(ratios) if ratios else 0.0}
    return {"reference": ref.series.name, "conditions": summary, "rows": rows, "between": between}
