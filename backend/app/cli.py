"""`calwizard` command line: every backend capability headless, JSON in / JSON out.

Each subcommand takes a Series JSON file path (or `-` for stdin) where it needs a series (the file may be a bare
Series or `{"series": {...}}`) and prints JSON to stdout. Errors are JSON on stderr with a non-zero exit code:
1 = the model/expression is invalid, 2 = bad input (usage, unreadable file, invalid JSON/schema, no data).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import ValidationError

from . import analysis as A
from . import export as X
from . import expr as E
from . import experiment as EX
from . import fit as F
from . import importer as IM
from . import limits as L
from . import metrics as K
from . import readback as RB
from . import report as RP
from . import requirements as R
from .jsonutil import clean
from .series import Sample, Series, bake, compile_series


class CliError(Exception):
    def __init__(self, message: str, code: int = 2, **extra: Any):
        super().__init__(message)
        self.payload = {"ok": False, "error": message, **extra}
        self.code = code


def _read_json(path: str) -> Any:
    try:
        text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    except OSError as e:
        raise CliError(f"cannot read {path!r}: {e.strerror or e}") from e
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise CliError(f"invalid JSON in {path!r}: {e}") from e


def _validate(data: Any) -> Series:
    if isinstance(data, dict) and isinstance(data.get("series"), dict):
        data = data["series"]
    try:
        return Series.model_validate(data)
    except ValidationError as e:
        raise CliError("invalid series", errors=json.loads(e.json())) from e


def _load_series(path: str) -> Series:
    return _validate(_read_json(path))


def _compile(series: Series):
    try:
        return compile_series(series)
    except E.ExprError as e:
        raise CliError(e.message, code=1, pos=e.pos) from e


def _out(payload: Any) -> None:
    sys.stdout.write(json.dumps(clean(payload), allow_nan=False) + "\n")


def _metric_k(args, series: Series) -> tuple[str, float]:
    return args.metric or series.metric, series.k_target if args.k is None else args.k


# ---------------------------------------------------------------- commands
def cmd_evaluate(args) -> None:
    m = _compile(_load_series(args.series))
    grid = np.array(args.grid, dtype=float) if args.grid else m.grid()
    _out({"grid": grid, "mean": m.mean(grid), "sd": m.sd(grid), "rows": K.level_rows(m), "levels": m.levels,
          **A.overview(m)})


def cmd_ladder(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    metric, k = _metric_k(args, s)
    levels = A.ladder(m, metric, k, args.start, args.stop, args.sig)
    _out({"levels": levels, "n": len(levels)})


def cmd_measure(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    metric, k = _metric_k(args, s)
    try:
        _out(A.measure_points(m, args.concs, metric, k))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_recover(args) -> None:
    m = _compile(_load_series(args.series))
    try:
        _out({"rows": A.recover(m, args.signals, args.conf)})
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_budget(args) -> None:
    from . import layers as LY

    m = _compile(_load_series(args.series))
    _out({"rows": LY.budget(m, args.c), "cumulative": LY.cumulative(m)})


def cmd_tolerance(args) -> None:
    from . import layers as LY
    m = _compile(_load_series(args.series))
    try:
        _out(LY.tolerance(m, args.c, args.k, args.tea))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_compare(args) -> None:
    from . import conditions as CD
    models = [_compile(_load_series(p)) for p in args.series]
    try:
        _out(CD.compare(models, args.c))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_design(args) -> None:
    from . import layers as LY

    m = _compile(_load_series(args.series))
    try:
        _out(LY.simulate_design(m, args.concs, args.n, args.runs, args.seed, args.metric, args.k, args.alpha))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_dialin(args) -> None:
    from . import layers as LY

    m = _compile(_load_series(args.series))
    try:
        text = Path(args.data).read_text(encoding="utf-8")
    except OSError as e:
        raise CliError(f"cannot read {args.data!r}: {e.strerror or e}") from e
    try:
        _out(LY.dial_in(m, LY.read_csv_rows(text)))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_rule(args) -> None:
    try:
        _out(A.rule(args.metric, args.k, args.error))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_inverse(args) -> None:
    m = _compile(_load_series(args.series))
    _out({"signals": args.signals, "c": m.inverse(args.signals)})


def _fit_body(data: Any) -> dict:
    """Accept {points|summary} directly, or a Series (its replicates/summary table is fitted)."""
    if not isinstance(data, dict):
        raise CliError("fit input must be a JSON object with 'points' or 'summary' (or a Series)")
    if "points" in data or "series" in data or "mode" in data:
        if "points" in data:
            return data
        s = _validate(data)
        if s.mode == "replicates":
            pts = [{"c": c, "y": y} for c, col in zip(s.replicates.concs, s.replicates.cells) for y in col
                   if y is not None]
            return {"points": pts}
        if s.mode == "summary":
            return {"summary": [r.model_dump() for r in s.summary]}
        raise CliError("series is in equations mode: nothing to fit; give a replicates/summary series or points")
    return data


def cmd_fit(args) -> None:
    _out(F.run_fit(_fit_body(_read_json(args.input))))


def cmd_export(args) -> None:
    s = _load_series(args.series)
    _compile(s)
    data = X.export_bytes(s)
    path = Path(args.output)
    try:
        path.write_bytes(data)
    except OSError as e:
        raise CliError(f"cannot write {args.output!r}: {e.strerror or e}") from e
    _out({"ok": True, "path": str(path), "bytes": len(data)})


def cmd_simulate(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    n = args.n_per if args.n_per else args.n
    try:
        _out(EX.simulate(m, args.concs, n, args.runs, args.seed, args.metric, args.k, args.conf, args.measured_n, args.alpha))
    except ValueError as e:
        raise CliError(str(e)) from e


def _lim(args, s: Series) -> dict:
    lim = s.limits
    return {"alpha": lim.alpha if args.alpha is None else args.alpha, "beta": lim.beta if args.beta is None else args.beta}


def cmd_limits(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    ab = _lim(args, s)
    try:
        out = L.limits(m, ab["alpha"], ab["beta"], s.limits.cv if args.cv is None else args.cv,
                       s.limits.reads if args.reads is None else args.reads, profile=not args.no_profile)
        out["data"] = L.limits_data(m, ab["alpha"], ab["beta"], args.low)
    except ValueError as e:
        raise CliError(str(e)) from e
    _out(out)


def cmd_plan(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    ab = _lim(args, s)
    try:
        _out(L.plan(m, args.n_blank, args.n_low, args.low, args.runs, args.seed, ab["alpha"], ab["beta"], args.conf,
                    s.limits.cv if args.cv is None else args.cv))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_separate(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    metric, k = _metric_k(args, s)
    try:
        _out(A.separate(m, args.c1, args.c2, metric, k, args.n, args.runs, args.seed, args.conf, args.alpha))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_requirements(args) -> None:
    _out(R.check(_compile(_load_series(args.series))))


def cmd_read(args) -> None:
    s = _load_series(args.series)
    m = _compile(s)
    samples = [Sample(id=str(i + 1), signal=v) for i, v in enumerate(args.signals)] if args.signals else None
    try:
        if args.output:
            data = RB.workbook_bytes(m, samples, args.conf)
            try:
                Path(args.output).write_bytes(data)
            except OSError as e:
                raise CliError(f"cannot write {args.output!r}: {e.strerror or e}") from e
            _out({"ok": True, "path": str(Path(args.output)), "bytes": len(data)})
        else:
            _out(RB.readback(m, samples, args.conf))
    except ValueError as e:
        raise CliError(str(e)) from e


def cmd_import(args) -> None:
    try:
        text = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8-sig")
    except OSError as e:
        raise CliError(f"cannot read {args.input!r}: {e.strerror or e}") from e

    def col(v):
        return int(v) if v is not None and v.lstrip("-").isdigit() else v

    parsed = IM.parse_reader(text, col(args.conc), col(args.signal))
    if parsed is None:
        raise CliError("not a reader table: need a header row, a concentration column and a signal column "
                       "(choose them with --conc / --signal)")
    base = {"name": args.name or (Path(args.input).stem if args.input != "-" else "Imported")}
    series = _validate(IM.to_series(parsed, base))
    _out({"series": series.model_dump(by_alias=True), "columns": parsed["columns"], "concCol": parsed["concCol"],
          "signalCols": parsed["signalCols"], "rows": parsed["rows"]})


def cmd_bake(args) -> None:
    s = _load_series(args.series)
    _compile(s)
    _out(bake(s).model_dump(by_alias=True))


def cmd_report(args) -> None:
    _out(RP.report(_compile(_load_series(args.series))))


def cmd_parse(args) -> None:
    try:
        node = E.parse(args.expr, args.var)
    except E.ExprError as e:
        raise CliError(e.message, code=1, pos=e.pos) from e
    _out({"ok": True, "excel": E.to_excel(node, "A1")})


class _Parser(argparse.ArgumentParser):
    """argparse that reports usage errors as a CliError (JSON on stderr, exit 2) instead of plain text."""

    def error(self, message: str):
        raise CliError(message, usage=self.format_usage().strip())


def build_parser() -> argparse.ArgumentParser:
    p = _Parser(
        prog="calwizard",
        description="Cal Wizard headless CLI: JSON in, JSON out. SERIES is a file path or '-' (stdin).",
        epilog="exit codes: 0 ok, 1 invalid expression/model, 2 bad input. Errors are JSON on stderr.")
    sub = p.add_subparsers(dest="command", required=True, metavar="COMMAND")

    def add(name: str, fn, help_: str, series: bool = True) -> argparse.ArgumentParser:
        sp = sub.add_parser(name, help=help_, description=help_)
        sp.set_defaults(fn=fn)
        if series:
            sp.add_argument("series", metavar="SERIES", help="Series JSON file, or - for stdin")
        return sp

    def metric_opts(sp):
        sp.add_argument("--metric", choices=list(A.METRICS), help="default: the series' metric")
        sp.add_argument("--k", type=float, help="target; default: the series' kTarget")

    sp = add("evaluate", cmd_evaluate, "mean(c), sd(c), adjacent-level rows and levels (like POST /api/evaluate)")
    sp.add_argument("--grid", type=float, nargs="+", metavar="C", help="concentrations (default: 501-point grid)")
    sp = add("ladder", cmd_ladder, "next-separable-concentration ladder: {levels, n}")
    metric_opts(sp)
    sp.add_argument("--start", type=float, default=0.0)
    sp.add_argument("--stop", type=float, help="default: cMax")
    sp.add_argument("--sig", type=int, default=A.DEFAULT_SIG, help="round levels up to N significant digits; 0 = off")
    sp = add("measure", cmd_measure, "separation between concentrations (2 or more): first pair as given, plus every adjacent pair")
    sp.add_argument("concs", type=float, nargs="+", metavar="C", help="two or more concentrations (anchors)")
    metric_opts(sp)
    sp = add("recover", cmd_recover, "read back concentration from signal, with the range consistent with it")
    sp.add_argument("signals", type=float, nargs="+", metavar="S")
    sp.add_argument("--conf", type=float, default=0.95, help="coverage of the range (default 0.95)")
    sp = add("budget", cmd_budget, "variance budget per concentration and cumulative resolvable levels by layer (spec 22)")
    sp.add_argument("--c", type=float, nargs="+", metavar="C", help="concentrations (default: the levels)")
    sp = add("tolerance", cmd_tolerance, "error budget per concentration: bias + k SD of every source, as a tolerance stack (spec 24)")
    sp.add_argument("-c", type=float, nargs="+", metavar="C", help="concentrations (default: the levels)")
    sp.add_argument("--k", type=float, help="coverage factor on the spread (default: the series', 2)")
    sp.add_argument("--tea", type=float, help="allowed total error as a fraction of c (default: the series', 0.3)")
    sp = add("compare", cmd_compare, "conditions: several series against the first (bias per level, claims, spread as a layer; spec 23)", False)
    sp.add_argument("series", nargs="+", metavar="SERIES", help="two or more Series JSON files; the first is the reference")
    sp.add_argument("-c", type=float, nargs="+", metavar="C", help="concentrations (default: the reference's levels)")
    sp = add("design", cmd_design, "experiments drawing actual lots/readers/days: separation, power, component precision (spec 22.3)")
    sp.add_argument("--concs", type=float, nargs="+", metavar="C")
    sp.add_argument("--n", type=int, default=2, help="replicates per unit combination (default 2)")
    sp.add_argument("--runs", type=int, default=200)
    sp.add_argument("--seed", type=int, default=1)
    sp.add_argument("--alpha", type=float, default=0.05)
    metric_opts(sp)
    sp = add("dialin", cmd_dialin, "measured layer sizes from real data CSV (c,<layer names>,y) vs predicted (spec 22.4)")
    sp.add_argument("data", metavar="DATA.csv")
    sp = add("rule", cmd_rule, "pass rule in plain words: {metric, k, error, text} from --k or --error", False)
    sp.add_argument("--metric", choices=list(A.METRICS), default="ssmd")
    g = sp.add_mutually_exclusive_group(required=True)
    g.add_argument("--k", type=float, help="target value of the metric")
    g.add_argument("--error", type=float, help="allowed misclassification rate, 0 < error < 0.5")
    sp = add("inverse", cmd_inverse, "concentration for each signal (null when out of range)")
    sp.add_argument("signals", type=float, nargs="+", metavar="S")
    sp = add("fit", cmd_fit, "fit mean/sd models to {points|summary} JSON (or a replicates/summary Series)", False)
    sp.add_argument("input", metavar="INPUT", help="JSON file, or - for stdin")
    sp = add("export", cmd_export, "write the Excel workbook")
    sp.add_argument("-o", "--output", required=True, metavar="FILE.xlsx")
    sp = add("simulate", cmd_simulate, "simulated experiments: n readings per concentration, over many runs (spec 13)")
    sp.add_argument("--concs", type=float, nargs="+", metavar="C", help="default: the model levels")
    g = sp.add_mutually_exclusive_group()
    g.add_argument("--n", type=int, default=4, help="readings per concentration (default 4)")
    g.add_argument("--n-per", type=int, nargs="+", metavar="N", help="one n per concentration")
    sp.add_argument("--runs", type=int, default=200)
    sp.add_argument("--seed", type=int, default=1)
    sp.add_argument("--conf", type=float, default=0.9, help="range coverage (default 0.9)")
    sp.add_argument("--measured-n", action="store_true", help="replicates tables: n = readings per column")
    sp.add_argument("--alpha", type=float, default=0.05, help="significance level for the Welch t-test power (default 0.05)")
    metric_opts(sp)
    sp = add("limits", cmd_limits, "LoB / LoD / LoQ and the precision profile (spec 15); data = the classical "
                                   "estimate from blank and low-level replicates when the table has them")
    sp.add_argument("--alpha", type=float, help="false-positive rate for the LoB (default: the series', 0.05)")
    sp.add_argument("--beta", type=float, help="false-negative rate for the LoD (default: the series', 0.05)")
    sp.add_argument("--cv", type=float, help="concentration CV allowed at the LoQ, as a fraction (default 0.2)")
    sp.add_argument("--reads", type=int, help="readings averaged per result (default 1)")
    sp.add_argument("--low", type=float, nargs="+", metavar="C", help="low-level columns for the classical estimate")
    sp.add_argument("--no-profile", action="store_true", help="omit the 201-point precision profile")
    sp = add("plan", cmd_plan, "simulate the LoB / LoD verification experiment: design, and how widely the estimates scatter")
    sp.add_argument("--n-blank", type=int, default=20, help="blank readings (default 20)")
    sp.add_argument("--n-low", type=int, default=20, help="readings at each low concentration (default 20)")
    sp.add_argument("--low", type=float, nargs="+", metavar="C", help="low concentrations (default: LoD and 2 x LoD)")
    sp.add_argument("--runs", type=int, default=500)
    sp.add_argument("--seed", type=int, default=1)
    sp.add_argument("--conf", type=float, default=0.9, help="range coverage (default 0.9)")
    sp.add_argument("--alpha", type=float)
    sp.add_argument("--beta", type=float)
    sp.add_argument("--cv", type=float, help="CV allowed at the LoQ (default: the series', 0.2); a LoQ sample is added")
    sp = add("separate", cmd_separate, "two concentrations in depth: metrics, threshold, sensitivity, AUC, replicates needed, power")
    sp.add_argument("c1", type=float, metavar="C1")
    sp.add_argument("c2", type=float, metavar="C2")
    metric_opts(sp)
    sp.add_argument("--n", type=int, default=3, help="readings per concentration for the power estimate (default 3)")
    sp.add_argument("--runs", type=int, default=1000)
    sp.add_argument("--seed", type=int, default=1)
    sp.add_argument("--conf", type=float, default=0.95, help="coverage of the read-back ranges (default 0.95)")
    sp.add_argument("--alpha", type=float, default=0.05)
    add("requirements", cmd_requirements, "check the series' requirements: met or not, measured value, SD factor needed")
    sp = add("read", cmd_read, "read signals back to concentrations (the series' samples, or the signals given)")
    sp.add_argument("signals", type=float, nargs="*", metavar="S")
    sp.add_argument("--conf", type=float, default=0.95)
    sp.add_argument("-o", "--output", metavar="FILE.xlsx", help="write the sheet as an Excel workbook")
    sp = add("import", cmd_import, "turn a reader export (CSV / TSV text) into a Series", False)
    sp.add_argument("input", metavar="FILE", help="delimited text file, or - for stdin")
    sp.add_argument("--conc", help="concentration column (header name or 0-based index)")
    sp.add_argument("--signal", help="signal column (header name or 0-based index)")
    sp.add_argument("--name", help="series name (default: the file name)")
    add("bake", cmd_bake, "fold the what-if layer into the equations / table: the same curve as a plain Series")
    add("report", cmd_report, "the claim sheet: levels, limits, requirements and read-back in one JSON object")
    sp = add("parse", cmd_parse, "check an expression and print its Excel form", False)
    sp.add_argument("expr", metavar="EXPR")
    sp.add_argument("--var", choices=["c", "S"], default="c", help="the variable the expression may use")
    return p


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        args.fn(args)
    except CliError as e:
        sys.stderr.write(json.dumps(clean(e.payload)) + "\n")
        return e.code
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
