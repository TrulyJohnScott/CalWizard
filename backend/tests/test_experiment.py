"""Spec section 13: simulated experiments."""
from __future__ import annotations

import io
import json
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import experiment as EX
from app import metrics as K
from app.cli import main as cli_main
from app.main import app
from app.series import Series, compile_series

client = TestClient(app)

SEED42 = [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]  # node, exact TS function body


def model(**kw):
    return compile_series(Series.model_validate(kw))


EQ = dict(mode="equations", meanExpr="50 + 10*c", sdExpr="20", levels=[0, 10, 50], cMax=50)


def test_mulberry_known_values():
    r = EX.Mulberry32(42)
    assert [r.next() for _ in range(3)] == SEED42
    r = EX.Mulberry32(4294967295)
    assert [r.next(), r.next()] == [0.8964226141106337, 0.189478256739676]
    assert EX.Mulberry32(-1).a == 0xFFFFFFFF


def test_vectorised_stream_matches_scalar():
    r = EX.Mulberry32(12345)
    ref = [r.next() for _ in range(50)]
    assert np.array_equal(EX.mulberry32_array(12345, 50), ref)
    assert np.array_equal(EX.mulberry32_array(12345, 10, 40), ref[40:])


def test_normal_formula_and_floor():
    r = EX.Mulberry32(42)
    z = EX.normal(r)
    assert z == pytest.approx(-0.956162229384149, abs=1e-12)
    assert EX.normal(r) == pytest.approx(-0.2730261048826104 * 0 + EX.normals_array(42, 2)[1], abs=1e-12)
    assert EX.normals_array(42, 2)[:2] == pytest.approx([-0.956162229384149, -0.2730261048826104], abs=1e-12)

    class Zero:
        def __init__(self):
            self.v = iter([0.0, 0.25])

        def next(self):
            return next(self.v)

    assert EX.normal(Zero()) == pytest.approx(math.sqrt(-2 * math.log(1e-300)) * math.cos(math.pi / 2))


def test_run0_matches_manual_loop():
    m = model(**EQ)
    res = EX.simulate(m, n=[2, 3, 4], runs=3, seed=9)
    rng = EX.Mulberry32(9)
    for lvl, c, n in zip(res["first"]["levels"], [0, 10, 50], [2, 3, 4]):
        ys = [float(m.mean(c)) + float(m.sd(c)) * EX.normal(rng) for _ in range(n)]
        assert lvl["ys"] == pytest.approx(ys, rel=1e-12)
        assert lvl["mean"] == pytest.approx(np.mean(ys))
        assert lvl["sd"] == pytest.approx(np.std(ys, ddof=1))
    # run 1 continues the same stream
    res1 = EX.simulate(m, n=[2, 3, 4], runs=2, seed=9)
    assert res1["first"] == res["first"]


def test_chunking_does_not_change_results(monkeypatch):
    m = model(**EQ)
    a = EX.simulate(m, n=5, runs=40, seed=3)
    monkeypatch.setattr(EX, "_CHUNK", 30)
    assert EX.simulate(m, n=5, runs=40, seed=3) == a


def test_statistics():
    m = model(**EQ)
    res = EX.simulate(m, n=10, runs=2000, seed=5)
    for lv, c in zip(res["levels"], [0, 10, 50]):
        assert lv["mean"]["med"] == pytest.approx(float(m.mean(c)), abs=2)
        assert lv["sd"]["med"] == pytest.approx(20, rel=0.1)
        assert lv["mean"]["lo"] < lv["mean"]["med"] < lv["mean"]["hi"]
    # pair 0-10: truth ssmd = 100/(20*sqrt2) = 3.54 -> passes at k=3 about 2/3 of the time with n=10 (loose)
    p0 = res["pairs"][0]
    assert p0["truth"] == pytest.approx(100 / (20 * math.sqrt(2)))
    assert 0.3 < p0["pPass"] < 1.0
    assert res["pairs"][1]["pPass"] > 0.99  # 400 apart
    assert sum(res["resolvedPairs"]["hist"]) == 2000 and len(res["resolvedPairs"]["hist"]) == 3
    assert res["pAllPass"] == pytest.approx(res["resolvedPairs"]["hist"][2] / 2000)
    assert res["truth"]["resolvedPairs"] == 2


def test_quantiles_match_numpy():
    m = model(**EQ)
    res = EX.simulate(m, n=4, runs=300, seed=2, conf=0.8)
    # recompute pair 0 values from scratch with a manual draw loop
    rng = EX.Mulberry32(2)
    vals = []
    for _ in range(300):
        est = []
        for c in (0, 10, 50):
            ys = [float(m.mean(c)) + 20 * EX.normal(rng) for _ in range(4)]
            est.append((np.mean(ys), np.std(ys, ddof=1)))
        vals.append(float(K.ssmd(est[0][0], est[0][1], est[1][0], est[1][1])))
    p = res["pairs"][0]
    lo, med, hi = np.quantile(vals, [0.1, 0.5, 0.9])
    assert (p["lo"], p["med"], p["hi"]) == pytest.approx((lo, med, hi), rel=1e-9)
    assert (p["min"], p["max"]) == pytest.approx((min(vals), max(vals)), rel=1e-9)
    assert p["pPass"] == pytest.approx(np.mean([abs(v) >= 3 for v in vals]))


def test_flat_curve_zprime_nan():
    m = model(mode="equations", meanExpr="100", sdExpr="5", levels=[0, 1, 2], cMax=2)
    res = EX.simulate(m, n=3, runs=20, metric="zprime", k=0.5)
    assert res["truth"]["rows"][0]["pass"] is False  # Z' = -inf for a flat curve
    m2 = model(mode="equations", meanExpr="100", sdExpr="0", levels=[0, 1], cMax=1)
    r2 = EX.simulate(m2, n=2, runs=5, metric="zprime", k=0.5)
    assert r2["pairs"][0]["lo"] is None and r2["pairs"][0]["max"] is None
    assert r2["pairs"][0]["pPass"] == 0 and r2["pAllPass"] == 0
    assert r2["resolvedPairs"]["hist"] == [5, 0]
    assert res["pAllPass"] == 0


def test_defaults_and_metric_override():
    m = model(**EQ, metric="dsum", kTarget=1.5)
    res = EX.simulate(m, runs=2)
    assert (res["metric"], res["k"], res["n"], res["concs"], res["conf"]) == ("dsum", 1.5, [4, 4, 4], [0, 10, 50], 0.9)
    res = EX.simulate(m, runs=2, metric="zprime", k=0.2)
    assert (res["metric"], res["k"]) == ("zprime", 0.2)


def test_measured_n():
    m = model(mode="replicates", replicates={"concs": [0, 1, 5, 25], "cells": [
        [1.0, 2.0, None, 3.0], [5.0, 6.0], [10.0, 12.0, 11.0], [30.0]]})
    res = EX.simulate(m, runs=3, measured_n=True)
    assert res["concs"] == [0, 1, 5] and res["n"] == [3, 2, 3]
    res = EX.simulate(m, concs=[1, 5], runs=3, measured_n=True)
    assert res["n"] == [2, 3]
    with pytest.raises(ValueError, match="n must be between"):
        EX.simulate(m, concs=[1, 25], runs=3, measured_n=True)
    with pytest.raises(ValueError, match="measured n needs replicate data"):
        EX.simulate(model(**EQ), measured_n=True)


@pytest.mark.parametrize("kw,msg", [
    (dict(n=1), "n must be between"), (dict(n=1001), "n must be between"), (dict(n=2.5), "integer"),
    (dict(n=True), "integer"), (dict(n=[2, 3]), "2 values but there are 3"), (dict(runs=0), "runs"),
    (dict(runs=5001), "runs"), (dict(conf=0), "conf"), (dict(conf=1), "conf"), (dict(conf="x"), "conf"),
    (dict(concs=[0, -1]), ">= 0"), (dict(concs=[0, math.inf]), "finite"), (dict(concs=[1]), "two concentrations"),
    (dict(metric="foo"), "metric"), (dict(k=math.nan), "finite"), (dict(seed=1.5), "seed"),
])
def test_validation(kw, msg):
    with pytest.raises(ValueError, match=msg):
        EX.simulate(model(**EQ), **kw)




# ---------------------------------------------------------------- CLI
def run_cli(monkeypatch, capsys, argv, stdin=None):
    if stdin is not None:
        monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    code = cli_main(argv)
    out = capsys.readouterr()
    return code, out.out, out.err


def test_cli_simulate(monkeypatch, capsys):
    code, out, _ = run_cli(monkeypatch, capsys, ["simulate", "-", "--runs", "5", "--n", "3", "--seed", "7"],
                           json.dumps(EQ))
    d = json.loads(out)
    assert code == 0 and d["runs"] == 5 and d["n"] == [3, 3, 3] and d["seed"] == 7
    code, out, _ = run_cli(monkeypatch, capsys, ["simulate", "-", "--n-per", "2", "3", "4", "--runs", "2",
                                                 "--concs", "0", "10", "50", "--metric", "dsum", "--k", "1",
                                                 "--conf", "0.5"], json.dumps(EQ))
    assert code == 0 and json.loads(out)["n"] == [2, 3, 4]


def test_cli_simulate_errors(monkeypatch, capsys):
    code, _, err = run_cli(monkeypatch, capsys, ["simulate", "-", "--n", "1"], json.dumps(EQ))
    assert code == 2 and "n must be" in json.loads(err)["error"]
    code, _, err = run_cli(monkeypatch, capsys, ["simulate", "-", "--measured-n"], json.dumps(EQ))
    assert code == 2 and "replicate" in err
    code, _, _ = run_cli(monkeypatch, capsys, ["simulate", "-"], json.dumps({**EQ, "meanExpr": "1 +"}))
    assert code == 1


# ---------------------------------------------------------------- API
def test_api_simulate():
    r = client.post("/api/simulate", json={"series": EQ, "n": [2, 3, 4], "runs": 4, "seed": 3, "measuredN": False})
    assert r.status_code == 200
    d = r.json()
    assert d["n"] == [2, 3, 4] and len(d["pairs"]) == 2 and "pAllPass" in d
    r = client.post("/api/simulate", json={"series": EQ, "runs": 3})
    assert r.status_code == 200 and r.json()["n"] == [4, 4, 4]


def test_api_simulate_errors():
    r = client.post("/api/simulate", json={"series": EQ, "n": 1})
    assert r.status_code == 422 and r.json()["detail"] == {"error": "n must be between 2 and 1000, got 1", "pos": None}
    r = client.post("/api/simulate", json={"series": {**EQ, "meanExpr": "1 +"}})
    assert r.status_code == 422
    r = client.post("/api/simulate", json={"series": EQ, "measuredN": True})
    assert r.status_code == 422 and "replicate" in r.json()["detail"]["error"]


# ---------------------------------------------------------------- power (Welch t-test)
def test_welch_p_matches_scipy_and_edges():
    from scipy.stats import ttest_ind_from_stats

    from app.experiment import welch_p

    for m1, s1, n1, m2, s2, n2 in [(10, 2, 4, 13, 3, 5), (0, 1, 3, 0.5, 1, 3), (5, 0.1, 10, 5.01, 0.2, 8)]:
        want = ttest_ind_from_stats(m1, s1, n1, m2, s2, n2, equal_var=False).pvalue
        assert float(welch_p(np.array(m1), np.array(s1), n1, np.array(m2), np.array(s2), n2)) == pytest.approx(want, rel=1e-9)
    assert float(welch_p(np.array(1.0), np.array(0.0), 3, np.array(2.0), np.array(0.0), 3)) == 0.0
    assert float(welch_p(np.array(1.0), np.array(0.0), 3, np.array(1.0), np.array(0.0), 3)) == 1.0


def test_power_rises_with_n_and_alpha_is_validated():
    m = model(**EQ)
    lo = EX.simulate(m, n=3, runs=400, seed=2)["pairs"][0]["pSig"]
    hi = EX.simulate(m, n=12, runs=400, seed=2)["pairs"][0]["pSig"]
    assert 0 <= lo < hi <= 1
    r = EX.simulate(m, n=3, runs=5, seed=2, alpha=0.01)
    assert r["alpha"] == 0.01 and all(0 <= row["p"] <= 1 for row in r["first"]["rows"])
    for bad in (0, 1, True, "x"):
        with pytest.raises(ValueError, match="alpha"):
            EX.simulate(m, alpha=bad)
