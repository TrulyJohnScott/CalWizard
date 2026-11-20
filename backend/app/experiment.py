"""Spec section 13: simulated experiments (draw n readings per concentration from the truth, measure separation).

Pure function of a compiled `Model`; the random stream is `mulberry32` exactly as `frontend/src/math/sim.ts`.
"""
from __future__ import annotations

import math
from numbers import Integral, Real

import numpy as np

from . import analysis as A
from . import metrics as K
from .series import Model

M32 = 0xFFFFFFFF
_INC = 0x6D2B79F5
MAX_RUNS = 5000
MAX_N = 1000
_CHUNK = 200_000  # readings per vectorised block (bounds memory)


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


class Mulberry32:
    """uint32-state PRNG; `next()` returns the next uniform in [0, 1)."""

    def __init__(self, seed: int):
        self.a = int(seed) & M32

    def next(self) -> float:
        self.a = (self.a + _INC) & M32
        t = self.a
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & M32)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296


def normal(rng: Mulberry32) -> float:
    """One standard normal (Box-Muller, cosine branch) from two consecutive uniforms."""
    u1 = max(rng.next(), 1e-300)
    u2 = rng.next()
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def mulberry32_array(seed: int, count: int, start: int = 0) -> np.ndarray:
    """Uniforms number `start` ... `start + count - 1` of the stream (the state is a counter, so this is vectorised)."""
    k = np.arange(start + 1, start + count + 1, dtype=np.uint64)
    a = ((np.uint64(int(seed) & M32) + k * np.uint64(_INC)) & np.uint64(M32)).astype(np.uint32)
    t = a
    with np.errstate(over="ignore"):
        t = (t ^ (t >> np.uint32(15))) * (t | np.uint32(1))
        t = t ^ (t + (t ^ (t >> np.uint32(7))) * (t | np.uint32(61)))
        t = t ^ (t >> np.uint32(14))
    return t.astype(np.float64) / 4294967296


def normals_array(seed: int, count: int, start: int = 0) -> np.ndarray:
    """Standard normals number `start` ... `start + count - 1` (two uniforms each)."""
    u = mulberry32_array(seed, 2 * count, 2 * start)
    u1 = np.maximum(u[0::2], 1e-300)
    return np.sqrt(-2 * np.log(u1)) * np.cos(2 * math.pi * u[1::2])


def _q(values: np.ndarray, conf: float) -> dict:
    v = np.asarray(values, dtype=float)
    v = v[~np.isnan(v)]
    if v.size == 0:
        return {"lo": None, "med": None, "hi": None, "min": None, "max": None}
    a = (1 - conf) / 2
    with np.errstate(all="ignore"):
        lo, med, hi = np.quantile(v, [a, 0.5, 1 - a])
    return {"lo": float(lo), "med": float(med), "hi": float(hi), "min": float(v.min()), "max": float(v.max())}


def _int(x, what: str, lo: int, hi: int) -> int:
    if isinstance(x, bool) or not isinstance(x, Real) or not float(x).is_integer():
        raise ValueError(f"{what} must be an integer, got {x!r}")
    x = int(x)
    if not lo <= x <= hi:
        raise ValueError(f"{what} must be between {lo} and {hi}, got {x}")
    return x


def _measured_counts(model: Model, concs: list[float] | None) -> tuple[list[float], list[int]]:
    s = model.series
    if s.mode != "replicates":
        raise ValueError("measured n needs replicate data")
    count: dict[float, int] = {}
    for c, col in zip(s.replicates.concs, s.replicates.cells):
        count[c] = count.get(c, 0) + sum(1 for y in col if y is not None and math.isfinite(y))
    if concs is None:
        concs = sorted(c for c, k in count.items() if k >= 2)
    return concs, [count.get(c, 0) for c in concs]


def _row(c1, c2, mu1, s1, mu2, s2, metric, k) -> dict:
    d, s, z = (float(f(mu1, s1, mu2, s2)) for f in (K.dsum, K.ssmd, K.zprime))
    value = {"dsum": d, "ssmd": s, "zprime": z}[metric]
    return {"c1": c1, "c2": c2, "dsum": d, "ssmd": s, "zprime": z, "value": value, "pass": K.passes(metric, value, k)}


def welch_p(m1, s1, n1, m2, s2, n2):
    """Two-sided Welch t-test p-value (vectorised). Both SDs 0: p = 0 if the means differ, else 1."""
    from scipy.stats import t as student_t

    with np.errstate(all="ignore"):
        a, b = s1 ** 2 / n1, s2 ** 2 / n2
        se = np.sqrt(a + b)
        tt = np.abs(m2 - m1) / se
        df = (a + b) ** 2 / (a ** 2 / (n1 - 1) + b ** 2 / (n2 - 1))
        p = 2 * student_t.sf(tt, df)
    return np.where(se > 0, p, np.where(m1 != m2, 0.0, 1.0))


def simulate(model: Model, concs=None, n=4, runs: int = 200, seed: int = 1, metric: str | None = None,
             k: float | None = None, conf: float = 0.9, measured_n: bool = False, alpha: float = 0.05) -> dict:
    s = model.series
    metric = A.check_metric(metric if metric is not None else s.metric)
    k = float(s.k_target if k is None else k)
    if not math.isfinite(k):
        raise ValueError(f"k must be finite, got {k!r}")
    runs = _int(runs, "runs", 1, MAX_RUNS)
    seed = _int(seed, "seed", -(2**53), 2**53)
    if isinstance(conf, bool) or not isinstance(conf, Real) or not 0 < conf < 1:
        raise ValueError(f"conf must be between 0 and 1 (exclusive), got {conf!r}")
    conf = float(conf)
    if isinstance(alpha, bool) or not isinstance(alpha, Real) or not 0 < alpha < 1:
        raise ValueError(f"alpha must be between 0 and 1 (exclusive), got {alpha!r}")
    alpha = float(alpha)
    if concs is not None:
        concs = [float(c) for c in concs]
    if measured_n:
        concs, ns = _measured_counts(model, concs)
    else:
        if concs is None:
            concs = [float(c) for c in model.levels]
        if isinstance(n, (list, tuple)):
            if len(n) != len(concs):
                raise ValueError(f"n has {len(n)} values but there are {len(concs)} concentrations")
            ns = list(n)
        else:
            ns = [n] * len(concs)
    if len(concs) < 2:
        raise ValueError("need at least two concentrations")
    if not all(math.isfinite(c) and c >= 0 for c in concs):
        raise ValueError("concentrations must be finite and >= 0")
    ns = [_int(x, "n", 2, MAX_N) for x in ns]

    mu = np.asarray(model.mean(np.array(concs)), dtype=float)
    sd = np.asarray(model.sd(np.array(concs)), dtype=float)
    npairs = len(concs) - 1
    nn = sum(ns)
    edges = np.concatenate([[0], np.cumsum(ns)])
    mu_rep, sd_rep = np.repeat(mu, ns), np.repeat(sd, ns)
    chunk = max(1, _CHUNK // nn)

    run_mean = np.empty((runs, len(concs)))
    run_sd = np.empty((runs, len(concs)))
    first_ys: list[list[float]] = []
    with np.errstate(all="ignore"):
        for r0 in range(0, runs, chunk):
            r1 = min(runs, r0 + chunk)
            z = normals_array(seed, (r1 - r0) * nn, r0 * nn).reshape(r1 - r0, nn)
            ys = mu_rep + sd_rep * z
            for j in range(len(concs)):
                seg = ys[:, edges[j]:edges[j + 1]]
                run_mean[r0:r1, j] = seg.mean(axis=1)
                run_sd[r0:r1, j] = seg.std(axis=1, ddof=1)
            if r0 == 0:
                first_ys = [ys[0, edges[j]:edges[j + 1]].tolist() for j in range(len(concs))]

    fn = {"dsum": K.dsum, "ssmd": K.ssmd, "zprime": K.zprime}
    pairs, passed = [], np.zeros((runs, npairs), dtype=bool)
    truth_rows, first_rows = [], []
    for i in range(npairs):
        c1, c2 = concs[i], concs[i + 1]
        vals = fn[metric](run_mean[:, i], run_sd[:, i], run_mean[:, i + 1], run_sd[:, i + 1])
        passed[:, i] = A._passes_array(metric, vals, k)
        t = _row(c1, c2, mu[i], sd[i], mu[i + 1], sd[i + 1], metric, k)
        truth_rows.append({"c1": c1, "c2": c2, "value": t["value"], "pass": t["pass"]})
        pv = welch_p(run_mean[:, i], run_sd[:, i], ns[i], run_mean[:, i + 1], run_sd[:, i + 1], ns[i + 1])
        first_rows.append({**_row(c1, c2, run_mean[0, i], run_sd[0, i], run_mean[0, i + 1], run_sd[0, i + 1], metric, k),
                           "p": float(pv[0])})
        pairs.append({"c1": c1, "c2": c2, "truth": t["value"], **_q(vals, conf),
                      "pPass": float(passed[:, i].mean()), "pSig": float((pv < alpha).mean())})
    count = passed.sum(axis=1)
    return {
        "concs": concs, "n": ns, "runs": runs, "seed": seed, "metric": metric, "k": k, "conf": conf, "alpha": alpha,
        "truth": {"rows": truth_rows, "resolvedPairs": sum(r["pass"] for r in truth_rows)},
        "first": {"levels": [{"c": concs[j], "ys": first_ys[j], "mean": float(run_mean[0, j]),
                              "sd": float(run_sd[0, j])} for j in range(len(concs))],
                  "rows": first_rows, "resolvedPairs": int(count[0])},
        "levels": [{"c": concs[j], "mean": _q(run_mean[:, j], conf), "sd": _q(run_sd[:, j], conf)}
                   for j in range(len(concs))],
        "pairs": pairs,
        "resolvedPairs": {**_q(count, conf), "hist": np.bincount(count, minlength=npairs + 1).tolist()},
        "pAllPass": float((count == npairs).mean()),
    }
