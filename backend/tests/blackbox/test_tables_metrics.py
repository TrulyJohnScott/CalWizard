"""Spec §3 (PCHIP table interpolation) and §5 (separation metrics), against scipy/numpy oracles."""
from __future__ import annotations

import math

import numpy as np
from scipy.interpolate import PchipInterpolator
import pytest
from hypothesis import HealthCheck, given, settings, strategies as st
from scipy import stats

from . import oracle as O

pytestmark = pytest.mark.filterwarnings("ignore::RuntimeWarning")


def evaluate(client, series, grid=None):
    body = {"series": series}
    if grid is not None:
        body["grid"] = [float(g) for g in grid]
    r = client.post("/api/evaluate", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def rep_series(concs, cells, **kw):
    return {"name": "r", "mode": "replicates", "replicates": {"concs": concs, "cells": cells},
            "levels": [0], "cMax": max(max(concs), 1), **kw}


def sum_series(rows, **kw):
    return {"name": "s", "mode": "summary", "summary": rows, "levels": [0], "cMax": max(max(r["c"] for r in rows), 1), **kw}


def arr(xs):
    return np.array([np.nan if x is None else x for x in xs], dtype=float)


def assert_close(got, want, rel=1e-9, abs_=1e-12, msg=""):
    got, want = arr(got), np.asarray(want, dtype=float)
    assert got.shape == want.shape, msg
    np.testing.assert_allclose(got, want, rtol=rel, atol=abs_, err_msg=msg)


# ---------------------------------------------------------------------------------------------
# §3 replicates
# ---------------------------------------------------------------------------------------------

REP_CASES = {
    "regular": ([0, 1, 5, 25, 100],
                [[48.1, 52.0, 47.3], [55.0, 58.2, 53.9], [90.1, 101.3, 95.5], [400, 420.5, 389.2],
                 [1500, 1480, 1555]]),
    "ragged": ([0, 2, 8, 30], [[10, 12, 11, 9.5], [20, 22], [60, 55, 61.5], [180, 175, 190, 185, 170]]),
    "nulls_ignored": ([0, 1, 4], [[5, None, 6, 7], [None, 9, 11, None, 10], [30, 31, None, 29.5]]),
    "one_value_column_has_no_sd": ([0, 1, 5, 10], [[5, 6, 5.5], [9], [20, 22, 21], [41, 43, 40]]),
    "one_value_via_nulls": ([0, 1, 5, 10], [[5, 6, 5.5], [9, None, None], [20, 22, 21], [41, 43, 40]]),
    "duplicate_concs_equal_n": ([0, 1, 1, 5, 10], [[5, 6, 5.5], [9, 10, 8], [11, 12, 10], [20, 22, 21], [41, 43, 40]]),
    "unsorted": ([10, 0, 5, 1], [[41, 43, 40], [5, 6, 5.5], [20, 22, 21], [9, 10, 8.5]]),
    "single_column": ([0], [[3, 4, 5]]),
    "two_columns_linear": ([0, 10], [[1, 2, 3], [11, 13, 12]]),
    "two_columns_one_sd": ([0, 10], [[1, 2, 3], [11]]),
    "all_single_value_sd_zero": ([0, 1, 5], [[1], [3], [9]]),
    "identical_replicates": ([0, 1, 5], [[2, 2, 2], [4, 4, 4], [9, 9, 9]]),
    "non_monotone": ([0, 1, 2, 3, 4], [[1, 2, 1.5], [9, 8, 10], [3, 4, 3.5], [8, 7, 9], [2, 3, 2.5]]),
    "negative_signals": ([0, 1, 2], [[-5, -6, -4], [-1, -2, -0.5], [4, 5, 3]]),
    "tiny_and_huge_scale": ([0, 1e-3, 1e3], [[1e-6, 2e-6], [1e-3, 3e-3], [1e6, 2e6]]),
    "fractional_concs": ([0, 0.1, 0.25, 1.5], [[1, 2, 3], [4, 5, 6.5], [9, 8, 10.5], [20, 21, 19]]),
}


def rep_oracle(concs, cells):
    return O.replicate_model(concs, cells)


@pytest.mark.parametrize("name", list(REP_CASES))
def test_replicates_mean_sd_match_pchip_oracle(client, name):
    concs, cells = REP_CASES[name]
    mean_i, sd_i, _ = rep_oracle(concs, cells)
    hi = max(concs)
    grid = np.unique(np.concatenate([np.linspace(-0.2 * hi, 1.3 * hi, 601), np.array(sorted(set(concs)))]))
    d = evaluate(client, rep_series(concs, cells), grid)
    assert_close(d["mean"], mean_i(grid), rel=1e-9, abs_=1e-12 * (1 + np.max(np.abs(mean_i(grid)))), msg="mean")
    assert_close(d["sd"], sd_i(grid), rel=1e-9, abs_=1e-12 * (1 + np.max(np.abs(sd_i(grid)))), msg="sd")
    lv = d["levels"]
    assert lv[0] == 0 and lv == sorted(set(lv)) and all(x >= 0 for x in lv)
    assert set(lv) >= set(float(c) for c in concs)


@pytest.mark.parametrize("name", list(REP_CASES))
def test_replicates_rows_follow_table_model(client, name):
    concs, cells = REP_CASES[name]
    mean_i, sd_i, _ = rep_oracle(concs, cells)
    d = evaluate(client, rep_series(concs, cells), [0.0])
    lv = d["levels"]
    assert len(d["rows"]) == len(lv) - 1
    for i, row in enumerate(d["rows"]):
        assert row["c1"] == lv[i] and row["c2"] == lv[i + 1]
        mu1, mu2 = float(mean_i(lv[i])), float(mean_i(lv[i + 1]))
        s1, s2 = float(sd_i(lv[i])), float(sd_i(lv[i + 1]))
        assert row["mu1"] == pytest.approx(mu1, rel=1e-9, abs=1e-12)
        assert row["mu2"] == pytest.approx(mu2, rel=1e-9, abs=1e-12)
        assert row["sd1"] == pytest.approx(s1, rel=1e-9, abs=1e-12)
        assert row["sd2"] == pytest.approx(s2, rel=1e-9, abs=1e-12)


def test_sample_sd_uses_n_minus_1(client):
    d = evaluate(client, rep_series([0, 1], [[1, 2, 3, 4], [10, 20, 30, 40]]), [0, 1])
    assert d["sd"][0] == pytest.approx(math.sqrt(5 / 3), rel=1e-12)       # ddof=1, not sqrt(1.25)
    assert d["sd"][1] == pytest.approx(10 * math.sqrt(5 / 3), rel=1e-12)
    assert d["mean"] == pytest.approx([2.5, 25.0])


def test_no_sd_available_gives_sd_zero(client):
    d = evaluate(client, rep_series([0, 1, 5], [[1], [3], [9]]), [0, 0.5, 1, 3, 5])
    assert d["sd"] == [0.0] * 5
    assert all(r["sd1"] == 0 and r["sd2"] == 0 for r in d["rows"])


def test_column_with_single_value_is_excluded_from_sd_interpolation(client):
    concs, cells = [0, 1, 5, 10], [[5, 6, 5.5], [9], [20, 22, 21], [41, 43, 40]]
    d = evaluate(client, rep_series(concs, cells), [1.0])
    # if the 1-value column were *included* (sd 0 or nan) the interpolated sd at c=1 would differ
    sd_wo = O.Interp([(0, np.std([5, 6, 5.5], ddof=1)), (5, np.std([20, 22, 21], ddof=1)),
                      (10, np.std([41, 43, 40], ddof=1))])(1.0)
    assert d["sd"][0] == pytest.approx(float(sd_wo), rel=1e-9)
    mean = O.Interp([(0, np.mean([5, 6, 5.5])), (1, 9), (5, np.mean([20, 22, 21])), (10, np.mean([41, 43, 40]))])
    assert d["mean"][0] == pytest.approx(9.0)


def test_outside_range_mean_continues_above_sd_holds(client):
    """Spec section 3 (v2.4): flat below c_first; above c_last the mean continues with the PCHIP end slope."""
    concs, cells = [0, 1, 5], [[5, 6], [9, 11], [30, 34]]
    d = evaluate(client, rep_series(concs, cells), [-100, -1e-9, 5, 6, 15])
    assert d["mean"][0] == d["mean"][1] == pytest.approx(5.5, abs=1e-6)
    k = float(PchipInterpolator([0, 1, 5], [5.5, 10, 32]).derivative()(5))
    assert d["mean"][2] == pytest.approx(32.0)
    assert d["mean"][3] == pytest.approx(32.0 + k, rel=1e-9)
    assert d["mean"][4] == pytest.approx(32.0 + 10 * k, rel=1e-9)
    assert d["sd"][3] == d["sd"][4] == pytest.approx(np.std([30, 34], ddof=1))


def test_pchip_is_not_linear_and_not_cubic_spline(client):
    """Guards against swapping PCHIP for np.interp / CubicSpline: 3 uneven monotone points."""
    concs, cells = [0, 1, 10], [[0, 0], [10, 10], [11, 11]]
    g = np.linspace(0, 10, 101)
    d = evaluate(client, rep_series(concs, cells), g)
    want = O.Interp([(0, 0), (1, 10), (10, 11)])(g)
    assert_close(d["mean"], want, rel=1e-12, abs_=1e-12)
    assert np.max(np.abs(want - np.interp(g, [0, 1, 10], [0, 10, 11]))) > 0.1  # the oracle really is nonlinear
    assert max(d["mean"]) <= 11 + 1e-12  # PCHIP shape preserving: no overshoot


def test_levels_always_include_zero_and_are_sorted_unique(client):
    d = evaluate(client, rep_series([5, 0, 1, 1], [[1, 2], [0.5, 0.6], [3, 4], [3.5, 4.5]]))
    assert d["levels"] == sorted(set(d["levels"])) and d["levels"][0] == 0


# ---------------------------------------------------------------------------------------------
# §3 summary
# ---------------------------------------------------------------------------------------------

SUM_CASES = {
    "regular": [{"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": 16}, {"c": 20, "mean": 400, "sd": 41},
                {"c": 100, "mean": 1900, "sd": 160}],
    "unsorted": [{"c": 20, "mean": 400, "sd": 41}, {"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": 16}],
    "duplicates_averaged": [{"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 90, "sd": 10}, {"c": 5, "mean": 100, "sd": 20},
                            {"c": 20, "mean": 400, "sd": 41}],
    "triplicate_dups": [{"c": 0, "mean": 1, "sd": 1}, {"c": 2, "mean": 3, "sd": 1}, {"c": 2, "mean": 6, "sd": 4},
                        {"c": 2, "mean": 9, "sd": 7}, {"c": 4, "mean": 20, "sd": 3}],
    "single_row": [{"c": 0, "mean": 50, "sd": 15}],
    "two_rows": [{"c": 0, "mean": 50, "sd": 15}, {"c": 10, "mean": 150, "sd": 25}],
    "sd_zero": [{"c": 0, "mean": 5, "sd": 0}, {"c": 1, "mean": 7, "sd": 0}, {"c": 3, "mean": 20, "sd": 0}],
    "non_monotone": [{"c": 0, "mean": 5, "sd": 1}, {"c": 1, "mean": 50, "sd": 5}, {"c": 2, "mean": 20, "sd": 2},
                     {"c": 3, "mean": 90, "sd": 9}],
    "falling": [{"c": 0, "mean": 4000, "sd": 100}, {"c": 1, "mean": 3000, "sd": 80}, {"c": 10, "mean": 200, "sd": 20}],
}


@pytest.mark.parametrize("name", list(SUM_CASES))
def test_summary_mean_sd_match_pchip_oracle(client, name):
    rows = SUM_CASES[name]
    mean_i, sd_i = O.summary_model(rows)
    hi = max(r["c"] for r in rows)
    grid = np.linspace(-1, max(hi * 1.4, 1), 501)
    d = evaluate(client, sum_series(rows), grid)
    assert_close(d["mean"], mean_i(grid), abs_=1e-10, msg="mean")
    assert_close(d["sd"], sd_i(grid), abs_=1e-10, msg="sd")
    lv = d["levels"]
    assert lv[0] == 0 and lv == sorted(set(lv))
    for i, row in enumerate(d["rows"]):
        assert row["mu1"] == pytest.approx(float(mean_i(lv[i])), abs=1e-10)
        assert row["sd2"] == pytest.approx(float(sd_i(lv[i + 1])), abs=1e-10)


def test_summary_duplicates_are_averaged_exactly(client):
    rows = [{"c": 0, "mean": 1, "sd": 1}, {"c": 2, "mean": 3, "sd": 1}, {"c": 2, "mean": 9, "sd": 7}]
    d = evaluate(client, sum_series(rows), [2.0])
    assert d["mean"][0] == pytest.approx(6.0)
    assert d["sd"][0] == pytest.approx(4.0)


@pytest.mark.parametrize("name", ["duplicate_concs_equal_n", "unsorted", "one_value_column_has_no_sd"])
def test_replicate_duplicates_and_order_are_invariant(client, name):
    """Column order must not matter (replicates)."""
    concs, cells = REP_CASES[name]
    perm = list(reversed(range(len(concs))))
    a = evaluate(client, rep_series(concs, cells), np.linspace(0, max(concs), 50))
    b = evaluate(client, rep_series([concs[i] for i in perm], [cells[i] for i in perm]), np.linspace(0, max(concs), 50))
    assert_close(a["mean"], b["mean"], abs_=1e-12)
    assert_close(a["sd"], b["sd"], abs_=1e-12)


def test_replicates_duplicate_column_sd_is_average_of_column_sds(client):
    concs, cells = [0, 1, 1, 5], [[5, 6, 5.5], [9, 10, 8], [11, 14, 10], [20, 22, 21]]
    mean_i, sd_i, _ = O.replicate_model(concs, cells)
    d = evaluate(client, rep_series(concs, cells), [1.0])
    assert d["sd"][0] == pytest.approx(float(sd_i(1.0)), rel=1e-9)


# ---- hypothesis over replicate tables ----

_vals = st.floats(min_value=-1e3, max_value=1e3, allow_nan=False, allow_infinity=False, width=32)
_cell = st.one_of(_vals, st.none())
_col = st.lists(_cell, min_size=1, max_size=6).filter(lambda col: any(v is not None for v in col))


@st.composite
def rep_tables(draw):
    n = draw(st.integers(1, 7))
    concs = sorted(draw(st.lists(st.integers(1, 50000).map(lambda i: i / 100), min_size=n - 1, max_size=n - 1,
                                 unique=True))) if n > 1 else []
    concs = [0.0] + concs
    cells = [draw(_col) for _ in concs]
    order = draw(st.permutations(range(len(concs))))
    return [concs[i] for i in order], [cells[i] for i in order]


@settings(max_examples=150, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck), database=None)
@given(tbl=rep_tables())
def test_random_replicate_tables(client, tbl):
    concs, cells = tbl
    mean_i, sd_i, _ = O.replicate_model(concs, cells)
    hi = max(concs)
    grid = np.unique(np.concatenate([np.linspace(-1, hi * 1.2 + 1, 97), np.array(concs)]))
    d = evaluate(client, rep_series(concs, cells), grid)
    scale_m = 1e-9 * (1 + np.max(np.abs(mean_i(grid))))
    scale_s = 1e-9 * (1 + np.max(np.abs(sd_i(grid))))
    assert_close(d["mean"], mean_i(grid), rel=1e-9, abs_=scale_m, msg=f"mean {tbl}")
    assert_close(d["sd"], sd_i(grid), rel=1e-9, abs_=scale_s, msg=f"sd {tbl}")


@st.composite
def sum_tables(draw):
    n = draw(st.integers(1, 7))
    concs = [0.0] + sorted(draw(st.lists(st.integers(1, 50000).map(lambda i: i / 100), min_size=n - 1,
                                         max_size=n - 1, unique=True)))
    rows = [{"c": c, "mean": draw(_vals), "sd": draw(st.floats(0, 200, allow_nan=False, width=32))} for c in concs]
    # sprinkle a duplicate concentration and shuffle
    if len(rows) > 2 and draw(st.booleans()):
        rows.append({"c": rows[1]["c"], "mean": draw(_vals), "sd": draw(st.floats(0, 200, allow_nan=False, width=32))})
    return draw(st.permutations(rows))


@settings(max_examples=150, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck), database=None)
@given(rows=sum_tables())
def test_random_summary_tables(client, rows):
    rows = list(rows)
    mean_i, sd_i = O.summary_model(rows)
    hi = max(r["c"] for r in rows)
    grid = np.linspace(-1, hi * 1.2 + 1, 120)
    d = evaluate(client, sum_series(rows), grid)
    assert_close(d["mean"], mean_i(grid), rel=1e-9, abs_=1e-9 * (1 + np.max(np.abs(mean_i(grid)))), msg="mean")
    assert_close(d["sd"], sd_i(grid), rel=1e-9, abs_=1e-9 * (1 + np.max(np.abs(sd_i(grid)))), msg="sd")


# ---------------------------------------------------------------------------------------------
# §5 metrics
# ---------------------------------------------------------------------------------------------


def pair_row(client, mu1, mu2, s1, s2, metric="ssmd", k=3.0):
    rows = [{"c": 0, "mean": mu1, "sd": s1}, {"c": 1, "mean": mu2, "sd": s2}]
    d = evaluate(client, sum_series(rows, metric=metric, kTarget=k), [0])
    assert len(d["rows"]) == 1
    return d["rows"][0]


ROW_KEYS = ["c1", "c2", "mu1", "mu2", "sd1", "sd2", "dmu", "dsum", "ssmd", "zprime", "ovl", "err", "pass"]

PAIRS = [  # mu1, mu2, s1, s2
    (50, 95, 15, 16), (0, 10, 1, 1), (0, 10, 2, 3), (100, 130, 10, 25), (5, 6, 1, 5), (0, 1, 1, 1),
    (0, 0.5, 1, 1), (0, 20, 1, 1), (0, 100, 1, 1), (0, 10, 0.5, 8), (0, 10, 8, 0.5), (0, 3, 10, 0.2),
    (-5, 5, 1, 2), (1000, 4000, 80, 320), (0, 1e-3, 1e-3, 2e-3), (1e6, 2e6, 1e5, 3e5), (3, 10, 1, 1.0000001),
    (10, 0, 1, 1), (4000, 50, 100, 300), (10, 0, 2, 3), (95, 50, 16, 15), (0, 6, 1, 1), (0, 4, 1, 1),
    (0, 3, 1, 1), (0, 5.999, 1, 1), (0, 12, 2, 2),
]


@pytest.mark.parametrize("mu1,mu2,s1,s2", PAIRS)
def test_metric_row_matches_first_principles(client, mu1, mu2, s1, s2):
    row = pair_row(client, mu1, mu2, s1, s2)
    assert list(row) == ROW_KEYS or set(row) == set(ROW_KEYS), list(row)
    base = O.metric_row(mu1, mu2, s1, s2)
    assert row["c1"] == 0 and row["c2"] == 1
    for k, v in [("mu1", mu1), ("mu2", mu2), ("sd1", s1), ("sd2", s2)]:
        assert row[k] == pytest.approx(v, rel=1e-12)
    for k in ("dmu", "dsum", "ssmd", "zprime"):
        assert row[k] == pytest.approx(base[k], rel=1e-9, abs=1e-12), k
    ovl = O.exact_ovl(mu1, s1, mu2, s2)
    assert abs(row["ovl"] - ovl) <= 2e-4, (row["ovl"], ovl)
    err = O.exact_err(mu1, s1, mu2, s2)
    assert row["err"] == pytest.approx(err, abs=1e-8, rel=1e-6), (row["err"], err)


@pytest.mark.parametrize("mu1,mu2,s1,s2", PAIRS[:12] + PAIRS[17:20])
def test_ovl_trapezoid_is_accurate_to_spec_tolerance_tighter(client, mu1, mu2, s1, s2):
    """The spec's trapezoid (4001 pts, +-8 sigma) is a few 1e-6 off exact; tolerate 2e-4 per spec, report >5e-5."""
    row = pair_row(client, mu1, mu2, s1, s2)
    assert abs(row["ovl"] - O.exact_ovl(mu1, s1, mu2, s2)) <= 2e-4


@pytest.mark.parametrize("metric", ["dsum", "ssmd", "zprime"])
@pytest.mark.parametrize("mu1,mu2,s1,s2", [p for p in PAIRS if p[2] > 0 and p[3] > 0 and p[0] != p[1]])
@pytest.mark.parametrize("k", [0.5, 1.0, 2.0, 3.0])
def test_pass_rule_per_metric(client, metric, mu1, mu2, s1, s2, k):
    row = pair_row(client, mu1, mu2, s1, s2, metric=metric, k=k)
    base = O.metric_row(mu1, mu2, s1, s2)
    value = base[metric]
    if abs(abs(value) - k) < 1e-6 * k or abs(value - k) < 1e-6 * k:
        pytest.skip("value on the threshold: floating-point tie")
    assert row["pass"] is O.passes(metric, value, k), (metric, value, k, row)


def test_pass_rule_signs_for_falling_curve(client):
    """dsum/ssmd use |value| so a falling curve passes; zprime uses |dmu| inside, no abs outside."""
    for metric in ("dsum", "ssmd"):
        row = pair_row(client, 4000, 50, 100, 100, metric=metric, k=3)
        assert row["dsum"] < 0 and row["ssmd"] < 0 and row["pass"] is True
    row = pair_row(client, 4000, 50, 100, 100, metric="zprime", k=0.5)
    assert row["zprime"] == pytest.approx(1 - 3 * 200 / 3950) and row["pass"] is True
    row = pair_row(client, 0, 1, 1, 1, metric="zprime", k=0.5)
    assert row["zprime"] == pytest.approx(-5.0) and row["pass"] is False


def test_hand_computed_reference_row(client):
    row = pair_row(client, 0, 10, 2, 3, metric="dsum", k=2.0)
    assert row["dmu"] == 10
    assert row["dsum"] == pytest.approx(10 / 5)
    assert row["ssmd"] == pytest.approx(10 / math.sqrt(13))
    assert row["zprime"] == pytest.approx(1 - 15 / 10)
    assert row["pass"] is True  # 2.0 >= 2.0


def test_equal_sigma_closed_forms(client):
    row = pair_row(client, 0, 6, 1, 1)
    # both closed forms known by hand
    assert row["ovl"] == pytest.approx(2 * stats.norm.cdf(-3), abs=2e-4)
    assert row["err"] == pytest.approx(stats.norm.cdf(-3), abs=1e-12)  # 0.5*(P(X1>3)+P(X2<3)) = Phi(-3)


def test_equal_means(client):
    row = pair_row(client, 7, 7, 2, 3)
    assert row["dmu"] == 0 and row["dsum"] == 0 and row["ssmd"] == 0
    assert row["zprime"] is None or row["zprime"] < -1e6  # -inf -> null
    assert row["ovl"] == pytest.approx(O.exact_ovl(7, 2, 7, 3), abs=2e-4)
    assert row["err"] == pytest.approx(0.5, abs=1e-9)
    assert row["pass"] is False


def test_equal_means_equal_sigmas(client):
    row = pair_row(client, 7, 7, 2, 2)
    assert row["ovl"] == pytest.approx(1.0, abs=2e-4) and row["err"] == pytest.approx(0.5) and row["pass"] is False


def test_huge_separation(client):
    row = pair_row(client, 0, 1e6, 1, 1)
    assert row["ovl"] == pytest.approx(0, abs=1e-12)
    assert row["err"] == pytest.approx(0, abs=1e-12)
    assert row["ssmd"] == pytest.approx(1e6 / math.sqrt(2), rel=1e-12)
    assert row["pass"] is True


def test_one_sigma_zero_still_computable(client):
    row = pair_row(client, 0, 10, 0, 2)
    assert row["dsum"] == pytest.approx(5.0)
    assert row["ssmd"] == pytest.approx(5.0)
    assert row["zprime"] == pytest.approx(1 - 3 * 2 / 10)
    assert row["pass"] is True
    for k in ("ovl", "err"):
        assert row[k] is None or 0 <= row[k] <= 1


def test_both_sigma_zero_is_sensible_and_never_crashes(client):
    row = pair_row(client, 0, 10, 0, 0)
    assert row["dmu"] == 10
    assert row["dsum"] is None and row["ssmd"] is None  # +inf -> null
    assert row["zprime"] == pytest.approx(1.0)
    assert row["pass"] is True
    for k in ("ovl", "err"):
        assert row[k] is None or 0 <= row[k] <= 1
    row = pair_row(client, 5, 5, 0, 0)
    assert row["dsum"] is None or math.isnan(row["dsum"] or 0)  # 0/0
    assert row["pass"] is False


def test_falling_curve_signs(client):
    up = pair_row(client, 50, 95, 15, 16)
    down = pair_row(client, 95, 50, 16, 15)
    assert down["dmu"] == -up["dmu"] and down["dsum"] == pytest.approx(-up["dsum"]) and down["ssmd"] == pytest.approx(-up["ssmd"])
    assert down["zprime"] == pytest.approx(up["zprime"])
    assert down["ovl"] == pytest.approx(up["ovl"], abs=1e-9)
    assert down["err"] == pytest.approx(up["err"], abs=1e-9)
    assert 0 <= down["err"] <= 0.5


@settings(max_examples=150, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck), database=None)
@given(mu1=st.floats(-1e4, 1e4), delta=st.floats(-3e3, 3e3), s1=st.floats(0.01, 500), ratio=st.floats(0.05, 20))
def test_random_pairs(client, mu1, delta, s1, ratio):
    mu2, s2 = mu1 + delta, s1 * ratio
    if abs(delta) < 1e-6:
        return
    row = pair_row(client, mu1, mu2, s1, s2, metric="ssmd", k=3)
    base = O.metric_row(mu1, mu2, s1, s2)
    for k in ("dmu", "dsum", "ssmd", "zprime"):
        assert row[k] == pytest.approx(base[k], rel=1e-8, abs=1e-9), k
    assert abs(row["ovl"] - O.exact_ovl(mu1, s1, mu2, s2)) <= 2e-4
    assert row["err"] == pytest.approx(O.exact_err(mu1, s1, mu2, s2), abs=1e-7, rel=1e-5)
    v = base["ssmd"]
    if abs(abs(v) - 3) > 1e-6:
        assert row["pass"] is (abs(v) >= 3)
    assert 0 <= row["err"] <= 0.5 + 1e-12 and 0 <= row["ovl"] <= 1 + 1e-9


# ---------------------------------------------------------------------------------------------
# §1 levels & range in equations mode, default grid
# ---------------------------------------------------------------------------------------------

EQ = {"name": "e", "mode": "equations", "meanExpr": "50 + 12*c^0.8", "sdExpr": "sqrt(15^2 + (0.08*S)^2)",
      "cMax": 500, "metric": "ssmd", "kTarget": 3}


@pytest.mark.parametrize("levels,want", [([5, 1, 25, 1, 100], [0, 1, 5, 25, 100]), ([0, 0, 0], [0]),
                                         ([100, 0, 10], [0, 10, 100]), ([], [0]), ([7], [0, 7]),
                                         ([2.5, 0.5, 2.5], [0, 0.5, 2.5])])
def test_equation_levels_always_contain_zero_sorted_unique(client, levels, want):
    d = evaluate(client, {**EQ, "levels": levels}, [0])
    assert d["levels"] == want
    assert len(d["rows"]) == len(want) - 1
    for row, (a, b) in zip(d["rows"], zip(want[:-1], want[1:])):
        assert (row["c1"], row["c2"]) == (a, b)


def test_negative_levels_are_dropped(client):
    d = evaluate(client, {**EQ, "levels": [-5, 3, -1, 10]}, [0])
    assert d["levels"] == [0, 3, 10]


def test_default_grid_spans_zero_to_cmax_and_is_evenly_ordered(client):
    d = evaluate(client, {**EQ, "levels": [0, 1, 5]})
    g = d["grid"]
    assert len(g) >= 50 and g[0] == 0 and g[-1] == pytest.approx(500)
    assert all(b > a for a, b in zip(g, g[1:]))
    tree, _ = O.parse_to_sympy(EQ["meanExpr"], "c")
    for i in (0, len(g) // 3, len(g) - 1):
        ref, scale, _ = O.eval_tree(tree, g[i])
        assert d["mean"][i] == pytest.approx(ref, rel=1e-9)


def test_table_default_grid_spans_zero_to_largest_level(client):
    d = evaluate(client, rep_series([0, 1, 7], [[1, 2], [4, 5], [9, 11]]))
    assert d["grid"][0] == 0 and d["grid"][-1] == pytest.approx(7)


def test_mode_selects_payload_and_other_payloads_are_ignored(client):
    """§4: all three payloads are kept; only `mode` decides which is used."""
    rep = {"concs": [0, 1], "cells": [[100, 102], [200, 204]]}
    summ = [{"c": 0, "mean": 5, "sd": 1}, {"c": 1, "mean": 9, "sd": 2}]
    base = {**EQ, "levels": [0, 1], "cMax": 1, "replicates": rep, "summary": summ}
    a = evaluate(client, {**base, "mode": "equations"}, [0, 1])
    b = evaluate(client, {**base, "mode": "replicates"}, [0, 1])
    c = evaluate(client, {**base, "mode": "summary"}, [0, 1])
    assert a["mean"] == pytest.approx([50, 62]) and b["mean"] == pytest.approx([101, 202]) and c["mean"] == pytest.approx([5, 9])
    assert c["sd"] == pytest.approx([1, 2])
