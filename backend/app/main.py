"""FastAPI app: routes under /api; NaN/inf serialised as null."""
from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

import numpy as np
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import analysis as A
from . import export as X
from . import expr as E
from . import experiment as EX
from . import fit as F
from . import metrics as K
from .jsonutil import clean
from .series import Camel, Series, compile_series

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def ok(payload: Any) -> JSONResponse:
    return JSONResponse(clean(payload))


class ParseRequest(BaseModel):
    expr: str
    variable: str = "c"


class SeriesRequest(Camel):
    series: Series


class EvaluateRequest(SeriesRequest):
    grid: list[float] | None = None


def _compile(series: Series):
    try:
        return compile_series(series)
    except E.ExprError as e:
        raise HTTPException(422, detail={"error": e.message, "pos": e.pos})
    except (ValueError, ArithmeticError) as e:  # e.g. table values too extreme to interpolate
        raise HTTPException(422, detail={"error": f"cannot build a model from these values: {e}", "pos": None})


router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"ok": True}


@router.post("/parse")
def parse(req: ParseRequest):
    try:
        node = E.parse(req.expr, "S" if req.variable.lower() == "s" else "c")
    except E.ExprError as e:
        return {"ok": False, "error": e.message, "pos": e.pos}
    return {"ok": True, "excel": E.to_excel(node, "A1")}


@router.post("/evaluate")
def evaluate(req: EvaluateRequest):
    m = _compile(req.series)
    grid = np.array(req.grid, dtype=float) if req.grid is not None else m.grid()
    return ok({"grid": grid, "mean": m.mean(grid), "sd": m.sd(grid), "rows": K.level_rows(m),
               "levels": m.levels, **A.overview(m)})


class LadderRequest(SeriesRequest):
    metric: Literal["dsum", "ssmd", "zprime"] | None = None
    k: float | None = None
    start: float = 0.0
    stop: float | None = None
    sig: int = A.DEFAULT_SIG


class MeasureRequest(SeriesRequest):
    c1: float | None = None
    c2: float | None = None
    concs: list[float] | None = None
    metric: Literal["dsum", "ssmd", "zprime"] | None = None
    k: float | None = None


@router.post("/ladder")
def ladder(req: LadderRequest):
    m = _compile(req.series)
    levels = A.ladder(m, req.metric or req.series.metric, req.series.k_target if req.k is None else req.k,
                      req.start, req.stop, req.sig)
    return ok({"levels": levels, "n": len(levels)})


@router.post("/measure")
def measure(req: MeasureRequest):
    m = _compile(req.series)
    metric = req.metric or req.series.metric
    k = req.series.k_target if req.k is None else req.k
    concs = req.concs if req.concs is not None else [c for c in (req.c1, req.c2) if c is not None]
    try:
        return ok(A.measure_points(m, concs, metric, k))
    except ValueError as e:
        raise HTTPException(422, detail={"error": str(e), "pos": None})


class RecoverRequest(SeriesRequest):
    signals: list[float]
    conf: float = 0.95


@router.post("/recover")
def recover(req: RecoverRequest):
    m = _compile(req.series)
    try:
        return ok({"rows": A.recover(m, req.signals, req.conf)})
    except ValueError as e:
        raise HTTPException(422, detail={"error": str(e), "pos": None})


class RuleRequest(Camel):
    metric: Literal["dsum", "ssmd", "zprime"]
    k: float | None = None
    error: float | None = None


@router.post("/rule")
def rule(req: RuleRequest):
    try:
        return ok(A.rule(req.metric, req.k, req.error))
    except ValueError as e:
        raise HTTPException(422, detail={"error": str(e), "pos": None})


class SimulateRequest(SeriesRequest):
    concs: list[float] | None = None
    n: int | list[int] = 4
    runs: int = 200
    seed: int = 1
    metric: Literal["dsum", "ssmd", "zprime"] | None = None
    k: float | None = None
    conf: float = 0.9
    measured_n: bool = False
    alpha: float = 0.05


@router.post("/simulate")
def simulate(req: SimulateRequest):
    m = _compile(req.series)
    try:
        return ok(EX.simulate(m, req.concs, req.n, req.runs, req.seed, req.metric, req.k, req.conf, req.measured_n, req.alpha))
    except ValueError as e:
        raise HTTPException(422, detail={"error": str(e), "pos": None})


@router.post("/fit")
async def fit(request: Request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - never HTTP-error on bad data
        body = {}
    return ok(F.run_fit(body))


@router.post("/export")
def export(req: SeriesRequest):
    _compile(req.series)
    name = X.export_filename(req.series)
    # Headers are latin-1: the plain filename must be ASCII; the real name travels in filename*.
    # export_filename always yields "calwizard_<safe>.xlsx", so the ASCII remainder is never empty.
    plain = name.encode("ascii", "ignore").decode()
    return Response(X.export_bytes(req.series), media_type=XLSX,
                    headers={"Content-Disposition": f"attachment; filename=\"{plain}\"; "
                                                    f"filename*=UTF-8''{quote(name)}"})


app = FastAPI(title="Cal Wizard")


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """422 without echoing the offending input (which may hold NaN/Infinity and break JSON)."""
    detail = [{"loc": [str(p) for p in e.get("loc", ())], "msg": str(e.get("msg", "")), "type": str(e.get("type", ""))}
              for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})


@app.exception_handler(ArithmeticError)
@app.exception_handler(ValueError)
async def numeric_error(_: Request, exc: Exception) -> JSONResponse:
    """Extreme numeric input is the caller's problem (422), never a server error."""
    return JSONResponse(status_code=422, content={"detail": {"error": f"cannot compute with these values: {exc}", "pos": None}})
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])
app.include_router(router)
