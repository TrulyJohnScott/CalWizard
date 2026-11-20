"""Series schema (spec section 4, camelCase on the wire) and the compiled model (sections 1, 3, 6)."""
from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel
from scipy.interpolate import PchipInterpolator

from . import expr as E

DEFAULT_MEAN = "4000 + (50 - 4000)/(1 + (c/40)^1.2)"
DEFAULT_SD = "sqrt(15^2 + (0.08*S)^2)"


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Replicates(Camel):
    concs: list[float] = [0.0]
    cells: list[list[float | None]] = [[]]


class SummaryRow(Camel):
    c: float
    mean: float
    sd: float | None = None


class Sim(Camel):
    n: int = 5
    seed: int = 42


class Adjust(Camel):
    """What-if layer on top of the curve (spec section 14). None / 1 = unchanged."""
    bottom: float | None = None
    top: float | None = None
    c_scale: float = 1.0
    sd_scale: float = 1.0

    @field_validator("c_scale")
    @classmethod
    def _cs(cls, v):
        if not (math.isfinite(v) and v > 0):
            raise ValueError("cScale must be > 0")
        return v

    @field_validator("sd_scale")
    @classmethod
    def _ss(cls, v):
        if not (math.isfinite(v) and v >= 0):
            raise ValueError("sdScale must be >= 0")
        return v

    @property
    def active(self) -> bool:
        return self.bottom is not None or self.top is not None or self.c_scale != 1 or self.sd_scale != 1


class LimitSettings(Camel):
    """Detection-limit settings (spec section 15)."""
    alpha: float = 0.05
    beta: float = 0.05
    cv: float = 0.2
    reads: int = 1

    @field_validator("alpha", "beta")
    @classmethod
    def _p(cls, v):
        if not 0 < v < 0.5:
            raise ValueError("alpha and beta must be between 0 and 0.5 (exclusive)")
        return v

    @field_validator("cv")
    @classmethod
    def _cv(cls, v):
        if not (math.isfinite(v) and v > 0):
            raise ValueError("cv must be > 0")
        return v

    @field_validator("reads")
    @classmethod
    def _reads(cls, v):
        if not 1 <= v <= 1000:
            raise ValueError("reads must be between 1 and 1000")
        return v


class Requirement(Camel):
    """One client requirement (spec section 17)."""
    kind: Literal["detect", "distinguish", "precision", "range", "levels"]
    c: float | None = None
    c2: float | None = None
    cv: float | None = None
    n: int | None = None
    label: str = ""


class Sample(Camel):
    """One row of the read-back sheet (spec section 18)."""
    id: str = ""
    signal: float | None = None
    dilution: float = 1.0


def normalize_levels(values) -> list[float]:
    """Finite, >= 0, unique, ascending, always containing 0."""
    out = {0.0}
    for v in values:
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(v) and v >= 0:
            out.add(v)
    return sorted(out)


class Series(Camel):
    name: str = "Untitled"
    analyte: str = ""
    units: str = "ng/mL"
    signal_label: str = "Signal"
    mode: Literal["equations", "replicates", "summary"] = "equations"
    mean_expr: str = DEFAULT_MEAN
    sd_expr: str = DEFAULT_SD
    levels: list[float] = [0, 1, 5, 25, 100, 500]
    c_max: float = 500.0
    extra_levels: list[float] = []
    replicates: Replicates = Replicates()
    summary: list[SummaryRow] = []
    metric: Literal["dsum", "ssmd", "zprime"] = "ssmd"
    k_target: float = 3.0
    sim: Sim = Sim()
    adjust: Adjust | None = None
    limits: LimitSettings = LimitSettings()
    requirements: list[Requirement] = []
    samples: list[Sample] = []

    @field_validator("levels")
    @classmethod
    def _levels(cls, v):
        return normalize_levels(v)

    @field_validator("extra_levels")
    @classmethod
    def _extra(cls, v):
        return sorted({float(x) for x in v if math.isfinite(x) and x >= 0})

    @field_validator("c_max")
    @classmethod
    def _cmax(cls, v):
        if not (math.isfinite(v) and v > 0):
            raise ValueError("cMax must be > 0")
        return v


# --------------------------------------------------------------------------- table interpolation
class Table:
    """PCHIP on linear c through (c_i, y_i); 1 point constant, 2 linear.

    Below the first point: held flat. Above the last point: held flat, or with `extend=True` continued as a
    straight line with the PCHIP end slope (spec section 3: the mean curve continues, the SD holds).
    """

    def __init__(self, c, y, extend: bool = False):
        order = np.argsort(c, kind="stable")
        c, y = np.asarray(c, float)[order], np.asarray(y, float)[order]
        uc, inv = np.unique(c, return_inverse=True)  # duplicate c averaged
        self.c = uc
        self.y = np.bincount(inv, weights=y) / np.bincount(inv)
        with np.errstate(over="ignore"):  # subnormal values overflow inside scipy's slope formula; result is fine
            self._f = PchipInterpolator(self.c, self.y) if len(self.c) > 1 else None
            self._end_slope = float(self._f.derivative()(self.c[-1])) if (extend and self._f is not None) else 0.0

    def __call__(self, c) -> np.ndarray:
        c = np.asarray(c, dtype=float)
        if len(self.c) == 0:
            return np.zeros_like(c)
        if self._f is None:
            return np.full_like(c, self.y[0])
        out = self._f(np.clip(c, self.c[0], self.c[-1]))
        return out + self._end_slope * np.maximum(c - self.c[-1], 0.0)


def table_points(series: Series) -> list[tuple[float, float, float | None]]:
    """(c, mean, sd or None) per table level, from the active table mode (unsorted, duplicates kept)."""
    if series.mode == "summary":
        return [(r.c, r.mean, r.sd) for r in series.summary if math.isfinite(r.c) and math.isfinite(r.mean)]
    pts = []
    for c, col in zip(series.replicates.concs, series.replicates.cells):
        v = np.array([x for x in col if x is not None and math.isfinite(x)], dtype=float)
        if v.size and math.isfinite(c):
            pts.append((c, float(v.mean()), float(v.std(ddof=1)) if v.size > 1 else None))
    # Header columns without replicates may carry a typed mean/sd (summary rows) — matches frontend.
    have = {p[0] for p in pts}
    concs = set(series.replicates.concs)
    for r in series.summary:
        if r.c in concs and r.c not in have and math.isfinite(r.c) and math.isfinite(r.mean):
            pts.append((r.c, r.mean, r.sd))
    return pts


class Model:
    """Compiled series: mean(c), sd(c), levels, cMax, inverse."""

    def __init__(self, series: Series):
        self.series = series
        self.sd_missing = False
        if series.mode == "equations":
            self._mean_ast = E.parse(series.mean_expr, "c")
            self._sd_ast = E.parse(series.sd_expr, "S")
            self.levels = np.array(series.levels, dtype=float)
            self.c_max = series.c_max
            self._mean = lambda c: E.evaluate(self._mean_ast, c)
            self._sd = lambda c: E.evaluate(self._sd_ast, self._mean(c))
        else:
            pts = table_points(series)
            if series.mode == "summary":
                concs = [r.c for r in series.summary if math.isfinite(r.c)]
            else:
                concs = [c for c in series.replicates.concs if math.isfinite(c)]
            self.levels = np.array(normalize_levels(list(concs) + list(series.extra_levels)), dtype=float)
            top = float(self.levels.max())
            self.c_max = top if top > 0 else 1.0
            mean_t = Table([p[0] for p in pts], [p[1] for p in pts], extend=True)
            sd_pts = [(p[0], p[2]) for p in pts if p[2] is not None and math.isfinite(p[2])]
            self.sd_missing = not sd_pts
            sd_t = Table([p[0] for p in sd_pts], [p[1] for p in sd_pts])
            self._mean, self._sd = mean_t, sd_t
        self.adjusted = bool(series.adjust and series.adjust.active)
        self.adjust_params: dict | None = None
        if self.adjusted:
            self._apply_adjust(series.adjust)

    def _apply_adjust(self, adj: Adjust) -> None:
        """Spec section 14: mean'(c) = B' + (f(c/xs) - B) * gain; sd' = sdScale * sd (of the new signal in equations
        mode, of c/xs in table modes). B = f(0), T = f(cMax) of the unadjusted curve."""
        f, g = self._mean, self._sd
        xs, ss = adj.c_scale, adj.sd_scale
        b0, t0 = float(f(np.float64(0.0))), float(f(np.float64(self.c_max)))
        b1 = b0 if adj.bottom is None else adj.bottom
        t1 = t0 if adj.top is None else adj.top
        gain = (t1 - b1) / (t0 - b0) if (math.isfinite(t0 - b0) and t0 != b0) else 1.0
        self.adjust_params = {"b0": b0, "t0": t0, "b1": b1, "t1": t1, "gain": gain, "cScale": xs, "sdScale": ss}

        def mean(c):
            return b1 + (f(c / xs) - b0) * gain

        if self.series.mode == "equations":
            sd_ast = self._sd_ast

            def sd(c):
                return ss * E.evaluate(sd_ast, mean(c))
        else:
            def sd(c):
                return ss * g(c / xs)

        self._mean, self._sd = mean, sd

    def mean(self, c) -> np.ndarray:
        return self._mean(np.asarray(c, dtype=float))

    def sd(self, c) -> np.ndarray:
        return self._sd(np.asarray(c, dtype=float))

    def grid(self, n: int = 501) -> np.ndarray:
        return np.linspace(0.0, self.c_max, n)

    def inverse(self, signals, n_scan: int = 2001, n_bisect: int = 60) -> list[float | None]:
        """c such that mean(c) = S on [0, cMax]; first bracket from c = 0, None if no bracket."""
        cs = np.linspace(0.0, self.c_max, n_scan)
        m = self.mean(cs)
        out = []
        for s in signals:
            f = m - s
            out.append(self._invert_one(cs, f, n_bisect, s))
        return out

    def _invert_one(self, cs, f, n_bisect, s):
        if not math.isfinite(s):
            return None
        zero = np.flatnonzero(f == 0)
        with np.errstate(invalid="ignore"):
            flip = np.flatnonzero(f[:-1] * f[1:] < 0)
        first_zero = zero[0] if zero.size else None
        if first_zero is not None and (not flip.size or first_zero <= flip[0]):
            return float(cs[first_zero])
        if not flip.size:
            return None
        i = flip[0]
        lo, hi = float(cs[i]), float(cs[i + 1])
        flo = f[i]
        for _ in range(n_bisect):
            mid = 0.5 * (lo + hi)
            fm = float(self.mean(mid) - s)
            if fm == 0:
                return mid
            if (fm < 0) == (flo < 0):
                lo, flo = mid, fm
            else:
                hi = mid
        return 0.5 * (lo + hi)


def compile_series(series: Series) -> Model:
    return Model(series)


def _lit(x: float) -> str:
    """A float as expression text (one parenthesised atom; negatives written as 0 - x)."""
    x = float(x)
    return f"({x!r})" if x >= 0 else f"(0 - {abs(x)!r})"


def bake(series: Series) -> Series:
    """The same curve with the what-if layer folded into the source (spec section 14): equations get new
    expressions, tables get transformed concentrations / readings. Exact: bake(s) evaluates like s."""
    adj = series.adjust
    if not (adj and adj.active):
        return series.model_copy(update={"adjust": None})
    p = Model(series).adjust_params
    b0, b1, gain, xs, ss = p["b0"], p["b1"], p["gain"], p["cScale"], p["sdScale"]
    if series.mode == "equations":
        inner = E.to_text(E.parse(series.mean_expr, "c"), f"(c/{_lit(xs)})")
        mean_expr = f"{_lit(b1)} + ({inner} - {_lit(b0)})*{_lit(gain)}"
        sd_expr = f"{_lit(ss)}*({E.to_text(E.parse(series.sd_expr, 'S'), 'S')})"
        return series.model_copy(update={"adjust": None, "mean_expr": mean_expr, "sd_expr": sd_expr})

    def y(v):
        return b1 + (v - b0) * gain

    concs, cells = [], []
    for c, col in zip(series.replicates.concs, series.replicates.cells):
        v = [x for x in col if x is not None and math.isfinite(x)]
        mu = sum(v) / len(v) if v else 0.0
        concs.append(c * xs)
        cells.append([None if (x is None or not math.isfinite(x)) else y(mu) + (x - mu) * ss for x in col])
    summary = [SummaryRow(c=r.c * xs, mean=y(r.mean), sd=None if r.sd is None else r.sd * ss) for r in series.summary]
    return series.model_copy(update={
        "adjust": None, "replicates": Replicates(concs=concs, cells=cells), "summary": summary,
        "extra_levels": [c * xs for c in series.extra_levels]})
