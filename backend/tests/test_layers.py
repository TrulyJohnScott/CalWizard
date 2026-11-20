"""Spec section 22: variability layers — model, budget, cumulative, design simulation, dial-in."""
import itertools
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import analysis as A
from app import cli
from app import layers as LY
from app.main import app
from app.series import Series, compile_series

LIN = dict(meanExpr="100 + 10*c", sdExpr="5", cMax=100, levels=[0, 10, 50, 100])


def model(**kw):
    return compile_series(Series.model_validate(kw))


def lay(**kw):
    return {"name": "L", "units": 3, **kw}


# ---------------------------------------------------------------- 16.1 model
def test_no_layers_or_all_off_changes_nothing():
    a, b = model(**LIN), model(**LIN, layers=[lay(cv=0.1, on=False)])
    assert float(a.sd(50)) == float(b.sd(50)) == 5.0


def test_effective_sd_closed_form():
    m = model(**LIN, layers=[lay(name="Lot", offsetSd=3, cv=0.02, gainCv=0.05, noiseCv=0.1), lay(name="Reader", offsetSd=4)])
    mu, mu0 = 600.0, 100.0  # c = 50
    want = 25 * 1.01 + ((mu - mu0) ** 2 * 0.05 ** 2 + mu ** 2 * 0.02 ** 2 + 9) + 16
    assert float(m.sd(50)) == pytest.approx(want ** 0.5, rel=1e-12)
    assert float(m.sd_within(50)) == 5.0
    assert float(m.mean(50)) == mu  # random effects leave the mean alone


def test_layer_validation():
    with pytest.raises(ValueError):
        Series.model_validate({"layers": [lay(cv=-0.1)]})
    with pytest.raises(ValueError):
        Series.model_validate({"layers": [lay(units=0)]})


# ---------------------------------------------------------------- 16.2 budget, cumulative
def test_budget_shares_and_off_layers():
    m = model(**LIN, layers=[lay(name="Lot", offsetSd=3), lay(name="Day", offsetSd=4, on=False)])
    (r,) = LY.budget(m, [10])
    assert r["within"] == pytest.approx(25) and r["total"] == pytest.approx(34)
    assert r["layers"][0] == {"name": "Lot", "on": True, "var": pytest.approx(9), "share": pytest.approx(9 / 34)}
    assert r["layers"][1]["share"] is None and r["layers"][1]["var"] == pytest.approx(16)
    assert r["withinShare"] == pytest.approx(25 / 34)
    assert [b["c"] for b in LY.budget(m)] == [0, 10, 50, 100]


def test_cumulative_counts_fall_as_layers_are_added():
    m = model(**LIN, metric="dsum", kTarget=1, layers=[lay(name="Lot", offsetSd=5), lay(name="Day", offsetSd=10)])
    cum = LY.cumulative(m)
    assert [c["layers"] for c in cum] == [[], ["Lot"], ["Lot", "Day"]]
    ns = [c["n"] for c in cum]
    assert ns[0] > ns[1] > ns[2]
    assert ns[0] == len(A.ladder(model(**LIN), "dsum", 1))


# ---------------------------------------------------------------- 16.4 ANOVA components
def test_components_exact_on_constructed_data():
    rng = np.random.default_rng(0)
    u1, u2, n = 30, 30, 8
    a = rng.normal(0, 3, u1)
    b = rng.normal(0, 2, u2)
    e = rng.normal(0, 1, (u1, u2, n))
    y = 50 + a[:, None, None] + b[None, :, None] + e
    ms_e, (v1, v2) = LY.components(y)
    assert ms_e == pytest.approx(1, rel=0.1)
    assert v1 == pytest.approx(9, rel=0.35) and v2 == pytest.approx(4, rel=0.35)
    # a factor with no effect estimates ~0 (never negative)
    _, (z,) = LY.components(rng.normal(0, 1, (10, 6)))
    assert z >= 0


def test_dial_in_recovers_sizes_from_synthetic_data():
    rng = np.random.default_rng(1)
    m = model(**LIN, layers=[lay(name="Lot", units=8, offsetSd=6), lay(name="Reader", units=8, cv=0.05)])
    concs = [0, 10, 50, 100]
    lots = rng.normal(0, 6, 8)
    readers = rng.normal(0, 0.05, 8)
    rows = []
    for c, i, j, r in itertools.product(concs, range(8), range(8), range(4)):
        mu = 100 + 10 * c
        rows.append({"c": c, "Lot": f"L{i}", "Reader": f"R{j}", "y": mu * (1 + readers[j]) + lots[i] + rng.normal(0, 5)})
    out = LY.dial_in(m, rows)
    got = {L["name"]: L["measured"] for L in out["layers"]}
    assert got["Lot"]["offsetSd"] == pytest.approx(np.std(lots, ddof=1), rel=0.35)
    assert got["Reader"]["cv"] == pytest.approx(np.std(readers, ddof=1), rel=0.35)
    assert all(w["measured"] == pytest.approx(25, rel=0.3) for w in out["within"])
    assert out["layers"][0]["predicted"]["offsetSd"] == 6 and out["layers"][0]["units"] == 8
    assert out["notes"] == ["gain and proportional CV cannot be told apart on this curve (blank signal is small): reported together as CV"]
    lo, hi = out["layers"][0]["rough"]
    assert 0.5 < lo < 1 < hi < 2.5


def test_dial_in_notes_and_errors():
    m = model(**LIN, layers=[lay(name="Lot"), lay(name="Day")])
    rows = [{"c": 0, "Lot": "a", "Day": "x", "y": 1}, {"c": 0, "Lot": "b", "Day": "x", "y": 2},
            {"c": 0, "Lot": "a", "Day": "x", "y": 1.5}, {"c": 0, "Lot": "b", "Day": "x", "y": 2.5}]
    out = LY.dial_in(m, rows)
    assert any("Day: fewer than 2 units" in n for n in out["notes"])
    assert any("fewer than 3 concentrations" in n for n in out["notes"])
    with pytest.raises(ValueError, match="no layers"):
        LY.dial_in(model(**LIN), rows)
    with pytest.raises(ValueError, match="no usable rows"):
        LY.dial_in(m, [{"c": "x"}])
    unbalanced = rows[:3]
    with pytest.raises(ValueError, match="complete crossed design"):
        LY.dial_in(m, [{"c": 0, "Lot": "a", "Day": "x", "y": 1}, {"c": 0, "Lot": "b", "Day": "y", "y": 2}])
    assert LY.dial_in(m, unbalanced)["notes"]


def test_read_csv_rows():
    assert LY.read_csv_rows("c,Lot,y\n0,a,1.5\n\n5,b,3\n") == [{"c": "0", "Lot": "a", "y": "1.5"}, {"c": "5", "Lot": "b", "y": "3"}]
    assert LY.read_csv_rows("c\tLot\ty\n0\ta\t1") == [{"c": "0", "Lot": "a", "y": "1"}]
    assert LY.read_csv_rows("") == []


# ---------------------------------------------------------------- 16.3 design simulation
def test_design_estimates_centre_on_truth_and_layers_hurt_power():
    m = model(**LIN, metric="dsum", kTarget=1, layers=[lay(name="Lot", units=4, offsetSd=8), lay(name="Day", units=3, cv=0.01)])
    out = LY.simulate_design(m, n=3, runs=150, seed=3)
    assert out["readingsPerConc"] == 4 * 3 * 3 and out["units"] == [4, 3]
    comp = {c["name"]: c for c in out["components"]}
    assert comp["within"]["med"] == pytest.approx(comp["within"]["true"], rel=0.25)
    assert comp["Lot"]["true"] == pytest.approx(64)
    assert 0 <= comp["Lot"]["lo"] <= comp["Lot"]["med"] <= comp["Lot"]["hi"]
    assert all(0 <= p["pSig"] <= 1 and 0 <= p["pPass"] <= 1 for p in out["pairs"])
    a = LY.simulate_design(m, n=3, runs=5, seed=9)
    assert a == LY.simulate_design(m, n=3, runs=5, seed=9)  # deterministic


def test_design_validation():
    with pytest.raises(ValueError, match="no layers"):
        LY.simulate_design(model(**LIN))
    m = model(**LIN, layers=[lay()])
    with pytest.raises(ValueError, match="two concentrations"):
        LY.simulate_design(m, concs=[1])
    with pytest.raises(ValueError, match="n must be"):
        LY.simulate_design(m, n=1)


# ---------------------------------------------------------------- CLI + API wiring
def test_cli_and_api(capsys, tmp_path):
    s = {**LIN, "layers": [lay(name="Lot", units=2, offsetSd=4)]}
    p = tmp_path / "s.json"
    p.write_text(json.dumps(s), encoding="utf-8")
    assert cli.main(["budget", str(p), "--c", "10"]) == 0
    assert json.loads(capsys.readouterr().out)["rows"][0]["c"] == 10
    assert cli.main(["design", str(p), "--runs", "3"]) == 0
    assert json.loads(capsys.readouterr().out)["runs"] == 3
    d = tmp_path / "d.csv"
    d.write_text("c,Lot,y\n0,a,100\n0,a,101\n0,b,104\n0,b,105\n", encoding="utf-8")
    assert cli.main(["dialin", str(p), str(d)]) == 0
    assert json.loads(capsys.readouterr().out)["layers"][0]["name"] == "Lot"
    assert cli.main(["dialin", str(p), str(tmp_path / "missing.csv")]) == 2
    assert cli.main(["design", str(tmp_path / "s.json"), "--n", "1"]) == 2
    capsys.readouterr()
    c = TestClient(app)
    assert c.post("/api/budget", json={"series": s}).status_code == 200
    assert c.post("/api/design", json={"series": s, "runs": 2}).json()["runs"] == 2
    assert c.post("/api/design", json={"series": LIN}).status_code == 422
    assert c.post("/api/dialin", json={"series": s, "csv": d.read_text()}).status_code == 200
    assert c.post("/api/dialin", json={"series": s, "rows": []}).status_code == 422


def test_dial_in_separates_gain_from_cv_when_the_blank_is_large():
    rng = np.random.default_rng(2)
    m = model(meanExpr="1000 + 10*c", sdExpr="3", cMax=100, levels=[0, 25, 50, 100],
              layers=[lay(name="Lot", units=10, gainCv=0.1)])
    gains = rng.normal(1, 0.1, 10)
    rows = [{"c": c, "Lot": f"L{i}", "y": 1000 + gains[i] * 10 * c + rng.normal(0, 3)}
            for c, i, _ in itertools.product([0, 25, 50, 100], range(10), range(3))]
    out = LY.dial_in(m, rows)
    got = out["layers"][0]["measured"]
    assert not any("cannot be told apart" in n for n in out["notes"])
    assert got["gainCv"] == pytest.approx(np.std(gains, ddof=1), rel=0.3)
    assert got["cv"] < 0.02
