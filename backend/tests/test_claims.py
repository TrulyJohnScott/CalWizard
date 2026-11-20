"""Spec sections 14-20: what-if layer, detection limits, separation, requirements, read-back, reader import.

Independent truths only: closed forms on a straight line with constant noise, hand-computed estimates, and one
wiring check per CLI / API surface.
"""
import io
import json
import math
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from scipy.stats import norm

from app import analysis as A
from app import cli
from app import importer as IM
from app import limits as L
from app import readback as RB
from app import requirements as R
from app.export import build_workbook
from app.main import app
from app.series import Sample, Series, bake, compile_series

Z = norm.ppf(0.95)
LINE = {"mode": "equations", "meanExpr": "100 + 20*c", "sdExpr": "10", "levels": [0, 10, 50], "cMax": 100}
FALL = {"mode": "equations", "meanExpr": "1000 - 2*c", "sdExpr": "10", "levels": [0, 100], "cMax": 400}
TABLE = {"mode": "replicates", "replicates": {"concs": [0, 2, 4, 50], "cells": [[1, 2, 3], [5, 6, 7], [9, 11, 10], [100, 104]]}}


def model(**kw):
    return compile_series(Series.model_validate(kw))


# ---------------------------------------------------------------- what-if layer (14)
def test_adjust_maps_bottom_and_top_and_scales_noise():
    m = model(**LINE, adjust={"bottom": 40, "top": 5000, "sdScale": 0.5})
    assert float(m.mean(0)) == pytest.approx(40) and float(m.mean(100)) == pytest.approx(5000)
    assert float(m.mean(50)) == pytest.approx(2520)  # still a straight line between the new ends
    assert float(m.sd(50)) == pytest.approx(5)


def test_adjust_c_scale_stretches_the_concentration_axis():
    base, m = model(**LINE), model(**LINE, adjust={"cScale": 2})
    assert float(m.mean(60)) == pytest.approx(float(base.mean(30)))


def test_adjust_sd_follows_the_new_signal_in_equations_mode():
    m = model(mode="equations", meanExpr="100 + 20*c", sdExpr="0.1*S", cMax=100, adjust={"bottom": 0})
    assert float(m.sd(0)) == pytest.approx(0) and float(m.sd(100)) == pytest.approx(210)


def test_inactive_adjust_changes_nothing():
    assert not model(**LINE, adjust={}).adjusted and not model(**LINE).adjusted


@pytest.mark.parametrize("body", [
    {**LINE, "sdExpr": "sqrt(4 + (0.05*S)^2)"},
    TABLE,
    {"mode": "summary", "summary": [{"c": 0, "mean": 50, "sd": 5}, {"c": 10, "mean": 300, "sd": 20}, {"c": 40, "mean": 900, "sd": 50}]},
])
def test_bake_is_the_same_curve_without_the_layer(body):
    s = Series.model_validate({**body, "adjust": {"bottom": -20, "top": 700, "cScale": 1.5, "sdScale": 0.6}})
    b = bake(s)
    assert b.adjust is None
    m, mb = compile_series(s), compile_series(b)
    cs = np.linspace(0, m.c_max * 1.5, 23)
    assert np.allclose(mb.mean(cs), m.mean(cs), rtol=1e-9) and np.allclose(mb.sd(cs), m.sd(cs), rtol=1e-9)
    assert bake(b) == b


def test_export_folds_the_layer_into_the_workbook():
    s = Series.model_validate({**LINE, "adjust": {"top": 5000}})
    assert "2.45" in build_workbook(s)["Inputs"]["B10"].value  # gain (5000 - 100) / (2100 - 100)


def test_adjust_validation():
    for bad in ({"cScale": 0}, {"sdScale": -1}, {"cScale": math.inf}):
        with pytest.raises(ValueError):
            Series.model_validate({"adjust": bad})


# ---------------------------------------------------------------- limits (15)
def test_limits_closed_form_on_a_line():
    r = L.limits(model(**LINE))
    assert r["direction"] == 1
    assert r["lob"]["signal"] == pytest.approx(100 + Z * 10)
    assert r["lob"]["c"] == pytest.approx(Z * 10 / 20, rel=1e-6)
    assert r["lod"]["c"] == pytest.approx(2 * Z * 10 / 20, rel=1e-6)
    assert r["loq"]["c"] == pytest.approx(10 / (20 * 0.2), rel=1e-6)  # cv(c) = sd / (slope c)
    assert r["loq"]["cv"] == pytest.approx(0.2, rel=1e-6)
    assert r["uloq"]["c"] == 100
    assert len(r["profile"]["c"]) == 201 and r["profile"]["cv"][100] == pytest.approx(10 / (20 * 50))


def test_limits_reads_and_rates():
    m = model(**LINE)
    assert L.limits(m, reads=4)["lod"]["c"] == pytest.approx(Z * 10 / 20, rel=1e-6)  # sd / 2
    r = L.limits(m, alpha=0.01, beta=0.1, cv=0.1)
    assert r["lod"]["c"] == pytest.approx((norm.ppf(0.99) + norm.ppf(0.9)) * 10 / 20, rel=1e-6)
    assert r["loq"]["c"] == pytest.approx(5, rel=1e-6)


def test_limits_on_a_falling_curve():
    r = L.limits(model(**FALL))
    assert r["direction"] == -1
    assert r["lob"]["signal"] == pytest.approx(1000 - Z * 10)
    assert r["lod"]["c"] == pytest.approx(2 * Z * 10 / 2, rel=1e-6)


def test_limits_none_when_nothing_is_detectable_or_quantifiable():
    r = L.limits(model(mode="equations", meanExpr="100 + 0.001*c", sdExpr="10", cMax=100))
    assert r["lod"] is None and r["loq"] is None and r["uloq"] is None
    r = L.limits(model(**LINE), cv=0.001)
    assert r["lod"] is not None and r["loq"] is None


@pytest.mark.parametrize("kw", [{"alpha": 0}, {"beta": 0.5}, {"cv": 0}, {"reads": 0}, {"reads": 1.5}])
def test_limits_validation(kw):
    with pytest.raises(ValueError):
        L.limits(model(**LINE), **kw)


def test_limits_from_replicates_by_hand():
    m = model(**TABLE)
    r = L.limits_data(m)
    lob = 2 + Z / (1 - 1 / (4 * 2)) * 1.0  # blank mean 2, sd 1, n 3
    assert r["blank"] == {"n": 3, "mean": 2.0, "sd": 1.0}
    assert r["lob"]["signal"] == pytest.approx(lob)
    assert r["lob"]["signalNonparametric"] == pytest.approx(3.0)  # rank 0.5 + 3 * 0.95 -> the top reading
    assert [x["c"] for x in r["low"]] == [2, 4] and r["sdLow"] == pytest.approx(1.0) and r["df"] == 4
    assert r["lod"]["signal"] == pytest.approx(lob + Z / (1 - 1 / 16) * 1.0)
    assert r["lod"]["c"] == pytest.approx(m.inverse([r["lod"]["signal"]])[0])
    assert L.limits_data(m, low_concs=[4])["low"][0]["c"] == 4


def test_limits_from_replicates_needs_blank_and_low_columns():
    assert L.limits_data(model(**LINE)) is None
    assert L.limits_data(model(mode="replicates", replicates={"concs": [0, 5], "cells": [[1], [5, 6]]})) is None
    assert L.limits_data(model(mode="replicates", replicates={"concs": [0, 5], "cells": [[1, 2], [5]]})) is None
    assert L.limits_data(model(**TABLE), low_concs=[3]) is None
    assert L.limits_data(model(**TABLE, adjust={"sdScale": 2})) is None


def test_rank_percentile_interpolates_between_ranks():
    assert L._rank_percentile([4, 1, 3, 2], 0.5) == pytest.approx(2.5)
    assert L._rank_percentile([1, 2], 0.0) == 1 and L._rank_percentile([1, 2], 1.0) == 2


def test_plan_centres_on_the_truth_and_is_reproducible():
    m = model(**LINE)
    p = L.plan(m, n_blank=30, n_low=30, runs=300, seed=4)
    lod = 2 * Z * 10 / 20
    assert p["design"]["strips"] == 120 and [r["c"] for r in p["design"]["rows"]] == [0, 1.64, 3.29, 2.5]
    q = p["loq"]  # a sample at the LoQ (cv = sd / (slope c) = 20% at c = 2.5): its measured CV scatters around the truth
    assert q["c"] == 2.5 and q["cvTruth"] == pytest.approx(0.2) and q["cv"]["lo"] < 0.2 < q["cv"]["hi"]
    assert q["cv"]["med"] == pytest.approx(0.2, rel=0.05) and 0.3 < q["pPass"] < 0.7
    assert p["truth"]["lod"] == pytest.approx(lod, rel=1e-6)
    assert p["lod"]["lo"] < lod < p["lod"]["hi"] and p["lod"]["med"] == pytest.approx(lod, rel=0.1)
    assert p["detect"][0]["truth"] == pytest.approx(0.95, abs=0.01) and p["detect"][0]["mean"] == pytest.approx(0.95, abs=0.03)
    assert p == L.plan(m, n_blank=30, n_low=30, runs=300, seed=4)
    wide = L.plan(m, n_blank=4, n_low=4, runs=300, seed=4)["lod"]
    assert wide["hi"] - wide["lo"] > p["lod"]["hi"] - p["lod"]["lo"]  # fewer strips, shakier estimate


def test_plan_validation():
    m = model(**LINE)
    for kw in ({"n_blank": 1}, {"runs": 0}, {"conf": 1}, {"low_concs": [0]}, {"low_concs": []}):
        with pytest.raises(ValueError):
            L.plan(m, **kw)
    with pytest.raises(ValueError, match="no detection limit"):
        L.plan(model(mode="equations", meanExpr="100 + 0.001*c", sdExpr="10", cMax=100))


# ---------------------------------------------------------------- separation (16)
def test_separate_equal_spreads_closed_form():
    r = A.separate(model(**LINE), 1, 2, "ssmd", 3, n=3, runs=50)
    d, s = 20.0, 10.0
    assert r["threshold"] == pytest.approx(130)
    assert r["sensitivity"] == pytest.approx(norm.cdf(d / (2 * s))) and r["specificity"] == pytest.approx(norm.cdf(d / (2 * s)))
    assert r["auc"] == pytest.approx(norm.cdf(d / (s * math.sqrt(2))))
    assert r["dprime"] == pytest.approx(2.0) and r["fold"] == 2 and r["cv1"] == pytest.approx(10 / 120)
    assert r["nNeeded"] == math.ceil((3 / (d / (s * math.sqrt(2)))) ** 2) == 5
    assert not r["pass"] and r["power"]["n"] == 3 and 0 <= r["power"]["pSig"] <= 1
    assert r["readback"][0]["c"] == pytest.approx(1) and r["readback"][1]["c"] == pytest.approx(2)


def test_separate_resolved_pair_needs_one_reading_and_blank_has_no_fold():
    r = A.separate(model(**LINE), 0, 50, "ssmd", 3, runs=20)
    assert r["pass"] and r["nNeeded"] == 1 and r["fold"] is None and r["power"]["pSig"] == 1


def test_separate_rejects_equal_or_bad_concentrations():
    for a, b in ((5, 5), (-1, 2), (math.nan, 1)):
        with pytest.raises(ValueError):
            A.separate(model(**LINE), a, b)


# ---------------------------------------------------------------- requirements (17)
def test_requirements_on_a_line():
    lod = 2 * Z * 10 / 20
    reqs = [{"kind": "detect", "c": 2}, {"kind": "detect", "c": 1}, {"kind": "distinguish", "c": 0, "c2": 50},
            {"kind": "distinguish", "c": 1, "c2": 2}, {"kind": "precision", "c": 5, "cv": 0.2},
            {"kind": "precision", "c": 1, "cv": 0.2}, {"kind": "range", "c": 3, "c2": 100},
            {"kind": "range", "c": 1, "c2": 100, "cv": 0.1}, {"kind": "levels", "n": 2}, {"kind": "levels", "n": 500}]
    out = R.check(model(**LINE, requirements=reqs))
    res = out["results"]
    assert [r["ok"] for r in res] == [True, False, True, False, True, False, True, False, True, False]
    assert out["met"] == 5 and out["total"] == 10
    assert res[0]["value"] == pytest.approx(lod, rel=1e-6) and res[0]["sdScale"] == 1
    assert res[1]["sdScale"] == pytest.approx(1 / lod, rel=1e-4)  # LoD is proportional to the noise
    assert res[3]["sdScale"] == pytest.approx((20 / (10 * math.sqrt(2))) / 3, rel=1e-6)
    assert res[4]["value"] == pytest.approx(0.1) and res[5]["sdScale"] == pytest.approx(0.4, rel=1e-6)
    assert res[7]["value"] == pytest.approx(5, rel=1e-6)  # LoQ at 10% CV
    assert res[9]["sdScale"] is None  # 500 levels: not even at 1% of the noise


def test_requirements_report_invalid_rows_instead_of_failing():
    out = R.check(model(**LINE, requirements=[{"kind": "detect"}, {"kind": "distinguish", "c": 1, "c2": 1},
                                             {"kind": "precision", "c": 1}, {"kind": "range", "c": 5, "c2": 2},
                                             {"kind": "levels"}]))
    assert all(r["error"] and not r["ok"] for r in out["results"])


# ---------------------------------------------------------------- read-back (18)
def test_readback_values_dilution_and_flags():
    m = model(**LINE)
    samples = [Sample(id="a", signal=300, dilution=2), Sample(id="b", signal=110), Sample(id="c", signal=140),
               Sample(id="d", signal=50), Sample(id="e", signal=9000), Sample(id="f", signal=None),
               Sample(id="g", signal=300, dilution=0)]
    out = RB.readback(m, samples)
    rows = {r["id"]: r for r in out["rows"]}
    assert rows["a"]["c"] == pytest.approx(10) and rows["a"]["result"] == pytest.approx(20) and rows["a"]["flag"] == "ok"
    assert rows["a"]["lo"] == pytest.approx(10 - 1.96 * 10 / 20, rel=1e-3) and rows["a"]["resultHi"] == pytest.approx(2 * (10 + 0.98), rel=1e-3)
    assert rows["a"]["cv"] == pytest.approx(0.05)
    assert [rows[k]["flag"] for k in "bcdef"] == ["belowLod", "belowLoq", "below", "above", "invalid"]
    assert rows["g"]["dilution"] == 1
    assert out["lod"] == pytest.approx(2 * Z * 10 / 20, rel=1e-6) and out["uloq"] == 100
    top = RB.readback(model(mode="equations", meanExpr="1000*c/(c+10)", sdExpr="20", cMax=1000), [Sample(signal=985)])
    assert top["rows"][0]["flag"] == "aboveLoq"


def test_readback_uses_the_series_samples_and_writes_a_workbook():
    m = model(**LINE, name="Run 7", samples=[{"id": "x", "signal": 300}, {"signal": None}])
    assert [r["flag"] for r in RB.readback(m)["rows"]] == ["ok", "invalid"]
    wb = load_workbook(io.BytesIO(RB.workbook_bytes(m)))
    ws = wb["Results"]
    assert ws["A2"].value == "x" and ws["D2"].value == pytest.approx(10) and ws["D1"].value == "Concentration (ng/mL)"
    assert ws["J2"].value == pytest.approx(5) and ws["K3"].value == "no signal"
    assert wb["About"]["B1"].value == "Run 7"


# ---------------------------------------------------------------- reader import (19)
READER = ("Instrument: RDS-2500\nDate,2026-11-01\nSample,Conc (ng/mL),T,C,T/C\nS1,blank,48,900,0.053\n"
          "S2,blank,52,910,0.057\nS3,5,95,905,0.105\nS4,5,101,899,0.112\nS5,25 ng/mL,400,890,0.449\n")


def test_import_long_reader_export_prefers_the_ratio_and_reads_units():
    r = IM.parse_reader(READER)
    assert r["concs"] == [0, 5, 25] and r["cells"] == [[0.053, 0.057], [0.105, 0.112], [0.449]]
    assert r["units"] == "ng/mL" and r["signalLabel"] == "T/C" and r["header"] == 2 and r["rows"] == 5
    assert [c["role"] for c in r["columns"]] == ["other", "conc", "candidate", "candidate", "signal"]


def test_import_chosen_columns_by_name_or_index():
    assert IM.parse_reader(READER, signal="t")["cells"][0] == [48, 52]
    assert IM.parse_reader(READER, conc=1, signal=3)["cells"][1] == [905, 899]
    assert IM.parse_reader(READER, signal="nope") is None and IM.parse_reader(READER, conc="nope") is None
    assert IM.parse_reader(READER, conc=1, signal=1) is None


def test_import_wide_replicate_columns_and_semicolon_decimal_commas():
    r = IM.parse_reader("Conc\tRep 1\tRep 2\tRep 3\n0\t48\t52\t47\n5\t90\t101\t95\n25\t400\t\t410\n")
    assert r["signalCols"] == [1, 2, 3] and r["cells"] == [[48, 52, 47], [90, 101, 95], [400, 410]] and r["signalLabel"] is None
    r = IM.parse_reader('Well;"Dose [pg/mL]";Peak area\nA1;0;12,5\nA2;0;13,1\nB1;10;40,2\n')
    assert r["units"] == "pg/mL" and r["cells"] == [[12.5, 13.1], [40.2]]


def test_import_adds_an_empty_blank_column_and_drops_negative_concentrations():
    r = IM.parse_reader("strip,level,intensity\n1,2,55\n2,2,58\n3,8,120\n4,-1,5\n")
    assert r["concs"] == [0, 2, 8] and r["cells"] == [[], [55, 58], [120]]


@pytest.mark.parametrize("text", ["0\t1\t5\n48\t55\t90\n", "just some text\nwith, a comma\n", "", "Sample,Note\na,b\nc,d\n",
                                  "Sample,Conc\na,1\nb,2\n"])
def test_import_returns_none_for_other_text(text):
    assert IM.parse_reader(text) is None


def test_import_to_series_round_trips_through_the_schema():
    s = Series.model_validate(IM.to_series(IM.parse_reader(READER), {"name": "lot 3"}))
    assert (s.mode, s.units, s.signal_label, s.name) == ("replicates", "ng/mL", "T/C", "lot 3")
    assert float(compile_series(s).mean(5)) == pytest.approx(0.1085)


# ---------------------------------------------------------------- CLI and API wiring
def run(capsys, *argv):
    code = cli.main([str(a) for a in argv])
    out, err = capsys.readouterr()
    return code, (json.loads(out) if out.strip() else None), (json.loads(err) if err.strip() else None)


@pytest.fixture
def line(tmp_path):
    p = tmp_path / "line.json"
    p.write_text(json.dumps({**LINE, "requirements": [{"kind": "detect", "c": 2}], "samples": [{"id": "a", "signal": 300}],
                             "adjust": {"sdScale": 1}}), encoding="utf-8")
    return p


def test_cli_limits_plan_separate(capsys, line):
    lod = 2 * Z * 10 / 20
    code, out, _ = run(capsys, "limits", line, "--no-profile")
    assert code == 0 and out["lod"]["c"] == pytest.approx(lod, rel=1e-6) and "profile" not in out and out["data"] is None
    _, out, _ = run(capsys, "limits", line, "--alpha", "0.01", "--beta", "0.1", "--cv", "0.1", "--reads", "1")
    assert out["loq"]["c"] == pytest.approx(5, rel=1e-6) and len(out["profile"]["cv"]) == 201
    code, _, err = run(capsys, "limits", line, "--cv", "0")
    assert code == 2 and "cv" in err["error"]
    code, out, _ = run(capsys, "plan", line, "--n-blank", "5", "--n-low", "5", "--low", "2", "4", "--runs", "10")
    assert code == 0 and out["design"]["strips"] == 20 and out["runs"] == 10 and out["loq"]["n"] == 5
    code, _, err = run(capsys, "plan", line, "--runs", "0")
    assert code == 2
    code, out, _ = run(capsys, "separate", line, "1", "2", "--runs", "10", "--metric", "dsum", "--k", "1")
    assert code == 0 and out["dsum"] == pytest.approx(1) and out["pass"]
    code, _, err = run(capsys, "separate", line, "1", "1")
    assert code == 2 and "different" in err["error"]


def test_cli_requirements_read_bake_report(capsys, line, tmp_path):
    code, out, _ = run(capsys, "requirements", line)
    assert code == 0 and (out["met"], out["total"]) == (1, 1)
    _, out, _ = run(capsys, "read", line)
    assert out["rows"][0]["id"] == "a" and out["rows"][0]["c"] == pytest.approx(10)
    _, out, _ = run(capsys, "read", line, "500", "--conf", "0.9")
    assert out["rows"][0]["c"] == pytest.approx(20) and out["conf"] == 0.9
    code, _, err = run(capsys, "read", line, "500", "--conf", "2")
    assert code == 2
    xlsx = tmp_path / "r.xlsx"
    code, out, _ = run(capsys, "read", line, "-o", xlsx)
    assert code == 0 and load_workbook(xlsx)["Results"]["A2"].value == "a"
    code, _, err = run(capsys, "read", line, "-o", tmp_path / "no" / "r.xlsx")
    assert code == 2 and "cannot write" in err["error"]
    _, out, _ = run(capsys, "bake", line)
    assert out["adjust"] is None and out["meanExpr"] == LINE["meanExpr"]
    _, out, _ = run(capsys, "report", line)
    assert out["requirements"]["met"] == 1 and out["limits"]["lod"]["c"] > 0 and out["readback"]["rows"][0]["flag"] == "ok"
    assert out["resolvable"]["n"] == len(out["resolvable"]["levels"]) and out["limitsData"] is None


def test_cli_import(capsys, tmp_path, monkeypatch):
    f = tmp_path / "lot 3.csv"
    f.write_text(READER, encoding="utf-8")
    code, out, _ = run(capsys, "import", f)
    assert code == 0 and out["series"]["name"] == "lot 3" and out["series"]["replicates"]["concs"] == [0, 5, 25]
    assert out["signalCols"] == [4]
    _, out, _ = run(capsys, "import", f, "--signal", "2", "--conc", "Conc (ng/mL)", "--name", "x")
    assert out["series"]["signalLabel"] == "T" and out["series"]["name"] == "x"
    monkeypatch.setattr(sys, "stdin", io.StringIO(READER))
    assert run(capsys, "import", "-")[1]["series"]["name"] == "Imported"
    code, _, err = run(capsys, "import", f, "--signal", "nope")
    assert code == 2 and "not a reader table" in err["error"]
    assert run(capsys, "import", tmp_path / "missing.csv")[0] == 2


def test_api_surfaces():
    c = TestClient(app)
    series = {**LINE, "requirements": [{"kind": "detect", "c": 2}], "samples": [{"id": "a", "signal": 300}]}
    lod = 2 * Z * 10 / 20
    r = c.post("/api/limits", json={"series": series, "profile": False}).json()
    assert r["lod"]["c"] == pytest.approx(lod, rel=1e-6) and r["data"] is None and "profile" not in r
    assert c.post("/api/limits", json={"series": series, "cv": 0}).status_code == 422
    assert c.post("/api/limits", json={"series": TABLE}).json()["data"]["blank"]["n"] == 3
    assert c.post("/api/plan", json={"series": series, "nBlank": 5, "nLow": 5, "runs": 10, "cv": 0.001}).json()["design"]["strips"] == 15
    assert c.post("/api/plan", json={"series": series, "runs": 0}).status_code == 422
    assert c.post("/api/separate", json={"series": series, "c1": 0, "c2": 50, "runs": 10}).json()["pass"] is True
    assert c.post("/api/separate", json={"series": series, "c1": 1, "c2": 1}).status_code == 422
    assert c.post("/api/requirements", json={"series": series}).json()["met"] == 1
    assert c.post("/api/readback", json={"series": series}).json()["rows"][0]["c"] == pytest.approx(10)
    assert c.post("/api/readback", json={"series": series, "samples": [{"signal": 500}], "conf": 2}).status_code == 422
    x = c.post("/api/readback/export", json={"series": {**series, "name": "Run 7"}})
    assert x.status_code == 200 and "calwizard_results_Run 7.xlsx" in x.headers["content-disposition"]
    assert load_workbook(io.BytesIO(x.content))["Results"]["A2"].value == "a"
    assert c.post("/api/readback/export", json={"series": series, "conf": 2}).status_code == 422
    assert c.post("/api/import", json={"text": READER}).json()["concs"] == [0, 5, 25]
    assert c.post("/api/import", json={"text": "nothing"}).json()["ok"] is False
    assert c.post("/api/bake", json={"series": {**LINE, "adjust": {"top": 5000}}}).json()["adjust"] is None
    assert c.post("/api/report", json={"series": series}).json()["requirements"]["total"] == 1
