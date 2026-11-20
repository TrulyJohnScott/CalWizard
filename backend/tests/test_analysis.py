"""Pair measurement, ladder, steps between and closeness (spec section 12)."""
import math

import numpy as np
import pytest

from app import analysis as A
from app import metrics as K
from app.series import Series, compile_series


def eq(**kw):
    return compile_series(Series.model_validate(kw))


LIN = dict(meanExpr="100 + 10*c", sdExpr="5", cMax=100)  # dsum k=1: dmu = 10*dc >= 5 + 5 -> steps of 1


# ---------------------------------------------------------------- pair
def test_pair_is_the_section5_row_of_the_two_concentrations():
    m = eq(**LIN)
    r = A.pair(m, 2, 5, "dsum", 1)
    assert (r["c1"], r["c2"]) == (2, 5)
    assert (r["mu1"], r["mu2"], r["sd1"], r["sd2"], r["dmu"]) == (120, 150, 5, 5, 30)
    assert r["dsum"] == pytest.approx(3.0) and r["ssmd"] == pytest.approx(30 / math.sqrt(50))
    assert r["zprime"] == pytest.approx(1 - 3 * 10 / 30)
    assert r["pass"] is True
    assert set(r) == {"c1", "c2", "mu1", "mu2", "sd1", "sd2", "dmu", "dsum", "ssmd", "zprime", "ovl", "err", "pass"}
    assert all(isinstance(v, (float, bool)) for v in r.values())
    assert A.pair(m, 2, 2.5, "dsum", 1)["pass"] is False


def test_pair_uses_signal_dependent_sd_and_matches_level_rows():
    m = eq()  # default 4PL + floor/CV
    rows = K.level_rows(m)
    for row in rows:
        got = A.pair(m, row["c1"], row["c2"], m.series.metric, m.series.k_target)
        for key, want in row.items():
            assert got[key] == pytest.approx(want, rel=1e-12, nan_ok=True), key
    assert A.pair(m, 5, 25, "ssmd", 3)["sd2"] == pytest.approx(float(m.sd(25)))


def test_pair_rejects_unknown_metric():
    with pytest.raises(ValueError, match="metric"):
        A.pair(eq(**LIN), 0, 1, "ovl", 1)
    with pytest.raises(ValueError, match="metric"):
        A.ladder(eq(**LIN), "bogus", 1)


# ---------------------------------------------------------------- ladder
def test_ladder_dsum_constant_sd_steps_of_one():
    m = eq(**LIN)
    lv = A.ladder(m, "dsum", 1, sig=0)
    assert lv[0] == 0 and len(lv) == 101
    np.testing.assert_allclose(lv, np.arange(101), atol=1e-9)


def test_ladder_start_and_stop():
    m = eq(**LIN)
    lv = A.ladder(m, "dsum", 1, start=4, stop=10, sig=0)
    np.testing.assert_allclose(lv, np.arange(4, 11), atol=1e-9)
    assert A.ladder(m, "dsum", 1, start=10, stop=10) == [10.0]
    assert A.ladder(m, "dsum", 1, start=50, stop=10) == [50.0]


def test_ladder_defaults_to_series_cmax_and_zero_start():
    m = eq(**{**LIN, "cMax": 7})
    assert A.ladder(m, "dsum", 1, sig=0)[-1] == pytest.approx(7)


def test_ladder_stops_when_nothing_passes():
    assert A.ladder(eq(meanExpr="1", sdExpr="1", cMax=10), "ssmd", 3) == [0.0]
    assert A.ladder(eq(meanExpr="c", sdExpr="1000", cMax=10), "dsum", 1) == [0.0]


def test_ladder_max_levels_cap():
    lv = A.ladder(eq(**LIN), "dsum", 1, max_levels=5)
    assert len(lv) == 5


def test_ladder_rounds_up_to_significant_digits_while_still_passing():
    m = eq(meanExpr="100 + 7*c", sdExpr="5", cMax=100)  # exact first step 10/7 = 1.428571...
    raw, rounded = A.ladder(m, "dsum", 1, sig=0), A.ladder(m, "dsum", 1, sig=4)
    assert raw[1] == pytest.approx(10 / 7, rel=1e-12)
    assert rounded[1] == pytest.approx(1.429, abs=1e-12)
    for lv in (raw, rounded):
        assert all(A.pair(m, a, b, "dsum", 1)["pass"] for a, b in zip(lv, lv[1:]))
    # rounding never leaves the range
    assert A.ladder(eq(**{**LIN, "cMax": 1.00001}), "dsum", 1, sig=1)[-1] <= 1.00001


def test_ladder_zprime_lands_on_target():
    m = eq(**LIN)
    lv = A.ladder(m, "zprime", 0.5, sig=0)
    assert len(lv) > 2
    assert A.pair(m, lv[0], lv[1], "zprime", 0.5)["zprime"] == pytest.approx(0.5, abs=1e-9)


def test_ladder_falling_curve_uses_abs():
    m = eq(meanExpr="1000/(1 + c/10)", sdExpr="2", cMax=200)
    lv = A.ladder(m, "dsum", 1)
    assert len(lv) > 3 and all(b > a for a, b in zip(lv, lv[1:]))


def test_ladder_on_table_models_and_zero_sd():
    m = eq(mode="summary", summary=[{"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": 16},
                                    {"c": 25, "mean": 400, "sd": 30}])
    lv = A.ladder(m, "ssmd", 3)
    assert lv[0] == 0 and len(lv) > 2 and lv[-1] <= 25
    # no SD at all (sd = 0): any change in the mean is infinitely resolved (|inf| >= k), so the ladder creeps
    # up from the start by (almost) nothing and never crashes; it is capped at max_levels
    z = eq(mode="summary", summary=[{"c": 0, "mean": 0}, {"c": 10, "mean": 100}])
    assert z.sd_missing
    lv = A.ladder(z, "dsum", 1, sig=0, max_levels=4)
    assert len(lv) == 4 and 0 < lv[1] < 1e-15 and all(b > a for a, b in zip(lv, lv[1:]))


def test_ladder_nan_model_never_passes():
    assert A.ladder(eq(meanExpr="sqrt(c - 100)", sdExpr="1", cMax=50), "dsum", 1) == [0.0]


# ---------------------------------------------------------------- steps between
def test_steps_between_counts_rungs_and_is_order_free():
    m = eq(**LIN)
    assert A.steps_between(m, 0, 10, "dsum", 1) == 10
    assert A.steps_between(m, 10, 0, "dsum", 1) == 10
    assert A.steps_between(m, 3.5, 9.25, "dsum", 1) == 5  # 3.5, 4.5, ..., 8.5 -> 5 steps
    assert A.steps_between(m, 4, 4, "dsum", 1) == 0
    assert A.steps_between(m, 0, 0.5, "dsum", 1) == 0
    assert A.steps_between(eq(meanExpr="1", sdExpr="1"), 0, 100, "ssmd", 3) == 0


# ---------------------------------------------------------------- closeness
ROW = {"dsum": 2.0, "ssmd": -6.0, "zprime": 0.2}


@pytest.mark.parametrize("metric,k,want", [
    ("dsum", 1, 2.0), ("dsum", 4, 0.5), ("ssmd", 3, 2.0), ("ssmd", 12, 0.5),
    ("dsum", 0, 2.0), ("ssmd", -1, 2.0),
    ("zprime", 0.5, 2.0 / (3 / 0.5)),  # |dsum| / (3 / (1 - k))
    ("zprime", 0.0, 2.0 / 3),
    ("zprime", -1, 2.0 / (3 / 2)),
    ("zprime", 1, 0.0), ("zprime", 7, 0.0),
])
def test_closeness_q(metric, k, want):
    assert A.closeness_q(ROW, metric, k) == pytest.approx(want)


def test_closeness_q_nan_and_missing_are_zero():
    nan = {"dsum": math.nan, "ssmd": math.nan, "zprime": math.nan}
    for metric, k in (("dsum", 1), ("ssmd", 3), ("zprime", 0.5), ("zprime", 2)):
        assert A.closeness_q(nan, metric, k) == 0.0
        assert A.closeness_q({"dsum": None, "ssmd": None, "zprime": None}, metric, k) == 0.0
    assert A.closeness_q({"dsum": math.inf, "ssmd": 1, "zprime": 1}, "dsum", 1) == math.inf


def test_closeness_q_unknown_metric():
    with pytest.raises(ValueError):
        A.closeness_q(ROW, "ovl", 1)


def test_closeness_agrees_with_pass_at_one():
    m = eq(**LIN)
    for metric, k in (("dsum", 1), ("ssmd", 3), ("zprime", 0.5)):
        for c2 in (0.3, 1.0, 2.0, 7.5, 40.0):
            r = A.pair(m, 0, c2, metric, k)
            assert (A.closeness_q(r, metric, k) >= 1 - 1e-12) == r["pass"], (metric, c2)


def test_metric_value_matches_pair_and_broadcasts():
    m = eq()
    cs = np.array([1.0, 5.0, 25.0])
    v = A.metric_value(m, 0.0, cs, "ssmd")
    np.testing.assert_allclose(v, [A.pair(m, 0, c, "ssmd", 3)["ssmd"] for c in cs])


def test_closeness_q_zprime_target_at_or_above_one_is_binary():
    assert A.closeness_q({"dsum": 9, "ssmd": 9, "zprime": 1.0}, "zprime", 1) == 2.0
    assert A.closeness_q({"dsum": 9, "ssmd": 9, "zprime": 0.99}, "zprime", 1) == 0.0


def test_ladder_terminates_when_the_scan_step_underflows_the_float_grid():
    # k = 0 passes at identical points; at 1e16 the scan step (0.002) is below one ulp, so no level can advance
    m = eq(meanExpr="c", sdExpr="1", cMax=2e16)
    assert A.ladder(m, "dsum", 0, start=1e16, stop=1e16 + 4, sig=0) == [1e16]
