"""Seeded-bug (mutation) check: do the tests notice when the code is wrong?

Copies backend/ + spec/ to a scratch directory, then plants small bugs in app/*.py one at a time
(flipped comparisons, swapped + / -, * / /, and / or, off-by-one constants) and runs the test suite
against each. A planted bug the tests do not catch is a "survivor" and is printed for review.

    uv run python scripts/mutation_check.py --n 40 --seed 1 --out result.json
    uv run python scripts/mutation_check.py --replay result.json      # re-plant that run's survivors

The live backend/ is never modified (the dev server may be watching it).
"""
from __future__ import annotations

import argparse
import ast
import json
import random
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
SKIP_FILES = {"__init__.py"}

CMP = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Eq: ast.NotEq, ast.NotEq: ast.Eq}
BIN = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Div, ast.Div: ast.Mult}
BOOL = {ast.And: ast.Or, ast.Or: ast.And}


class Mutator(ast.NodeTransformer):
    """Visits mutation sites in a fixed order; mutates the one whose index == target."""

    def __init__(self, target: int | None = None):
        self.target, self.i, self.sites, self.done = target, 0, [], None

    def _site(self, node: ast.AST, label: str) -> bool:
        hit = self.i == self.target
        self.sites.append((getattr(node, "lineno", 0), label))
        self.i += 1
        if hit:
            self.done = (getattr(node, "lineno", 0), label)
        return hit

    def visit_Compare(self, node: ast.Compare):
        self.generic_visit(node)
        for k, op in enumerate(node.ops):
            new = CMP.get(type(op))
            if new and self._site(node, f"{type(op).__name__} -> {new.__name__}"):
                node.ops[k] = new()
        return node

    def visit_BinOp(self, node: ast.BinOp):
        self.generic_visit(node)
        new = BIN.get(type(node.op))
        # skip string building / list concat: only mutate when neither side is a str/f-string/list literal
        texty = (ast.JoinedStr, ast.List, ast.Tuple)
        is_text = any(isinstance(s, texty) or (isinstance(s, ast.Constant) and isinstance(s.value, str))
                      for s in (node.left, node.right))
        if new and not is_text and self._site(node, f"{type(node.op).__name__} -> {new.__name__}"):
            node.op = new()
        return node

    def visit_BoolOp(self, node: ast.BoolOp):
        self.generic_visit(node)
        new = BOOL[type(node.op)]
        if self._site(node, f"{type(node.op).__name__} -> {new.__name__}"):
            node.op = new()
        return node

    def visit_Constant(self, node: ast.Constant):
        v = node.value
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return node
        if self._site(node, f"const {v!r} -> {v + 1!r}"):
            return ast.copy_location(ast.Constant(v + 1), node)
        return node

    # never mutate annotations or docstring-ish expression statements
    def visit_AnnAssign(self, node: ast.AnnAssign):
        if node.value is not None:
            node.value = self.visit(node.value)
        return node

    def visit_arguments(self, node: ast.arguments):
        node.defaults = [self.visit(d) for d in node.defaults]
        node.kw_defaults = [self.visit(d) if d is not None else None for d in node.kw_defaults]
        return node


def sites_of(path: Path) -> list[tuple[int, str]]:
    m = Mutator()
    m.visit(ast.parse(path.read_text(encoding="utf-8")))
    return m.sites


def mutate(path: Path, index: int) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    m = Mutator(index)
    tree = m.visit(tree)
    ast.fix_missing_locations(tree)
    return ast.unparse(tree) + "\n"


def run_tests(work: Path, python: str, timeout: int, tests: list[str] | None = None) -> tuple[bool, float, str]:
    """True if the suite PASSES. -x: stop at the first failure (a caught bug is caught fast)."""
    t0 = time.time()
    cmd = [python, "-m", "pytest", "-x", "-q", "--no-cov", "-p", "no:cacheprovider", *(tests or ["tests"])]
    try:
        r = subprocess.run(cmd, cwd=work, capture_output=True, text=True, timeout=timeout)
        tail = (r.stdout.strip().splitlines() or [""])[-1]
        return r.returncode == 0, time.time() - t0, tail
    except subprocess.TimeoutExpired:
        return False, time.time() - t0, "timeout (counted as caught)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--out", default="")
    ap.add_argument("--files", nargs="*", default=None, help="limit to these app/ file names")
    ap.add_argument("--tests", nargs="*", default=None, help="pytest targets (default: the whole suite)")
    ap.add_argument("--replay", default="", help="a previous --out file: re-plant its survivors instead of sampling")
    a = ap.parse_args()

    scratch = Path(tempfile.mkdtemp(prefix="calwizard-mut-"))
    work = scratch / "backend"
    ignore = shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache", "*.xlsx", ".coverage", "htmlcov")
    shutil.copytree(BACKEND, work, ignore=ignore)
    shutil.copytree(REPO / "spec", scratch / "spec")
    python = sys.executable
    print(f"scratch copy: {work}", flush=True)

    ok, secs, tail = run_tests(work, python, a.timeout, a.tests)
    print(f"baseline (no bug planted): {'PASS' if ok else 'FAIL'} in {secs:.0f}s — {tail}", flush=True)
    if not ok:
        print("Baseline must pass before planting bugs.")
        return 2

    files = sorted(p for p in (work / "app").glob("*.py") if p.name not in SKIP_FILES and (not a.files or p.name in a.files))
    all_sites = [(p, i, line, label) for p in files for i, (line, label) in enumerate(sites_of(p))]
    if a.replay:
        want = {(r["file"], r["line"], r["mutation"]) for r in json.loads(Path(a.replay).read_text(encoding="utf-8"))["results"]
                if r["status"] == "SURVIVED"}
        chosen = [s for s in all_sites if (s[0].name, s[2], s[3]) in want]
    else:
        chosen = random.Random(a.seed).sample(all_sites, min(a.n, len(all_sites)))
    print(f"{len(all_sites)} possible planted bugs across {len(files)} files; testing {len(chosen)}", flush=True)

    results = []
    for k, (path, idx, line, label) in enumerate(chosen, 1):
        original = path.read_text(encoding="utf-8")
        try:
            path.write_text(mutate(path, idx), encoding="utf-8")
            passed, secs, tail = run_tests(work, python, a.timeout, a.tests)
        finally:
            path.write_text(original, encoding="utf-8")
        src_line = original.splitlines()[line - 1].strip() if line else ""
        status = "SURVIVED" if passed else "caught"
        results.append({"file": path.name, "line": line, "mutation": label, "source": src_line, "status": status, "seconds": round(secs, 1), "tail": tail})
        print(f"[{k}/{len(chosen)}] {status:8} {path.name}:{line} {label}   | {src_line[:90]}", flush=True)

    survived = [r for r in results if r["status"] == "SURVIVED"]
    summary = {"tested": len(results), "caught": len(results) - len(survived), "survived": len(survived), "possible_sites": len(all_sites), "seed": a.seed, "results": results}
    if a.out:
        Path(a.out).write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\ncaught {summary['caught']}/{summary['tested']} planted bugs; {len(survived)} survived")
    for r in survived:
        print(f"  SURVIVED {r['file']}:{r['line']} {r['mutation']}  | {r['source']}")
    shutil.rmtree(scratch, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
