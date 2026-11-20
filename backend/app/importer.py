"""Spec section 19: reader import. A delimited text export from a strip reader (a header row, then one row per
strip or per sample) becomes a replicate table. Ported to frontend/src/math/reader.ts (parity via the fixtures).

Supported shapes (after an optional preamble of non-table lines):
- long:  a concentration column and a signal column, one reading per row (`Conc, T, C, T/C`);
- wide:  a concentration column and replicate columns (`Conc, Rep 1, Rep 2, Rep 3`).
Tables whose header row is all numbers (concentrations across the top) are not reader exports: returns None.
"""
from __future__ import annotations

import re

NUM = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")
NUM_PREFIX = re.compile(r"^([-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)\s*[A-Za-z%/ ]*$")
BLANK = re.compile(r"^(blank|neg|negative|zero|nc|buffer|bkg|background)$", re.I)
CONC = re.compile(r"conc|dose|standard|^std$|level|calibrator|ng/|pg/|ug/|mg/|iu/|mol", re.I)
SKIP = re.compile(r"^(rep|replicate|well|strip|id|sample|no|n|index|time|date|lot|operator|run|day|position|pos|"
                  r"cassette|reader|name|#)$", re.I)
PREF = (re.compile(r"t\s*/\s*c|ratio", re.I),
        re.compile(r"test|^t$|t.?line|signal|intensity|peak|area|response|^od|rlu|^au$", re.I))
REPCOL = re.compile(r"^(rep|replicate|r|read|reading|strip|run|meas|measurement)?\s*#?\s*\d+$", re.I)
UNITS = re.compile(r"[(\[]\s*([^)\]]+?)\s*[)\]]")


def _clean(cell: str) -> str:
    t = cell.strip()
    if len(t) >= 2 and t[0] == '"' and t[-1] == '"':
        t = t[1:-1].strip()
    return t


def number(cell: str) -> float | None:
    """A plain number (comma decimals tolerated), else None."""
    t = cell.replace(" ", "")
    if "," in t and "." not in t:
        t = t.replace(",", ".")
    return float(t) if NUM.match(t) else None


def conc_number(cell: str) -> float | None:
    """A concentration cell: a number, a number with a unit suffix (`5 ng/mL`), or a blank word (0)."""
    t = cell.strip()
    if BLANK.match(t):
        return 0.0
    v = number(t)
    if v is not None:
        return v
    m = NUM_PREFIX.match(t)
    return float(m.group(1)) if m else None


def split(text: str) -> list[list[str]]:
    lines = [ln for ln in text.replace("\r", "").split("\n") if ln.strip() != ""]
    delim = "\t" if any("\t" in ln for ln in lines) else ";" if any(";" in ln for ln in lines) else ","
    return [[_clean(c) for c in ln.split(delim)] for ln in lines]


def _header(rows: list[list[str]]) -> int | None:
    for i in range(len(rows) - 1):
        cells = [c for c in rows[i] if c != ""]
        if len(cells) < 2 or all(number(c) is not None for c in cells):
            continue
        nxt = rows[i + 1]
        if sum(1 for c in nxt if conc_number(c) is not None) >= 2:
            return i
    return None


def _pick(names: list[str], want) -> int | None:
    if want is None:
        return None
    if isinstance(want, int) and not isinstance(want, bool):
        return want if 0 <= want < len(names) else None
    low = [n.lower() for n in names]
    w = str(want).strip().lower()
    return low.index(w) if w in low else None


def parse_reader(text: str, conc=None, signal=None) -> dict | None:
    """Parse a reader export. `conc` / `signal` choose columns by header name or 0-based index. None if the text is
    not a header-plus-rows table with a concentration column and at least one signal column."""
    rows = split(text)
    h = _header(rows)
    if h is None:
        return None
    names = rows[h]
    width = len(names)
    data = [r + [""] * (width - len(r)) for r in rows[h + 1:]]
    col = lambda j: [r[j] for r in data]  # noqa: E731

    def frac(j, fn):
        cells = [c for c in col(j) if c != ""]
        return sum(1 for c in cells if fn(c) is not None) / len(cells) if cells else 0.0

    cj = _pick(names, conc)
    if cj is None and conc is None:
        cj = next((j for j in range(width) if CONC.search(names[j]) and frac(j, conc_number) >= 0.6), None)
        if cj is None:
            cj = next((j for j in range(width) if not SKIP.match(names[j]) and frac(j, conc_number) == 1.0), None)
    if cj is None:
        return None
    used = [r for r in data if conc_number(r[cj]) is not None]
    if not used:
        return None

    def numeric_share(j):
        cells = [r[j] for r in used if r[j] != ""]
        return sum(1 for c in cells if number(c) is not None) / len(cells) if cells else 0.0

    cands = [j for j in range(width) if j != cj and names[j] != "" and not SKIP.match(names[j]) and numeric_share(j) >= 0.8]
    sj = _pick(names, signal)
    if signal is not None:
        if sj is None or sj == cj:
            return None
        sig = [sj]
    else:
        if not cands:
            return None
        if len(cands) >= 2 and all(REPCOL.match(names[j]) for j in cands):
            sig = cands
        else:
            sig = [next((j for j in cands if PREF[0].search(names[j])), None)]
            if sig[0] is None:
                sig = [next((j for j in cands if PREF[1].search(names[j])), cands[0])]
    groups: dict[float, list[float]] = {}
    for r in used:
        c = conc_number(r[cj])
        if c < 0:
            continue
        vals = [v for v in (number(r[j]) for j in sig) if v is not None]
        groups.setdefault(c, []).extend(vals)
    concs = sorted(groups)
    if 0.0 not in groups:
        concs = [0.0] + concs
    um = UNITS.search(names[cj])
    roles = ["conc" if j == cj else "signal" if j in sig else "candidate" if j in cands else "other" for j in range(width)]
    return {
        "concs": concs, "cells": [groups.get(c, []) for c in concs],
        "units": um.group(1) if um else None,
        "signalLabel": names[sig[0]] if len(sig) == 1 else None,
        "columns": [{"name": names[j], "role": roles[j]} for j in range(width)],
        "concCol": cj, "signalCols": sig, "rows": len(used), "header": h,
    }


def to_series(parsed: dict, base: dict | None = None) -> dict:
    """Series JSON (camelCase) for a parsed import, on top of `base` fields (name, metric, ...)."""
    out = dict(base or {})
    out.update(mode="replicates", replicates={"concs": parsed["concs"], "cells": parsed["cells"]}, summary=[],
               extraLevels=[], adjust=None)
    if parsed["units"]:
        out["units"] = parsed["units"]
    if parsed["signalLabel"]:
        out["signalLabel"] = parsed["signalLabel"]
    return out
