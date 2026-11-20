"""Spec section 22: variability layers — budget, cumulative counts, design-aware experiments, dial-in estimation.

Pure functions of a compiled Model; ported to frontend/src/math/layers.ts (parity via the fixtures).
"""
from __future__ import annotations

import itertools
import math
from collections import defaultdict

import numpy as np
from scipy.optimize import nnls

from . import analysis as A
from . import limits as L
from . import experiment as EX
from . import metrics as K
from .series import Model, Series, compile_series, layer_terms

SEPARABLE_CORR = 0.995  # above this, gain and proportional CV are reported together


def _mu0(model: Model) -> float:
    return float(np.asarray(model.mean(0.0)))


def budget(model: Model, concs=None) -> list[dict]:
    """16.2: variance budget per concentration (default: the levels)."""
    layers = model.series.layers
    cs = [float(c) for c in (model.levels if concs is None else concs)]
    mu0 = _mu0(model)
    out = []
    for c in cs:
        mu = float(np.asarray(model.mean(c)))
        within, terms = layer_terms(mu, float(np.asarray(model.sd_within(c))), mu0, layers)
        within = float(within)
        total = within + sum(float(t) for t, lay in zip(terms, layers) if lay.on)
        rows = [{"name": lay.name, "on": lay.on, "var": float(t), "share": (float(t) / total if lay.on and total > 0 else None)}
                for lay, t in zip(layers, terms)]
        out.append({"c": c, "mean": mu, "total": total, "within": within,
                    "withinShare": within / total if total > 0 else None, "layers": rows})
    return out


def tolerance(model: Model, concs=None, k: float | None = None, tea: float | None = None) -> dict:
    """Spec section 24: the error budget per concentration, as a tolerance stack in concentration units.

    Sources: the within-run spread plus every layer that is on. Each has a fixed bias (biasOffset + biasPct * mean,
    layers only) and an SD; both are divided by the curve's slope to become concentration. `total` is the usual
    budget |sum of biases| + k * sqrt(sum of variances); `worst` is the linear stack sum |bias| + k * sum SD.
    `rel` / `worstRel` are those as a fraction of c, and `ok` compares `rel` with the allowed total error."""
    s = model.series
    k = s.tolerance.k if k is None else float(k)
    tea = s.tolerance.tea if tea is None else float(tea)
    if not (math.isfinite(k) and k > 0 and math.isfinite(tea) and tea > 0):
        raise ValueError("k and tea must be > 0")
    on = [lay for lay in s.layers if lay.on]
    mu0 = _mu0(model)
    rows = []
    for c in [float(c) for c in (model.levels if concs is None else concs)]:
        mu = float(np.asarray(model.mean(c)))
        within, terms = layer_terms(mu, float(np.asarray(model.sd_within(c))), mu0, on)
        slope = float(L.slope(model, c))
        src = [{"name": "within run", "bias": 0.0, "sd": math.sqrt(float(within))}]
        src += [{"name": lay.name, "bias": lay.bias_offset + lay.bias_pct * mu, "sd": math.sqrt(float(t))} for lay, t in zip(on, terms)]
        row = {"c": c, "mean": mu, "slope": slope, "sources": src, "bias": None, "sd": None, "total": None, "worst": None,
               "rel": None, "worstRel": None, "ok": None}
        if slope != 0 and math.isfinite(slope):
            for x in src:
                x["biasC"], x["sdC"] = x["bias"] / slope, x["sd"] / abs(slope)
            bias = sum(x["biasC"] for x in src)
            sd = math.sqrt(sum(x["sdC"] ** 2 for x in src))
            total = abs(bias) + k * sd
            worst = sum(abs(x["biasC"]) for x in src) + k * sum(x["sdC"] for x in src)
            row.update(bias=bias, sd=sd, total=total, worst=worst)
            if c > 0:
                row.update(rel=total / c, worstRel=worst / c, ok=bool(total / c <= tea))
        rows.append(row)
    judged = [r for r in rows if r["ok"] is not None]
    return {"k": k, "tea": tea, "rows": rows, "met": sum(1 for r in judged if r["ok"]), "total": len(judged)}


def _with_layers(series: Series, on_names: set[str]) -> Model:
    lays = [lay.model_copy(update={"on": lay.name in on_names}) for lay in series.layers]
    return compile_series(series.model_copy(update={"layers": lays}))


def cumulative(model: Model) -> list[dict]:
    """16.2: headline ladder length with only the first k layers on, k = 0…L."""
    s = model.series
    out = []
    for k in range(len(s.layers) + 1):
        names = [lay.name for lay in s.layers[:k]]
        m = _with_layers(s, set(names))
        out.append({"layers": names, "n": len(A.ladder(m, s.metric, s.k_target))})
    return out


# ---------------------------------------------------------------- 16.4 estimation (balanced crossed ANOVA)
def components(y: np.ndarray) -> tuple[float, list[float]]:
    """Crossed main-effects ANOVA on a balanced array y[u_1, …, u_L, n] -> (σ²_e, [σ²_L]) (method of moments)."""
    y = np.asarray(y, dtype=float)
    L = y.ndim - 1
    N = y.size
    grand = y.mean()
    ss_total = float(((y - grand) ** 2).sum())
    out, ss_f, df_f = [], 0.0, 0
    for ax in range(L):
        u = y.shape[ax]
        other = tuple(i for i in range(y.ndim) if i != ax)
        means = y.mean(axis=other)
        ss = (N / u) * float(((means - grand) ** 2).sum())
        out.append((ss, u - 1, N / u))
        ss_f += ss
        df_f += u - 1
    df_e = N - 1 - df_f
    ms_e = (ss_total - ss_f) / df_e if df_e > 0 else math.nan
    comps = [max(0.0, ((ss / df) - ms_e) / per) if df > 0 else 0.0 for ss, df, per in out]
    return ms_e, comps


def simulate_design(model: Model, concs=None, n: int = 2, runs: int = 200, seed: int = 1, metric: str | None = None,
                    k: float | None = None, alpha: float = 0.05, conf: float = 0.9) -> dict:
    """16.3: experiments drawing actual units of every layer (crossed design), pooled per concentration."""
    s = model.series
    metric = A.check_metric(metric if metric is not None else s.metric)
    k = float(s.k_target if k is None else k)
    lays = list(s.layers)
    if not lays:
        raise ValueError("no layers: use simulate (spec 13) for a single-run design")
    n = EX._int(n, "n", 2, 1000)
    runs = EX._int(runs, "runs", 1, 2000)
    cs = [float(c) for c in (model.levels if concs is None else concs)]
    if len(cs) < 2:
        raise ValueError("need at least two concentrations")
    units = [lay.units for lay in lays]
    combos = list(itertools.product(*[range(u) for u in units]))
    P = len(combos)
    mu = np.asarray(model.mean(np.array(cs)), dtype=float)
    sw = np.asarray(model.sd_within(np.array(cs)), dtype=float)
    mu0 = _mu0(model)
    n_eff = sum(units) * 4
    per_run = n_eff + len(cs) * P * n
    idx = np.array(combos)  # (P, L)
    mid = len(cs) // 2

    means = np.empty((runs, len(cs)))
    sds = np.empty((runs, len(cs)))
    comp_runs = np.empty((runs, len(lays) + 1))
    first = None
    for r in range(runs):
        z = EX.normals_array(seed, per_run, r * per_run)
        eff = z[:n_eff].reshape(sum(units), 4)
        eps = z[n_eff:].reshape(len(cs), P, n)
        G = np.ones(P)
        M = np.zeros(P)
        Aoff = np.zeros(P)
        Kn = np.ones(P)
        off = 0
        for li, lay in enumerate(lays):
            e = eff[off: off + lay.units]
            off += lay.units
            u = idx[:, li]
            G = G * (1 + lay.gain_cv * e[u, 0])
            M = M + lay.cv * e[u, 1]
            Aoff = Aoff + lay.offset_sd * e[u, 2]
            Kn = Kn * (1 + lay.noise_cv * e[u, 3])
        y = ((mu0 + G[None, :, None] * (mu[:, None, None] - mu0)) * (1 + M[None, :, None]) + Aoff[None, :, None]
             + Kn[None, :, None] * sw[:, None, None] * eps)
        flat = y.reshape(len(cs), P * n)
        means[r] = flat.mean(axis=1)
        sds[r] = flat.std(axis=1, ddof=1)
        ms_e, comps = components(y[mid].reshape(*units, n))
        comp_runs[r] = [ms_e, *comps]
        if r == 0:
            first = flat
    fn = {"dsum": K.dsum, "ssmd": K.ssmd, "zprime": K.zprime}
    within_true, terms_true = layer_terms(mu[mid], sw[mid], mu0, lays)
    N = P * n
    pairs = []
    for i in range(len(cs) - 1):
        vals = fn[metric](means[:, i], sds[:, i], means[:, i + 1], sds[:, i + 1])
        passed = A._passes_array(metric, vals, k)
        pv = EX.welch_p(means[:, i], sds[:, i], N, means[:, i + 1], sds[:, i + 1], N)
        pairs.append({"c1": cs[i], "c2": cs[i + 1], **EX._q(vals, conf), "pPass": float(passed.mean()),
                      "pSig": float((pv < alpha).mean())})
    comps_out = [{"name": "within", "true": float(sw[mid] ** 2), **EX._q(comp_runs[:, 0], conf)}]
    comps_out += [{"name": lay.name, "true": float(t), **EX._q(comp_runs[:, j + 1], conf)}
                  for j, (lay, t) in enumerate(zip(lays, terms_true))]
    return {"concs": cs, "n": n, "units": units, "readingsPerConc": N, "runs": runs, "seed": seed, "metric": metric,
            "k": k, "alpha": alpha, "conf": conf, "componentsAt": cs[mid], "pairs": pairs, "components": comps_out,
            "first": {"readings": first.tolist(), "mean": means[0].tolist(), "sd": sds[0].tolist()}}


def dial_in(model: Model, rows: list[dict]) -> dict:
    """16.4: measured layer sizes from real long-format data rows {c, <layer names>, y}."""
    lays = list(model.series.layers)
    names = [lay.name for lay in lays]
    if not lays:
        raise ValueError("no layers to estimate: add layers first")
    by_c: dict[float, list[dict]] = defaultdict(list)
    for r in rows:
        try:
            c, y = float(r["c"]), float(r["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(c) and math.isfinite(y):
            by_c[c].append(r)
    if len(by_c) < 1:
        raise ValueError("no usable rows: need columns c, y and one column per layer")
    notes = []
    per = []
    for c in sorted(by_c):
        rs = by_c[c]
        labels = [sorted({str(r.get(nm, "")) for r in rs}) for nm in names]
        cells: dict[tuple, list[float]] = defaultdict(list)
        for r in rs:
            cells[tuple(labels[i].index(str(r.get(nm, ""))) for i, nm in enumerate(names))].append(float(r["y"]))
        shape = [len(lb) for lb in labels]
        nrep = min((len(v) for v in cells.values()), default=0)
        full = len(cells) == int(np.prod(shape)) and nrep >= 1
        if not full or any(len(v) != nrep for v in cells.values()):
            notes.append(f"c = {c:g}: unbalanced or incomplete design; using the first {nrep} reading(s) of complete cells")
        if not full or nrep < 1:
            continue
        arr = np.empty(shape + [nrep])
        for key, v in cells.items():
            arr[key] = v[:nrep]
        if nrep < 2 and all(u < 2 for u in shape):
            continue
        ms_e, comps = components(arr)
        per.append({"c": c, "n": int(arr.size), "mean": float(arr.mean()), "within": ms_e,
                    "layers": {nm: v for nm, v in zip(names, comps)}})
    for i, nm in enumerate(names):
        if all(len({str(r.get(nm, "")) for r in rs}) < 2 for rs in by_c.values()):
            notes.append(f"{nm}: fewer than 2 units in the data, its size cannot be estimated")
    if not per:
        raise ValueError("no concentration has a complete crossed design to estimate from")
    mu0 = per[0]["mean"] if per[0]["c"] == 0 else _mu0(model)
    mus = np.array([p["mean"] for p in per])
    x_cv, x_gain = mus ** 2, (mus - mu0) ** 2
    # gain and proportional CV are both ∝ signal² when the blank is small: merge them when they cannot be separated
    separable = len(per) >= 3 and float(np.corrcoef(x_cv, x_gain)[0, 1]) < SEPARABLE_CORR
    if len(per) >= 3 and not separable:
        notes.append("gain and proportional CV cannot be told apart on this curve (blank signal is small): "
                     "reported together as CV")
    if len(per) < 3:
        notes.append("fewer than 3 concentrations: each layer's size is reported as an offset SD only")
    out_layers = []
    for lay in lays:
        b = np.array([p["layers"][lay.name] for p in per])
        if separable:
            x, _ = nnls(np.column_stack([np.ones_like(mus), x_cv, x_gain]), b)
        elif len(per) >= 3:
            x2, _ = nnls(np.column_stack([np.ones_like(mus), x_cv]), b)
            x = np.array([x2[0], x2[1], 0.0])
        else:
            x = np.array([float(b.mean()), 0.0, 0.0])
        units = max(len({str(r.get(lay.name, "")) for r in rs}) for rs in by_c.values())
        # rough 90% range of an SD estimated from `units` units (chi-square with units - 1 df), as a ± factor
        rough = None
        if units >= 2:
            from scipy.stats import chi2
            df = units - 1
            rough = [float(math.sqrt(df / chi2.ppf(0.95, df))), float(math.sqrt(df / chi2.ppf(0.05, df)))]
        measured = {"offsetSd": float(math.sqrt(x[0])), "cv": float(math.sqrt(x[1])), "gainCv": float(math.sqrt(x[2]))}
        out_layers.append({"name": lay.name, "units": units, "rough": rough, "measured": measured,
                           "predicted": {"offsetSd": lay.offset_sd, "cv": lay.cv, "gainCv": lay.gain_cv}})
        if units < 5:
            notes.append(f"{lay.name}: {units} units give a rough estimate (true SD could be "
                         f"{rough[0]:.2f}–{rough[1]:.1f}× the estimate)" if rough else f"{lay.name}: too few units")
    within = [{"c": p["c"], "measured": p["within"], "predicted": float(np.asarray(model.sd_within(p["c"]))) ** 2}
              for p in per]
    return {"perConc": per, "layers": out_layers, "within": within, "notes": notes}


def read_csv_rows(text: str) -> list[dict]:
    """CSV/TSV with a header row (c, <layer names>, y) -> list of dicts."""
    lines = [ln for ln in text.replace("\r", "").split("\n") if ln.strip()]
    if not lines:
        return []
    sep = "\t" if "\t" in lines[0] else ","
    head = [h.strip() for h in lines[0].split(sep)]
    return [dict(zip(head, [v.strip() for v in ln.split(sep)])) for ln in lines[1:]]
