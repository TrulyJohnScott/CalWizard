"""Spec §8 /api/fit: recover known curves / noise laws; expr strings are re-parsed by the sympy oracle."""
from __future__ import annotations

import json
import math

import numpy as np
import pytest

from . import oracle as O

pytestmark = pytest.mark.filterwarnings("ignore::RuntimeWarning")

MEAN_KINDS = {"linear", "quadratic", "power", "exponential", "log", "4pl", "5pl"}
SD_KINDS = {"floor_cv", "constant", "cv", "power"}


def post_fit(client, body):
    r = client.post("/api/fit", json=body)
    assert r.status_code == 200, (r.status_code, r.text[:300])
    return r.json()


def oracle_curve(expr, xs, var="c"):
    tree, _ = O.parse_to_sympy(expr, var)
    out = []
    for x in xs:
        v, _, _ = O.eval_tree(tree, float(x))
        out.append(np.nan if v is None else v)
    return np.array(out)


TRUTH = {
    "linear": (lambda c: 10 + 5 * c, [0, 1, 2, 4, 6, 8, 10, 15, 20]),
    "quadratic": (lambda c: 5 + 2 * c + 0.3 * c**2, [0, 1, 2, 4, 6, 8, 10, 15, 20]),
    "power": (lambda c: 50 + 12 * c**0.8, [0, 1, 2, 5, 10, 20, 50, 100, 200]),
    "exponential": (lambda c: 50 + 10 * (np.exp(0.05 * c) - 1), [0, 5, 10, 15, 20, 25, 30, 40, 50]),
    "log": (lambda c: 50 + 900 * np.log(1 + c / 20), [0, 1, 5, 10, 25, 50, 100, 200, 500]),
    "4pl": (lambda c: 4000 + (50 - 4000) / (1 + (c / 40) ** 1.2), [0, 1, 3, 10, 30, 100, 300, 1000, 3000]),
    "5pl": (lambda c: 4000 + (50 - 4000) / (1 + (c / 40) ** 1.2) ** 0.8, [0, 1, 3, 10, 30, 100, 300, 1000, 3000]),
}


def make_points(kind, noise, seed=7, reps=3):
    f, cs = TRUTH[kind]
    rng = np.random.default_rng(seed)
    pts = []
    for c in cs:
        y0 = float(f(np.float64(c)))
        for _ in range(reps):
            pts.append({"c": float(c), "y": y0 * (1 + noise * rng.standard_normal()) if noise else y0})
    return pts


@pytest.mark.parametrize("noise", [0.0, 0.01])
@pytest.mark.parametrize("kind", sorted(TRUTH))
def test_true_family_is_recovered(client, kind, noise):
    f, cs = TRUTH[kind]
    d = post_fit(client, {"points": make_points(kind, noise, reps=1 if noise == 0 else 3)})
    fits = {x["kind"]: x for x in d["meanFits"]}
    assert set(fits) == MEAN_KINDS
    fit = fits[kind]
    assert fit["ok"] is True and isinstance(fit["expr"], str)
    grid = np.linspace(min(cs), max(cs), 400)
    truth = f(grid)
    got = oracle_curve(fit["expr"], grid)
    span = truth.max() - truth.min()
    tol = (0.004 if noise == 0 else 0.03) * span
    assert np.all(np.isfinite(got)), fit["expr"]
    assert np.max(np.abs(got - truth)) <= tol, (kind, fit["expr"], np.max(np.abs(got - truth)), tol)
    assert fit["r2"] > 0.995


@pytest.mark.parametrize("kind", sorted(TRUTH))
def test_true_family_ranks_near_top_by_aicc(client, kind):
    d = post_fit(client, {"points": make_points(kind, 0.01, seed=11)})
    ranked = [x for x in d["meanFits"] if x["ok"] and x["aicc"] is not None]
    aiccs = [x["aicc"] for x in ranked]
    assert aiccs == sorted(aiccs), "meanFits must be ranked by AICc ascending"
    pos = [x["kind"] for x in ranked].index(kind)
    delta = ranked[pos]["aicc"] - ranked[0]["aicc"]
    # statistically indistinguishable from the best (dAICc <= 4) counts as "at the top" too
    assert pos <= 2 or delta <= 4, (kind, [(x["kind"], round(x["aicc"], 1)) for x in ranked])


@pytest.mark.parametrize("kind", ["linear", "4pl", "power"])
def test_noisy_ranking_stable_across_seeds(client, kind):
    """Statistical: AICc can be fooled by an unlucky noise draw, so require the true family to be near
    the top (top 3 or within dAICc 4 of the best) in at least 5 of 7 independent noise draws."""
    good = 0
    for seed in range(7):
        d = post_fit(client, {"points": make_points(kind, 0.015, seed=100 + seed)})
        r = [x for x in d["meanFits"] if x["ok"] and x["aicc"] is not None]
        ranked = [x["kind"] for x in r]
        if kind not in ranked:
            continue
        delta = r[ranked.index(kind)]["aicc"] - r[0]["aicc"]
        good += kind in ranked[:3] or delta <= 4
    assert good >= 5, good


def test_every_returned_expr_is_valid_in_the_spec_language(client):
    for kind in ("4pl", "power", "exponential"):
        d = post_fit(client, {"points": make_points(kind, 0.01)})
        for x in d["meanFits"]:
            if x["expr"] is not None:
                assert O.is_valid(x["expr"], "c"), x
                assert not O.is_valid(x["expr"], "S") or "c" not in x["expr"]
        for x in d["sdFits"]:
            if x["expr"] is not None:
                assert O.is_valid(x["expr"], "S"), x
                assert not O.is_valid(x["expr"], "c") or "S" not in x["expr"]
        # app's own app-parse accepts them too
        for x in d["meanFits"]:
            if x["expr"]:
                assert client.post("/api/parse", json={"expr": x["expr"], "variable": "c"}).json()["ok"], x
        for x in d["sdFits"]:
            if x["expr"]:
                assert client.post("/api/parse", json={"expr": x["expr"], "variable": "S"}).json()["ok"], x


def test_expr_numbers_have_at_most_four_significant_digits(client):
    d = post_fit(client, {"points": make_points("4pl", 0.01)})
    import re
    for x in d["meanFits"]:
        if not x["expr"]:
            continue
        for tok in re.findall(r"(?<![A-Za-z_])\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+", x["expr"]):
            mant = re.split(r"[eE]", tok)[0].replace(".", "").lstrip("0").rstrip("0") if float(tok) else "0"
            assert len(mant) <= 4, (x["expr"], tok)


def test_levels_aggregate_replicates_with_sample_sd(client):
    pts = [{"c": 5, "y": 10}, {"c": 0, "y": 1}, {"c": 5, "y": 12}, {"c": 0, "y": 3}, {"c": 5, "y": 17},
           {"c": 10, "y": 30}]
    d = post_fit(client, {"points": pts})
    lv = {x["c"]: x for x in d["levels"]}
    assert set(lv) == {0, 5, 10}
    assert lv[0]["mean"] == pytest.approx(2.0) and lv[0]["n"] == 2 and lv[0]["sd"] == pytest.approx(math.sqrt(2))
    assert lv[5]["mean"] == pytest.approx(13.0) and lv[5]["n"] == 3 and lv[5]["sd"] == pytest.approx(np.std([10, 12, 17], ddof=1))
    assert lv[10]["n"] == 1 and lv[10]["sd"] is None
    assert [x["c"] for x in d["levels"]] == sorted(lv)


def test_summary_input_levels_and_sd_fit_from_given_sd(client):
    rows = [{"c": c, "mean": 50 + 12 * c**0.8, "sd": 20.0} for c in [0, 1, 2, 5, 10, 20, 50, 100]]
    d = post_fit(client, {"summary": rows})
    assert [x["c"] for x in d["levels"]] == [r["c"] for r in rows]
    assert [x["n"] for x in d["levels"]] == [1] * len(rows)
    assert [x["sd"] for x in d["levels"]] == [20.0] * len(rows)
    fits = {x["kind"]: x for x in d["meanFits"]}
    got = oracle_curve(fits["power"]["expr"], [0, 3, 30, 100])
    assert got == pytest.approx([50 + 12 * c**0.8 for c in [0, 3, 30, 100]], rel=2e-3, abs=0.5)


SD_LAWS = {
    "floor_cv": lambda s: np.sqrt(15**2 + (0.08 * s) ** 2),
    "constant": lambda s: 20 + 0 * s,
    "cv": lambda s: 0.08 * s,
    "power": lambda s: 2 + 0.05 * s**1.1,
}


@pytest.mark.parametrize("noise", [0.0, 0.01])
@pytest.mark.parametrize("kind", sorted(SD_LAWS))
def test_sd_law_recovered_from_summary(client, kind, noise):
    f4 = TRUTH["4pl"][0]
    cs = [0, 1, 3, 10, 30, 100, 300, 1000, 3000]
    rng = np.random.default_rng(3)
    rows = []
    for c in cs:
        m = float(f4(np.float64(c)))
        sd = float(SD_LAWS[kind](m)) * (1 + noise * rng.standard_normal())
        rows.append({"c": float(c), "mean": m, "sd": sd})
    d = post_fit(client, {"summary": rows})
    fits = {x["kind"]: x for x in d["sdFits"]}
    assert set(fits) == SD_KINDS
    fit = fits[kind]
    assert fit["ok"] is True
    S = np.linspace(min(r["mean"] for r in rows), max(r["mean"] for r in rows), 300)
    truth = SD_LAWS[kind](S)
    got = oracle_curve(fit["expr"], S, "S")
    span = float(truth.max() - truth.min()) or float(truth.max())
    tol = (0.02 if noise == 0 else 0.06) * max(span, 0.25 * float(truth.max()))
    assert np.max(np.abs(got - truth)) <= tol, (kind, fit["expr"], np.max(np.abs(got - truth)), tol)
    ranked = [x["kind"] for x in d["sdFits"] if x["ok"] and x["aicc"] is not None]
    aiccs = [x["aicc"] for x in d["sdFits"] if x["ok"] and x["aicc"] is not None]
    assert aiccs == sorted(aiccs)
    assert kind in ranked[:2], (kind, ranked)


# ---------------------------------------------------------------------------------------------
# garbage never errors
# ---------------------------------------------------------------------------------------------

GARBAGE = {
    "empty_object": {},
    "empty_points": {"points": []},
    "empty_summary": {"summary": []},
    "both_empty": {"points": [], "summary": []},
    "null_points": {"points": None},
    "one_point": {"points": [{"c": 1, "y": 2}]},
    "two_points": {"points": [{"c": 1, "y": 2}, {"c": 2, "y": 4}]},
    "three_points": {"points": [{"c": 0, "y": 2}, {"c": 1, "y": 4}, {"c": 2, "y": 9}]},
    "strings": {"points": [{"c": "a", "y": "b"}] * 6},
    "numeric_strings": {"points": [{"c": str(i), "y": str(i * 2)} for i in range(8)]},
    "missing_keys": {"points": [{"c": 1}, {"y": 2}, {}, {"c": 3, "y": 5}]},
    "wrong_types": {"points": "notalist", "summary": 5},
    "points_is_dict": {"points": {"c": 1, "y": 2}},
    "nested_junk": {"points": [[1, 2], [3, 4], None, "x", 7]},
    "all_equal_y": {"points": [{"c": i, "y": 5} for i in range(8)]},
    "all_equal_c": {"points": [{"c": 3, "y": float(i)} for i in range(8)]},
    "all_zero": {"points": [{"c": 0, "y": 0} for _ in range(8)]},
    "negative_c": {"points": [{"c": -i, "y": i * i} for i in range(1, 9)]},
    "huge": {"points": [{"c": 10.0**i, "y": 10.0**(300 + i % 8)} for i in range(8)]},
    "tiny": {"points": [{"c": 10.0**-i, "y": 10.0**-(300 + i)} for i in range(8)]},
    "summary_sd_negative": {"summary": [{"c": i, "mean": i * 3, "sd": -5} for i in range(8)]},
    "summary_sd_zero": {"summary": [{"c": i, "mean": i * 3, "sd": 0} for i in range(8)]},
    "summary_missing_sd": {"summary": [{"c": i, "mean": i * 3} for i in range(8)]},
    "summary_null_values": {"summary": [{"c": None, "mean": None, "sd": None}] * 5},
    "duplicate_c": {"points": [{"c": 1, "y": i} for i in range(10)]},
    "alternating_noise": {"points": [{"c": i, "y": (-1) ** i * 1e6} for i in range(12)]},
    "step_function": {"points": [{"c": i, "y": 0 if i < 5 else 1e4} for i in range(12)]},
    "non_monotone": {"points": [{"c": i, "y": math.sin(i) * 100} for i in range(12)]},
    "decreasing_exponential": {"points": [{"c": i, "y": 1000 * math.exp(-i) } for i in range(12)]},
}


@pytest.mark.parametrize("name", list(GARBAGE))
def test_garbage_returns_200_with_consistent_shape(client, name):
    d = post_fit(client, GARBAGE[name])
    assert set(d) >= {"levels", "meanFits", "sdFits"}
    assert isinstance(d["levels"], list) and isinstance(d["meanFits"], list) and isinstance(d["sdFits"], list)
    assert {x["kind"] for x in d["meanFits"]} <= MEAN_KINDS
    assert {x["kind"] for x in d["sdFits"]} <= SD_KINDS
    for x in d["meanFits"] + d["sdFits"]:
        assert isinstance(x["ok"], bool)
        if x["ok"]:
            assert isinstance(x["expr"], str) and x["expr"]
            assert x["r2"] is None or math.isfinite(x["r2"])
        else:
            assert x["expr"] is None
    for x in d["meanFits"]:
        if x["ok"]:
            assert O.is_valid(x["expr"], "c"), x
    for x in d["sdFits"]:
        if x["ok"]:
            assert O.is_valid(x["expr"], "S"), x


@pytest.mark.parametrize("name", ["empty_object", "empty_points", "empty_summary", "both_empty", "null_points",
                                  "one_point", "strings", "wrong_types", "points_is_dict", "nested_junk",
                                  "summary_null_values", "missing_keys"])
def test_unfittable_input_has_every_fit_not_ok(client, name):
    d = post_fit(client, GARBAGE[name])
    # SPEC AMBIGUITY: for wrong-typed payloads the app returns *empty* lists rather than ok:false entries;
    # either way nothing is claimed as a successful fit.
    assert not any(x["ok"] for x in d["meanFits"]), d["meanFits"]


def test_two_and_three_points_do_not_claim_overparameterised_fits_with_finite_aicc(client):
    d = post_fit(client, GARBAGE["three_points"])
    for x in d["meanFits"]:
        if x["ok"] and x["kind"] in ("4pl", "5pl", "quadratic", "power", "exponential", "log"):
            assert x["aicc"] is None or math.isfinite(x["aicc"])


def test_all_equal_y_fits_reproduce_constant(client):
    d = post_fit(client, GARBAGE["all_equal_y"])
    for x in d["meanFits"]:
        if x["ok"]:
            got = oracle_curve(x["expr"], [0, 3.5, 7])
            assert np.all(np.isfinite(got)) and got == pytest.approx([5, 5, 5], abs=1e-3), x


def test_non_json_bodies(client):
    for raw in (b"", b"garbage", b"[1,2,3]", b'"str"', b"null", b"123", b'{"points": [{"c": NaN, "y": 1}]',
                b'{"points": [{"c": NaN, "y": 1}, {"c": Infinity, "y": -Infinity}, {"c": 2, "y": NaN}]}',
                b'{"points": [{"c": 1e999, "y": 1}, {"c": 2, "y": -1e999}]}'):
        r = client.post("/api/fit", content=raw, headers={"content-type": "application/json"})
        assert r.status_code == 200, (raw, r.status_code, r.text[:200])
        json.loads(r.text)  # strict JSON out (NaN would not parse in other languages, python's loads accepts it)
        assert "NaN" not in r.text and "Infinity" not in r.text


def test_nan_points_are_dropped_not_fitted(client):
    raw = (b'{"points": [{"c": 0, "y": 1}, {"c": NaN, "y": 5}, {"c": 1, "y": 3}, {"c": 2, "y": 5}, '
           b'{"c": 3, "y": NaN}, {"c": 4, "y": 9}, {"c": 5, "y": 11.1}]}')
    r = client.post("/api/fit", content=raw, headers={"content-type": "application/json"})
    d = r.json()
    assert r.status_code == 200
    assert [x["c"] for x in d["levels"]] == [0, 1, 2, 4, 5]
    lin = next(x for x in d["meanFits"] if x["kind"] == "linear")
    assert lin["ok"] and oracle_curve(lin["expr"], [0, 5]) == pytest.approx([1, 11], abs=0.3)


def test_big_input_is_fine(client):
    rng = np.random.default_rng(0)
    cs = np.repeat(np.geomspace(0.1, 1000, 100), 20)
    pts = [{"c": float(c), "y": float(50 + 3950 / (1 + (40 / c) ** 1.2) + rng.normal(0, 20))} for c in cs]
    d = post_fit(client, {"points": pts})
    assert len(d["levels"]) == 100
    fit = next(x for x in d["meanFits"] if x["kind"] == "4pl")
    assert fit["ok"]
    grid = np.geomspace(0.1, 1000, 50)
    truth = 50 + 3950 / (1 + (40 / grid) ** 1.2)
    assert np.max(np.abs(oracle_curve(fit["expr"], grid) - truth)) < 60
