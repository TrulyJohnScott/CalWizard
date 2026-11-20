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
