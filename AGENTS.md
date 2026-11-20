# Cal Wizard — agent instructions

Lateral flow assay resolution simulator. Contract: [spec/SPEC.md](spec/SPEC.md). Human overview: [README.md](README.md).

## Guiding principle

**CLI/dev-first in mind, GUI-first in heart, agentic engineering a first-class citizen.**

- **CLI in mind:** every capability must be reachable headless — core logic in `backend/app/` as pure
  functions of a Series, exposed by a CLI and the HTTP API with JSON in/out. The GUI is a client;
  no feature may live only in the browser.
- **GUI in heart:** the interface is what people love. Compact, fluid, progressive disclosure, no
  clutter. Defaults just work; power is revealed on demand.
- **Agentic first-class:** an agent must be able to build, run, test and verify everything from
  commands in this file, with no human clicking. Keep the spec current, tests deterministic, and
  the TypeScript math in parity with Python via `spec/fixtures/model_vectors.json`.

## Commands

| Task | Command (from repo root) |
|---|---|
| Backend tests, essential (fast, coverage ≥ 95%) | `cd backend; uv run pytest -q` |
| Backend tests, everything (+ black-box oracle, properties, Excel recalculation, subprocess CLI) | `cd backend; uv run pytest -q -m ""` |
| Regenerate parity fixtures | `cd backend; uv run python scripts/make_fixtures.py` |
| Frontend typecheck | `cd frontend; npx tsc --noEmit` |
| Frontend tests (incl. parity) | `cd frontend; npx vitest run` |
| Frontend build | `cd frontend; npm run build` |
| Run API (port 8000) | `cd backend; uv run uvicorn app.main:app --reload --port 8000` |
| Run web (port 5173) | `cd frontend; npm run dev` |

Python: always `uv` (`uv add`, `uv run`), never bare `python`/`pip`.

## Rules

- Change the math in **both** `backend/app/` and `frontend/src/math/`, regenerate fixtures, and keep
  the parity test green.
- Update `spec/SPEC.md` in the same change as any behaviour change.
- Ladder, measure and closeness exist in both languages (`backend/app/analysis.py`, `frontend/src/math/`),
  parity-tested through the fixtures. New capabilities must be added to the CLI as well as the API.
- Backend pytest treats warnings as errors. The default run is the essential suite (independent truths only: closed
  forms, known values, bug regressions, parity, one wiring check per CLI/API surface; no tests that restate the code).
  Slow exhaustive checks are marked `deep` and run with `-m ""`; hypothesis property tests are deterministic.

## CLI (`uv run calwizard ...`, from `backend/`)

SERIES = Series JSON file path or `-` (stdin); try `examples/example.json`. Output: JSON on stdout. Errors:
JSON on stderr, exit 1 (invalid expression/model) or 2 (bad input).

| Command | Purpose |
|---|---|
| `calwizard evaluate SERIES [--grid C...]` | mean, sd, adjacent-level rows, levels, `resolvable` headline, `rule` |
| `calwizard ladder SERIES [--metric M --k K --start C --stop C --sig N]` | `{levels, n}` |
| `calwizard measure SERIES C1 C2 [--metric M --k K]` | §5 row + `stepsBetween` + `whyNot` (what would make it pass) |
| `calwizard rule [--metric M] (--k K or --error E)` | pass rule in plain words: `{metric, k, error, text}` |
| `calwizard inverse SERIES S...` | concentration per signal (null if out of range) |
| `calwizard recover SERIES S... [--conf 0.95]` | read-back c with its range `{signal, c, lo, hi, loOpen, hiOpen}` |
| `calwizard fit INPUT` | ranked mean/sd fits from `{points}`/`{summary}` JSON or a table Series |
| `calwizard simulate SERIES [--concs C...] [--n N \| --n-per N...] [--runs R] [--seed S] [--metric M --k K --conf P] [--measured-n]` | simulated experiments (spec §13): per-run readings, ranges, `pPass`, `pAllPass` |
| `calwizard export SERIES -o file.xlsx` | Excel workbook |
| `calwizard parse EXPR --var c\|S` | validate an expression, print its Excel form |
