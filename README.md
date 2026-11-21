# Cal Wizard

Lateral flow assay resolution simulator: model test-line **signal S(c)** and **SD(c)** as continuous
functions of concentration, see how well neighbouring levels separate (Δμ/Σσ, SSMD, Z′, overlap,
misclassification), simulate and fit replicates, and export to Excel with live forward/reverse formulas.

The contract for the math and API lives in [spec/SPEC.md](spec/SPEC.md).

## Run

Backend (FastAPI, port 8000):

```powershell
cd backend; uv run uvicorn app.main:app --reload --port 8000
```

Frontend (Vite + React + Plotly, port 5173, proxies `/api` to 8000):

```powershell
cd frontend; npm install; npm run dev
```

Open http://localhost:5173.

## Test

```powershell
cd backend; uv run pytest -q
```

```powershell
cd backend; uv run python scripts/make_fixtures.py
```

```powershell
cd frontend; npx vitest run
```

`make_fixtures.py` regenerates `spec/fixtures/model_vectors.json`; the frontend parity test checks the
TypeScript math against it. Any change to the math must keep both sides in step.

## Layout

- `backend/app/` — models, metrics, fit, simulate, Excel export, API
- `frontend/src/math/` — TypeScript port of the math (runs live in the browser)
- `frontend/src/charts/` — Plotly chart builders (pure functions of a Series)
- `frontend/src/components/` — UI panels; `frontend/src/state/store.ts` — zustand store

## Workspaces

One screen per job, so nobody looks at controls they do not need:

| Key | Workspace | Question it answers |
|---|---|---|
| 1 | Curve | What does the curve look like, and how many levels can it resolve? |
| 2 | Separate | Can the assay tell these two concentrations apart, and what would it take? |
| 3 | Limits | What are LoB, LoD and LoQ, and how many strips confirm them? |
| 4 | Read | What concentration is this signal? (a sheet; exports to Excel) |
| 5 | Variability | What do lots, readers and days cost, and what did the study measure? |
| P | Present | The report, full-screen: print it, save it as one HTML file, or copy a link |

`W` toggles **What if**: move the background, the top, the midpoint or the noise (type, or drag the diamonds on the
curve) and every claim follows. Click **Cal Wizard** for the example gallery, or paste / drop reader data anywhere.
Everything is also available headless: see the CLI table in [AGENTS.md](AGENTS.md) and the contract in
[spec/SPEC.md](spec/SPEC.md).
