"""Spec section 15: detection limits (LoB / LoD / LoQ, CLSI EP17 style), the precision profile, the classical
estimate from blank / low-level replicates, and the simulated verification experiment (the planner).

Pure functions of a compiled `Model`; ported to frontend/src/math/limits.ts (parity via the fixtures).
"""
from __future__ import annotations

import math

import numpy as np
from scipy.special import ndtr, ndtri

from . import experiment as EX
from .series import Model

SCAN = 2000
BISECT = 60
PROFILE_N = 200
SLOPE_H = 1e-4  # derivative step as a fraction of cMax


def direction(model: Model) -> int:
    """+1 when the signal rises with concentration (sandwich), -1 when it falls (competitive)."""
    return model.direction()


def slope(model: Model, c):
    """d mean / dc by a central difference (one-sided at 0), step SLOPE_H * cMax. Scalar or array."""
    c = np.asarray(c, dtype=float)
    h = model.c_max * SLOPE_H
    a, b = np.maximum(c - h, 0.0), c + h
    return (model.mean(b) - model.mean(a)) / (b - a)


def conc_cv(model: Model, c, reads: int = 1):
    """CV of the read-back concentration at c: sd of `reads` averaged readings / (|slope| * c). inf at c = 0 or a flat
    curve. Only within-run noise averages over reads (Model.sd_reads)."""
    c = np.asarray(c, dtype=float)
    with np.errstate(all="ignore"):
        s = np.abs(slope(model, c))
        cv = model.sd_reads(c, reads) / (s * c)
    out = np.where((c > 0) & (s > 0), cv, np.inf)
    return float(out) if out.ndim == 0 else out


def _one(pred, c: float) -> bool:
    return bool(np.asarray(pred(np.float64(c))))


def _first(pred, lo: float, hi: float) -> float | None:
    """Smallest c in [lo, hi] where pred holds: SCAN-interval scan, then BISECT bisections. None if it never holds.
    `pred` takes a scalar or an array of concentrations."""
    cs = lo + (hi - lo) * np.arange(SCAN + 1, dtype=float) / SCAN
    hits = np.flatnonzero(np.asarray(pred(cs), dtype=bool))
    if not hits.size:
        return None
    j = int(hits[0])
    if j == 0:
        return float(cs[0])
    a, b = float(cs[j - 1]), float(cs[j])
    for _ in range(BISECT):
        mid = 0.5 * (a + b)
        if _one(pred, mid):
            b = mid
        else:
            a = mid
    return b


def _last(pred, lo: float, hi: float) -> float | None:
    """Largest c in [lo, hi] where pred holds (scan, then bisect toward the first failing point above it)."""
    cs = lo + (hi - lo) * np.arange(SCAN + 1, dtype=float) / SCAN
    hits = np.flatnonzero(np.asarray(pred(cs), dtype=bool))
    if not hits.size:
        return None
    j = int(hits[-1])
    if j == SCAN:
        return float(cs[SCAN])
    a, b = float(cs[j]), float(cs[j + 1])
    for _ in range(BISECT):
        mid = 0.5 * (a + b)
        if _one(pred, mid):
            a = mid
        else:
            b = mid
    return a


def _check(alpha: float, beta: float, cv: float, reads: int) -> None:
    if not (0 < alpha < 0.5 and 0 < beta < 0.5):
        raise ValueError("alpha and beta must be between 0 and 0.5 (exclusive)")
    if not (math.isfinite(cv) and cv > 0):
        raise ValueError("cv must be > 0")
    if isinstance(reads, bool) or int(reads) != reads or not 1 <= reads <= 1000:
        raise ValueError("reads must be an integer between 1 and 1000")


def limits(model: Model, alpha: float = 0.05, beta: float = 0.05, cv: float = 0.2, reads: int = 1,
           profile: bool = True) -> dict:
    """LoB, LoD, LoQ and the upper limit of quantitation from the curve (spec section 15)."""
    _check(alpha, beta, cv, reads)
    c_max = model.c_top  # claims stop at a hook's peak (15.4)
    d = direction(model)
    mean = model.mean
    sd = lambda c: model.sd_reads(c, reads)  # noqa: E731
    mu0, sd0 = float(mean(0.0)), float(sd(0.0))
    za, zb = float(ndtri(1 - alpha)), float(ndtri(1 - beta))
    lob_s = mu0 + d * za * sd0
    lob_c = _first(lambda c: d * (mean(c) - lob_s) >= 0, 0.0, c_max)
    lod = _first(lambda c: d * (mean(c) - lob_s) - zb * sd(c) >= 0, 0.0, c_max)
    ok = lambda c: conc_cv(model, c, reads) <= cv  # noqa: E731
    loq = uloq = None
    if lod is not None:
        loq = _first(ok, lod, c_max)
        if loq is not None:
            uloq = _last(ok, loq, c_max)

    def at(c):
        return None if c is None else {"c": c, "signal": float(mean(c)), "cv": conc_cv(model, c, reads)}

    out = {
        "alpha": alpha, "beta": beta, "cv": cv, "reads": int(reads), "direction": d,
        "blank": {"mean": mu0, "sd": sd0},
        "lob": {"signal": lob_s, "c": lob_c},
        "lod": at(lod), "loq": at(loq), "uloq": at(uloq), "hook": model.hook(),
        # the CV is still within target at the top of the usable range: the true upper limit lies beyond (15.2)
        "uloqOpen": uloq is not None and uloq >= c_max,
    }
    if profile:
        cs = model.c_max * np.arange(PROFILE_N + 1, dtype=float) / PROFILE_N
        with np.errstate(all="ignore"):
            cvs = np.where(mean(cs) != 0, sd(cs) / np.abs(mean(cs)), np.inf)
        out["profile"] = {"c": cs, "cv": conc_cv(model, cs, reads), "cvSignal": cvs}
    return out


# ---------------------------------------------------------------- classical EP17 estimate from replicates
def _rank_percentile(values: list[float], p: float) -> float:
    """EP17 nonparametric percentile: rank position 0.5 + n p (1-based), linear between neighbouring ranks."""
    v = sorted(values)
    n = len(v)
    pos = min(max(0.5 + n * p, 1.0), float(n))
    i = int(math.floor(pos))
    f = pos - i
    return v[i - 1] + (v[min(i, n - 1)] - v[i - 1]) * f


def _mean_sd(v: list[float]) -> tuple[float, float]:
    n = len(v)
    m = sum(v) / n
    return m, math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1))


def limits_data(model: Model, alpha: float = 0.05, beta: float = 0.05, low_concs: list[float] | None = None) -> dict | None:
    """EP17 classical estimate from the entered replicates: LoB from the blank column (parametric with the c_p
    correction, and the nonparametric rank percentile), LoD = LoB + c_p * pooled SD of the low-level columns.
    None unless the series has a blank column and one low column with at least two readings each."""
    _check(alpha, beta, 0.2, 1)
    s = model.series
    if s.mode != "replicates" or model.adjusted:
        return None
    cols: dict[float, list[float]] = {}
    for c, col in zip(s.replicates.concs, s.replicates.cells):
        if math.isfinite(c):
            cols.setdefault(float(c), []).extend(float(y) for y in col if y is not None and math.isfinite(y))
    blank = cols.get(0.0, [])
    if len(blank) < 2:
        return None
    pos = sorted(c for c, v in cols.items() if c > 0 and len(v) >= 2)
    if low_concs is None:
        low = pos[:2]
    else:
        low = [float(c) for c in low_concs if float(c) in pos]
    if not low:
        return None
    d = direction(model)
    za, zb = float(ndtri(1 - alpha)), float(ndtri(1 - beta))
    mb, sb = _mean_sd(blank)
    nb = len(blank)
    lob_s = mb + d * za / (1 - 1 / (4 * (nb - 1))) * sb
    lob_np = _rank_percentile(blank, 1 - alpha if d > 0 else alpha)
    rows, num, df = [], 0.0, 0
    for c in low:
        m, sdv = _mean_sd(cols[c])
        n = len(cols[c])
        rows.append({"c": c, "n": n, "mean": m, "sd": sdv})
        num += (n - 1) * sdv * sdv
        df += n - 1
    sd_low = math.sqrt(num / df)
    lod_s = lob_s + d * zb / (1 - 1 / (4 * df)) * sd_low
    return {
        "alpha": alpha, "beta": beta, "direction": d,
        "blank": {"n": nb, "mean": mb, "sd": sb},
        "lob": {"signal": lob_s, "signalNonparametric": lob_np, "c": model.inverse([lob_s])[0]},
        "low": rows, "sdLow": sd_low, "df": df,
        "lod": {"signal": lod_s, "c": model.inverse([lod_s])[0]},
    }


# ---------------------------------------------------------------- planner: simulate the verification experiment
def _sig3(x: float) -> float:
    return float(f"{x:.3g}")


def plan(model: Model, n_blank: int = 20, n_low: int = 20, low_concs: list[float] | None = None, runs: int = 500,
         seed: int = 1, alpha: float = 0.05, beta: float = 0.05, conf: float = 0.9, cv: float = 0.2) -> dict:
    """Simulate the EP17 LoB / LoD experiment `runs` times: n_blank blank readings and n_low readings at each low
    concentration per run, the classical estimate from each, and how widely the estimates scatter. When the curve
    has a LoQ (at `cv`), a sample there is read n_low times too: its measured result CV is the signal SD over
    |slope| * c (delta method), and `loq` reports how that scatters and how often it confirms the claim."""
    _check(alpha, beta, cv, 1)
    n_blank = EX._int(n_blank, "nBlank", 2, EX.MAX_N)
    n_low = EX._int(n_low, "nLow", 2, EX.MAX_N)
    runs = EX._int(runs, "runs", 1, EX.MAX_RUNS)
    seed = EX._int(seed, "seed", -(2**53), 2**53)
    if not 0 < conf < 1:
        raise ValueError(f"conf must be between 0 and 1 (exclusive), got {conf!r}")
    truth = limits(model, alpha, beta, cv, profile=False)
    if low_concs is None:
        if truth["lod"] is None:
            raise ValueError("no detection limit within the range: give the low concentrations to test")
        lod_c = truth["lod"]["c"]
        low_concs = [_sig3(lod_c), _sig3(2 * lod_c)]
    low = [float(c) for c in low_concs]
    if not low or not all(math.isfinite(c) and c > 0 for c in low):
        raise ValueError("low concentrations must be finite and > 0")
    d = truth["direction"]
    za, zb = float(ndtri(1 - alpha)), float(ndtri(1 - beta))
    k = len(low)
    cq = None if truth["loq"] is None else _sig3(truth["loq"]["c"])
    per = n_blank + (k + (0 if cq is None else 1)) * n_low
    z = EX.normals_array(seed, runs * per, 0).reshape(runs, per)
    mu0, sd0 = float(model.mean(0.0)), float(model.sd(0.0))
    mu_l = [float(model.mean(c)) for c in low]
    sd_l = [float(model.sd(c)) for c in low]
    with np.errstate(all="ignore"):
        blanks = mu0 + sd0 * z[:, :n_blank]
        lob_s = blanks.mean(axis=1) + d * za / (1 - 1 / (4 * (n_blank - 1))) * blanks.std(axis=1, ddof=1)
        var = np.zeros(runs)
        detect = []
        for j in range(k):
            ys = mu_l[j] + sd_l[j] * z[:, n_blank + j * n_low: n_blank + (j + 1) * n_low]
            var += ys.var(axis=1, ddof=1)
            detect.append((d * (ys - lob_s[:, None]) > 0).mean(axis=1))
        df = k * (n_low - 1)
        lod_s = lob_s + d * zb / (1 - 1 / (4 * df)) * np.sqrt(var / k)
        loq = None
        if cq is not None:
            ys = float(model.mean(cq)) + float(model.sd(cq)) * z[:, n_blank + k * n_low:]
            cvs = ys.std(axis=1, ddof=1) / (abs(float(slope(model, cq))) * cq)
            loq = {"c": cq, "n": n_low, "cvTarget": cv, "cvTruth": conc_cv(model, cq), "cv": EX._q(cvs, conf),
                   "pPass": float((cvs <= cv).mean())}
    lod_c = np.array([np.nan if c is None else c for c in model.inverse([float(v) for v in lod_s])], dtype=float)
    true_lob = truth["lob"]["signal"]
    return {
        "design": {"rows": [{"sample": "blank", "c": 0.0, "n": n_blank}] +
                           [{"sample": f"low {j + 1}", "c": low[j], "n": n_low} for j in range(k)] +
                           ([] if cq is None else [{"sample": "LoQ", "c": cq, "n": n_low}]),
                   "strips": per},
        "alpha": alpha, "beta": beta, "runs": runs, "seed": seed, "conf": conf,
        "truth": {"lobSignal": true_lob, "lod": None if truth["lod"] is None else truth["lod"]["c"]},
        "lobSignal": EX._q(lob_s, conf), "lodSignal": EX._q(lod_s, conf), "lod": EX._q(lod_c, conf),
        "lodFound": float((~np.isnan(lod_c)).mean()),
        "detect": [{"c": low[j], "truth": float(ndtr(d * (mu_l[j] - true_lob) / sd_l[j])) if sd_l[j] > 0 else None,
                    "mean": float(detect[j].mean())} for j in range(k)],
        "loq": loq,
        "first": {"lobSignal": float(lob_s[0]), "lodSignal": float(lod_s[0]),
                  "lod": None if math.isnan(lod_c[0]) else float(lod_c[0])},
    }
