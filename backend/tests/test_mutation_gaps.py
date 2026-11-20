"""Tests added because a planted bug (scripts/mutation_check.py) once survived the suite.

Each test names the line it pins down. Keep them small and exact.
"""
import io
import json
import math

import numpy as np
import pytest
from openpyxl import load_workbook

from app import analysis as A
from app import cli
from app import export as X
from app import expr as E
from app import fit as F
from app import metrics as K
from app.series import Series, compile_series


def model(**kw):
    return compile_series(Series.model_validate(kw))


# ---------------------------------------------------------------- export: summary rows on the Data sheet
def test_export_summary_data_sheet_has_c_mean_sd_in_columns_a_b_c():
    rows = [{"c": 10, "mean": 300, "sd": 25}, {"c": 0, "mean": 50, "sd": 15}]
    ws = load_workbook(io.BytesIO(X.export_bytes(Series(mode="summary", summary=rows))))["Data"]
    assert [c.value for c in ws[1]] == ["c", "mean", "sd", "CV"]
    assert [ws.cell(2, j).value for j in (1, 2, 3)] == [0, 50, 15]  # sorted by c
    assert [ws.cell(3, j).value for j in (1, 2, 3)] == [10, 300, 25]
    assert ws.cell(3, 4).value == '=IFERROR(C3/B3,"")'


# ---------------------------------------------------------------- cli: unreadable file message
def test_cli_missing_file_reports_the_plain_os_reason(capsys, tmp_path):
    code = cli.main(["evaluate", str(tmp_path / "missing.json")])
    err = json.loads(capsys.readouterr().err)
    assert code == 2 and err["ok"] is False
    assert "No such file" in err["error"] and "Errno" not in err["error"]


# ---------------------------------------------------------------- expr: depth counts function arguments
@pytest.mark.parametrize("text, depth", [("c", 1), ("abs(c)", 2), ("max(1, abs(c))", 3), ("-c", 2), ("1 + 2*c", 3)])
def test_ast_depth(text, depth):
    assert E._depth(E.parse(text)) == depth


# ---------------------------------------------------------------- analysis: ladder defaults and sig=1
LIN = dict(meanExpr="100 + 10*c", sdExpr="5", cMax=100)




def test_ladder_rounds_up_at_one_significant_digit():
    m = model(**LIN)  # dsum k=1.5: exact step is 1.5
    assert A.ladder(m, "dsum", 1.5, sig=0)[1] == pytest.approx(1.5)
    assert A.ladder(m, "dsum", 1.5, sig=1)[:3] == [0.0, 2.0, 4.0]


# ---------------------------------------------------------------- metrics: crossing with a zero SD
def test_crossing_with_zero_sd_is_the_midpoint():
    assert K.crossing(0, 0, 10, 2) == 5
    assert K.crossing(0, 2, 10, 0) == 5


# ---------------------------------------------------------------- fit: AICc, start helper, SD power bounds
def test_aicc_formula():
    n, k, rss = 10, 3, 2.0
    assert F._aicc(10, 3, 2.0) == pytest.approx(10 * math.log(0.2) + 6 + 4)
    assert F._aicc(4, 3, 2.0) == math.inf


def test_mid_c_uses_the_mean_of_each_concentration():
    c = np.array([0, 1, 1, 10, 100.0])
    y = np.array([0, 10, 12, 50, 100.0])
    assert F._mid_c(c, y, 0.0, 100.0) == 10.0
    assert F._mid_c(np.array([0.0, 0.0]), np.array([1.0, 2.0]), 0.0, 1.0) == 1.0


S = np.array([50, 100, 200, 500, 1000, 2000, 4000.0])


def test_sd_power_fit_recovers_offset_and_slope_below_one():
    r = F.fit_sd("power", S, 0.5 + 0.02 * S**1.2)
    assert r["ok"]
    assert r["params"]["a"] == pytest.approx(0.5, rel=0.02)
    assert r["params"]["b"] == pytest.approx(0.02, rel=0.02)
    assert r["params"]["p"] == pytest.approx(1.2, rel=0.01)


def test_sd_power_fit_exponent_is_capped_at_3():
    r = F.fit_sd("power", S, 1e-9 * S**4)
    assert r["ok"] and 0.1 <= r["params"]["p"] <= 3.0 + 1e-9
    assert r["params"]["p"] == pytest.approx(3.0, abs=1e-3)


def test_sd_models_other_than_power_have_no_upper_bound():
    r = F.fit_sd("constant", S, np.full_like(S, 5000.0))  # far above the power model's cap of 3
    assert r["params"]["s0"] == pytest.approx(5000.0)


def test_sd_cv_and_floor_fits_recover_values_below_one():
    assert F.fit_sd("cv", S, 0.08 * S)["params"]["cv"] == pytest.approx(0.08, rel=1e-6)
    r = F.fit_sd("floor_cv", S, np.sqrt(0.5**2 + (0.08 * S) ** 2))
    assert r["params"]["s0"] == pytest.approx(0.5, rel=0.05) and r["params"]["cv"] == pytest.approx(0.08, rel=1e-3)


# ---------------------------------------------------------------- api: last-resort numeric handler, export filename
def test_numeric_error_handler_answers_422_with_the_reason():
    import asyncio

    from app import main

    res = asyncio.run(main.numeric_error(None, OverflowError("too big")))
    assert res.status_code == 422
    assert json.loads(res.body) == {"detail": {"error": "cannot compute with these values: too big", "pos": None}}


@pytest.mark.parametrize("name, plain", [("Run 1", "calwizard_Run 1.xlsx"), ("日本語", "calwizard_.xlsx"), ('a"b', "calwizard_a_b.xlsx")])
def test_export_plain_filename_is_ascii_and_quoted_safely(name, plain):
    from fastapi.testclient import TestClient

    from app.main import app

    r = TestClient(app).post("/api/export", json={"series": {"name": name}})
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith(f'attachment; filename="{plain}"; filename*=UTF-8\'\'')


# ---------------------------------------------------------------- second planted-bug sample
@pytest.mark.parametrize("fn", ["sqrt", "exp", "ln", "log", "log10", "abs"])
def test_one_argument_functions_take_exactly_one(fn):
    E.parse(f"{fn}(c)")
    with pytest.raises(E.ExprError, match="wrong number of arguments"):
        E.parse(f"{fn}(c, 2)")


@pytest.mark.parametrize("fn", ["min", "max"])
def test_min_max_take_one_or_more(fn):
    assert float(E.evaluate(E.parse(f"{fn}(c)"), 7.0)) == 7.0
    assert float(E.evaluate(E.parse(f"{fn}(c, 2, 9)"), 7.0)) == (2.0 if fn == "min" else 9.0)


def test_overlap_with_a_zero_sd_is_all_or_nothing():
    assert K.overlap(0, 0, 10, 2) == 0.0 and K.overlap(0, 2, 10, 0) == 0.0
    assert K.overlap(5, 0, 5, 1) == 1.0 and K.overlap(5, 1, 5, 0) == 1.0


def test_mid_c_measures_half_way_from_y0_to_y1():
    c = np.array([0, 1, 1, 10, 100.0])
    y = np.array([0, 10, 12, 50, 100.0])
    assert F._mid_c(c, y, 40.0, 100.0) == 10.0  # half way is 70; the level means are 11, 50, 100


def test_clip_start_nudges_just_inside_finite_bounds():
    assert F._clip_start([-5.0, 99.0, 7.0], [0.0, 0.0, -np.inf], [np.inf, 3.0, np.inf]) == [1e-12, 3.0 - 4e-12, 7.0]
    assert F._clip_start([1.0], [3.0], [np.inf]) == [3.0 + 4e-12]


def test_best_lsq_keeps_the_lowest_finite_cost(monkeypatch):
    class R:
        def __init__(self, cost):
            self.cost = cost

    costs = {1.0: 5.0, 2.0: 1.0, 3.0: 3.0, 4.0: math.nan}
    monkeypatch.setattr(F, "least_squares", lambda resid, x0, **kw: R(costs[x0[0]]))
    assert F._best_lsq(None, [[1.0], [2.0], [3.0], [4.0]], [-np.inf], [np.inf]).cost == 1.0
    assert F._best_lsq(None, [[4.0]], [-np.inf], [np.inf]) is None


def test_sd_power_fit_exponent_is_floored_at_0_1():
    r = F.fit_sd("power", S, 2 * S**0.02)
    assert r["ok"] and r["params"]["p"] >= 0.1 - 1e-12
