"""Edge cases and error paths in expr / fit / series / metrics, plus fixture freshness."""
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from app import expr as E
from app import fit as F
from app import metrics as K
from app.series import Series, compile_series

ROOT = Path(__file__).resolve().parents[2]


def eq(**kw):
    return compile_series(Series.model_validate(kw))


# ---------------------------------------------------------------- expr
def test_parser_rejects_unknown_variable_kind():
    with pytest.raises(ValueError, match="variable must be one of"):
        E.parse("1", "x")


@pytest.mark.parametrize("text,msg,pos", [
    ("sqrt(1 2)", "expected ')'", 7),  # call not closed
    ("max(1, 2", "expected ')'", 8),
    ("* 1", "unexpected '*'", 0),  # operator where an atom must be
    ("1 + )", "unexpected ')'", 4),
    ("2 ^ ^ 3", "unexpected '^'", 4),
    ("(", "unexpected end of expression", 1),
])
def test_parser_error_messages_and_positions(text, msg, pos):
    with pytest.raises(E.ExprError) as e:
        E.parse(text, "c")
    assert (e.value.message, e.value.pos) == (msg, pos)
    assert f"(at position {pos})" in str(e.value)


# ---------------------------------------------------------------- metrics
def test_crossing_with_unequal_sd_and_no_root_between_the_means():
    # equal means, different SDs: the two crossings are symmetric about the mean, none lies between (a point)
    assert K.crossing(0.0, 1.0, 0.0, 3.0) == 0.0
    err = K.misclass(0.0, 1.0, 0.0, 3.0)
    assert err == pytest.approx(0.5, abs=1e-12)  # decided at the midpoint: both tails give 0.5
    assert 0 < K.overlap(0.0, 1.0, 0.0, 3.0) < 1
    # a crossing between the means is found for unequal SDs and sits closer to the tighter distribution's mean
    t = K.crossing(0.0, 1.0, 10.0, 3.0)
    assert 0 < t < 5


def test_crossing_clamps_rounding_noise_in_the_discriminant():
    # nearly-equal SDs: still returns a finite threshold inside [mu1, mu2]
    t = K.crossing(0.0, 2.0, 6.0, 2.0 * (1 + 1e-9))
    assert 0 <= t <= 6 and math.isfinite(t)


def test_metrics_nonfinite_inputs_give_nan_not_errors():
    nan = float("nan")
    assert math.isnan(K.overlap(nan, 1, 0, 1)) and math.isnan(K.misclass(0, nan, 1, 1))
    assert K.passes("ssmd", nan, 1) is False and K.passes("zprime", math.inf, 0.5) is True


# ---------------------------------------------------------------- series
def test_cmax_must_be_positive_and_finite():
    for bad in (0, -1, float("inf")):
        with pytest.raises(ValidationError, match="cMax must be > 0"):
            Series(cMax=bad)
    with pytest.raises(ValidationError):
        Series.model_validate({"cMax": "nan"})


def test_replicate_header_without_data_takes_typed_summary_values():
    m = eq(mode="replicates", replicates={"concs": [0, 1, 5], "cells": [[10.0, 12.0], [], [None]]},
           summary=[{"c": 1, "mean": 40, "sd": 3}, {"c": 5, "mean": 90, "sd": None}, {"c": 99, "mean": 1, "sd": 1}])
    np.testing.assert_allclose(m.mean([0, 1, 5]), [11, 40, 90])  # c=99 is not a header column: ignored
    np.testing.assert_allclose(m.sd([0, 1]), [np.std([10, 12], ddof=1), 3])  # typed sd used; c=5 has none
    assert not m.sd_missing
    assert list(m.levels) == [0, 1, 5]


def test_inverse_bisects_between_scan_points():
    m = eq(meanExpr="c^2", cMax=10)
    (got,) = m.inverse([2.0])
    assert got == pytest.approx(math.sqrt(2), abs=1e-12)
    f = eq(meanExpr="1000/(1 + c/10)", cMax=100)
    assert f.inverse([123.0])[0] == pytest.approx(10 * (1000 / 123 - 1), abs=1e-9)


def test_inverse_bisection_can_land_exactly_on_the_root():
    # the root 0.025 is the first bisection midpoint of the first scan interval (0, 0.05)
    m = eq(meanExpr="2*c", cMax=100)
    assert m.inverse([0.05])[0] == 0.025


def test_inverse_first_bracket_wins_with_bisection():
    m = eq(meanExpr="c*(10 - c)", cMax=10)
    assert m.inverse([21.0])[0] == pytest.approx(3.0, abs=1e-9)


# ---------------------------------------------------------------- fit
def test_mid_c_without_positive_concentrations():
    c = np.array([0.0, 0.0])
    assert F._mid_c(c, np.array([1.0, 2.0]), 0.0, 1.0) == 1.0


def test_best_lsq_survives_a_failing_start_and_returns_none_when_all_fail():
    good = F._best_lsq(lambda x: x - 3, [[1.0]], [-10.0], [10.0])
    assert good.x[0] == pytest.approx(3.0)
    bad = F._best_lsq(lambda x: np.array([np.nan]), [[1.0], [2.0]], [-10.0], [10.0])  # raises inside scipy
    assert bad is None
    mixed = F._best_lsq(lambda x: x - 3 if x[0] < 5 else np.array([np.nan]), [[7.0], [1.0]], [-10.0], [10.0])
    assert mixed.x[0] == pytest.approx(3.0)


def test_fit_functions_report_failure_instead_of_raising():
    c = np.array([0.0, 1.0, 2.0, 5.0, 10.0])
    y = np.array([1.0, np.nan, 3.0, 4.0, 5.0])
    r = F.fit_mean("linear", c, y, np.ones(5), 10.0)
    assert r["ok"] is False and r["expr"] is None and r["params"] == {}
    s = F.fit_sd("constant", np.array([1.0, 2.0, 3.0]), np.array([1.0, np.nan, 2.0]))
    assert s["ok"] is False and s["expr"] is None


def test_run_fit_never_raises_even_if_a_model_blows_up(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(F, "fit_mean", boom)
    monkeypatch.setattr(F, "fit_sd", boom)
    res = F.run_fit({"points": [{"c": c, "y": 2 * c + d} for c in (0, 1, 2, 3) for d in (0, 1)]})
    assert len(res["meanFits"]) == 7 and len(res["sdFits"]) == 4
    assert not any(f["ok"] for f in res["meanFits"] + res["sdFits"])
    assert [lv["n"] for lv in res["levels"]] == [2, 2, 2, 2]


def test_summary_rows_with_invalid_entries_are_skipped():
    res = F.run_fit({"summary": [
        {"c": 0, "mean": 50, "sd": 5}, {"c": -1, "mean": 3, "sd": 1}, {"c": "x", "mean": 3}, {"c": 4, "mean": None},
        {"c": float("inf"), "mean": 1}, {"c": 1, "mean": 60, "sd": "bad"}, {"c": 2, "mean": 70, "sd": 6},
        {"c": 5, "mean": 120, "sd": 8}]})
    assert [lv["c"] for lv in res["levels"]] == [0, 1, 2, 5]
    assert res["levels"][1]["sd"] is None


# ---------------------------------------------------------------- fixtures stay in sync with the code
def _approx_equal(a, b, path="$"):
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), path
        for k in a:
            _approx_equal(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            _approx_equal(x, y, f"{path}[{i}]")
    elif isinstance(a, float) or isinstance(b, float):
        assert a == pytest.approx(b, rel=1e-9, abs=1e-12), path
    else:
        assert a == b, path


def test_fixture_file_matches_what_make_fixtures_generates():
    spec = importlib.util.spec_from_file_location("make_fixtures", ROOT / "backend" / "scripts" / "make_fixtures.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fresh = json.loads(json.dumps(mod.build_payload(), allow_nan=False))
    on_disk = json.loads((ROOT / "spec" / "fixtures" / "model_vectors.json").read_text(encoding="utf-8"))
    _approx_equal(fresh, on_disk)  # if this fails: cd backend; uv run python scripts/make_fixtures.py


def test_fixtures_carry_ladder_and_measure_for_every_case():
    fx = json.loads((ROOT / "spec" / "fixtures" / "model_vectors.json").read_text(encoding="utf-8"))
    for case in fx["cases"]:
        got = {(lw["metric"], lw["k"], lw["sig"]) for lw in case["ladder"]}
        assert {("dsum", 1, 4), ("ssmd", 3, 4), ("zprime", 0.5, 4), ("ssmd", 3, 0)} == got, case["name"]
        assert all(lw["levels"][0] == 0 and len(lw["levels"]) >= 1 for lw in case["ladder"])
        assert len(case["measure"]) == 2
        assert all({"c1", "c2", "mu1", "dsum", "pass", "stepsBetween", "metric", "k"} <= set(w)
                   for w in case["measure"])
