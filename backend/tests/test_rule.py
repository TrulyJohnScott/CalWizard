"""Pass rule in plain words (spec section 12): metric/k <-> misclassification rate, API, CLI, evaluate headline."""
import json
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.stats import norm

from app import analysis as A
from app import cli
from app import metrics as K
from app.main import app
from app.series import Series, compile_series

client = TestClient(app)


# ---------------------------------------------------------------- rule_error: closed forms
@pytest.mark.parametrize("k", [0.5, 1, 2, 3])
def test_dsum_and_ssmd_error_are_normal_tails(k):
    assert A.rule_error("dsum", k) == pytest.approx(norm.cdf(-k), rel=1e-12)
    assert A.rule_error("ssmd", k) == pytest.approx(norm.cdf(-k / math.sqrt(2)), rel=1e-12)


def test_known_values():
    assert A.rule_error("ssmd", 3) == pytest.approx(0.016947, abs=1e-6)
    assert A.rule_error("dsum", 1) == pytest.approx(0.158655, abs=1e-6)
    assert A.rule_error("zprime", 0.5) == pytest.approx(norm.cdf(-6), rel=1e-9)


@pytest.mark.parametrize("metric", ["dsum", "ssmd"])
@pytest.mark.parametrize("k", [0, -1, -1e9])
def test_non_positive_k_passes_everything(metric, k):
    assert A.rule_error(metric, k) == 0.5


@pytest.mark.parametrize("k", [1, 1.5, 100])
def test_zprime_at_or_above_one_is_unreachable(k):
    assert A.rule_error("zprime", k) == 0.0


def test_zprime_below_one_matches_equivalent_dsum():
    for k in (-2, 0, 0.3, 0.9):
        assert A.rule_error("zprime", k) == pytest.approx(A.rule_error("dsum", 3 / (1 - k)), rel=1e-12)


@pytest.mark.parametrize("metric, k", [("dsum", 1.3), ("ssmd", 2.4), ("zprime", 0.2)])
def test_rule_error_equals_section5_err_at_the_threshold_with_equal_sds(metric, k):
    """A pair sitting exactly on the threshold, with equal SDs, has §5 err == rule_error."""
    sd = 7.0
    dmu = {"dsum": k * 2 * sd, "ssmd": k * math.sqrt(2) * sd, "zprime": 3 * 2 * sd / (1 - k)}[metric]
    row = K.pair_row(0, 1, 100.0, 100.0 + dmu, sd, sd, metric, k)
    assert row[metric] == pytest.approx(k, rel=1e-12)
    assert row["err"] == pytest.approx(A.rule_error(metric, k), rel=1e-9)


# ---------------------------------------------------------------- k_for_error: inverse
@pytest.mark.parametrize("metric", A.METRICS)
@pytest.mark.parametrize("e", [1e-12, 1e-6, 0.001, 0.0135, 0.05, 0.25, 0.4999])
def test_round_trip(metric, e):
    k = A.k_for_error(metric, e)
    assert A.rule_error(metric, k) == pytest.approx(e, rel=1e-9)


def test_k_for_error_known_values():
    assert A.k_for_error("dsum", 0.025) == pytest.approx(1.959964, abs=1e-6)
    assert A.k_for_error("ssmd", 0.025) == pytest.approx(1.959964 * math.sqrt(2), abs=1e-6)
    assert A.k_for_error("zprime", norm.cdf(-6)) == pytest.approx(0.5, abs=1e-9)


@pytest.mark.parametrize("metric", A.METRICS)
def test_k_grows_as_error_shrinks(metric):
    ks = [A.k_for_error(metric, e) for e in (0.4, 0.1, 0.01, 1e-4, 1e-8)]
    assert all(np.diff(ks) > 0)


@pytest.mark.parametrize("e", [0, 0.5, 0.7, -0.1, math.nan, math.inf])
def test_k_for_error_rejects_out_of_range(e):
    with pytest.raises(ValueError, match="between 0 and 0.5"):
        A.k_for_error("ssmd", e)


def test_bad_metric():
    for fn, arg in ((A.rule_error, 3), (A.k_for_error, 0.1)):
        with pytest.raises(ValueError, match="metric must be one of"):
            fn("nope", arg)
    with pytest.raises(ValueError, match="metric must be one of"):
        A.rule("nope", k=1)


# ---------------------------------------------------------------- rule(): text and argument rules
@pytest.mark.parametrize("metric, k, text", [
    ("ssmd", 3, "SSMD ≥ 3 · 1.7% misread"),
    ("dsum", 1, "Δμ/Σσ ≥ 1 · 16% misread"),
    ("zprime", 0.5, "Z′ ≥ 0.5 · < 0.0001% misread"),
    ("zprime", 1, "Z′ ≥ 1 · 0% misread"),
    ("dsum", 0, "Δμ/Σσ ≥ 0 · 50% misread"),
    ("ssmd", 2.12132034, "SSMD ≥ 2.121 · 6.7% misread"),
    ("dsum", 4.5, "Δμ/Σσ ≥ 4.5 · 0.00034% misread"),
])
def test_rule_text(metric, k, text):
    r = A.rule(metric, k=k)
    assert r == {"metric": metric, "k": float(k), "error": A.rule_error(metric, k), "text": text}


def test_rule_from_error():
    r = A.rule("dsum", error=0.01)
    assert r["k"] == pytest.approx(2.326348, abs=1e-6) and r["error"] == pytest.approx(0.01)
    assert r["text"] == "Δμ/Σσ ≥ 2.326 · 1% misread"


@pytest.mark.parametrize("kw", [{}, {"k": 3, "error": 0.01}])
def test_rule_needs_exactly_one(kw):
    with pytest.raises(ValueError, match="exactly one"):
        A.rule("ssmd", **kw)


@pytest.mark.parametrize("k", [math.inf, -math.inf, math.nan])
def test_rule_rejects_non_finite_k(k):
    with pytest.raises(ValueError, match="finite"):
        A.rule("ssmd", k=k)


# ---------------------------------------------------------------- overview (headline)


def test_overview_ignores_the_levels_list():
    a = A.overview(compile_series(Series(levels=[0, 1, 2])))
    b = A.overview(compile_series(Series(levels=[0, 300])))
    assert a == b


# ---------------------------------------------------------------- HTTP
def test_api_rule_from_k_and_from_error():
    r = client.post("/api/rule", json={"metric": "ssmd", "k": 3})
    assert r.status_code == 200 and r.json() == A.rule("ssmd", k=3)
    r = client.post("/api/rule", json={"metric": "zprime", "error": 0.001})
    assert r.status_code == 200 and r.json()["k"] == pytest.approx(A.k_for_error("zprime", 0.001))


@pytest.mark.parametrize("body", [{"metric": "ssmd"}, {"metric": "ssmd", "k": 1, "error": 0.1},
                                  {"metric": "ssmd", "error": 0.5}, {"metric": "ssmd", "error": 0}])
def test_api_rule_bad_arguments_are_422_with_a_reason(body):
    r = client.post("/api/rule", json=body)
    assert r.status_code == 422 and r.json()["detail"]["error"]


@pytest.mark.parametrize("body", [{"metric": "nope", "k": 1}, {"k": 1}, {"metric": "ssmd", "k": "x"}])
def test_api_rule_invalid_body_is_422(body):
    assert client.post("/api/rule", json=body).status_code == 422


def test_api_evaluate_includes_headline():
    r = client.post("/api/evaluate", json={"series": {}, "grid": [1]}).json()
    m = compile_series(Series())
    assert r["resolvable"] == {"levels": A.ladder(m, "ssmd", 3), "n": len(A.ladder(m, "ssmd", 3))}
    assert r["rule"]["text"] == "SSMD ≥ 3 · 1.7% misread"


# ---------------------------------------------------------------- CLI
def run(capsys, *argv):
    code = cli.main([str(a) for a in argv])
    out, err = capsys.readouterr()
    return code, (json.loads(out) if out.strip() else None), (json.loads(err) if err.strip() else None)


def test_cli_rule(capsys):
    code, out, _ = run(capsys, "rule", "--k", 3)
    assert code == 0 and out == A.rule("ssmd", k=3)
    code, out, _ = run(capsys, "rule", "--metric", "dsum", "--error", 0.01)
    assert code == 0 and out["k"] == pytest.approx(2.326348, abs=1e-6)


@pytest.mark.parametrize("argv", [["rule"], ["rule", "--k", "1", "--error", "0.1"], ["rule", "--error", "0.6"],
                                  ["rule", "--metric", "nope", "--k", "1"], ["rule", "--k", "inf"]])
def test_cli_rule_errors_exit_2(capsys, argv):
    code, out, err = run(capsys, *argv)
    assert code == 2 and out is None and err["ok"] is False


def test_cli_evaluate_includes_headline(capsys, tmp_path):
    p = tmp_path / "s.json"
    p.write_text(json.dumps({"metric": "dsum", "kTarget": 1}), encoding="utf-8")
    code, out, _ = run(capsys, "evaluate", p, "--grid", 1)
    assert code == 0 and out["rule"] == A.rule("dsum", k=1)
    assert out["resolvable"]["n"] == len(out["resolvable"]["levels"])
