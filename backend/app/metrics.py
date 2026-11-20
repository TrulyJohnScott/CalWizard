"""Spec section 5: separation metrics between adjacent levels."""
from __future__ import annotations

import math

import numpy as np
from scipy.special import ndtr

from .series import Model


def dsum(mu1, s1, mu2, s2):
    with np.errstate(all="ignore"):
        return (mu2 - mu1) / (s1 + s2)


def ssmd(mu1, s1, mu2, s2):
    with np.errstate(all="ignore"):
        return (mu2 - mu1) / np.sqrt(s1**2 + s2**2)


def zprime(mu1, s1, mu2, s2):
    with np.errstate(all="ignore"):
        return 1 - 3 * (s1 + s2) / np.abs(mu2 - mu1)


def _pdf(x, mu, sd):
    return np.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * math.sqrt(2 * math.pi))


def overlap(mu1, s1, mu2, s2, n: int = 4001) -> float:
    """Integral of min(p1, p2): trapezoid, n points over [min(mu) - 8 max(sd), max(mu) + 8 max(sd)]."""
    if not all(map(math.isfinite, (mu1, s1, mu2, s2))):
        return math.nan
    if s1 <= 0 or s2 <= 0:
        return 1.0 if mu1 == mu2 else 0.0
    w = 8 * max(s1, s2)
    x = np.linspace(min(mu1, mu2) - w, max(mu1, mu2) + w, n)
    return float(np.trapezoid(np.minimum(_pdf(x, mu1, s1), _pdf(x, mu2, s2)), x))


def crossing(mu1, s1, mu2, s2) -> float:
    """PDF crossing point between the means (midpoint if equal SDs or no root)."""
    mid = 0.5 * (mu1 + mu2)
    if s1 <= 0 or s2 <= 0 or abs(s1 - s2) < 1e-12 * (s1 + s2):
        return mid
    A = 1 / s1**2 - 1 / s2**2
    B = -2 * mu1 / s1**2 + 2 * mu2 / s2**2
    C = mu1**2 / s1**2 - mu2**2 / s2**2 - 2 * math.log(s2 / s1)
    disc = max(B * B - 4 * A * C, 0.0)  # >= 0 analytically (two Gaussians with unequal SDs always cross twice)
    lo, hi = min(mu1, mu2), max(mu1, mu2)
    for r in ((-B + math.sqrt(disc)) / (2 * A), (-B - math.sqrt(disc)) / (2 * A)):
        if lo <= r <= hi:
            return r
    return mid


def misclass(mu1, s1, mu2, s2) -> float:
    """0.5 (P(X_low > t) + P(X_high < t)) at the PDF crossing t."""
    if not all(map(math.isfinite, (mu1, s1, mu2, s2))):
        return math.nan
    if s1 <= 0 or s2 <= 0:
        return 0.0 if mu1 != mu2 else 0.5
    (ml, sl), (mh, sh) = sorted([(mu1, s1), (mu2, s2)])
    t = crossing(mu1, s1, mu2, s2)
    return float(0.5 * ((1 - ndtr((t - ml) / sl)) + ndtr((t - mh) / sh)))


def passes(metric: str, value: float, k: float) -> bool:
    """|value| >= k for dsum/ssmd; value >= k for Z'. NaN never passes."""
    if math.isnan(value):
        return False
    return value >= k if metric == "zprime" else abs(value) >= k


def pair_row(c1, c2, mu1, mu2, s1, s2, metric: str = "ssmd", k: float = 3.0) -> dict:
    mu1, mu2, s1, s2 = (np.float64(v) for v in (mu1, mu2, s1, s2))
    with np.errstate(all="ignore"):  # infinite/NaN means give NaN metrics, never a warning
        row = {"c1": c1, "c2": c2, "mu1": mu1, "mu2": mu2, "sd1": s1, "sd2": s2, "dmu": mu2 - mu1,
               "dsum": float(dsum(mu1, s1, mu2, s2)), "ssmd": float(ssmd(mu1, s1, mu2, s2)),
               "zprime": float(zprime(mu1, s1, mu2, s2)), "ovl": overlap(mu1, s1, mu2, s2),
               "err": misclass(mu1, s1, mu2, s2)}
    v = row[metric]
    row["pass"] = passes(metric, v, k)
    return row


def level_rows(model: Model) -> list[dict]:
    lv = model.levels
    mu, sd = model.mean(lv), model.sd(lv)
    s = model.series
    return [pair_row(float(lv[i]), float(lv[i + 1]), mu[i], mu[i + 1], sd[i], sd[i + 1], s.metric, s.k_target)
            for i in range(len(lv) - 1)]
