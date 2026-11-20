import io
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app import expr as E
from app import fit as F
from app.main import app
from app.series import Series, compile_series

client = TestClient(app)

LEVELS = [0, 2, 5, 10, 25, 60, 150, 400, 1000]
MEAN4 = "4000 + (50 - 4000)/(1 + (c/80)^1.2)"
SD_FLOOR = "sqrt(15^2 + (0.08*S)^2)"


def simulate_points(mean_expr=MEAN4, sd_expr=SD_FLOOR, n=8, seed=3, levels=LEVELS):
    m = compile_series(Series(meanExpr=mean_expr, sdExpr=sd_expr, levels=levels, cMax=max(levels)))
    rng = np.random.default_rng(seed)
    pts = []
    for c in levels:
        mu, sd = float(m.mean(c)), float(m.sd(c))
        pts += [{"c": c, "y": float(y)} for y in rng.normal(mu, sd, n)]
    return m, pts


def curve(expr, var, x):
    return E.evaluate(E.parse(expr, var), x)


# ---------------------------------------------------------------- fit
def test_fit_4pl_round_trips_through_expr():
    truth, pts = simulate_points()
    res = F.run_fit({"points": pts})
    fit4 = next(f for f in res["meanFits"] if f["kind"] == "4pl")
    assert fit4["ok"] and fit4["r2"] > 0.95
    c = np.array([1, 10, 100, 500.0])
    # the emitted expression (4 significant digits) reproduces the fitted curve
    p = fit4["params"]
    from app.fit import _logistic
    np.testing.assert_allclose(curve(fit4["expr"], "c", c), _logistic(c, p["a"], p["d"], p["C"], p["B"]), rtol=2e-3)
    # and recovers the generating curve
    np.testing.assert_allclose(curve(fit4["expr"], "c", c), truth.mean(c), rtol=0.1)
    best = res["meanFits"][0]
    assert best["kind"] in ("4pl", "5pl") and best["ok"]


def test_every_fit_expr_parses_and_matches_its_params():
    truth, pts = simulate_points()
    res = F.run_fit({"points": pts})
    c = np.linspace(0, 1000, 50)
    for f in res["meanFits"]:
        assert f["ok"], f["kind"]
        m = F.MEAN_MODELS[f["kind"]]
        pred = m["f"](c, *f["params"].values())
        np.testing.assert_allclose(curve(f["expr"], "c", c), pred, rtol=5e-3, atol=2e-3 * np.ptp(pred))
    kinds = {f["kind"] for f in res["meanFits"]}
    assert kinds == {"linear", "quadratic", "power", "exponential", "log", "4pl", "5pl"}
    aiccs = [f["aicc"] for f in res["meanFits"] if f["aicc"] is not None]
    assert aiccs == sorted(aiccs)


def test_fit_sd_floor_cv_round_trip():
    truth, pts = simulate_points(n=40, seed=11)
    res = F.run_fit({"points": pts})
    sd = next(f for f in res["sdFits"] if f["kind"] == "floor_cv")
    assert sd["ok"] and sd["expr"].startswith("sqrt(")
    s = np.array([100, 1000, 3000.0])
    p = sd["params"]
    np.testing.assert_allclose(curve(sd["expr"], "S", s), np.sqrt(p["s0"] ** 2 + (p["cv"] * s) ** 2), rtol=2e-3)
    np.testing.assert_allclose(curve(sd["expr"], "S", s), np.sqrt(15**2 + (0.08 * s) ** 2), rtol=0.25)
    assert res["sdFits"][0]["kind"] in ("floor_cv", "power")
    assert {f["kind"] for f in res["sdFits"]} == {"floor_cv", "constant", "cv", "power"}


def test_fit_accepts_summary_rows():
    truth, _ = simulate_points()
    lv = np.array(LEVELS, float)
    rows = [{"c": float(c), "mean": float(m), "sd": float(s)} for c, m, s in zip(lv, truth.mean(lv), truth.sd(lv))]
    res = F.run_fit({"summary": rows})
    assert len(res["levels"]) == len(LEVELS) and res["levels"][0]["n"] == 1
    fit4 = next(f for f in res["meanFits"] if f["kind"] in ("4pl", "5pl"))
    assert fit4["ok"]
    np.testing.assert_allclose(curve(res["meanFits"][0]["expr"], "c", lv), truth.mean(lv), rtol=0.02, atol=5)
    sd = next(f for f in res["sdFits"] if f["kind"] == "floor_cv")
    np.testing.assert_allclose(curve(sd["expr"], "S", truth.mean(lv)), truth.sd(lv), rtol=0.05)


def test_fit_expr_sign_formatting():
    assert F.MEAN_MODELS["linear"]["expr"]([-5.0, -0.5]) == "-5 - 0.5*c"
    assert F.MEAN_MODELS["quadratic"]["expr"]([1.0, 2.0, -0.003]) == "1 + 2*c - 0.003*c^2"


@pytest.mark.parametrize("body", [
    {}, [], None, {"points": []}, {"points": [{"c": 1, "y": 2}]}, {"points": [{"c": "x", "y": None}]},
    {"points": [{"c": 0, "y": 1}, {"c": 0, "y": 1}]},
    {"points": [{"c": 0, "y": 1}, {"c": 1, "y": 1}, {"c": 2, "y": 1}]},
    {"summary": [{"c": 0, "mean": 1}, {"c": 1, "mean": 2}]},
    {"summary": [{"c": 0, "mean": 1, "sd": 0}, {"c": 1, "mean": 2, "sd": 0}, {"c": 5, "mean": 9, "sd": 0}]},
    {"points": "garbage"},
])
def test_fit_never_errors_on_bad_data(body):
    r = client.post("/api/fit", json=body)
    assert r.status_code == 200
    assert set(r.json()) == {"levels", "meanFits", "sdFits"}


def test_fit_garbage_body():
    assert client.post("/api/fit", content=b"not json").status_code == 200


# ---------------------------------------------------------------- API
def test_health_and_cors():
    assert client.get("/api/health").json() == {"ok": True}
    r = client.options("/api/health", headers={"Origin": "http://localhost:5173",
                                               "Access-Control-Request-Method": "GET"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_parse_endpoint():
    r = client.post("/api/parse", json={"expr": "4000 + (50 - 4000)/(1 + (c/40)^1.2)", "variable": "c"}).json()
    assert r["ok"] and r["excel"].startswith("(4000+") and "A1" in r["excel"]
    r = client.post("/api/parse", json={"expr": "sqrt(15^2 + (0.08*S)^2)", "variable": "S"}).json()
    assert r["ok"]
    r = client.post("/api/parse", json={"expr": "1 + x", "variable": "c"}).json()
    assert r == {"ok": False, "error": "unknown identifier 'x'", "pos": 4}
    assert not client.post("/api/parse", json={"expr": "S", "variable": "c"}).json()["ok"]


def test_evaluate_endpoint():
    series = Series().model_dump(by_alias=True)
    r = client.post("/api/evaluate", json={"series": series, "grid": [0, 40, 500]})
    assert r.status_code == 200
    d = r.json()
    assert d["levels"] == [0, 1, 5, 25, 100, 500]
    assert d["mean"][0] == pytest.approx(50) and d["mean"][1] == pytest.approx(2025)
    assert d["sd"][0] == pytest.approx(math.sqrt(15**2 + (0.08 * 50) ** 2))
    assert len(d["rows"]) == 5 and "pass" in d["rows"][0]
    assert len(client.post("/api/evaluate", json={"series": series}).json()["grid"]) == 501


def test_evaluate_nan_becomes_null_and_bad_expr_is_422():
    s = Series(meanExpr="sqrt(c - 10)", sdExpr="1").model_dump(by_alias=True)
    d = client.post("/api/evaluate", json={"series": s, "grid": [0, 20]}).json()
    assert d["mean"][0] is None and d["mean"][1] == pytest.approx(math.sqrt(10))
    bad = Series(meanExpr="1 +").model_dump(by_alias=True)
    r = client.post("/api/evaluate", json={"series": bad})
    assert r.status_code == 422 and r.json()["detail"]["pos"] == 3


def test_evaluate_camel_case_input():
    body = {"series": {"mode": "summary", "summary": [{"c": 0, "mean": 5, "sd": 1}, {"c": 10, "mean": 50, "sd": 2}],
                       "kTarget": 2, "metric": "dsum"}, "grid": [0, 5, 10]}
    d = client.post("/api/evaluate", json=body).json()
    assert d["mean"][0] == 5 and d["mean"][2] == 50 and d["levels"] == [0, 10]


def test_export_endpoint_headers():
    r = client.post("/api/export", json={"series": Series(name="My Assay").model_dump(by_alias=True)})
    assert r.status_code == 200
    assert "calwizard_My Assay.xlsx" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Inputs", "Calculator", "Grid", "Levels", "Data"]
    assert len(wb["Grid"]._charts) == 1
    assert wb["Grid"].max_row == 502


# ---------------------------------------------------------------- Excel recalculation
try:
    import formulas
except ImportError:  # recalculation tests are skipped without the dev dependency
    formulas = None
needs_formulas = pytest.mark.skipif(formulas is None, reason="formulas package not installed")


def recalc(series: Series, tmp_path, **inputs):
    """Export, set Calculator inputs, recalculate with `formulas`; return {sheet: {cell: value}}."""
    from app.export import build_workbook
    wb = build_workbook(series)
    for cell, v in inputs.items():
        wb["Calculator"][cell] = v
    path = tmp_path / "t.xlsx"
    wb.save(path)
    sol = formulas.ExcelModel().loads(str(path)).finish().calculate()
    out: dict[str, dict] = {}
    for key, v in sol.items():
        sheet, _, cell = key.partition("]")[2].partition("!")
        if ":" in cell or not hasattr(v, "value"):
            continue
        out.setdefault(sheet.strip("'").upper(), {})[cell.replace("$", "")] = v.value[0, 0]
    return out


def check_workbook(series: Series, tmp_path, c_in, tol):
    model = compile_series(series)
    s_in = float(model.mean(c_in * 0.8))
    x = recalc(series, tmp_path, B1=c_in, B5=s_in)
    calc = x["CALCULATOR"]
    assert float(calc["B2"]) == pytest.approx(float(model.mean(c_in)), rel=tol)
    assert float(calc["B3"]) == pytest.approx(float(model.sd(c_in)), rel=tol)
    assert float(calc["B6"]) == pytest.approx(c_in * 0.8, rel=2e-3)
    assert calc["B6"] != "out of range"
    # out of range reverse lookup
    far = recalc(series, tmp_path, B1=c_in, B5=1e9)
    assert far["CALCULATOR"]["B6"] == "out of range"
    # Levels sheet vs Python rows
    from app.metrics import level_rows
    lv = x["LEVELS"]
    for i, row in enumerate(level_rows(model)):
        r = i + 2
        for col, key in zip("GHIJ", ("dmu", "dsum", "ssmd", "zprime")):
            assert float(lv[f"{col}{r}"]) == pytest.approx(row[key], rel=1e-6, abs=1e-9)
        assert float(lv[f"L{r}"]) == pytest.approx(row["err"], rel=1e-5, abs=1e-9)
        assert float(lv[f"K{r}"]) == pytest.approx(row["ovl"], rel=1e-9)
        assert bool(lv[f"M{r}"]) == row["pass"]
    return x


@pytest.mark.deep
@needs_formulas
def test_export_recalculation_equations_mode(tmp_path):
    series = Series(meanExpr="4000 + (50 - 4000)/(1 + (c/40)^1.2)",
                    sdExpr="sqrt(15^2 + (0.08*S)^2) + 0*log(S)", levels=[0, 1, 5, 25, 100, 500])
    x = check_workbook(series, tmp_path, 30.0, 1e-9)
    # Grid is live: last point is cMax, formulas reproduce the model there
    m = compile_series(series)
    assert float(x["GRID"]["A502"]) == pytest.approx(500)
    assert float(x["GRID"]["B502"]) == pytest.approx(float(m.mean(500)))
    assert float(x["GRID"]["C252"]) == pytest.approx(float(m.sd(250)))


@pytest.mark.deep
@needs_formulas
def test_export_recalculation_falling_curve(tmp_path):
    series = Series(meanExpr="3000/(1 + c/50) + 100", sdExpr="0.05*S + 10", levels=[0, 10, 50, 200, 800], cMax=800)
    check_workbook(series, tmp_path, 40.0, 1e-9)


@pytest.mark.deep
@needs_formulas
def test_export_recalculation_summary_mode(tmp_path):
    summary = [{"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 300, "sd": 25}, {"c": 25, "mean": 1500, "sd": 80},
               {"c": 100, "mean": 3000, "sd": 150}, {"c": 500, "mean": 3900, "sd": 200}]
    series = Series(mode="summary", summary=summary)
    check_workbook(series, tmp_path, 60.0, 2e-3)


@needs_formulas
def test_export_replicates_mode_data_sheet(tmp_path):
    series = Series(mode="replicates", replicates={
        "concs": [0, 5, 50], "cells": [[48.0, 52.0, 50.0], [200.0, 210.0, None], [900.0]]})
    x = recalc(series, tmp_path)
    d = x["DATA"]
    r0 = 3 + 4  # depth(3) + 4 -> header row; level rows follow
    assert float(d[f"B{r0 + 1}"]) == pytest.approx(50)
    assert float(d[f"C{r0 + 1}"]) == pytest.approx(2.0)
    assert float(d[f"D{r0 + 2}"]) == 2
    assert float(d[f"B{r0 + 3}"]) == 900 and d[f"C{r0 + 3}"] == ""
    check_workbook(series, tmp_path, 20.0, 5e-3)
