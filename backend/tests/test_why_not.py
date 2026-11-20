"""Why not resolved (spec section 12): needed dmu, SD scale, and the first passing concentration."""
import json
import math

import pytest
from fastapi.testclient import TestClient

from app import analysis as A
from app import cli
from app.main import app
from app.series import Series, compile_series

LIN = dict(meanExpr="100 + 10*c", sdExpr="5", cMax=100)


def model(**kw):
    return compile_series(Series.model_validate(kw))


def test_closed_forms_for_each_metric():
    m = model(**LIN)
    w = A.why_not(m, 0, 0.5, "dsum", 1)  # dmu 5, needs 1*(5+5)
    assert w["needDmu"] == pytest.approx(10) and w["dmu"] == pytest.approx(5)
    assert w["sdScale"] == pytest.approx(0.5) and w["moveTo"] == pytest.approx(1, abs=1e-9)
    assert (w["c1"], w["c2"]) == (0.0, 0.5)
    assert A.why_not(m, 0, 0.5, "ssmd", 3)["needDmu"] == pytest.approx(3 * math.sqrt(50))
    z = A.why_not(m, 0, 0.5, "zprime", 0.5)
    assert z["needDmu"] == pytest.approx(60) and z["sdScale"] == pytest.approx(0.5 / 6)  # dsum 0.5 vs 3/(1-k) = 6
    assert A.why_not(m, 0, 0.5, "zprime", 1)["needDmu"] is None
    assert A.why_not(m, 0, 0.5, "zprime", 1)["sdScale"] is None


def test_floors_and_unreachable():
    m = model(**LIN)
    assert A.why_not(m, 0, 0.5, "dsum", -1)["needDmu"] == 0.0
    flat = model(meanExpr="100", sdExpr="5", cMax=10)
    w = A.why_not(flat, 0, 5, "ssmd", 3)
    assert w["sdScale"] is None and w["moveTo"] is None and w["dmu"] == 0.0


def test_measure_api_and_cli_include_why_not(capsys, tmp_path):
    r = TestClient(app).post("/api/measure", json={"series": LIN, "c1": 0, "c2": 0.5, "metric": "dsum", "k": 1}).json()
    assert r["whyNot"] == A.why_not(model(**LIN), 0, 0.5, "dsum", 1)
    p = tmp_path / "s.json"
    p.write_text(json.dumps(LIN), encoding="utf-8")
    assert cli.main(["measure", str(p), "0", "0.5", "--metric", "dsum", "--k", "1"]) == 0
    assert json.loads(capsys.readouterr().out)["whyNot"]["needDmu"] == pytest.approx(10)
