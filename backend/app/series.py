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
HOOK_SCAN = 2001


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


class Tolerance(Camel):
    """Error budget settings (spec section 24): allowed total error as a fraction of the concentration, and the
    coverage factor on the spread."""
    tea: float = 0.3
    k: float = 2.0

    @field_validator("tea", "k")
    @classmethod
    def _pos(cls, v):
        if not (math.isfinite(v) and v > 0):
            raise ValueError("tea and k must be > 0")
        return v


class Point(Camel):
    """An evaluated concentration (core design): separate from the calibration data; strips None = limits.reads."""
    c: float
    strips: int | None = None


class Sample(Camel):
    """One row of the read-back sheet (spec section 18)."""
    id: str = ""
    signal: float | None = None
    dilution: float = 1.0
    #: the value is the mean of this many strips (core design): only within-run noise averages
    strips: int = 1


class Layer(Camel):
    """A source of variability on top of the within-run curve (spec section 22)."""
    name: str = "Layer"
    units: int = 3
    on: bool = True
    offset_sd: float = 0.0
    cv: float = 0.0
    gain_cv: float = 0.0
    noise_cv: float = 0.0
    # a known, fixed shift of this source against the calibration (spec section 24): signal units, and a fraction of
    # the signal. Bias moves accuracy (the error budget), not the spread, so it does not change resolution.
    bias_offset: float = 0.0
    bias_pct: float = 0.0

    @field_validator("offset_sd", "cv", "gain_cv", "noise_cv")
    @classmethod
    def _nonneg(cls, v):
        if not (math.isfinite(v) and v >= 0):
            raise ValueError("layer sizes must be finite and >= 0")
        return v

    @field_validator("units")
    @classmethod
    def _units(cls, v):
        if not 1 <= v <= 50:
            raise ValueError("units must be between 1 and 50")
        return v


def layer_terms(mu, sd, mu0: float, layers) -> tuple[np.ndarray, list[np.ndarray]]:
    """Spec 22.1: (within variance, [each layer's variance]) at signal mean `mu` with within-run SD `sd`.
    `within` uses the noise CVs of the layers that are on; each layer's term is computed whether on or not."""
    mu = np.asarray(mu, dtype=float)
    sd = np.asarray(sd, dtype=float)
    k2 = 1.0
    for lay in layers:
        if lay.on:
            k2 *= 1 + lay.noise_cv ** 2
    within = sd ** 2 * k2
    terms = [(mu - mu0) ** 2 * lay.gain_cv ** 2 + mu ** 2 * lay.cv ** 2 + lay.offset_sd ** 2 for lay in layers]
    return within, terms


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
    points: list[Point] = []
    tolerance: Tolerance = Tolerance()
    layers: list[Layer] = []

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
            sd_pts = [(p[0], p[2], p[1]) for p in pts if p[2] is not None and math.isfinite(p[2])]
            self.sd_missing = not sd_pts
            if sd_pts and all(abs(p[2]) > 0 for p in sd_pts):
                # core design: interpolate the CV (SD / |mean|) between concentrations, so a concentration without an
                # SD (a single reading) borrows its neighbours' CV; beyond the ends the CV holds
                cv_t = Table([p[0] for p in sd_pts], [p[1] / abs(p[2]) for p in sd_pts])
                self._cv = cv_t

                def sd_t(c, cv_t=cv_t, mean_t=mean_t):
                    return cv_t(c) * np.abs(mean_t(c))
            else:  # a zero mean among them: interpolate the SD itself
                sd_t = Table([p[0] for p in sd_pts], [p[1] for p in sd_pts])
            self._mean, self._sd = mean_t, sd_t
        self.adjusted = bool(series.adjust and series.adjust.active)
        self.adjust_params: dict | None = None
        if self.adjusted:
            self._apply_adjust(series.adjust)
        # variability layers (spec section 22) sit on top of the curve, what-if included
        self._sd_within = self._sd
        on = [lay for lay in series.layers if lay.on]
        if on:
            within_sd, mean_f = self._sd, self._mean
            mu0 = float(np.asarray(mean_f(np.float64(0.0))))

            def sd_eff(c):
                mu = mean_f(c)
                w, terms = layer_terms(mu, within_sd(c), mu0, on)
                return np.sqrt(w + sum(terms))

            self._sd = sd_eff

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
        elif getattr(self, "_cv", None) is not None:  # CV-interpolated table: the noise follows the new signal
            cv = self._cv

            def sd(c):
                return ss * cv(c / xs) * np.abs(mean(c))
        else:
            def sd(c):
                return ss * g(c / xs)

        self._mean, self._sd = mean, sd

    def mean(self, c) -> np.ndarray:
        return self._mean(np.asarray(c, dtype=float))

    def sd_within(self, c) -> np.ndarray:
        """Within-run SD (the curve's own σ, before layers)."""
        return self._sd_within(np.asarray(c, dtype=float))

    def sd(self, c) -> np.ndarray:
        return self._sd(np.asarray(c, dtype=float))

    def direction(self) -> int:
        """+1 when the signal rises with concentration (sandwich), -1 when it falls (competitive): the sign of the
        largest excursion from the blank on a 2001-point grid (robust to a hook or a fit that dips at the far end)."""
        if not hasattr(self, "_dir"):
            cs = np.linspace(0.0, self.c_max, HOOK_SCAN)
            with np.errstate(invalid="ignore"):
                dev = self.mean(cs) - float(self.mean(np.float64(0.0)))
            dev = np.where(np.isfinite(dev), dev, 0.0)
            self._dir = 1 if dev[int(np.argmax(np.abs(dev)))] >= 0 else -1
        return self._dir

    def hook(self) -> dict | None:
        """Spec 15.4: the high-dose hook. The extreme of direction * mean(c) on [0, cMax]; when it lies inside the range
        and the signal turns back after it (by more than 1e-6 of the signal span), {c, signal} of the peak, else None.
        Claims stop at the peak: above it a signal is also produced by a lower concentration."""
        if not hasattr(self, "_hook"):
            self._hook = None
            d = self.direction()
            cs = np.linspace(0.0, self.c_max, HOOK_SCAN)
            with np.errstate(invalid="ignore"):
                y = d * self.mean(cs)
            if np.all(np.isfinite(y)):
                i = int(np.argmax(y))
                span = float(y.max() - y.min())
                if i < HOOK_SCAN - 1 and span > 0 and y[i] - y[-1] > 1e-6 * span:
                    a, b = float(cs[max(i - 1, 0)]), float(cs[i + 1])
                    g = (math.sqrt(5) - 1) / 2
                    for _ in range(60):  # golden-section search for the maximum
                        x1, x2 = b - g * (b - a), a + g * (b - a)
                        if d * float(self.mean(x1)) >= d * float(self.mean(x2)):
                            b = x2
                        else:
                            a = x1
                    c = 0.5 * (a + b)
                    self._hook = {"c": c, "signal": float(self.mean(c))}
        return self._hook

    @property
    def c_top(self) -> float:
        """The top of the usable range: the hook's peak if there is one, else cMax."""
        h = self.hook()
        return self.c_max if h is None else h["c"]

    def sd_reads(self, c, reads: int = 1) -> np.ndarray:
        """SD of the average of `reads` readings of one sample (spec 15, 22.1): only within-run noise (with the layers'
        noise CVs) averages; lot, reader, day and the other layer terms are shared by the reads and stay whole."""
        c = np.asarray(c, dtype=float)
        if reads == 1:
            return self.sd(c)
        on = [lay for lay in self.series.layers if lay.on]
        if not on:
            return self.sd(c) / math.sqrt(reads)
        w, terms = layer_terms(self.mean(c), self.sd_within(c), float(self.mean(np.float64(0.0))), on)
        return np.sqrt(w / reads + sum(terms))

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

    # with the SD interpolated in CV the noise follows the new signal: a deviation scales by ss·|y(μ)|/|μ|
    by_cv = getattr(compile_series(series.model_copy(update={"adjust": None})), "_cv", None) is not None

    def spread(mu):
        return ss * (abs(y(mu)) / abs(mu) if by_cv and mu != 0 else 1.0)

    concs, cells = [], []
    for c, col in zip(series.replicates.concs, series.replicates.cells):
        v = [x for x in col if x is not None and math.isfinite(x)]
        mu = sum(v) / len(v) if v else 0.0
        concs.append(c * xs)
        cells.append([None if (x is None or not math.isfinite(x)) else y(mu) + (x - mu) * spread(mu) for x in col])
    summary = [SummaryRow(c=r.c * xs, mean=y(r.mean), sd=None if r.sd is None else r.sd * (spread(r.mean) if r.mean is not None else ss)) for r in series.summary]
    return series.model_copy(update={
        "adjust": None, "replicates": Replicates(concs=concs, cells=cells), "summary": summary,
        "extra_levels": [c * xs for c in series.extra_levels]})
