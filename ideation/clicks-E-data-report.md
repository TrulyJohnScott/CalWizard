# Click study E — data, reporting, sharing (Q41–Q50)

Scene: CEO and CSO behind a bench scientist. Start state for each question: app loaded with the **Sandwich** gallery
example. Driven in the built-in browser (tab-5) against http://localhost:5173. The pane was hidden, so pointer clicks
were not possible; every user action was replayed as one DOM event (`element.click()`, a value set on a field, an
Escape/Ctrl+Z keydown). Click counts are what a user would do; downloads and the OS print dialog were not completed.
Code paths cross-checked in `frontend/src/components/TopBar.tsx`, `Present.tsx`, `share.ts`, `api.ts`,
`state/store.ts`, `App.tsx`, `backend/app/export.py`.

Side observations during the run: the page reloaded twice mid-session (likely Vite HMR from other agents) and state
came back from `localStorage["calwizard.v2"]`, which every tab on the origin shares.

---

## Q41. Import our reader's CSV export

> **CEO:** We have the reader export. Get it in.
> **Scientist:** Clicks the name / `Cal Wizard` area… the Start panel opens: "Or bring your own data", a paste box.
> **CSO:** Paste it.
> **Scientist:** Pastes `Conc (ng/L),Signal` + 15 rows, clicks **Import**. Toast: "Imported 15 readings at 5 concentrations (Signal) · Undo".
> **CEO:** And it knew the units?  **Scientist:** Axis says ng/L — read from the header.

- **Answered:** yes. Table mode, 5 levels, units taken from `(ng/L)`. The series name stayed "Example" (not the file or analyte).
- **Clicks:** 2 clicks + 1 paste (Start button → paste in box → Import). Shortcut: Ctrl+V anywhere = 0 clicks + 1 keystroke; or drop a file.
- **Prerequisites:** 0 (CSV on clipboard).
- **Visibility:** one level deep (Start panel behind the "Examples and your own data" button; first visit opens it automatically). Paste-anywhere is hidden (one hint line in the Start panel).
- **Discoverability:** the top-left button's label ("Cal Wizard" / name) does not say "Import"; the Share menu has "Open… reader data", which helps.
- **CLI:** `uv run calwizard import reader.csv [--conc COL --signal COL --name N]`

## Q42. Rename the analyte and units so every chart says "cTnI, ng/L"

> **CSO:** This is troponin, not CRP. And ng per litre.
> **Scientist:** Clicks "Sandwich 4PL · CRP · ng/mL" in the top bar; a popover: Name, Analyte, Units, Signal.
> **Scientist:** Types cTnI, types ng/L, Esc.
> **CEO:** Limits, Separate, Requirements, the report — all ng/L now?  **Scientist:** Yes, zero "ng/mL" left.
> **CSO:** Wait — the numbers did not change. 500 ng/mL is now "500 ng/L"?  **Scientist:** It only relabels.

- **Answered:** yes (relabel). Axes read "cTnI (ng/L)", sentences and report follow. The read-back histogram says "Read-back concentration (ng/L)" and the Read sheet column says "Concentration" (no analyte); Excel axis says "Concentration (units)".
- **Clicks:** 1 click + 2 typed fields (+ Esc).
- **Prerequisites:** 0.
- **Visibility:** visible on first screen (top-bar chip shows analyte · units).
- **Discoverability:** good; risk: unit change silently keeps numbers (a 1000× error between ng/mL and ng/L), no warning or "convert values" offer.
- **CLI:** none (edit `analyte` / `units` in the Series JSON by hand).

## Q43. Export everything to Excel

> **CEO:** Put everything in a spreadsheet for finance.
> **Scientist:** Share → **Excel workbook**. Downloads.
> **CSO:** Does it have the LoD, the requirements, the read-back?
> **Scientist:** Sheets: Inputs, Grid, Calculator, Levels, Data. The read-back sheet is a separate Excel in Read. No limits, requirements, layers, conditions.

- **Answered:** partly. Curve and levels with live formulas; not "everything".
- **Clicks:** 2 (Share → Excel workbook) + browser save.
- **Prerequisites:** 0 (API must be running; export is server-side).
- **Visibility:** one level deep (Share menu).
- **Discoverability:** good; the menu subtitle ("live formulas for the curve and the levels") is honest about scope.
- **CLI:** `uv run calwizard export SERIES -o file.xlsx` (+ `calwizard read SERIES -o readback.xlsx`)

## Q44. Print / save a PDF claim sheet for the board pack

> **CEO:** I need a one-pager for the board.
> **Scientist:** Share → **Print or save as PDF**. The report opens full-screen, then the print dialog.
> **CSO:** Headline tiles: 10 levels, LoD 1.13, range 1.53–69.4, requirements 3 of 3. Good.

- **Answered:** yes (up to the OS dialog; "Save as PDF" is chosen there).
- **Clicks:** 2 (Share → Print or save as PDF). Alternative: P → Print = 1 key + 1 click.
- **Prerequisites:** 0 (requirements already in the Sandwich example; otherwise the section is thin).
- **Visibility:** one level deep.
- **Discoverability:** good — wording says PDF explicitly.
- **CLI:** `uv run calwizard report SERIES` gives the JSON content only; no PDF/HTML from the CLI.

## Q45. Send a link of exactly this state to a colleague

> **CEO:** Send Priya exactly what we are looking at.
> **Scientist:** Share → **Copy link**. "Link copied."
> **CSO:** Exactly? Including this workspace, the other lot we added, the A/B pair?
> **Scientist:** The link carries the active curve only (with its requirements, samples, layers, what-if). Not the workspace, not the other conditions, not the Separate pair.

- **Answered:** partly. `copyShareLink(d)` encodes `d.series` (active series) as `#s=`; workspace, conditions, Separate pair, experiment settings are dropped. Opening the link *replaces the receiver's active series* (`replaceActive`).
- **Clicks:** 2 (Share → Copy link) + paste in mail. Also from Present: 1 click.
- **Prerequisites:** 0.
- **Visibility:** one level deep.
- **Discoverability:** good; the "exactly this state" promise is not kept and nothing says what is left out.
- **CLI:** none.

## Q46. Switch to a clean presentation mode for the client call

> **CEO:** Client is joining. Clean screen.
> **Scientist:** Clicks **Present** (or P). Report full-screen: tiles, curve, limits, requirements, method. "← → to step · Esc to leave".
> **CSO:** Copy link / Save HTML / Print / Done are there too.

- **Answered:** yes.
- **Clicks:** 1 (or key P). Exit: Done / Esc.
- **Prerequisites:** 0.
- **Visibility:** visible on first screen (top bar).
- **Discoverability:** very good.
- **CLI:** none (`calwizard report` is the content).

## Q47. Compare two what-if scenarios side by side (current vs 2× affinity)

> **CSO:** What if the antibody had twice the affinity? Side by side with today.
> **Scientist:** What if (W) → "midpoint ×" = 0.5. Bar: levels 10 → 11, LoD 1.13 → 0.563, LoQ 1.53 → 0.764; dashed line keeps today's curve.
> **CEO:** That's a before/after strip, not side by side. And requirements dropped to 2 of 3 — where?
> **Scientist:** For a real table: name chip → + Add a condition → Esc → W → midpoint 0.5 → Keep as the curve → Variability (6). Table: Levels / LoD / LoQ per condition, curves overlaid.
> **CSO:** Why is it under "lots, readers, days"? And it's called "Sandwich 4PL 2".

- **Answered:** partly. Current vs *one* what-if: quick deltas. Two scenarios side by side: only by abusing conditions in Variability; the comparison has no requirements column, and names must be edited separately. "Affinity 2×" must be translated to "midpoint × 0.5" by the user.
- **Clicks:** quick delta: 1 click + 1 field. Side-by-side: 6 clicks + 1 field (+1 field to rename the condition).
- **Prerequisites:** 1 (a copy of the curve as a condition, made *before* changing it).
- **Visibility:** what-if visible on first screen; side-by-side hidden (Variability workspace, conditions section).
- **Discoverability:** poor for this goal. Trap found: loading an example afterwards silently overwrote the active condition and kept the other.
- **CLI:** `uv run calwizard compare A.json B.json` after hand-editing B (`adjust.cScale: 0.5`, then `calwizard bake B.json`).

## Q48. Undo the last three changes

> **CEO:** Undo those last three things.
> **Scientist:** Clicks the undo arrow three times (or Ctrl+Z ×3). Units back to ng/mL, analyte back to CRP, then the example load itself undone.
> **CSO:** Which three were they?  **Scientist:** It doesn't say; I watch the chip.

- **Answered:** yes. Each click one step; same-field typing bursts coalesce into one step; redo Ctrl+Shift+Z / Ctrl+Y.
- **Clicks:** 3 (or 3 keystrokes).
- **Prerequisites:** 0.
- **Visibility:** visible on first screen (icon only; tooltip "Undo (Ctrl+Z)").
- **Discoverability:** good; no history list or "Undo: units ng/L" label, so "the last three" is guesswork. Workspace / zoom / what-if UI are not history (by design).
- **CLI:** none (n/a).

## Q49. Save the project to a file and load it back

> **CSO:** Save it so we can reopen it next week.
> **Scientist:** Share → **Save as JSON** → `Sandwich_4PL.calwizard.json`.
> **CEO:** Load it back.  **Scientist:** Share → Open… → Choose a file… → pick it. Or drop it on the window.
> **CSO:** Our second lot came back too?  **Scientist:** No — only the active curve is saved.

- **Answered:** partly. Round-trip works for the active series; conditions are not saved (`saveJson(s)` writes one series). Autosave to localStorage also exists (silent, shared by all tabs).
- **Clicks:** save 2; load 3 + file pick (or 1 drag-drop).
- **Prerequisites:** 0.
- **Visibility:** one level deep (Share menu). "Save" living under "Share" is a slight mismatch.
- **Discoverability:** fine; Ctrl+S does nothing.
- **CLI:** the saved file is the CLI's SERIES input (`uv run calwizard evaluate Sandwich_4PL.calwizard.json`).

## Q50. Overall: which of our requirements are met, at a glance?

> **CEO:** Bottom line: do we meet the spec?
> **Scientist:** Requirements tab (or 5): "All 3 requirements are met." Detect 2 → LoD 1.13; Tell 5 from 10 → SSMD 5.07 (needs 3); Quantify 2–60 within 20% → quantifiable from 1.53.
> **CSO:** The top bar only shows "10 levels". Why not 3/3 up there?

- **Answered:** yes.
- **Clicks:** 1 (tab) or key 5; also tile "Requirements met 3 of 3" in Present (1).
- **Prerequisites:** requirements must exist (the Sandwich example has 3; a new assay has 0 → 1–5 adds + fields).
- **Visibility:** one level deep; nothing on the first screen (no met/total badge on the tab or top bar).
- **Discoverability:** good once in the tab; note "quantifiable from 1.53" on the range row hides the upper LoQ (69.4) that is the binding end.
- **CLI:** `uv run calwizard requirements SERIES`

---

## Summary

| Q | Answered | Clicks | Fields / keys | Prerequisites | Visibility |
|---|---|---|---|---|---|
| 41 Import CSV | yes | 2 (or 0 with Ctrl+V) | 1 paste | 0 | one level deep (paste-anywhere hidden) |
| 42 Analyte + units | yes (relabel only) | 1 | 2 fields + Esc | 0 | first screen |
| 43 Excel, everything | partly | 2 | 0 | 0 (API up) | one level deep |
| 44 PDF claim sheet | yes | 2 (to OS dialog) | 0 | 0 | one level deep |
| 45 Link of exact state | partly | 2 | 0 | 0 | one level deep |
| 46 Presentation mode | yes | 1 (or P) | 0 | 0 | first screen |
| 47 Two what-ifs side by side | partly | 1 (delta) / 6 (table) | 1 (+1 rename) | 1 (copy first) | first screen (delta) / hidden (table) |
| 48 Undo three | yes | 3 (or Ctrl+Z ×3) | 0 | 0 | first screen (icon only) |
| 49 Save + load file | partly | 2 save + 3 load (or drop) | 1 file pick | 0 | one level deep |
| 50 Requirements at a glance | yes | 1 (or 5) | 0 | requirements defined | one level deep |

## Fixes

1. **Q45, Q49 — save and share the whole project, not the active curve.** `copyShareLink` and `saveJson` take
   `d.series`; carry all conditions (and the active workspace / Separate pair in the link) and say in the menu what is
   included. Opening a link should add, or ask before replacing, rather than silently `replaceActive`.
2. **Q47 — scenarios as a first-class comparison.** "Save this what-if as a scenario" in the What-if bar (copies the
   curve with `adjust` applied as a condition, named e.g. "affinity ×2"), and a compare view with levels / LoD / LoQ /
   requirements met per scenario. Offer "affinity ×" as the user-facing lever (= 1 / midpoint ×). Loading an example
   must not silently overwrite the active condition when others exist.
3. **Q43 — "Excel workbook" should be the report in Excel:** add Limits, Requirements (met, value, SD factor),
   Read-back and Conditions sheets, or rename the item to "Curve and levels (Excel)".
4. **Q50 — requirements badge on the first screen:** "3/3 met" (or "2/3", red) next to "10 resolvable levels" and on
   the Requirements tab; on the range row show both ends ("1.53 – 69.4").
5. **Q42 — unit change guard:** when units change between convertible units (ng/mL → ng/L), ask "Relabel only, or
   convert all concentrations ×1000?"; also use the analyte in the read-back histogram, Read sheet and Excel axis.
6. **Q48 — named undo:** tooltip / toast "Undo: units ng/mL → ng/L" and a small history list on long-press.
7. **Q41 — name the door:** label the Start button "Data" or "Open / import", take the series name from the file name
   on import, and show "Ctrl+V to paste a reader export" as an empty-state hint on the Curve workspace.
8. **Q49 — Ctrl+S saves JSON, Ctrl+O opens;** move Save / Open out of "Share" into a File group (or rename the menu
   "File & share").
9. **Q44, Q45, Q46 — CLI parity:** `calwizard report SERIES --html out.html` (the same self-contained file) and
   `calwizard link SERIES` (prints the `#s=` URL) so the agent path matches the GUI.
10. **Robustness (observed):** autosave in `localStorage["calwizard.v2"]` is shared by every tab on the origin; two
    tabs overwrite each other. Key it per tab/session or warn when another tab changed it.
