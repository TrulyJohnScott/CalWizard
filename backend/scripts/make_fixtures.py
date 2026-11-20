"""Write spec/fixtures/model_vectors.json (version 2) for frontend parity tests.

Run from backend/:  uv run python scripts/make_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import analysis as A  # noqa: E402
from app import experiment as EX  # noqa: E402
from app import expr as E  # noqa: E402
from app import metrics as K  # noqa: E402
from app.main import clean  # noqa: E402
from app.series import Series, compile_series  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "spec" / "fixtures" / "model_vectors.json"

MEANS = {
    "linear": "50 + 3.5*c",
    "quadratic": "50 + 8*c - 0.003*c^2",
    "power": "50 + 12*c^0.8",
    "exponential": "50 + 40*(exp(0.004*c) - 1)",
    "log": "50 + 900*ln(1 + c/20)",
    "4pl": "4000 + (50 - 4000)/(1 + (c/40)^1.2)",
    "5pl": "4000 + (50 - 4000)/(1 + (c/40)^1.2)^0.8",
}
SDS = {
    "floor_cv": "sqrt(15^2 + (0.08*S)^2)",
    "constant": "20",
    "cv": "0.08*S",
    "power": "2 + 0.05*S^1.1",
}
LEVELS = [0, 1, 5, 25, 100, 500]
# (metric, k, significant digits): dsum/ssmd/zprime as the GUI Ladder button runs them (sig 4) plus one raw
LADDERS = [("dsum", 1, 4), ("ssmd", 3, 4), ("zprime", 0.5, 4), ("ssmd", 3, 0)]
MEASURE_PAIRS = [(0.02, 0.1), (0.3, 0.9)]  # fractions of cMax


def case(name: str, **kw) -> dict:
    series = Series.model_validate(kw)
    m = compile_series(series)
    grid = np.linspace(0, m.c_max, 31)
    mu = m.mean(grid)
    top = float(np.nanmax(mu))
    bot = float(np.nanmin(mu))
    signals = [float(m.mean(m.c_max * f)) for f in (0.05, 0.1, 0.3, 0.5, 0.8)] + [bot - 10, top + 10]
    inv = m.inverse(signals)
    ladders = [{"metric": met, "k": k, "sig": sig, "levels": A.ladder(m, met, k, sig=sig)}
               for met, k, sig in LADDERS]
    measure = []
    for f1, f2 in MEASURE_PAIRS:
        c1, c2 = m.c_max * f1, m.c_max * f2
        measure.append({**A.pair(m, c1, c2, series.metric, series.k_target), "metric": series.metric,
                        "k": series.k_target,
                        "stepsBetween": A.steps_between(m, c1, c2, series.metric, series.k_target)})
    rec_signals = signals[:5] + [float(m.mean(0.0)), bot - 10]
    return clean({
        "name": name,
        "recover": A.recover(m, rec_signals, 0.95),
        "series": series.model_dump(by_alias=True),
        "grid": grid, "mean": mu, "sd": m.sd(grid),
        "rows": K.level_rows(m),
        "inverse": {"signals": signals, "c": inv},
        "ladder": ladders,
        "measure": measure,
    })


def build_cases() -> list[dict]:
    cases = []
    sd_keys = list(SDS)
    for i, (mk, mexpr) in enumerate(MEANS.items()):
        sk = sd_keys[i % len(sd_keys)]
        metric = ["ssmd", "dsum", "zprime"][i % 3]
        cases.append(case(f"eq-{mk}-{sk}", mode="equations", meanExpr=mexpr, sdExpr=SDS[sk], levels=LEVELS,
                          cMax=500, metric=metric, kTarget=0.5 if metric == "zprime" else 3))
    for sk in sd_keys:  # every sd preset against the 4PL
        if sk != sd_keys[5 % len(sd_keys)]:
            cases.append(case(f"eq-4pl-{sk}", mode="equations", meanExpr=MEANS["4pl"], sdExpr=SDS[sk],
                              levels=LEVELS, cMax=500))
    cases.append(case("eq-falling", mode="equations", meanExpr="3000/(1 + c/50) + 100", sdExpr="0.05*S + 10",
                      levels=[0, 10, 50, 200, 800], cMax=800))
    cases.append(case("eq-levels-no-zero", mode="equations", meanExpr=MEANS["log"], sdExpr=SDS["cv"],
                      levels=[100, 10, 10, 1], cMax=200))
    cases.append(case("replicates-ragged", mode="replicates", metric="dsum", kTarget=1, replicates={
        "concs": [0, 1, 5, 25, 100],
        "cells": [[48.1, 52.0, 47.3, None], [55.0, 58.2, 53.9], [90.1, 101.3, 95.5, 99.0],
                  [402.0], [1200.0, 1250.5, 1180.2, 1233.0, None]]}))
    cases.append(case("summary", mode="summary", summary=[
        {"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": 16}, {"c": 25, "mean": 400, "sd": 30},
        {"c": 100, "mean": 1500, "sd": 90}, {"c": 500, "mean": 3500, "sd": 210}]))
    return cases


EXPR_CASES = [
    ("1 + 2*3", "c"), ("-2^2", "c"), ("2^3^2", "c"), ("2^-1", "c"), ("(1 + c)*c", "c"), ("10 - 4 - 3 + c", "c"),
    ("8/4/2*c", "c"), ("sqrt(c) + ln(1 + c) + log(1000) + log10(c + 1)", "c"),
    ("exp(-c/10) + abs(c - 5) + min(c, 3) + max(c, 3, 4)", "c"),
    ("4000 + (50 - 4000)/(1 + (c/40)^1.2)", "c"), (".5*c + 1.5e1 + 2E-1", "c"), ("pi*c", "c"),
    ("sqrt(15^2 + (0.08*S)^2)", "S"), ("0.08*s", "S"), ("1/c", "c"), ("sqrt(c - 3)", "c"),
    ("1 +", "c"), ("foo + 1", "c"), ("S + 1", "c"), ("c + 1", "S"), ("sqrt(1, 2)", "c"), ("(1 + 2", "c"),
    ("2 $ 3", "c"),
]
X = [0.0, 0.5, 1.0, 2.0, 10.0, 100.0]


def build_expr_cases() -> list[dict]:
    out = []
    for text, var in EXPR_CASES:
        try:
            node = E.parse(text, var)
        except E.ExprError as e:
            out.append({"expr": text, "variable": var, "ok": False, "error_pos": e.pos})
            continue
        out.append(clean({"expr": text, "variable": var, "ok": True,
                          "values": {"x": X, "y": E.evaluate(node, X)}, "excel": E.to_excel(node, "A1")}))
    return out


RULE_K = {"dsum": [-1, 0, 0.5, 1, 2, 3], "ssmd": [-1, 0, 1, 2, 3, 5], "zprime": [-2, 0, 0.3, 0.5, 0.9, 1, 1.5]}
RULE_ERRORS = [1e-9, 1e-4, 0.001, 0.0135, 0.05, 0.25, 0.49]


def build_rule_cases() -> list[dict]:
    """Pass rule in plain words (spec section 12): k -> error and error -> k for every metric."""
    out = [{"metric": m, "k": k, "error": A.rule_error(m, k)} for m, ks in RULE_K.items() for k in ks]
    out += [{"metric": m, "error": e, "k": A.k_for_error(m, e)} for m in RULE_K for e in RULE_ERRORS]
    return out


SIM_SUMMARY = {"mode": "summary", "summary": [
    {"c": 0, "mean": 50, "sd": 15}, {"c": 5, "mean": 95, "sd": 16}, {"c": 25, "mean": 400, "sd": 30},
    {"c": 100, "mean": 1500, "sd": 90}]}
SIM_REPLICATES = {"mode": "replicates", "metric": "dsum", "kTarget": 1, "replicates": {
    "concs": [0, 1, 5, 25], "cells": [[48.1, 52.0, 47.3, None], [55.0, 58.2, 53.9], [90.1, 101.3, 95.5, 99.0],
                                       [402.0]]}}
SIM_CASES = [
    ({}, {"n": 3, "runs": 5, "seed": 7}),
    (SIM_SUMMARY, {"n": [2, 3, 4, 5], "runs": 5, "seed": 42, "conf": 0.8}),
    (SIM_REPLICATES, {"measuredN": True, "runs": 5, "seed": 3}),
    ({}, {"n": 6, "runs": 4, "seed": 11, "metric": "dsum", "k": 1.5, "concs": [0, 5, 100, 500]}),
]


def build_sim_cases() -> list[dict]:
    """Simulated experiments (spec section 13): args use the API's camelCase names."""
    out = []
    for body, args in SIM_CASES:
        series = Series.model_validate(body)
        res = EX.simulate(compile_series(series), args.get("concs"), args.get("n", 4), args["runs"], args["seed"],
                          args.get("metric"), args.get("k"), args.get("conf", 0.9), args.get("measuredN", False))
        out.append(clean({"series": series.model_dump(by_alias=True), "args": args, "result": res}))
    return out


def build_payload() -> dict:
    return {"version": 2, "cases": build_cases(), "exprCases": build_expr_cases(), "ruleCases": build_rule_cases(),
            "simulate": build_sim_cases()}


def main() -> None:
    payload = build_payload()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1, allow_nan=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}: {len(payload['cases'])} cases, {len(payload['exprCases'])} exprCases")


if __name__ == "__main__":
    main()
