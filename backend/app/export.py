"""Excel export (spec section 10). Plain cell references; formulas are live in equations mode."""
from __future__ import annotations

import io
import math
import re

import numpy as np
from openpyxl import Workbook
from openpyxl.chart import Reference, ScatterChart, Series as XlSeries
from openpyxl.styles import Font, PatternFill

from . import expr as E
from . import metrics as K
from .series import Model, Series, compile_series

BOLD = Font(bold=True)
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
GRID_N = 501  # points; rows 2..502 of the Grid sheet
G0, G1 = 2, GRID_N + 1
CMAX = "Inputs!$B$7"
KTARGET = "Inputs!$B$8"
GA, GM, GS = (f"Grid!${col}${G0}:${col}${G1}" for col in "ABC")
OUT = '"out of range"'


def export_filename(series: Series) -> str:
    safe = re.sub(r"[^\w\-. ]+", "_", series.name).strip() or "series"
    return f"calwizard_{safe}.xlsx"


def _head(ws, row: int, labels: list[str], col0: int = 1) -> None:
    for i, h in enumerate(labels):
        ws.cell(row=row, column=col0 + i, value=h).font = BOLD


def _num(v):
    return None if v is None or not math.isfinite(v) else float(v)


# --------------------------------------------------------------------------- sheets
def _inputs(wb: Workbook, series: Series, model: Model) -> None:
    ws = wb.active
    ws.title = "Inputs"
    ws["A1"] = "Cal Wizard inputs"
    ws["A1"].font = Font(bold=True, size=13)
    rows = [("Name", series.name), ("Units", series.units), ("Signal label", series.signal_label),
            ("Mode", series.mode), ("c max", model.c_max), ("k target", series.k_target),
            ("Metric", series.metric)]
    for i, (k, v) in enumerate(rows, start=3):
        ws.cell(row=i, column=1, value=k).font = BOLD
        ws.cell(row=i, column=2, value=v)
    ws["B7"].fill = ws["B8"].fill = INPUT_FILL
    if series.mode == "equations":
        ws["A10"], ws["B10"] = "mean(c) =", series.mean_expr
        ws["A11"], ws["B11"] = "sd(S) =", series.sd_expr
        ws["A12"], ws["B12"] = "levels", ", ".join(f"{v:g}" for v in model.levels)
        ws["C10"] = "Text for reference; the live model is the formula in Calculator!B2 and Calculator!B3."
    elif series.mode == "summary":
        _head(ws, 13, ["c", "mean", "sd"])
        for i, r in enumerate(sorted(series.summary, key=lambda r: r.c), start=14):
            ws.cell(row=i, column=1, value=r.c)
            ws.cell(row=i, column=2, value=r.mean)
            ws.cell(row=i, column=3, value=r.sd)
    else:
        ws["A13"] = "Replicates as entered: see the Data sheet."
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 38


def _grid(wb: Workbook, series: Series, model: Model) -> None:
    ws = wb.create_sheet("Grid")
    _head(ws, 1, ["c", "mean", "sd"])
    cs = model.grid(GRID_N)
    if series.mode == "equations":
        mean_ast, sd_ast = E.parse(series.mean_expr, "c"), E.parse(series.sd_expr, "S")
        for i in range(GRID_N):
            r = G0 + i
            ws.cell(row=r, column=1, value=f"={CMAX}*{i}/{GRID_N - 1}")
            ws.cell(row=r, column=2, value="=" + E.to_excel(mean_ast, f"A{r}"))
            ws.cell(row=r, column=3, value="=" + E.to_excel(sd_ast, f"B{r}"))
    else:
        for i, (c, m, s) in enumerate(zip(cs, model.mean(cs), model.sd(cs))):
            ws.cell(row=G0 + i, column=1, value=float(c))
            ws.cell(row=G0 + i, column=2, value=_num(m))
            ws.cell(row=G0 + i, column=3, value=_num(s))
    chart = ScatterChart()
    chart.title = f"mean(c) - {series.name}"
    chart.style = 13
    chart.x_axis.title = f"Concentration ({series.units})"
    chart.y_axis.title = series.signal_label
    chart.x_axis.scaling.min = 0
    chart.x_axis.delete = False
    chart.y_axis.delete = False
    chart.legend = None
    s = XlSeries(Reference(ws, min_col=2, min_row=G0, max_row=G1), Reference(ws, min_col=1, min_row=G0, max_row=G1),
                 title="mean")
    s.marker.symbol = "none"
    s.smooth = False
    chart.series.append(s)
    chart.width, chart.height = 18, 10
    ws.add_chart(chart, "E2")


def _lookup(col: str, k: str, x: str) -> str:
    """Linear interpolation of Grid column `col` at the grid index in cell `k` for abscissa cell `x`
    (abscissa = Grid column A when col is mean/sd)."""
    return (f"INDEX({col},{k})+(INDEX({col},{k}+1)-INDEX({col},{k}))*({x}-INDEX({GA},{k}))"
            f"/(INDEX({GA},{k}+1)-INDEX({GA},{k}))")


def _calculator(wb: Workbook, series: Series, model: Model) -> None:
    ws = wb.create_sheet("Calculator")
    c0 = float(np.median(model.levels))
    ws["A1"], ws["B1"] = f"c ({series.units})", c0
    ws["A2"], ws["A3"] = "mean(c)", "sd(c)"
    ws["A5"], ws["B5"] = f"S ({series.signal_label})", float(model.mean(c0))
    ws["A6"] = "c(S)"
    for a in ("A1", "A2", "A3", "A5", "A6"):
        ws[a].font = BOLD
    ws["B1"].fill = ws["B5"].fill = INPUT_FILL
    if series.mode == "equations":
        ws["B2"] = "=" + E.to_excel(E.parse(series.mean_expr, "c"), "B1")
        ws["B3"] = "=" + E.to_excel(E.parse(series.sd_expr, "S"), "B2")
        ws["C2"] = "Edit these formulas to change the model."
    else:
        ws["E1"], ws["F1"] = "helper: clamped c", f"=MAX(MIN(B1,Grid!$A${G1}),Grid!$A${G0})"
        ws["E2"], ws["F2"] = "helper: grid index", f"=MIN(MATCH(F1,{GA},1),{GRID_N - 1})"
        ws["B2"] = "=" + _lookup(GM, "$F$2", "$F$1")
        ws["B3"] = "=" + _lookup(GS, "$F$2", "$F$1")
        ws["C2"] = "Linear interpolation on the Grid sheet."
    first, last = f"Grid!$B${G0}", f"Grid!$B${G1}"
    ws["E5"] = "helper: grid index"
    ws["F5"] = f"=MIN(IF({first}<={last},MATCH(B5,{GM},1),MATCH(B5,{GM},-1)),{GRID_N - 1})"
    inner = (f"INDEX({GA},$F$5)+(INDEX({GA},$F$5+1)-INDEX({GA},$F$5))*(B5-INDEX({GM},$F$5))"
             f"/(INDEX({GM},$F$5+1)-INDEX({GM},$F$5))")
    ws["B6"] = (f"=IF(OR(B5<MIN({first},{last}),B5>MAX({first},{last})),{OUT},IFERROR({inner},{OUT}))")
    ws["C6"] = "Interpolates the Grid mean column (assumes a monotone curve)."
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["E"].width = 20


def _levels(wb: Workbook, series: Series, model: Model, rows: list[dict]) -> None:
    ws = wb.create_sheet("Levels")
    _head(ws, 1, ["c1", "c2", "mu1", "mu2", "sd1", "sd2", "dmu", "dmu/sum(sd)", "SSMD", "Z'", "overlap",
                  "misclass.", "pass", "", "a", "b", "c", "disc", "root1", "root2", "crossing t"])
    eq = series.mode == "equations"
    if eq:
        mean_ast, sd_ast = E.parse(series.mean_expr, "c"), E.parse(series.sd_expr, "S")
    for i, row in enumerate(rows):
        r = i + 2
        ws.cell(row=r, column=1, value=row["c1"])
        ws.cell(row=r, column=2, value=row["c2"])
        if eq:
            ws[f"C{r}"] = "=" + E.to_excel(mean_ast, f"A{r}")
            ws[f"D{r}"] = "=" + E.to_excel(mean_ast, f"B{r}")
            ws[f"E{r}"] = "=" + E.to_excel(sd_ast, f"C{r}")
            ws[f"F{r}"] = "=" + E.to_excel(sd_ast, f"D{r}")
        else:
            for col, key in zip("CDEF", ("mu1", "mu2", "sd1", "sd2")):
                ws[f"{col}{r}"] = _num(row[key])
        ws[f"G{r}"] = f"=D{r}-C{r}"
        ws[f"H{r}"] = f"=G{r}/(E{r}+F{r})"
        ws[f"I{r}"] = f"=G{r}/SQRT(E{r}^2+F{r}^2)"
        ws[f"J{r}"] = f"=1-3*(E{r}+F{r})/ABS(G{r})"
        ws[f"K{r}"] = _num(row["ovl"])
        ws[f"O{r}"] = f"=IFERROR(1/E{r}^2-1/F{r}^2,0)"
        ws[f"P{r}"] = f"=IFERROR(-2*C{r}/E{r}^2+2*D{r}/F{r}^2,0)"
        ws[f"Q{r}"] = f"=IFERROR(C{r}^2/E{r}^2-D{r}^2/F{r}^2-2*LN(F{r}/E{r}),0)"
        ws[f"R{r}"] = f"=P{r}^2-4*O{r}*Q{r}"
        ws[f"S{r}"] = f'=IFERROR((-P{r}+SQRT(R{r}))/(2*O{r}),"")'
        ws[f"T{r}"] = f'=IFERROR((-P{r}-SQRT(R{r}))/(2*O{r}),"")'
        lo, hi, mid = f"MIN(C{r},D{r})", f"MAX(C{r},D{r})", f"(C{r}+D{r})/2"
        ws[f"U{r}"] = (f"=IF(OR(ABS(E{r}-F{r})<1E-12*(E{r}+F{r}),R{r}<0),{mid},"
                       f"IF(AND(ISNUMBER(S{r}),S{r}>={lo},S{r}<={hi}),S{r},"
                       f"IF(AND(ISNUMBER(T{r}),T{r}>={lo},T{r}<={hi}),T{r},{mid})))")
        low = f"C{r}<=D{r}"
        ml, sl = f"IF({low},C{r},D{r})", f"IF({low},E{r},F{r})"
        mh, sh = f"IF({low},D{r},C{r})", f"IF({low},F{r},E{r})"
        ws[f"L{r}"] = (f'=IFERROR(0.5*((1-_xlfn.NORM.DIST(U{r},{ml},{sl},TRUE))'
                       f'+_xlfn.NORM.DIST(U{r},{mh},{sh},TRUE)),"")')
        test = {"dsum": f"ABS(H{r})", "ssmd": f"ABS(I{r})", "zprime": f"J{r}"}[series.metric]
        ws[f"M{r}"] = f"=IFERROR({test}>={KTARGET},FALSE)"
    ws.column_dimensions["H"].width = 13


def _data(wb: Workbook, series: Series) -> None:
    ws = wb.create_sheet("Data")
    rep = series.replicates
    concs, cells = rep.concs, rep.cells
    depth = max([len(c) for c in cells] + [0])
    has_data = any(v is not None for col in cells for v in col)
    if series.mode == "summary":
        _head(ws, 1, ["c", "mean", "sd", "CV"])
        for i, r in enumerate(sorted(series.summary, key=lambda r: r.c), start=2):
            ws.cell(row=i, column=1, value=r.c)
            ws.cell(row=i, column=2, value=r.mean)
            ws.cell(row=i, column=3, value=r.sd)
            ws.cell(row=i, column=4, value=f'=IFERROR(C{i}/B{i},"")')
        return
    if not has_data:
        ws["A1"] = "No replicate data entered."
        return
    for j, c in enumerate(concs, start=1):
        ws.cell(row=1, column=j, value=c).font = BOLD
        for i, v in enumerate(cells[j - 1] if j - 1 < len(cells) else [], start=2):
            ws.cell(row=i, column=j, value=v)
    top = depth + 4
    _head(ws, top, ["c", "mean", "SD", "n", "CV"])
    for j in range(1, len(concs) + 1):
        L = ws.cell(row=1, column=j).column_letter
        rng, r = f"{L}2:{L}{depth + 1}", top + j
        ws.cell(row=r, column=1, value=f"={L}1")
        ws.cell(row=r, column=2, value=f'=IFERROR(AVERAGE({rng}),"")')
        ws.cell(row=r, column=3, value=f'=IFERROR(STDEV({rng}),"")')
        ws.cell(row=r, column=4, value=f"=COUNT({rng})")
        ws.cell(row=r, column=5, value=f'=IFERROR(C{r}/B{r},"")')


def build_workbook(series: Series) -> Workbook:
    model = compile_series(series)
    rows = K.level_rows(model)
    wb = Workbook()
    _inputs(wb, series, model)
    _calculator(wb, series, model)
    _grid(wb, series, model)
    _levels(wb, series, model, rows)
    _data(wb, series)
    return wb


def export_bytes(series: Series) -> bytes:
    buf = io.BytesIO()
    build_workbook(series).save(buf)
    return buf.getvalue()
