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
- The GUI is organised as workspaces, one per job (spec §21: Curve, Separate, Limits, Read, Requirements, Present). A new
  capability gets a place in the workspace of the person who needs it, not a new control on every screen.
- Figures outside the Curve workspace are plain SVG (`frontend/src/charts/svg.tsx`) so they also print and export; the
  report (`components/Report.tsx`) uses only its own `rp-` classes.
- Keep tests lean: essential, independent truths only (closed forms, hand-computed values, parity, one wiring check per
  surface). No tests that restate the code.
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
| `calwizard limits SERIES [--alpha A --beta B --cv CV --reads N --low C... --no-profile]` | LoB / LoD / LoQ, precision profile; `data` = classical estimate from blank + low replicates (spec §15) |
| `calwizard plan SERIES [--n-blank N --n-low N --low C... --runs R --seed S --conf P]` | simulated LoB / LoD verification experiment: design and how widely the estimates scatter |
| `calwizard separate SERIES C1 C2 [--metric M --k K --n N --runs R --seed S]` | two concentrations in depth: cut-off, sensitivity, AUC, replicates needed, power (§16) |
| `calwizard requirements SERIES` | the series' requirements: met or not, measured value, SD factor needed (§17) |
| `calwizard read SERIES [S...] [--conf P] [-o file.xlsx]` | signals → concentrations with range, CV and flag; optional Excel sheet (§18) |
| `calwizard import FILE [--conc COL --signal COL --name N]` | reader export (CSV / TSV) → Series (§19) |
| `calwizard bake SERIES` | fold the what-if layer into the equations / table (§14) |
| `calwizard report SERIES` | the claim sheet: levels, limits, requirements, read-back in one object (§20) |
| `calwizard parse EXPR --var c\|S` | validate an expression, print its Excel form |
