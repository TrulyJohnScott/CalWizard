"""Spec §10 Excel export: recalculated with the independent `formulas` engine and compared with oracles."""
from __future__ import annotations

import io
import math
import re
import warnings
import zipfile

import numpy as np
import openpyxl
import pytest
from scipy import optimize

from . import oracle as O

pytestmark = [pytest.mark.filterwarnings("ignore"), ]

SHEETS = ["Inputs", "Calculator", "Grid", "Levels", "Data"]
N_GRID = 501

EQ_UP = {"name": "Default", "units": "ng/mL", "signalLabel": "Signal", "mode": "equations",
         "meanExpr": "4000 + (50 - 4000)/(1 + (c/40)^1.2)", "sdExpr": "sqrt(15^2 + (0.08*S)^2)",
         "levels": [0, 1, 5, 25, 100, 500], "cMax": 500, "metric": "ssmd", "kTarget": 3}
EQ_DOWN = {"name": "Falling", "units": "pg/mL", "signalLabel": "RFU", "mode": "equations",
           "meanExpr": "5000/(1 + c/50) + 100", "sdExpr": "0.05*S + 10", "levels": [1000, 0, 10, 50, 200],
           "cMax": 1000, "metric": "dsum", "kTarget": 1.5}
REPL = {"name": "Repl", "units": "ng/mL", "signalLabel": "Signal", "mode": "replicates",
        "replicates": {"concs": [0, 1, 5, 25, 100],
                       "cells": [[48.1, 52.0, 47.3], [55.0, 58.2, 53.9, 56.0], [90.1, 101.3, 95.5],
                                 [400, None, 389.2], [1500, 1480, 1555]]},
        "levels": [0], "cMax": 100, "metric": "dsum", "kTarget": 1}
SUMM = {"name": "Summ", "units": "IU", "signalLabel": "Signal", "mode": "summary",
        "summary": [{"c": 0, "mean": 50, "sd": 15}, {"c": 2, "mean": 120, "sd": 18}, {"c": 10, "mean": 600, "sd": 40},
                    {"c": 40, "mean": 2100, "sd": 160}, {"c": 80, "mean": 3000, "sd": 210}],
        "levels": [0], "cMax": 80, "metric": "zprime", "kTarget": 0.5}
ALL = {"eq_up": EQ_UP, "eq_down": EQ_DOWN, "repl": REPL, "summ": SUMM}


def _wrap(f):
    return lambda c: np.atleast_1d(f(np.atleast_1d(np.asarray(c, dtype=float))))


def oracle_models(s):
    """-> (mean(c) -> ndarray, sd(c) -> ndarray, levels)"""
    if s["mode"] == "equations":
        mt, _ = O.parse_to_sympy(s["meanExpr"], "c")
        st_, _ = O.parse_to_sympy(s["sdExpr"], "S")

        def mean(c):
            return np.array([O.eval_tree(mt, float(x))[0] for x in np.atleast_1d(c)], dtype=float)

        def sd(c):
            m = mean(c)
            return np.array([O.eval_tree(st_, float(x))[0] for x in m], dtype=float)

        levels = sorted(set([0.0] + [float(x) for x in s["levels"] if x >= 0]))
        return mean, sd, levels
    if s["mode"] == "replicates":
        mi, si, _ = O.replicate_model(s["replicates"]["concs"], s["replicates"]["cells"])
        mi, si = _wrap(mi), _wrap(si)
        levels = sorted(set([0.0] + [float(x) for x in s["replicates"]["concs"]]))
        return mi, si, levels
    mi, si = O.summary_model(s["summary"])
    mi, si = _wrap(mi), _wrap(si)
    levels = sorted(set([0.0] + [float(r["c"]) for r in s["summary"]]))
    return mi, si, levels


def post_export(client, s):
    r = client.post("/api/export", json={"series": s})
    assert r.status_code == 200, r.text[:300]
    return r


class XL:
    """workbook + recalculation through `formulas`."""

    def __init__(self, content: bytes, path):
        import formulas
        self.content = content
        self.path = str(path)
        with open(self.path, "wb") as f:
            f.write(content)
        self.wb = openpyxl.load_workbook(io.BytesIO(content))  # formulas as text
        self.model = formulas.ExcelModel().loads(self.path).finish()
        self.fname = path.name
        self.base = self._collect(self.model.calculate())

    def key(self, sheet, cell):
        return f"'[{self.fname}]{sheet.upper()}'!{cell}"

    @staticmethod
    def _v(r):
        v = r.value[0][0] if hasattr(r, "value") else r
        if isinstance(v, (bool, np.bool_)):
            return bool(v)
        if isinstance(v, (int, float, np.floating, np.integer)):
            return float(v)
        return str(v)

    def _collect(self, sol):
        return {k: self._v(v) for k, v in sol.items()}

    def get(self, sheet, cell):
        return self.base[self.key(sheet, cell)]

    def run(self, inputs: dict, outputs: list):
        """inputs {(sheet,cell): value}; outputs [(sheet,cell)] -> list of values"""
        sol = self.model.calculate(inputs={self.key(*k): v for k, v in inputs.items()},
                                   outputs=[self.key(*o) for o in outputs])
        return [self._v(sol[self.key(*o)]) for o in outputs]


@pytest.fixture(scope="module")
def book(client, tmp_path_factory):
    cache = {}

    def get(name):
        if name not in cache:
            r = post_export(client, ALL[name])
            d = tmp_path_factory.mktemp(name)
            cache[name] = XL(r.content, d / f"{name}.xlsx")
            cache[name].response = r
        return cache[name]

    return get


# ---------------------------------------------------------------------------------------------
# structure
# ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ALL)
def test_sheet_names_and_order(book, name):
    assert book(name).wb.sheetnames == SHEETS


@pytest.mark.parametrize("name,fname", [("eq_up", "calwizard_Default.xlsx"), ("eq_down", "calwizard_Falling.xlsx")])
def test_attachment_headers(book, name, fname):
    r = book(name).response
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert "attachment" in r.headers["content-disposition"] and fname in r.headers["content-disposition"]
    assert r.content[:2] == b"PK"


def _kv(ws):
    out = {}
    for row in ws.iter_rows(values_only=True):
        if row and isinstance(row[0], str) and len(row) > 1 and row[1] is not None:
            out[row[0].strip().lower()] = row[1]
    return out


@pytest.mark.parametrize("name", ALL)
def test_inputs_sheet_holds_settings(book, name):
    s = ALL[name]
    kv = _kv(book(name).wb["Inputs"])
    assert kv["mode"] == s["mode"]
    assert kv["units"] == s["units"]
    assert kv["name"] == s["name"]
    assert any(v == s["signalLabel"] for k, v in kv.items() if "signal" in k)
    cmax = [v for k, v in kv.items() if k.replace(" ", "") == "cmax"][0]
    assert float(cmax) == pytest.approx(float(s["cMax"]))
    assert float([v for k, v in kv.items() if "target" in k][0]) == pytest.approx(s["kTarget"])
    assert kv["metric"] == s["metric"]


def test_inputs_equations_text_is_verbatim(book):
    kv = _kv(book("eq_up").wb["Inputs"])
    vals = [v for v in kv.values() if isinstance(v, str)]
    assert EQ_UP["meanExpr"] in vals and EQ_UP["sdExpr"] in vals
    # stored as *text*, not as live formulas
    ws = book("eq_up").wb["Inputs"]
    for row in ws.iter_rows():
        for c in row:
            if c.value in (EQ_UP["meanExpr"], EQ_UP["sdExpr"]):
                assert c.data_type != "f" and not str(c.value).startswith("=")


def test_inputs_summary_table_as_entered(book):
    ws = book("summ").wb["Inputs"]
    rows = [tuple(c for c in r if c is not None) for r in ws.iter_rows(values_only=True)]
    for r in SUMM["summary"]:
        want = (r["c"], r["mean"], r["sd"])
        assert any(tuple(x for x in row)[i:i + 3] == want for row in rows for i in range(max(1, len(row) - 2))), r


def test_data_sheet_replicates_as_entered(book):
    ws = book("repl").wb["Data"]
    concs = REPL["replicates"]["concs"]
    top = [c.value for c in ws[1]][:len(concs)]
    assert top == concs
    for j, col in enumerate(REPL["replicates"]["cells"]):
        below = [ws.cell(row=2 + i, column=1 + j).value for i in range(len(col))]
        assert [b for b in below if b is not None] == [v for v in col if v is not None]


def test_chart_is_a_native_linear_scatter_of_grid_mean(book):
    z = zipfile.ZipFile(io.BytesIO(book("eq_up").content))
    charts = [n for n in z.namelist() if n.startswith("xl/charts/chart")]
    assert charts, z.namelist()
    xml = z.read(charts[0]).decode()
    assert "scatterChart" in xml
    assert "logBase" not in xml
    assert "Grid" in xml
    # the chart is hosted on the Grid sheet: its drawing is linked from Grid's worksheet rels
    wbxml = z.read("xl/workbook.xml").decode()
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', wbxml)
    assert names == SHEETS
    grid_idx = names.index("Grid") + 1
    rels = [n for n in z.namelist() if n.startswith("xl/worksheets/_rels/")]
    assert any(z.read(n).decode().count("drawing") for n in rels)


@pytest.mark.parametrize("name", ["eq_up", "eq_down"])
def test_equations_calculator_formulas_are_live_and_chained(book, name):
    ws = book(name).wb["Calculator"]
    mean_f, sd_f = ws["B2"].value, ws["B3"].value
    assert isinstance(mean_f, str) and mean_f.startswith("=") and "B1" in mean_f
    assert isinstance(sd_f, str) and sd_f.startswith("=") and "B2" in sd_f and "B1" not in sd_f
    g = book(name).wb["Grid"]
    assert str(g["B2"].value).startswith("=") and str(g["C2"].value).startswith("=")


# ---------------------------------------------------------------------------------------------
# values
# ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ALL)
def test_grid_sheet_has_501_points_with_oracle_mean_and_sd(book, name):
    s = ALL[name]
    x = book(name)
    mean, sd, levels = oracle_models(s)
    cmax = float(s["cMax"])
    ws = x.wb["Grid"]
    assert [ws.cell(row=1, column=i).value for i in (1, 2, 3)] == ["c", "mean", "sd"]
    assert ws.max_row == N_GRID + 1
    gc = np.array([x.get("Grid", f"A{r}") for r in range(2, N_GRID + 2)])
    np.testing.assert_allclose(gc, np.linspace(0, cmax, N_GRID), rtol=1e-12, atol=1e-12)
    gm = np.array([x.get("Grid", f"B{r}") for r in range(2, N_GRID + 2)])
    gs = np.array([x.get("Grid", f"C{r}") for r in range(2, N_GRID + 2)])
    em, es = mean(gc), sd(gc)
    np.testing.assert_allclose(gm, em, rtol=1e-9, atol=1e-9 * (1 + np.abs(em).max()))
    np.testing.assert_allclose(gs, es, rtol=1e-9, atol=1e-9 * (1 + np.abs(es).max()))


@pytest.mark.parametrize("name", ALL)
def test_calculator_forward_mean_and_sd(book, name):
    s = ALL[name]
    x = book(name)
    mean, sd, _ = oracle_models(s)
    cmax = float(s["cMax"])
    gc = np.linspace(0, cmax, N_GRID)
    gm_all, gs_all = mean(gc), sd(gc)
    for c in [0.0, cmax * 0.0037, cmax * 0.0123, cmax / 7, cmax * 0.31, cmax * 0.5, cmax * 0.777, cmax]:
        m, sdv = x.run({("Calculator", "B1"): c}, [("Calculator", "B2"), ("Calculator", "B3")])
        if s["mode"] == "equations":
            assert m == pytest.approx(float(mean(c)[0]), rel=1e-9), c
            assert sdv == pytest.approx(float(sd(c)[0]), rel=1e-9), c
        else:
            # table modes: linear interpolation of the dense grid
            assert m == pytest.approx(float(np.interp(c, gc, gm_all)), rel=1e-9, abs=1e-9), c
            assert sdv == pytest.approx(float(np.interp(c, gc, gs_all)), rel=1e-9, abs=1e-9), c
            span = gm_all.max() - gm_all.min()
            assert abs(m - float(mean(c)[0])) <= 5e-3 * span  # and close to true PCHIP


@pytest.mark.parametrize("name", ALL)
def test_calculator_forward_clamps_table_modes_outside_range(book, name):
    s = ALL[name]
    if s["mode"] == "equations":
        pytest.skip("equations mode evaluates the formula directly")
    x = book(name)
    mean, _, _ = oracle_models(s)
    cmax = float(s["cMax"])
    lo, hi = x.run({("Calculator", "B1"): -5.0}, [("Calculator", "B2")])[0], \
        x.run({("Calculator", "B1"): cmax * 10}, [("Calculator", "B2")])[0]
    assert lo == pytest.approx(float(mean(0.0)[0]), rel=1e-9)
    assert hi == pytest.approx(float(mean(cmax)[0]), rel=1e-9)


def _grid_inverse_oracle(gc, gm, S):
    lo, hi = gm.min(), gm.max()
    if S < lo or S > hi:
        return None
    if gm[0] <= gm[-1]:
        return float(np.interp(S, gm, gc))
    return float(np.interp(S, gm[::-1], gc[::-1]))


@pytest.mark.parametrize("name", ALL)
def test_reverse_calculator_matches_grid_inverse_and_true_inverse(book, name):
    s = ALL[name]
    x = book(name)
    mean, _, _ = oracle_models(s)
    cmax = float(s["cMax"])
    gc = np.linspace(0, cmax, N_GRID)
    gm = mean(gc)
    assert np.all(np.diff(gm) > 0) or np.all(np.diff(gm) < 0), "test series must be monotone"
    lo, hi = gm.min(), gm.max()
    span = hi - lo
    for frac in [1e-6, 0.003, 0.2, 0.5, 0.81, 1 - 1e-6]:
        S = lo + frac * span
        (got,) = x.run({("Calculator", "B5"): S}, [("Calculator", "B6")])
        want = _grid_inverse_oracle(gc, gm, S)
        assert isinstance(got, float), (S, got)
        assert got == pytest.approx(want, rel=1e-9, abs=1e-9 * cmax), (name, frac, got, want)
        # and it is a correct inverse of the real curve to within the grid's interpolation error
        assert abs(float(mean(got)[0]) - S) <= 0.02 * span, (name, frac, S, float(mean(got)[0]))


@pytest.mark.parametrize("name", ALL)
def test_reverse_calculator_exact_boundaries_are_ok_or_out_of_range(book, name):
    """At exactly min/max signal either an in-range value or 'out of range' (float round-off) is fine."""
    s = ALL[name]
    x = book(name)
    mean, _, _ = oracle_models(s)
    gm = mean(np.linspace(0, float(s["cMax"]), N_GRID))
    for S, c_expect in [(gm.min(), None), (gm.max(), None)]:
        (got,) = x.run({("Calculator", "B5"): float(S)}, [("Calculator", "B6")])
        assert got == "out of range" or (isinstance(got, float) and -1e-9 <= got <= float(s["cMax"]) + 1e-9)


@pytest.mark.parametrize("name", ALL)
def test_reverse_calculator_out_of_range(book, name):
    s = ALL[name]
    x = book(name)
    mean, _, _ = oracle_models(s)
    gm = mean(np.linspace(0, float(s["cMax"]), N_GRID))
    lo, hi = gm.min(), gm.max()
    span = hi - lo
    for S in [lo - 1e-3 * span, lo - 0.5 * span, hi + 1e-3 * span, hi + 10 * span, -1e9, 1e12]:
        (got,) = x.run({("Calculator", "B5"): S}, [("Calculator", "B6")])
        assert got == "out of range", (name, S, got)
    (got,) = x.run({("Calculator", "B5"): lo + 0.5 * span}, [("Calculator", "B6")])
    assert got != "out of range" and isinstance(got, float)


def test_reverse_round_trip_equations(book):
    """c -> mean(c) (forward) -> c(S) (reverse) must give back c up to grid resolution."""
    x = book("eq_up")
    for c in [3.0, 20.0, 77.7, 250.0, 480.0]:
        (m,) = x.run({("Calculator", "B1"): c}, [("Calculator", "B2")])
        (back,) = x.run({("Calculator", "B5"): m}, [("Calculator", "B6")])
        # curve is steep near 0: compare in signal space
        mean, _, _ = oracle_models(EQ_UP)
        assert abs(float(mean(back)[0]) - m) <= 0.01 * (mean(500.0)[0] - mean(0.0)[0])
        assert back == pytest.approx(c, rel=0.02, abs=0.1)


HEADERS = {"c1": "c1", "c2": "c2", "mu1": "mu1", "mu2": "mu2", "sd1": "sd1", "sd2": "sd2", "dmu": "dmu",
           "dsum": "dmu/sum(sd)", "ssmd": "ssmd", "zprime": "z'", "ovl": "overlap", "err": "misclass.",
           "pass": "pass"}


def levels_cols(wb):
    ws = wb["Levels"]
    hdr = {str(c.value).strip().lower(): c.column_letter for c in ws[1] if c.value is not None}
    cols = {}
    for key, h in HEADERS.items():
        assert h in hdr, (h, list(hdr))
        cols[key] = hdr[h]
    return cols


@pytest.mark.parametrize("name", ALL)
def test_levels_sheet_pairs_and_metrics(book, name):
    s = ALL[name]
    x = book(name)
    mean, sd, levels = oracle_models(s)
    cols = levels_cols(x.wb)
    n_pairs = len(levels) - 1
    ws = x.wb["Levels"]
    # rows of the pair table = consecutive rows below the header with numeric c1
    got_rows = []
    r = 2
    while ws[f"A{r}"].value is not None:
        got_rows.append(r)
        r += 1
    assert len(got_rows) == n_pairs
    metric, k = s["metric"], float(s["kTarget"])
    for i, r in enumerate(got_rows):
        g = {key: x.get("Levels", f"{col}{r}") for key, col in cols.items()}
        c1, c2 = levels[i], levels[i + 1]
        assert g["c1"] == pytest.approx(c1) and g["c2"] == pytest.approx(c2)
        mu1, mu2 = float(mean(c1)[0]), float(mean(c2)[0])
        s1, s2 = float(sd(c1)[0]), float(sd(c2)[0])
        base = O.metric_row(mu1, mu2, s1, s2)
        assert g["mu1"] == pytest.approx(mu1, rel=1e-9, abs=1e-9) and g["mu2"] == pytest.approx(mu2, rel=1e-9, abs=1e-9)
        assert g["sd1"] == pytest.approx(s1, rel=1e-9, abs=1e-9) and g["sd2"] == pytest.approx(s2, rel=1e-9, abs=1e-9)
        for key in ("dmu", "dsum", "ssmd", "zprime"):
            assert g[key] == pytest.approx(base[key], rel=1e-9, abs=1e-9), (name, i, key)
        if s1 > 0 and s2 > 0:
            assert abs(g["ovl"] - O.exact_ovl(mu1, s1, mu2, s2)) <= 2e-4, (name, i)
            assert g["err"] == pytest.approx(O.exact_err(mu1, s1, mu2, s2), abs=1e-7, rel=1e-5), (name, i)
        value = base[metric]
        if abs(abs(value) - k) > 1e-6 * k and abs(value - k) > 1e-6 * k:
            assert g["pass"] is O.passes(metric, value, k), (name, i, value, k)


def test_levels_sheet_metrics_are_live_formulas(book):
    ws = book("eq_up").wb["Levels"]
    cols = levels_cols(book("eq_up").wb)
    for key in ("dmu", "dsum", "ssmd", "zprime", "err"):
        v = ws[f"{cols[key]}2"].value
        assert isinstance(v, str) and v.startswith("="), (key, v)
    assert "NORM.DIST" in ws[f"{cols['err']}2"].value.upper()
    ov = ws[f"{cols['ovl']}2"].value
    assert isinstance(ov, (int, float))  # ovl is a value, not a formula
    # live: change kTarget on Inputs and 'pass' follows
    x = book("eq_up")
    inputs_ws = x.wb["Inputs"]
    ktarget_cell = [c.coordinate for row in inputs_ws.iter_rows() for c in row
                    if isinstance(c.value, str) and "target" in c.value.lower()][0]
    kcell = "B" + ktarget_cell[1:]
    pas = cols["pass"]
    lo = x.run({("Inputs", kcell): 0.001}, [("Levels", f"{pas}2")])[0]
    hi = x.run({("Inputs", kcell): 1e9}, [("Levels", f"{pas}2")])[0]
    assert lo is True and hi is False


def test_editing_the_equation_in_excel_changes_the_model(book):
    """The documented way to change the model is to edit Calculator!B2/B3: dependents must follow."""
    x = book("eq_up")
    (m, s_) = x.run({("Calculator", "B1"): 10.0}, [("Calculator", "B2"), ("Calculator", "B3")])
    assert s_ == pytest.approx(math.sqrt(15**2 + (0.08 * m) ** 2), rel=1e-12)
    # overriding the mean cell (as a user typing a formula would) flows into sd
    (s2,) = x.run({("Calculator", "B2"): 1000.0}, [("Calculator", "B3")])
    assert s2 == pytest.approx(math.sqrt(15**2 + 80**2), rel=1e-12)


def test_data_sheet_per_level_stats_replicates(book):
    x = book("repl")
    ws = x.wb["Data"]
    hdr_row = None
    for r in range(1, ws.max_row + 1):
        vals = [str(ws.cell(row=r, column=c).value).strip().lower() for c in range(1, 7)]
        if vals[:4] == ["c", "mean", "sd", "n"]:
            hdr_row = r
    assert hdr_row, "per-level c/mean/SD/n/CV table not found"
    assert str(ws.cell(row=hdr_row, column=5).value).strip().lower() == "cv"
    concs, cells = REPL["replicates"]["concs"], REPL["replicates"]["cells"]
    for j, (c, col) in enumerate(zip(concs, cells)):
        vals = np.array([v for v in col if v is not None], dtype=float)
        r = hdr_row + 1 + j
        got = [x.get("Data", f"{L}{r}") for L in "ABCDE"]
        assert got[0] == pytest.approx(c)
        assert got[1] == pytest.approx(vals.mean(), rel=1e-12)
        assert got[2] == pytest.approx(vals.std(ddof=1), rel=1e-9)
        assert got[3] == len(vals)
        assert got[4] == pytest.approx(vals.std(ddof=1) / vals.mean(), rel=1e-9)


def test_no_replicates_data_sheet_is_still_present(book):
    assert "Data" in book("eq_up").wb.sheetnames


# ---------------------------------------------------------------------------------------------
# export edge cases (no 5xx; sensible)
# ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["ü", "μ", "日本語", "ünïcödé μ"])
def test_non_ascii_series_names_export(client, name):
    r = client.post("/api/export", json={"series": {**EQ_UP, "name": name}})
    assert r.status_code == 200, (name, r.status_code)
    r.headers["content-disposition"].encode("ascii")  # must be representable
    assert r.content[:2] == b"PK"


@pytest.mark.parametrize("name", ["a/b", "x:y*z?", "  spaced  ", "", "a" * 200, "q\"uote", "line\nbreak"])
def test_unusual_series_names_still_export(client, name):
    r = client.post("/api/export", json={"series": {**EQ_UP, "name": name}})
    assert r.status_code == 200, (name, r.status_code, r.text[:200])
    assert r.content[:2] == b"PK"
    assert "attachment" in r.headers["content-disposition"]
    openpyxl.load_workbook(io.BytesIO(r.content))


def test_export_with_degenerate_levels_and_one_row_tables(client):
    for s in [{**EQ_UP, "levels": [0]}, {**EQ_UP, "levels": []},
              {**SUMM, "summary": [{"c": 0, "mean": 5, "sd": 1}], "cMax": 1},
              {**REPL, "replicates": {"concs": [0], "cells": [[1, 2, 3]]}, "cMax": 1},
              {**REPL, "replicates": {"concs": [0, 1], "cells": [[], [None]]}, "cMax": 1}]:
        r = client.post("/api/export", json={"series": s})
        assert r.status_code < 500, (r.status_code, r.text[:200])
        if r.status_code == 200:
            wb = openpyxl.load_workbook(io.BytesIO(r.content))
            assert wb.sheetnames == SHEETS


def test_export_invalid_expression_is_client_error_not_500(client):
    for bad in ({"meanExpr": "c +"}, {"sdExpr": "c"}, {"meanExpr": "S"}, {"meanExpr": ""}):
        r = client.post("/api/export", json={"series": {**EQ_UP, **bad}})
        assert 400 <= r.status_code < 500, (bad, r.status_code)
