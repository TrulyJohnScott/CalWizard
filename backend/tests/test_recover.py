"""Recovery: signal -> concentration with the range of concentrations consistent with it (spec section 12)."""
import json
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.stats import norm

from app import analysis as A
from app import cli
from app.main import app
from app.series import Series, compile_series

client = TestClient(app)


def model(**kw):
    return compile_series(Series.model_validate(kw))


LIN = dict(meanExpr="100 + 10*c", sdExpr="5", cMax=100)  # c = (S - 100)/10, range ±z*5/10


def test_linear_constant_sd_closed_form():
    m = model(**LIN)
    z = norm.ppf(0.975)
    (r,) = A.recover(m, [400.0])
    assert r["c"] == pytest.approx(30.0)
    assert r["lo"] == pytest.approx(30 - z * 0.5, abs=1e-9)
    assert r["hi"] == pytest.approx(30 + z * 0.5, abs=1e-9)
    assert (r["loOpen"], r["hiOpen"], r["conf"], r["signal"]) == (False, False, 0.95, 400.0)


def test_conf_widens_the_range():
    m = model(**LIN)
    w = [A.recover(m, [400], conf)[0] for conf in (0.5, 0.9, 0.99)]
    widths = [r["hi"] - r["lo"] for r in w]
    assert widths[0] < widths[1] < widths[2]
    assert widths[1] == pytest.approx(2 * norm.ppf(0.95) * 0.5, abs=1e-9)


def test_near_zero_range_is_open_at_zero():
    (r,) = A.recover(model(**LIN), [100.5])
    assert r["loOpen"] and r["lo"] == 0.0 and not r["hiOpen"]
    assert r["hi"] == pytest.approx(0.05 + norm.ppf(0.975) * 0.5, abs=1e-9)


def test_above_the_curve_range_is_open_at_cmax_and_c_is_null():
    (r,) = A.recover(model(**LIN), [1101.0])  # mean(100) = 1100
    assert r["c"] is None and r["hiOpen"] and r["hi"] == 100.0
    assert r["lo"] == pytest.approx(100.1 - norm.ppf(0.975) * 0.5, abs=1e-9)


def test_far_outside_and_non_finite_give_nulls():
    rows = A.recover(model(**LIN), [5000.0, -1e6, math.nan, math.inf])
    for r in rows:
        assert (r["c"], r["lo"], r["hi"], r["loOpen"], r["hiOpen"]) == (None, None, None, False, False)


def test_signal_dependent_sd_and_falling_curve():
    m = model(meanExpr="3000/(1 + c/50) + 100", sdExpr="0.05*S + 10", cMax=800)
    (r,) = A.recover(m, [float(m.mean(100))])
    assert r["c"] == pytest.approx(100, rel=1e-6)
    assert r["lo"] < 100 < r["hi"]
    z = norm.ppf(0.975)
    for c in (r["lo"], r["hi"]):  # ends sit on the boundary |S - mean(c)| = z sd(c)
        assert abs(float(m.mean(100)) - float(m.mean(c))) == pytest.approx(z * float(m.sd(c)), rel=1e-6)


def test_every_point_inside_the_range_is_consistent():
    m = compile_series(Series())
    (r,) = A.recover(m, [1500.0])
    z = norm.ppf(0.975)
    for c in np.linspace(r["lo"], r["hi"], 50):
        assert abs(1500 - float(m.mean(c))) <= z * float(m.sd(c)) * (1 + 1e-9)


@pytest.mark.parametrize("conf", [0, 1, -0.1, 1.5, math.nan])
def test_bad_conf(conf):
    with pytest.raises(ValueError, match="conf must be"):
        A.recover(model(**LIN), [400], conf)


def test_table_mode_beyond_last_column_is_within_cmax_only():
    m = model(mode="summary", summary=[{"c": 0, "mean": 50, "sd": 2}, {"c": 5, "mean": 100, "sd": 3}])
    (r,) = A.recover(m, [120.0])  # beyond mean(cMax) = 100 by ~6.7 sd
    assert r["c"] is None and r["lo"] is None


# ---------------------------------------------------------------- HTTP + CLI
def test_api_recover():
    r = client.post("/api/recover", json={"series": {"meanExpr": "100 + 10*c", "sdExpr": "5", "cMax": 100}, "signals": [400]})
    assert r.status_code == 200
    assert r.json()["rows"] == A.recover(model(**LIN), [400.0])


def test_api_recover_bad_conf_and_bad_series():
    s = {"meanExpr": "100 + 10*c", "sdExpr": "5", "cMax": 100}
    assert client.post("/api/recover", json={"series": s, "signals": [1], "conf": 2}).status_code == 422
    r = client.post("/api/recover", json={"series": {**s, "meanExpr": "1 +"}, "signals": [1]})
    assert r.status_code == 422 and "pos" in r.json()["detail"]


def run(capsys, *argv):
    code = cli.main([str(a) for a in argv])
    out, err = capsys.readouterr()
    return code, (json.loads(out) if out.strip() else None), (json.loads(err) if err.strip() else None)


def test_cli_recover(capsys, tmp_path):
    p = tmp_path / "s.json"
    p.write_text(json.dumps(LIN), encoding="utf-8")
    code, out, _ = run(capsys, "recover", p, 400, 5000, "--conf", 0.9)
    assert code == 0
    assert out["rows"] == A.recover(model(**LIN), [400.0, 5000.0], 0.9)
    code, out, err = run(capsys, "recover", p, 400, "--conf", 1)
    assert code == 2 and out is None and "conf" in err["error"]
