"""POST /api/ladder and /api/measure."""
import pytest
from fastapi.testclient import TestClient

from app import analysis as A
from app.main import app
from app.series import Series, compile_series

client = TestClient(app)
LIN = {"meanExpr": "100 + 10*c", "sdExpr": "5", "cMax": 100, "levels": [0, 10, 100]}


def post(path, **body):
    return client.post(f"/api/{path}", json=body)


def test_ladder_defaults_follow_the_series():
    r = post("ladder", series=Series().model_dump(by_alias=True))
    assert r.status_code == 200
    body = r.json()
    m = compile_series(Series())
    assert body["levels"] == A.ladder(m, "ssmd", 3) and body["n"] == len(body["levels"]) > 3
    assert body["levels"][0] == 0


def test_ladder_options():
    r = post("ladder", series=LIN, metric="dsum", k=1, start=4, stop=10, sig=0).json()
    assert r["n"] == 7 and r["levels"][0] == 4 and r["levels"][-1] == pytest.approx(10)
    # series metric / kTarget are the defaults, overridable per call
    s = {**LIN, "metric": "dsum", "kTarget": 2}
    assert post("ladder", series=s, sig=0).json()["levels"][1] == pytest.approx(2)
    assert post("ladder", series=s, k=1, sig=0).json()["levels"][1] == pytest.approx(1)
    assert post("ladder", series=LIN, metric="dsum", k=1, start=50, stop=10).json() == {"levels": [50.0], "n": 1}


def test_ladder_table_mode_and_camel_case_keys():
    s = {"mode": "summary", "summary": [{"c": 0, "mean": 50, "sd": 15}, {"c": 25, "mean": 400, "sd": 30}]}
    assert post("ladder", series=s).json()["n"] >= 2


def test_measure_row_and_steps():
    r = post("measure", series=LIN, c1=2, c2=5, metric="dsum", k=1)
    assert r.status_code == 200
    body = r.json()
    assert body["stepsBetween"] == 3 and body["pass"] is True and body["dsum"] == pytest.approx(3)
    assert {"c1", "c2", "mu1", "mu2", "sd1", "sd2", "dmu", "dsum", "ssmd", "zprime", "ovl", "err", "pass"} <= set(body)
    # defaults come from the series; reversed order measures the same pair backwards
    back = post("measure", series=LIN, c1=5, c2=2).json()
    fwd = post("measure", series=LIN, c1=2, c2=5).json()
    assert back["dmu"] == -fwd["dmu"] and back["stepsBetween"] == fwd["stepsBetween"]


def test_measure_zero_sd_serialises_nulls():
    s = {"mode": "summary", "summary": [{"c": 0, "mean": 1}, {"c": 1, "mean": 1}]}
    body = post("measure", series=s, c1=0, c2=1).json()
    assert body["dsum"] is None and body["pass"] is False  # 0/0 -> NaN -> null, never passes


@pytest.mark.parametrize("path,extra", [("ladder", {}), ("measure", {"c1": 0, "c2": 1})])
def test_bad_expression_is_422_with_position(path, extra):
    r = post(path, series={"meanExpr": "1 +"}, **extra)
    assert r.status_code == 422 and r.json()["detail"] == {"error": "unexpected end of expression", "pos": 3}


@pytest.mark.parametrize("path,body", [
    ("ladder", {"series": LIN, "metric": "ovl"}), ("ladder", {"series": {"cMax": 0}}),
    ("ladder", {}), ("measure", {"series": LIN, "c1": 0}), ("measure", {"series": LIN, "c1": "a", "c2": 1}),
])
def test_schema_errors_are_422(path, body):
    assert post(path, **body).status_code == 422
