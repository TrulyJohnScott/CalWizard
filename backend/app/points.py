"""Your concentrations (core design): the points being evaluated, separate from the calibration data. Each is
measured with its own number of strips (default limits.reads); only within-run noise averages over strips. Each point
is judged against the one below it, 0 first. Ported to frontend/src/state/points.ts."""
from __future__ import annotations

from . import analysis as A
from .series import Model


class _View:
    """The curve as the points see it: the same mean, the SD of one result at each point."""

    def __init__(self, model: Model, strips: dict[float, int], default: int):
        self._m, self._strips, self._default = model, strips, default
        self.series, self.c_max = model.series, model.c_max

    def mean(self, c):
        return self._m.mean(c)

    def sd(self, c):
        return self._m.sd_reads(c, self._strips.get(float(c), self._default))


def steps(model: Model, metric: str | None = None, k: float | None = None) -> dict:
    """{points: [{c, strips, mean, sd}], steps: [{a, b, value, n, q, apart, misread}], apart, total}."""
    s = model.series
    metric = A.check_metric(metric or s.metric)
    k = float(s.k_target if k is None else k)
    default = int(s.limits.reads)
    strips = {float(p.c): int(p.strips or default) for p in s.points}
    view = _View(model, strips, default)
    cs = [0.0] + sorted({float(p.c) for p in s.points if p.c > 0})
    pts = [{"c": c, "strips": strips.get(c, default), "mean": float(view.mean(c)), "sd": float(view.sd(c))} for c in cs]
    out = []
    for a, b in zip(cs, cs[1:]):
        row = A.pair(view, a, b, metric, k)
        q = A.closeness_q(row, metric, k)
        out.append({"a": a, "b": b, "value": row[metric], "n": q * k, "q": q, "apart": bool(q >= 1), "misread": row["err"]})
    return {"metric": metric, "k": k, "points": pts, "steps": out, "apart": sum(x["apart"] for x in out), "total": len(out)}
