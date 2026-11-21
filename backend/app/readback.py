"""Spec section 18: the read-back sheet. Signals in, concentrations out, with a range, a CV and a flag against the
detection limits; plus its Excel workbook. Ported to frontend/src/math/readback.ts."""
from __future__ import annotations

import io
import math

from openpyxl import Workbook
from openpyxl.styles import Font

from . import analysis as A
from . import limits as L
from .series import Model, Sample

FLAGS = {
    "ok": "",
    "invalid": "no signal",
    "below": "below the blank",
    "above": "above the range",
    "belowLod": "not detected (< LoD)",
    "belowLoq": "detected, below LoQ",
    "aboveLoq": "above the quantifiable range",
    "hook": "ambiguous: also above the hook peak",
}


def readback(model: Model, samples: list[Sample] | None = None, conf: float = 0.95) -> dict:
    """One row per sample: c from the curve, its range, the result after dilution, CV and flag."""
    s = model.series
    samples = s.samples if samples is None else samples
    lim = s.limits
    res = L.limits(model, lim.alpha, lim.beta, lim.cv, lim.reads, profile=False)
    lod, loq, uloq = (None if res[k] is None else res[k]["c"] for k in ("lod", "loq", "uloq"))
    d = res["direction"]
    mu0 = res["blank"]["mean"]
    valid = [x for x in samples if x.signal is not None and math.isfinite(x.signal)]
    rec = iter(A.recover(model, [x.signal for x in valid], conf)) if valid else iter(())
    rows = []
    for x in samples:
        dil = x.dilution if (math.isfinite(x.dilution) and x.dilution > 0) else 1.0
        row = {"id": x.id, "signal": x.signal, "dilution": dil, "c": None, "lo": None, "hi": None, "result": None,
               "resultLo": None, "resultHi": None, "cv": None, "flag": "invalid"}
        if x.signal is not None and math.isfinite(x.signal):
            r = next(rec)
            c = r["c"]
            row.update(c=c, lo=r["lo"], hi=r["hi"])
            if c is None:
                row["flag"] = "below" if d * (x.signal - mu0) < 0 else "above"
            else:
                row.update(result=c * dil, cv=L.conc_cv(model, c, lim.reads),
                           resultLo=None if r["lo"] is None else r["lo"] * dil,
                           resultHi=None if r["hi"] is None else r["hi"] * dil)
                if r["hook"]:
                    row["flag"] = "hook"
                elif lod is not None and c < lod:
                    row["flag"] = "belowLod"
                elif loq is not None and c < loq:
                    row["flag"] = "belowLoq"
                elif uloq is not None and c > uloq:
                    row["flag"] = "aboveLoq"
                else:
                    row["flag"] = "ok"
        rows.append(row)
    return {"conf": conf, "lod": lod, "loq": loq, "uloq": uloq, "rows": rows}


def _num(v):
    return v if (v is not None and math.isfinite(v)) else None


def workbook_bytes(model: Model, samples: list[Sample] | None = None, conf: float = 0.95) -> bytes:
    """The sheet as an .xlsx: a Results sheet (values) and an About sheet (curve, limits, settings)."""
    s = model.series
    out = readback(model, samples, conf)
    u = f" ({s.units})" if s.units else ""
    wb = Workbook()
    ws = wb.active
    ws.title = "Results"
    head = ["Sample", s.signal_label or "Signal", "Dilution", f"Concentration{u}", f"Low{u}", f"High{u}",
            f"Result{u}", f"Result low{u}", f"Result high{u}", "CV %", "Flag"]
    ws.append(head)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for r in out["rows"]:
        ws.append([r["id"], _num(r["signal"]), r["dilution"], _num(r["c"]), _num(r["lo"]), _num(r["hi"]),
                   _num(r["result"]), _num(r["resultLo"]), _num(r["resultHi"]),
                   None if _num(r["cv"]) is None else r["cv"] * 100, FLAGS[r["flag"]]])
    for col, w in zip("ABCDEFGHIJK", (18, 12, 10, 18, 12, 12, 14, 14, 14, 9, 28)):
        ws.column_dimensions[col].width = w
    ab = wb.create_sheet("About")
    lim = s.limits
    for k, v in [("Series", s.name), ("Analyte", s.analyte), ("Units", s.units), ("Signal", s.signal_label),
                 ("Range coverage", conf), ("Curve source", s.mode),
                 ("What-if layer", "yes" if model.adjusted else "no"),
                 (f"LoD{u}", _num(out["lod"])), (f"LoQ{u}", _num(out["loq"])), (f"Upper LoQ{u}", _num(out["uloq"])),
                 ("LoQ CV target %", lim.cv * 100), ("alpha", lim.alpha), ("beta", lim.beta),
                 ("Readings averaged per result", lim.reads)]:
        ab.append([k, v])
    ab.column_dimensions["A"].width = 30
    ab.column_dimensions["B"].width = 24
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
