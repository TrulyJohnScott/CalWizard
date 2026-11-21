"""Spec section 12: pair measurement, ladder, steps between two concentrations, closeness.

Pure functions of a compiled `Model`; ports of frontend/src/math/analysis.ts and closeness.ts.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.special import ndtr, ndtri

from . import metrics as K
from .series import Model

METRICS = ("dsum", "ssmd", "zprime")
SCAN = 2000  # scan intervals (2001 points incl. the left end), spec section 12
BISECT = 60
MAX_LEVELS = 200
DEFAULT_SIG = 4  # what the GUI "Ladder" button uses


def check_metric(metric: str) -> str:
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {list(METRICS)}, got {metric!r}")
    return metric


def _scalar(x) -> np.float64:
    return np.float64(x)


def pair(model: Model, c1: float, c2: float, metric: str = "ssmd", k: float = 3.0) -> dict:
    """The section 5 row for the concentration pair (c1, c2)."""
    check_metric(metric)
    c1, c2 = float(c1), float(c2)
    mu1, mu2 = _scalar(model.mean(c1)), _scalar(model.mean(c2))
    s1, s2 = _scalar(model.sd(c1)), _scalar(model.sd(c2))
    row = K.pair_row(c1, c2, mu1, mu2, s1, s2, metric, k)
    return {key: (bool(v) if key == "pass" else float(v)) for key, v in row.items()}


def metric_value(model: Model, c1, c2, metric: str):
    """Metric value only (no overlap integral). `c1`/`c2` may be scalars or arrays (broadcast)."""
    return _metric(metric, model.mean(c1), model.sd(c1), model.mean(c2), model.sd(c2))


def _metric(metric: str, mu1, s1, mu2, s2):
    fn = {"dsum": K.dsum, "ssmd": K.ssmd, "zprime": K.zprime}[metric]
    return fn(mu1, s1, mu2, s2)


def _passes_array(metric: str, v: np.ndarray, k: float) -> np.ndarray:
    """Vector form of metrics.passes (NaN never passes)."""
    with np.errstate(invalid="ignore"):
        hit = v >= k if metric == "zprime" else np.abs(v) >= k
    return hit & ~np.isnan(v)


def ladder(model: Model, metric: str = "ssmd", k: float = 3.0, start: float = 0.0, stop: float | None = None,
           sig: int = DEFAULT_SIG, max_levels: int = MAX_LEVELS) -> list[float]:
    """Next-separable-concentration ladder, `start` first.

    c_{i+1} is the smallest c in (c_i, stop] whose pair (c_i, c) passes `metric` at `k`: a 2001-point scan
    c_i + (stop - c_i) * j / 2000 (j = 1..2000), then 60 bisections between the last failing scan point and
    the first passing one. With `sig` > 0 each level is rounded UP to `sig` significant digits when that
    keeps the pair passing and does not exceed `stop`. Stops when nothing passes or at `max_levels`.
    """
    check_metric(metric)
    stop = model.c_top if stop is None else float(stop)  # a hook's peak ends the ladder (15.4)
    out = [float(start)]
    j = np.arange(1, SCAN + 1, dtype=float)
    while len(out) < max_levels:
        a = out[-1]
        if not a < stop:
            break
        mu_a, s_a = _scalar(model.mean(a)), _scalar(model.sd(a))
        cs = a + ((stop - a) * j) / SCAN
        hits = np.flatnonzero(_passes_array(metric, _metric(metric, mu_a, s_a, model.mean(cs), model.sd(cs)), k))
        if not hits.size:
            break
        first = int(hits[0])
        lo, hi = (a if first == 0 else float(cs[first - 1])), float(cs[first])
        for _ in range(BISECT):
            mid = 0.5 * (lo + hi)
            if _ok(model, mu_a, s_a, mid, metric, k):
                hi = mid
            else:
                lo = mid
        if sig > 0:
            p = 10.0 ** (sig - 1 - math.floor(math.log10(hi)))
            up = math.ceil(hi * p - 1e-9) / p
            if up <= stop and _ok(model, mu_a, s_a, up, metric, k):
                hi = up
        if not hi > a:
            break
        out.append(hi)
    return out


def _ok(model: Model, mu_a: float, s_a: float, c: float, metric: str, k: float) -> bool:
    v = _metric(metric, mu_a, s_a, _scalar(model.mean(c)), _scalar(model.sd(c)))
    return K.passes(metric, float(v), k)


def steps_between(model: Model, c1: float, c2: float, metric: str = "ssmd", k: float = 3.0) -> int:
    """Number of resolvable steps from c1 to c2: ladder from c1 with stop c2 (unrounded), minus the start."""
    lo, hi = sorted((float(c1), float(c2)))
    return len(ladder(model, metric, k, start=lo, stop=hi, sig=0)) - 1


def closeness_q(row: dict, metric: str, k: float) -> float:
    """Closeness of an adjacent pair relative to the target: < 1 not resolved, >= 1 resolved (NaN -> 0).

    dsum/ssmd: |value| / k (2 when k <= 0). Z': |dsum| / (3 / (1 - k)); for k >= 1 it is 2 if zprime >= k else 0.
    """
    def num(key):
        v = row.get(key)
        return math.nan if v is None else float(v)

    if metric == "zprime":
        if not k < 1:
            q = 2.0 if num("zprime") >= k else 0.0
        else:
            q = abs(num("dsum")) / (3 / (1 - k))
    else:
        check_metric(metric)
        q = abs(num(metric)) / k if k > 0 else 2.0
    return 0.0 if math.isnan(q) else q


# ---------------------------------------------------------------- pass rule in plain words (spec section 12)
LABEL = {"dsum": "Δμ/Σσ", "ssmd": "SSMD", "zprime": "Z′"}


def rule_error(metric: str, k: float) -> float:
    """Misclassification rate a pair has exactly at the threshold, for equal SDs: Phi(-dsum at threshold)."""
    check_metric(metric)
    k = float(k)
    if metric == "zprime":
        return 0.0 if k >= 1 else float(ndtr(-3 / (1 - k)))
    if k <= 0:
        return 0.5
    return float(ndtr(-k if metric == "dsum" else -k / math.sqrt(2)))


def k_for_error(metric: str, error: float) -> float:
    """Inverse of rule_error for 0 < error < 0.5."""
    check_metric(metric)
    error = float(error)
    if not 0 < error < 0.5:
        raise ValueError(f"error must be between 0 and 0.5 (exclusive), got {error!r}")
    z = float(-ndtri(error))
    return {"dsum": z, "ssmd": math.sqrt(2) * z, "zprime": 1 - 3 / z}[metric]


def _pct(e: float) -> str:
    if e == 0:
        return "0%"
    if e < 1e-6:
        return "< 0.0001%"
    return f"{e * 100:.2g}%"


def rule(metric: str, k: float | None = None, error: float | None = None) -> dict:
    """{metric, k, error, text} from exactly one of k / error."""
    check_metric(metric)
    if (k is None) == (error is None):
        raise ValueError("give exactly one of k or error")
    if k is None:
        k = k_for_error(metric, error)
    if not math.isfinite(float(k)):
        raise ValueError(f"k must be finite, got {k!r}")
    err = rule_error(metric, k)
    return {"metric": metric, "k": float(k), "error": err, "text": f"{LABEL[metric]} ≥ {float(k):.4g} · {_pct(err)} misread"}


def overview(model: Model) -> dict:
    """The headline for a series: the resolvable-levels ladder and its pass rule (series metric and kTarget)."""
    s = model.series
    levels = ladder(model, s.metric, s.k_target)
    return {"resolvable": {"levels": levels, "n": len(levels)}, "rule": rule(s.metric, s.k_target)}


# ---------------------------------------------------------------- recovery (spec section 12)
RECOVER_SCAN = 2000


def recover(model: Model, signals, conf: float = 0.95) -> list[dict]:
    """Concentration read back from each signal, with the range of concentrations consistent with it.

    c = inverse(S) (section 6). The range is the hull of {c in [0, cMax] : |S - mean(c)| <= z sd(c)}, z = Phi^-1(1 -
    (1 - conf)/2): a 2001-point scan, then 60 bisections at each end. loOpen / hiOpen: the range touches 0 (zero
    cannot be excluded) / cMax (it may continue above the calibrated range). No point inside -> lo = hi = None.
    """
    conf = float(conf)
    if not 0 < conf < 1:
        raise ValueError(f"conf must be between 0 and 1 (exclusive), got {conf!r}")
    z = float(ndtri(1 - (1 - conf) / 2))
    c_max = model.c_top  # the usable range; beyond a hook's peak the same signal recurs (15.4)
    cs = c_max * np.arange(RECOVER_SCAN + 1, dtype=float) / RECOVER_SCAN
    mu, sd = model.mean(cs), model.sd(cs)
    hk = model.hook()
    if hk is not None:
        cs_far = hk["c"] + (model.c_max - hk["c"]) * np.arange(1, RECOVER_SCAN + 1, dtype=float) / RECOVER_SCAN
        mu_far, sd_far = model.mean(cs_far), model.sd(cs_far)
    cs_inv = model.inverse([float(v) for v in signals])
    out = []
    for S, c in zip(signals, cs_inv):
        S = float(S)
        row = {"signal": S, "c": c, "lo": None, "hi": None, "loOpen": False, "hiOpen": False, "conf": conf,
               "hook": False}
        if math.isfinite(S) and hk is not None:  # also produced above the peak: the reading is ambiguous
            with np.errstate(invalid="ignore"):
                row["hook"] = bool(np.any(np.abs(S - mu_far) <= z * sd_far))
        if math.isfinite(S):
            with np.errstate(invalid="ignore"):
                inside = np.abs(S - mu) <= z * sd
            idx = np.flatnonzero(inside)
            if idx.size:
                first, last = int(idx[0]), int(idx[-1])

                def ok(x: float) -> bool:
                    m, s_ = float(model.mean(x)), float(model.sd(x))
                    return abs(S - m) <= z * s_

                lo = float(cs[first])
                if first > 0:  # bisect between the last outside point and the first inside one
                    a, b = float(cs[first - 1]), lo
                    for _ in range(BISECT):
                        mid = 0.5 * (a + b)
                        if ok(mid):
                            b = mid
                        else:
                            a = mid
                    lo = b
                hi = float(cs[last])
                if last < RECOVER_SCAN:
                    a, b = hi, float(cs[last + 1])
                    for _ in range(BISECT):
                        mid = 0.5 * (a + b)
                        if ok(mid):
                            a = mid
                        else:
                            b = mid
                    hi = a
                row.update(lo=lo, hi=hi, loOpen=first == 0, hiOpen=last == RECOVER_SCAN)
        out.append(row)
    return out


def why_not(model: Model, c1: float, c2: float, metric: str = "ssmd", k: float = 3.0) -> dict:
    """What would make the pair (c1, c2) pass: needed |dmu| at its SDs, SD scale factor (= closeness q), and the
    smallest c above c1 that passes against c1 (raw ladder step, within cMax)."""
    r = pair(model, c1, c2, metric, k)
    s1, s2 = r["sd1"], r["sd2"]
    if metric == "dsum":
        need = k * (s1 + s2)
    elif metric == "ssmd":
        need = k * math.sqrt(s1 * s1 + s2 * s2)
    else:
        need = 3 * (s1 + s2) / (1 - k) if k < 1 else None
    if need is not None:
        need = max(need, 0.0)
    q = (abs(r["dsum"]) / (3 / (1 - k)) if k < 1 else math.nan) if metric == "zprime" else abs(r[metric]) / k
    steps = ladder(model, metric, k, start=float(c1), sig=0, max_levels=2)
    return {"c1": float(c1), "c2": float(c2), "needDmu": need, "dmu": abs(r["dmu"]),
            "sdScale": q if math.isfinite(q) and q > 0 else None, "moveTo": steps[1] if len(steps) > 1 else None}


def measure_points(model: Model, concs, metric: str = "ssmd", k: float = 3.0) -> dict:
    """N-point ruler (spec section 11 v2.6): the first two concentrations as given (section 5 row + stepsBetween + whyNot,
    the two-point output), plus `pairs` = the same for every adjacent pair of the sorted unique concentrations."""
    cs = [float(c) for c in concs]
    if len(cs) < 2 or not all(math.isfinite(c) for c in cs):
        raise ValueError("measure needs at least two finite concentrations")

    def full(a, b):
        return {**pair(model, a, b, metric, k), "stepsBetween": steps_between(model, a, b, metric, k),
                "whyNot": why_not(model, a, b, metric, k)}

    srt = sorted(set(cs))
    return {**full(cs[0], cs[1]), "pairs": [full(a, b) for a, b in zip(srt, srt[1:])]}


# ---------------------------------------------------------------- separation of two concentrations (spec section 16)
def rates_at(t: float, c1: float, mu1: float, s1: float, c2: float, mu2: float, s2: float) -> dict:
    """Call rates of one reading at a fixed signal threshold t: sensitivity = the higher concentration called
    positive, specificity = the lower one called negative; positive is the higher concentration's side of t."""
    (_, ml, sl), (_, mh, sh) = sorted([(c1, mu1, s1), (c2, mu2, s2)])
    up = mh >= ml

    def above(m, s):
        return float(1 - ndtr((t - m) / s)) if s > 0 else (1.0 if m > t else 0.0 if m < t else 0.5)

    return {"threshold": float(t), "sensitivity": above(mh, sh) if up else 1 - above(mh, sh),
            "specificity": 1 - above(ml, sl) if up else above(ml, sl)}


def separate(model: Model, c1: float, c2: float, metric: str = "ssmd", k: float = 3.0, n: int = 3,
             runs: int = 1000, seed: int = 1, conf: float = 0.95, alpha: float = 0.05,
             threshold: float | None = None) -> dict:
    """Everything about telling two concentrations apart: the section 5 row, the decision threshold with its
    sensitivity / specificity, AUC, d-prime, CVs, replicates needed, read-back ranges and the power of an
    n-versus-n experiment."""
    from . import experiment as EX  # local: experiment imports this module

    c1, c2 = float(c1), float(c2)
    if not (math.isfinite(c1) and math.isfinite(c2) and c1 >= 0 and c2 >= 0) or c1 == c2:
        raise ValueError("separate needs two different finite concentrations >= 0")
    row = pair(model, c1, c2, metric, k)
    mu1, mu2, s1, s2 = row["mu1"], row["mu2"], row["sd1"], row["sd2"]
    (ml, sl), (mh, sh) = sorted([(mu1, s1), (mu2, s2)])
    t = K.crossing(mu1, s1, mu2, s2)
    var = s1 * s1 + s2 * s2
    with np.errstate(all="ignore"):
        # correct-call rates of the high- and low-signal groups; positive = the higher concentration, which on a
        # falling (competitive) curve is the low-signal group
        p_hi = float(1 - ndtr((t - mh) / sh)) if sh > 0 else (1.0 if mh > t else 0.5)
        p_lo = float(ndtr((t - ml) / sl)) if sl > 0 else (1.0 if ml < t else 0.5)
        rising = (c2 > c1) == (mu2 >= mu1)
        sens, spec = (p_hi, p_lo) if rising else (p_lo, p_hi)
        auc = float(ndtr(abs(mu2 - mu1) / math.sqrt(var))) if var > 0 else (1.0 if mu1 != mu2 else 0.5)
        dprime = abs(mu2 - mu1) / math.sqrt(var / 2) if var > 0 else math.inf
    q = closeness_q(row, metric, k)
    n_needed = None
    if math.isfinite(q) and q > 0:
        n_needed = max(1, math.ceil(1 / (q * q) - 1e-9))
        if n_needed > 100000:
            n_needed = None
    lo_c, hi_c = sorted((c1, c2))
    sim = EX.simulate(model, [lo_c, hi_c], n, runs, seed, metric, k, 0.9, False, alpha)
    return {
        **row, "metric": metric, "k": float(k),
        "stepsBetween": steps_between(model, c1, c2, metric, k),
        "whyNot": why_not(model, c1, c2, metric, k),
        "closeness": q,
        "threshold": float(t), "sensitivity": sens, "specificity": spec, "auc": auc, "dprime": float(dprime),
        # the rates at a threshold that stays put (e.g. the shipped cut-off while the curve changes; spec 16)
        "at": None if threshold is None else rates_at(float(threshold), c1, mu1, s1, c2, mu2, s2),
        "cv1": float(s1 / abs(mu1)) if mu1 != 0 else None, "cv2": float(s2 / abs(mu2)) if mu2 != 0 else None,
        "fold": (c2 / c1) if c1 > 0 else None,
        "nNeeded": n_needed,
        "readback": recover(model, [mu1, mu2], conf),
        "power": {"n": int(n), "runs": sim["runs"], "seed": sim["seed"], "alpha": alpha,
                  "pSig": sim["pairs"][0]["pSig"], "pPass": sim["pairs"][0]["pPass"]},
    }
