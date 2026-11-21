import math

import numpy as np
from scipy.interpolate import PchipInterpolator
import pytest

from app import expr as E
from app import metrics as K
from app.series import Series, Table, compile_series, normalize_levels


def eq(**kw):
    return compile_series(Series.model_validate(kw))


# ---------------------------------------------------------------- levels
def test_levels_always_include_zero():
    assert normalize_levels([5, 1, 5, 25]) == [0, 1, 5, 25]
    assert normalize_levels([]) == [0]
    assert normalize_levels([-3, float("nan"), 2, "x"]) == [0, 2]
    assert Series(levels=[10, 2]).levels == [0, 2, 10]
    m = eq(mode="replicates", replicates={"concs": [3, 1], "cells": [[1, 2], [3, 4]]})
    assert list(m.levels) == [0, 1, 3] and m.c_max == 3


# ---------------------------------------------------------------- table interpolation edge cases
def test_table_one_point_constant():
    t = Table([2.0], [7.0])
    np.testing.assert_allclose(t([0, 2, 100]), 7.0)


def test_table_two_points_linear_and_clamped():
    t = Table([0, 10], [0, 100])
    np.testing.assert_allclose(t([-5, 0, 2.5, 10, 20]), [0, 0, 25, 100, 100])


def test_table_extend_continues_the_end_slope_above_only():
    t = Table([0, 10], [0, 100], extend=True)
    np.testing.assert_allclose(t([-5, 0, 10, 20, 30]), [0, 0, 100, 200, 300])
    t = Table([0, 1, 2, 10], [0, 1, 2, 3], extend=True)
    slope = float(PchipInterpolator([0, 1, 2, 10], [0, 1, 2, 3]).derivative()(10))
    np.testing.assert_allclose(t([10, 14]), [3, 3 + 4 * slope])
    assert Table([2.0], [7.0], extend=True)(100) == 7.0  # one point: constant either way


def test_table_duplicates_averaged_and_sorted():
    t = Table([10, 0, 10], [100, 0, 200])
    np.testing.assert_allclose(t([0, 10]), [0, 150])


def test_table_pchip_monotone():
    t = Table([0, 1, 2, 10], [0, 1, 2, 3])
    x = np.linspace(0, 10, 200)
    assert np.all(np.diff(t(x)) >= -1e-12)
    np.testing.assert_allclose(t([0, 1, 2, 10]), [0, 1, 2, 3])


def test_replicates_ragged_null_and_single_value_column():
    m = eq(mode="replicates", replicates={
        "concs": [0, 1, 5, 20],
        "cells": [[48.0, 52.0, None], [55.0, 58.0, 53.0, 56.0], [90.0], [None, None]]})
    np.testing.assert_allclose(m.mean([0, 1, 5]), [50, 55.5, 90])
    # SD only from columns 0 and 1 (the 1-value and empty columns are excluded); sample SD (n-1)
    np.testing.assert_allclose(m.sd([0]), [np.std([48, 52], ddof=1)])
    np.testing.assert_allclose(m.sd([1]), [np.std([55, 58, 53, 56], ddof=1)])
    cv = lambda c: m.sd([c])[0] / m.mean([c])[0]  # noqa: E731
    assert cv(5) == pytest.approx(cv(1)) and cv(100) == pytest.approx(cv(1))  # the 1-reading column and beyond borrow the CV
    assert m.mean([40])[0] > m.mean([20])[0] > m.mean([5])[0]  # the mean continues past the last column
    assert not m.sd_missing


def test_replicates_no_sd_at_all():
    m = eq(mode="replicates", replicates={"concs": [0, 1], "cells": [[1.0], [2.0]]})
    assert m.sd_missing
    np.testing.assert_allclose(m.sd([0, 0.5, 1]), 0.0)


def test_summary_mode_and_missing_sd_rows():
    m = eq(mode="summary", summary=[{"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": None},
                                    {"c": 25, "mean": 400, "sd": 30}])
    np.testing.assert_allclose(m.mean([0, 5, 25]), [50, 95, 400])
    np.testing.assert_allclose(m.sd([0, 25]), [15, 30])
    assert 15 < float(m.sd(5)) < 30


def test_empty_table_does_not_crash():
    m = eq(mode="summary", summary=[])
    assert m.mean([1, 2]).tolist() == [0.0, 0.0]


# ---------------------------------------------------------------- equations
def test_equations_sd_is_function_of_signal():
    m = eq(meanExpr="100 + 2*c", sdExpr="0.1*S")
    np.testing.assert_allclose(m.mean([0, 10]), [100, 120])
    np.testing.assert_allclose(m.sd([0, 10]), [10, 12])


def test_bad_expression_raises():
    with pytest.raises(E.ExprError):
        eq(meanExpr="1 +")
    eq(mode="summary", meanExpr="1 +", summary=[{"c": 0, "mean": 1, "sd": 1}])  # unused field is ignored


# ---------------------------------------------------------------- metrics
def test_metric_formulas():
    r = K.pair_row(0, 1, 100.0, 130.0, 5.0, 10.0, "ssmd", 2)
    assert r["dmu"] == 30
    assert r["dsum"] == pytest.approx(2.0)
    assert r["ssmd"] == pytest.approx(30 / math.sqrt(125))
    assert r["zprime"] == pytest.approx(1 - 3 * 15 / 30)
    assert r["pass"] is True
    assert K.pair_row(0, 1, 100.0, 110.0, 5.0, 10.0, "ssmd", 3)["pass"] is False
    assert K.pair_row(0, 1, 0.0, 100.0, 5.0, 5.0, "zprime", 0.5)["pass"] is True


def test_overlap_and_error_equal_sd():
    r = K.pair_row(0, 1, 0.0, 4.0, 1.0, 1.0)
    tail = 1 - 0.9772498680518208  # P(Z > 2)
    assert r["ovl"] == pytest.approx(2 * tail, abs=1e-5)
    assert r["err"] == pytest.approx(tail, abs=1e-9)
    same = K.pair_row(0, 1, 5.0, 5.0, 2.0, 2.0)
    assert same["ovl"] == pytest.approx(1.0, abs=1e-6)
    assert same["err"] == pytest.approx(0.5)


def test_falling_curve_metrics_use_abs():
    r = K.pair_row(0, 1, 100.0, 40.0, 5.0, 5.0, "ssmd", 3)
    assert r["dmu"] < 0 and r["ssmd"] < 0 and r["pass"] is True
    assert r["err"] == pytest.approx(K.pair_row(0, 1, 40.0, 100.0, 5.0, 5.0)["err"])


def test_zero_sd_edge_cases_never_crash():
    r = K.pair_row(0, 1, 1.0, 2.0, 0.0, 0.0)
    assert math.isinf(r["dsum"]) and r["ovl"] == 0.0 and r["err"] == 0.0
    r = K.pair_row(0, 1, 1.0, 1.0, 0.0, 0.0)
    assert math.isnan(r["dsum"]) and r["pass"] is False
    K.pair_row(0, 1, math.nan, 1.0, 1.0, 1.0)


def test_level_rows_adjacent_pairs():
    rows = K.level_rows(eq())
    assert [(r["c1"], r["c2"]) for r in rows] == [(0, 1), (1, 5), (5, 25), (25, 100), (100, 500)]
    keys = {"mu1", "mu2", "sd1", "sd2", "dmu", "dsum", "ssmd", "zprime", "ovl", "err", "pass"}
    assert all(set(r) >= keys for r in rows)


# ---------------------------------------------------------------- inverse
def test_inverse_rising_and_falling():
    m = eq(meanExpr="50 + 2*c", cMax=100)
    np.testing.assert_allclose(m.inverse([50, 150, 250]), [0, 50, 100], atol=1e-9)
    assert m.inverse([49, 251, float("nan")]) == [None, None, None]
    f = eq(meanExpr="1000/(1 + c/10)", cMax=100)
    assert f.inverse([500])[0] == pytest.approx(10, abs=1e-9)


def test_inverse_first_bracket_wins_on_nonmonotone():
    m = eq(meanExpr="c*(10 - c)", cMax=10)  # rises to 25 at c=5 then falls
    assert m.inverse([16])[0] == pytest.approx(2, abs=1e-9)


def test_inverse_table_mode():
    m = eq(mode="summary", summary=[{"c": 0, "mean": 0, "sd": 1}, {"c": 10, "mean": 100, "sd": 1}])
    assert m.inverse([50])[0] == pytest.approx(5)
