"""The `calwizard` CLI: JSON in / JSON out, errors as JSON on stderr with a non-zero exit."""
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

from app import analysis as A
from app import cli
from app.series import Series, compile_series

BACKEND = Path(__file__).resolve().parents[1]
EXAMPLE = BACKEND / "examples" / "example.json"


def run(capsys, *argv, stdin=None, monkeypatch=None):
    if stdin is not None:
        monkeypatch.setattr(sys, "stdin", io.StringIO(stdin))
    code = cli.main([str(a) for a in argv])
    out, err = capsys.readouterr()
    return code, (json.loads(out) if out.strip() else None), (json.loads(err) if err.strip() else None)


def write(tmp_path, data, name="s.json"):
    p = tmp_path / name
    p.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
    return p


@pytest.fixture
def model():
    return compile_series(Series.model_validate(json.loads(EXAMPLE.read_text())))


# ---------------------------------------------------------------- happy paths
def test_example_file_is_the_spec_default_series():
    s = Series.model_validate(json.loads(EXAMPLE.read_text()))
    assert s.model_copy(update={"name": "Untitled"}) == Series()


def test_evaluate(capsys, model):
    code, out, err = run(capsys, "evaluate", EXAMPLE)
    assert (code, err) == (0, None)
    assert len(out["grid"]) == len(out["mean"]) == len(out["sd"]) == 501
    assert out["levels"] == [0, 1, 5, 25, 100, 500] and len(out["rows"]) == 5
    assert out["mean"][0] == pytest.approx(50)
    code, out, _ = run(capsys, "evaluate", EXAMPLE, "--grid", "0", "40", "1e9")
    assert out["grid"] == [0, 40, 1e9] and out["mean"][1] == pytest.approx(2025.0)


def test_ladder_matches_library_and_options(capsys, model):
    code, out, _ = run(capsys, "ladder", EXAMPLE)
    want = A.ladder(model, "ssmd", 3)
    assert code == 0 and out["levels"] == want and out["n"] == len(want)
    _, out, _ = run(capsys, "ladder", EXAMPLE, "--metric", "dsum", "--k", "1", "--sig", "0", "--start", "5", "--stop", "50")
    assert out["levels"] == A.ladder(model, "dsum", 1, 5, 50, 0) and out["levels"][0] == 5


def test_measure(capsys, model):
    code, out, _ = run(capsys, "measure", EXAMPLE, 5, 25)
    assert code == 0
    assert out["stepsBetween"] == A.steps_between(model, 5, 25, "ssmd", 3) == 3
    assert out["pass"] is True and out["dmu"] == pytest.approx(A.pair(model, 5, 25)["dmu"])
    _, out, _ = run(capsys, "measure", EXAMPLE, 0, 1, "--metric", "zprime", "--k", "0.5")
    assert out["pass"] is False


def test_inverse_negative_numbers_and_out_of_range(capsys):
    code, out, _ = run(capsys, "inverse", EXAMPLE, 1000, -5, 1e9)
    assert code == 0 and out["signals"] == [1000, -5, 1e9]
    assert out["c"][0] == pytest.approx(15.3424700, abs=1e-6) and out["c"][1:] == [None, None]


def test_stdin_as_dash_and_wrapped_series(capsys, monkeypatch):
    text = EXAMPLE.read_text()
    _, a, _ = run(capsys, "ladder", "-", stdin=text, monkeypatch=monkeypatch)
    _, b, _ = run(capsys, "ladder", "-", stdin=json.dumps({"series": json.loads(text)}), monkeypatch=monkeypatch)
    assert a == b and a["n"] > 3


def test_parse_ok_and_variable(capsys):
    code, out, _ = run(capsys, "parse", "sqrt(15^2 + (0.08*S)^2)", "--var", "S")
    assert code == 0 and out == {"ok": True, "excel": "SQRT(((15^2)+((0.08*A1)^2)))"}
    _, out, _ = run(capsys, "parse", "log(c) + pi")
    assert out["excel"] == "(LOG10(A1)+PI())"


def test_fit_points_summary_and_series(capsys, tmp_path):
    pts = [{"c": c, "y": 50 + 3 * c + d} for c in (0, 1, 2, 5, 10, 20) for d in (-1, 0, 1)]
    code, out, _ = run(capsys, "fit", write(tmp_path, {"points": pts}))
    assert code == 0 and out["meanFits"][0]["ok"] and {f["kind"] for f in out["meanFits"]} >= {"linear", "4pl"}
    assert len(out["levels"]) == 6
    summ = [{"c": c, "mean": 50 + 3 * c, "sd": 2 + 0.1 * c} for c in (0, 1, 2, 5, 10, 20)]
    _, out, _ = run(capsys, "fit", write(tmp_path, {"summary": summ}))
    assert len(out["levels"]) == 6 and out["levels"][0]["n"] == 1
    rep = {"mode": "replicates", "replicates": {"concs": [0, 1, 5, 10],
                                                "cells": [[1, 1.2, None], [3, 3.1], [9, 9.4, 8.9], [18, 19]]}}
    _, out, _ = run(capsys, "fit", write(tmp_path, rep))
    assert [lv["n"] for lv in out["levels"]] == [2, 2, 3, 2]
    _, out, _ = run(capsys, "fit", write(tmp_path, {"series": {"mode": "summary", "summary": summ}}))
    assert len(out["levels"]) == 6
    _, out, _ = run(capsys, "fit", write(tmp_path, {}))  # never HTTP/CLI-errors on empty data
    assert out["levels"] == [] and not any(f["ok"] for f in out["meanFits"] + out["sdFits"])


def test_export_writes_a_workbook(capsys, tmp_path):
    target = tmp_path / "out.xlsx"
    code, out, _ = run(capsys, "export", EXAMPLE, "-o", target)
    assert code == 0 and out["path"] == str(target) and out["bytes"] == target.stat().st_size > 1000
    assert {"Inputs", "Calculator", "Grid", "Levels", "Data"} <= set(load_workbook(target).sheetnames)


# ---------------------------------------------------------------- errors: JSON on stderr + non-zero exit
def test_bad_expression_is_exit_1_with_position(capsys, tmp_path):
    p = write(tmp_path, {"meanExpr": "1 +"})
    for cmd in (["evaluate", p], ["ladder", p], ["measure", p, 1, 2], ["inverse", p, 1],
                ["export", p, "-o", tmp_path / "x.xlsx"]):
        code, out, err = run(capsys, *cmd)
        assert (code, out) == (1, None), cmd
        assert err["ok"] is False and err["pos"] == 3 and "end of expression" in err["error"]
    code, out, err = run(capsys, "parse", "sqrt(c")
    assert (code, out) == (1, None) and err["pos"] == 6
    code, _, err = run(capsys, "parse", "c + 1", "--var", "S")
    assert code == 1 and err["pos"] == 0 and "not allowed" in err["error"]
    assert not (tmp_path / "x.xlsx").exists()


def test_bad_input_is_exit_2(capsys, tmp_path, monkeypatch):
    code, out, err = run(capsys, "ladder", tmp_path / "missing.json")
    assert (code, out) == (2, None) and "cannot read" in err["error"]
    code, _, err = run(capsys, "ladder", write(tmp_path, "{not json"))
    assert code == 2 and "invalid JSON" in err["error"]
    code, _, err = run(capsys, "ladder", write(tmp_path, {"cMax": -1}))
    assert code == 2 and err["error"] == "invalid series" and err["errors"][0]["loc"] == ["cMax"]
    code, _, err = run(capsys, "ladder", "-", stdin="[1, 2]", monkeypatch=monkeypatch)
    assert code == 2 and err["error"] == "invalid series"
    code, _, err = run(capsys, "fit", write(tmp_path, [1, 2]))
    assert code == 2 and "JSON object" in err["error"]
    code, _, err = run(capsys, "fit", write(tmp_path, {"mode": "equations"}))
    assert code == 2 and "equations mode" in err["error"]
    code, _, err = run(capsys, "export", EXAMPLE, "-o", tmp_path)  # a directory
    assert code == 2 and "cannot write" in err["error"]


@pytest.mark.parametrize("argv", [
    [], ["nonsense"], ["ladder"], ["measure", str(EXAMPLE), "1"], ["measure", str(EXAMPLE), "a", "b"],
    ["ladder", str(EXAMPLE), "--metric", "ovl"], ["parse", "1", "--var", "x"], ["export", str(EXAMPLE)],
])
def test_usage_errors_are_json_exit_2(capsys, argv):
    code, out, err = run(capsys, *argv)
    assert (code, out) == (2, None) and err["ok"] is False and err["error"]


def test_help_exits_zero(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["--help"])
    assert e.value.code == 0
    text = capsys.readouterr().out
    assert all(c in text for c in ("evaluate", "ladder", "measure", "inverse", "fit", "export", "parse"))


# ---------------------------------------------------------------- real process (console script / module)
@pytest.mark.deep
def test_subprocess_module_and_console_script(tmp_path):
    env_py = [sys.executable, "-m", "app.cli"]
    r = subprocess.run([*env_py, "ladder", str(EXAMPLE)], capture_output=True, text=True, cwd=BACKEND, timeout=60)
    assert r.returncode == 0 and json.loads(r.stdout)["n"] > 3 and r.stderr == ""
    r = subprocess.run([*env_py, "measure", "-", "1", "5"], input=EXAMPLE.read_text(), capture_output=True,
                       text=True, cwd=BACKEND, timeout=60)
    assert r.returncode == 0 and "stepsBetween" in json.loads(r.stdout)
    bad = write(tmp_path, {"sdExpr": "S +"})
    r = subprocess.run([*env_py, "evaluate", str(bad)], capture_output=True, text=True, cwd=BACKEND, timeout=60)
    assert r.returncode == 1 and r.stdout == "" and json.loads(r.stderr)["ok"] is False
    exe = Path(sys.executable).parent / ("calwizard.exe" if sys.platform == "win32" else "calwizard")
    assert exe.exists(), "console script `calwizard` is not installed (uv sync)"
    r = subprocess.run([str(exe), "parse", "2*c"], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and json.loads(r.stdout)["excel"] == "(2*A1)"
    r = subprocess.run([str(exe), "--help"], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and "evaluate" in r.stdout
