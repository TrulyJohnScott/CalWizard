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
| `calwizard measure SERIES C1 C2 [C3 ...] [--metric M --k K]` | §5 row + `stepsBetween` + `whyNot` (what would make it pass) |
| `calwizard rule [--metric M] (--k K or --error E)` | pass rule in plain words: `{metric, k, error, text}` |
| `calwizard inverse SERIES S...` | concentration per signal (null if out of range) |
| `calwizard recover SERIES S... [--conf 0.95]` | read-back c with its range `{signal, c, lo, hi, loOpen, hiOpen}` |
| `calwizard fit INPUT` | ranked mean/sd fits from `{points}`/`{summary}` JSON or a table Series |
| `calwizard simulate SERIES [--concs C...] [--n N \| --n-per N...] [--runs R] [--seed S] [--metric M --k K --conf P] [--measured-n]` | simulated experiments (spec §13): per-run readings, ranges, `pPass`, `pAllPass` |
| `calwizard export SERIES -o file.xlsx` | Excel workbook |
| `calwizard parse EXPR --var c\|S` | validate an expression, print its Excel form |

# Worktree Charter — `variability-layers` (../calwizard-layers)

**Purpose.** Let assay developers reason about *layered* variability — lots with slightly different performance,
readers with bias / variability, days, runs — and how each source eats the ability to resolve concentrations:
predict it, plan an experiment for it, then dial in real numbers after the experiment.

**Scope.**
1. *Predict:* `layers` on a Series (offset SD, proportional CV, gain CV = lot/reader performance, noise CV, units, on/off);
   effective SD used everywhere; a variance **budget** per concentration; cumulative "within-run → + day → + reader →
   + lot" resolvable-level counts; aggregate / disaggregate by switching layers.
2. *Plan:* design-aware experiments that draw actual units (e.g. 3 lots × 4 readers × 3 days × n) — separation,
   significance, and how precisely each source would be estimated.
3. *Dial in:* paste real nested results (lot, reader, day, conc, reading) → estimated size of each source (variance
   components) → predicted vs measured side by side → adopt measured.
Every capability headless first (Python + `calwizard` CLI + API), mirrored in the browser with parity fixtures.
Not in scope here: the what-if adjustment and detection limits being built in the main folder by another session.

**Done when.** All three steps work in the app with a clear story flow (beautiful, uncluttered, intuitive), every
step is reachable from the CLI/API, spec §16 documents it, the essential test suites pass (backend coverage ≥ 95%,
frontend all green, parity green), and the branch is committed ready to merge into `master` after the other
session's work lands. Spec numbering: this branch uses **§16** (§14/§15 are taken by the other session).
