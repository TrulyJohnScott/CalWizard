# 3 — Five bands for a CRP strip (semi-quantitative persona)

**Persona:** Dr. Lena Kovac, assay development lead on a semi-quantitative CRP lateral flow assay read by a handheld reader.
**Also in the room:** Marcus (marketing lead), Priya (clinical affairs).
**Data:** a reader CSV export (made up but realistic) for lot CRP-L07, with 8 calibrators (0, 5, 10, 20, 40, 80, 160, 300 mg/L) and 6 replicates each. It has a reader preamble, a `C line` column, a blank cell at 40 and an `ERR` at 160. The reference runs were `examples/semiquant.json` (hCG bins) and `examples/reader.json`.
**Every number below comes from a real `uv run calwizard ...` call.** Scratch files are in
`%TEMP%\claude\...\scratchpad\personas\` (`crp_reader_export.csv`, `crp.json`, `crp_fit.json`, `bands.py`).

---

## Scene 1 — Getting the data in

*A small meeting room. LENA has a laptop hooked to the screen. MARCUS has a one-page brief titled "CRP Rapid — 5 clinical bands". PRIYA has a printout of a sepsis/antibiotic-stewardship guideline.*

**MARCUS:** Simple question. The brief says five bands: under 10, 10 to 40, 40 to 80, 80 to 200, over 200. Can the strip do it?

**LENA:** Let me load Thursday's reader run, then I'll tell you.

> [TOOL] `calwizard import crp_reader_export.csv --name "CRP L07"`
> → `{"ok": false, "error": "not a reader table: need a header row, a concentration column and a signal column (choose them with --conc / --signal)"}`

**LENA:** …It doesn't see a table.

> [TOOL] Retried with `--conc "Std Conc [mg/L]" --signal "Rep 1"`. Same error.

> [FRICTION] The reader preamble has `Method: CRP_semiquant_v3 ; read time 10 min`. That one semicolon makes `split()` choose `;` as the delimiter for the whole file (`importer.py:54`: "tab, else `;` if *any* line has one, else `,`"). The error says to choose columns, but naming them can't help when the delimiter is wrong. I only found the cause by reading the source. A scientist would have given up and retyped the numbers into Excel.

**LENA:** *(deletes the Method line in a text editor)* Again.

> [TOOL] `calwizard import crp_nosemi.csv` → exit 0, 8 concentrations. Every cell holds **one** reading: `[[0.027], [0.102], [0.193], …]`. `signalCols: [2]`, and the signal label is "Rep 1".

**LENA:** It kept Rep 1 and dropped the other five replicates. No warning.

> [FRICTION] The importer treats several `Rep N` columns as replicates only if *every* numeric candidate column has a replicate name. Every reader export I've seen also has a `C line` (control line) column, so the rule never fires and the tool quietly falls back to one column. The result looks plausible, which makes it the worst kind of error. Also, `--signal` takes one column name, so you can't say "Rep 1–6" from the command line.

> [TOOL] Deleted the `C line` column by hand (`cut -d, -f1-8,10`). Re-imported: 6/6/6/6/5/6/5/6 readings. The blank cell and the `ERR` were dropped correctly. The units `mg/L` were picked up from `[mg/L]`. The signal label came out as "Signal", the analyte was empty, and `cMax` stayed at 500 from the default template. I set analyte and signal label by editing the JSON.

**PRIYA:** So it took three tries and a text editor to load the data.

**LENA:** Two edits I'd have to remember for every reader run, yes. Moving on.

---

## Scene 2 — The headline number

> [TOOL] `calwizard evaluate crp.json` → `resolvable.n = 11`, levels `0, 1.299, 2.775, 4.625, 9.785, 14.68, 19.46, 26.72, 39.06, 59.67, 149.2`; rule `SSMD ≥ 3 · 1.7% misread`.

**MARCUS:** *(reading the screen)* Eleven resolvable levels. We need five. Done. Can I put "11-level resolution" on the sell sheet?

**LENA:** No. Look at where the eleven are. Nine of them are below 60 mg/L. The ladder steps from 59.67 to 149.2, and after that there's *nothing*. It can't find another level between 149 and 300 that passes.

**MARCUS:** But 200 is a band edge.

**LENA:** That's the problem.

> [FRICTION] The headline counts steps from the blank upward, and they pile up where the curve is steep and quiet. For a semi-quant product the question isn't "how many levels can I fit" but "can I resolve *these* five intervals". The `levels` requirement ("Resolve at least 6 levels") is marked **met (11)**, even though the band the client cares most about (>200) can't be resolved. That green tick is misleading.

> [FRICTION] It's also path-dependent. `ladder --k 3.29` (stricter, 1% misread) gives `…, 50.22, 96.72, 270.5`: still 11 levels, but now it *reaches* 270. A stricter rule climbing higher is correct for a greedy ladder, but it makes me distrust the count as a product claim. Two rules that both say "11" describe very different assays.

> [TOOL] Adjacent calibrator rows from `evaluate`: 80→160 SSMD **2.16** (fail, err 4.7%), 160→300 SSMD **1.95** (fail, err 8.3%), 5→10 SSMD **2.87** (just fails, err 1.1%).

**LENA:** Our own calibrators at 160 and 300 overlap. Single readings at those two levels misread about 8% of the time, and that's at the *centres*. A patient near the edge is worse.

---

## Scene 3 — Translating the brief into the tool

**PRIYA:** Then let's ask the tool exactly what the brief asks.

**LENA:** I can't, not directly. It has "detect", "distinguish c from c2", "precision", "range" and "levels". There's no "band". So I approximated: one `distinguish` per edge, using a representative concentration from each side.

> [TOOL] Added requirements, then `calwizard requirements crp.json` → **5 of 9 met**:
> - Detect 10 → met, value **LoD 0.99 mg/L**
> - 5 vs 20 → SSMD 10.8 ✓ · 20 vs 60 → 7.03 ✓
> - 60 vs 140 → **2.88 ✗**, sdScale **0.96**
> - 140 vs 250 → **1.77 ✗**, sdScale **0.59**
> - 160 vs 300 → 1.95 ✗, sdScale 0.65
> - CV at 40 ≤ 20% → 9.3% ✓
> - Quantify 10–200 within 20% → **✗, value shown 1.65** (that's the LoQ)
> - ≥ 6 levels → ✓ (11)

> [FRICTION] I made up "60 vs 140" and "140 vs 250" as band representatives. Choosing 140 instead of 120 changes the answer, so the requirement tests my choice of stand-ins, not the band edge. What I need is a requirement of the kind "edge at 80 mg/L, misclassify at most X% of samples within ±Y% of it".

> [FRICTION] "Detect 10" passes because the LoD is 0.99. Clinically, "<10" is a *cut-off*: a 12 mg/L sample must not read "<10". The LoD answers a different question. Even the shipped `semiquant.json` example models its "Negative below 10" this way.

> [FRICTION] The range requirement fails because the **upper** LoQ is 107.5 mg/L, short of 200, but the value column shows the lower LoQ (1.65). I read the failing row three times before I saw that.

**MARCUS:** "Met if the noise were 0.96× today." So we're 4% off on the 80 edge?

**LENA:** On a pair I chose myself. Hold on, it's worse than that.

---

## Scene 4 — Which curve do I believe?

**LENA:** Those numbers use the table interpolation (PCHIP through six-replicate means and SDs). The SD at 5 mg/L comes out at 0.0075 and at 10 mg/L at 0.020, a factor of 2.7 over one doubling of concentration. That's six-strip noise, not chemistry. Let me fit a model.

> [TOOL] `calwizard fit crp.json` → mean: 4PL `2.7 - 2.673/(1 + (c/143.1)^1.032)`, r² 0.978 (5PL is degenerate, g = 0.05 at its bound). SD: Floor+CV `sqrt(0.004531^2 + (0.08568*S)^2)`. That's an 8.6% CV, which matches what we see across lots.

> [FRICTION] `fit` returns expressions but no series. To *use* the fit I hand-wrote `crp_fit.json` (mode equations, paste both expressions, set levels and `cMax`). That should be a single `--apply` or `fit -o series.json`.

> [TOOL] Re-ran on the fitted model: `requirements` → 60 vs 140 now **SSMD 4.07 ✓**; 140 vs 250 **2.07 ✗** (sdScale 0.69); **upper LoQ 193.6** (was 107.5); ladder `… 39.4, 65.51, 119.5, 277.0`.

**PRIYA:** So the 80 edge passes or fails depending on a modelling choice?

**LENA:** Yes. The upper LoQ almost doubles. The tool shows each answer with confidence and never says "these two reasonable models disagree on your verdict".

> [FRICTION] No sensitivity readout for the model choice (interpolated vs fitted) and no uncertainty on SDs estimated from 5–6 replicates. A 6-replicate SD has a 95% CI of roughly ×0.6 to ×2.5. The pass/fail lines are sharp but the data behind them are not.

---

## Scene 5 — The question nobody's tool answers: misclassification per band

**PRIYA:** Here's what I'll actually be asked. A patient is at 70 mg/L. What's the chance the strip says 40–80, and what's the chance it says 80–200? Clinicians treat those bands differently.

**LENA:** The tool has the pieces but not the question. `separate` gives sensitivity and specificity for two concentrations, but at *its own* optimal cut-off.

> [TOOL] `calwizard separate crp.json 60 100 --n 2` → threshold signal **0.908** (that's c = **73.3 mg/L** by `inverse`), sensitivity 0.95, specificity 0.98, `nNeeded` 2.
> `calwizard separate crp.json 150 250 --n 2` → threshold 1.535 (c = 196.5), sensitivity **0.85**, specificity **0.88**, `nNeeded` **4**.

> [FRICTION] `--n 1` is rejected ("n must be between 2 and 1000"), same in `simulate`. A semi-quant strip is read **once**. The single-read case is the product, not an edge case.

> [FRICTION] The cut-off the reader firmware will use is the signal at the band edge (mean at 80 = 0.958), not the PDF crossing between two concentrations I picked. There's no way to fix the cut-off.

**LENA:** So I left the tool. I took the `evaluate` grid (mean and SD every 0.6 mg/L) and wrote 40 lines of Python. Cut-offs at the signal of each edge, Gaussian single reads, true concentrations spread evenly across each band.

> [TOOL — outside the tool] `bands.py` on the `evaluate` grid, edges 10/40/80/200, signal cut-offs 0.170 / 0.587 / 0.958 / 1.549:
>
> | true \ called | <10 | 10–40 | 40–80 | 80–200 | >200 |
> |---|---|---|---|---|---|
> | <10 | **94.8%** | 5.2 | 0 | 0 | 0 |
> | 10–40 | 1.7 | **93.9%** | 4.4 | 0 | 0 |
> | 40–80 | 0 | 4.2 | **86.8%** | 8.9 | 0 |
> | 80–200 | 0 | 0 | 6.4 | **80.6%** | 13.0 |
> | >200 (to 300) | 0 | 0 | 0 | 20.3 | **79.7%** |
>
> Grey zones (P(correct band) < 90%): edge 10 → **8.4–11.6**; edge 40 → **35.8–45.4**; edge 80 → **68.8–102.5**; edge 200 → **146.6–269.1** mg/L.
> With the fitted model: diagonal 96.1 / 93.2 / 85.7 / 84.8 / 79.9; edge-200 grey zone 158.7–270.9.

**MARCUS:** One in five patients over 200 gets called 80–200?

**LENA:** Of patients spread evenly between 200 and 300, yes. And I had to *assume* that spread. In a real ICU population the share near 200 is different, so the matrix depends on who walks in.

**PRIYA:** And a patient at 70?

**LENA:** 87% "40–80", 13% "80–200". At 90 it's 24% "40–80". At 180 it's 67/32. At 220, 34% are called 80–200.

> [TOOL] Cross-check inside the tool: `recover` at the 200-edge signal (1.549) → **132.1–300 (hiOpen)**; at the 80-edge signal (0.958) → **64.5–134.9**. A single reading right on the 80 cut-off fits anything from 65 to 135 mg/L at 95%.

> [FRICTION] The recover intervals say the same thing but in the wrong shape. A clinician needs "% wrong band", not "range in mg/L". The grey zone (the concentrations near an edge where the call is a coin toss) is the single most useful picture for this product, and I drew it in a script.

---

## Scene 6 — Where the edges *can* go

**MARCUS:** So which bands would you sign?

**LENA:** I tried two alternatives with the same script.

> [TOOL — outside the tool] Edges **10/30/60/150** (five bands, shifted down): diagonal 94.8 / 93.1 / **89.0** / 84.0 / **88.2**. Grey zones 27.3–33.7, 53.2–69.8, 115–207.
> Edges **10/40/100** (four bands): diagonal 94.8 / 93.9 / 88.0 / **93.9**. Edge-100 grey zone 82.9–141.4.

**LENA:** Two honest options. Four bands with a ">100" top: every band is about 88% correct or better. Or five bands with the top edge pulled down to 150, which is what the noise allows, not what the guideline says. The curve is flattening above 150 (mean 1.38 at 160, 1.91 at 300, SD ~0.2) and there's not enough signal left to split 80 from 200 from 300.

**PRIYA:** The guideline cut-offs are 10/40/80/200 for a reason. 40 versus 80 is where clinicians pick viral versus bacterial. I can live with 30/60 if we justify it, but I can't invent 150.

**LENA:** Then the honest claim is 10/40/80, with ">80" as the top band. Four bands.

> [FRICTION] There's no "suggest edges" for a *given number of bands*. The ladder answers "how many bands, starting from 0" but not "where do I put 4 edges so the worst band is as good as possible", or "these clinical edges are fixed, what SD do I need". I'd want both buttons.

**MARCUS:** What would it take to keep 200?

> [TOOL] `measure crp.json 140 250` → `whyNot.sdScale` **0.59**, `moveTo` **null** (nothing up to cMax passes from 140). `measure 80 200` → sdScale 0.955, `moveTo` 208.3.

**LENA:** Roughly 40% less noise at the top, or a curve that isn't flattening there. That means a different capture antibody concentration or a dilution step. And we haven't checked the hook. CRP in sepsis goes past 300, and our top calibrator *is* 300.

> [FRICTION] No hook check in this workflow. The read sheet calls anything above the curve top `above` and drops the range: P-10 at signal 2.1 → `c: null`, `lo: 240.4`, `resultLo: null`. For a band product, "≥ 240 at 95%" is a perfectly good ">200" call, and the tool throws it away. And signal 2.1 is within the replicate scatter at 300 (one 300 mg/L strip read 2.272).

---

## Scene 7 — What we show the client

**MARCUS:** I need something by Friday. What do I send?

> [TOOL] `calwizard report crp.json` → `{series, resolvable, rule, levels, rows, limits, limitsData, requirements, readback}`. `calwizard export crp.json -o crp.xlsx` → sheets Inputs / Calculator / Grid / Levels / Data (Levels = calibrator pairs only). `calwizard read crp.json -o readback.xlsx` → Results / About. On stdout, `read -o` prints only `{ok, path, bytes}`, so I ran it twice to see the rows.

**LENA:** The report leads with "11 resolvable levels", an LoD of 0.99 mg/L and an LoQ of 1.65. None of those are a band claim. The requirement rows say 5 of 9. The misclassification table, which is the one thing the client should see, isn't in there because I made it myself.

**PRIYA:** And the read-back sheet calls P-8 (176.6 mg/L, range 119–282) `aboveLoq`. A clinician reads that as "error". In band language it's "80–200, probably, could be >200".

> [FRICTION] The report has no "band claim" section and the read sheet has no band column. Exporting a claim sheet means pasting my script's table into PowerPoint next to the tool's report. Two sources of truth.

**MARCUS:** So the message is…

**LENA:** One: the strip resolves four clinical bands (<10, 10–40, 40–80, >80), each correct about 88% of the time or better on this lot. Two: within about ±15% of each edge the call can go either way. That goes on the label as a grey zone, not in the fine print. Three: a fifth band at 200 needs about 40% less noise at the top, or a dilution, and we've seen one lot, one reader and one day. No lot-to-lot or reader layers yet, so all of these numbers are optimistic.

**PRIYA:** I'll take that to the clinical advisory board. Lena, can you get the tool to produce the matrix so it's reproducible?

**LENA:** Not today. Today it's a script next to the tool.

---

## Commands that errored or that I distrust

- `import` with a `;` anywhere in the preamble → "not a reader table", even with `--conc/--signal`. **Bug.**
- `import` with `Rep 1…Rep 6` plus a `C line` column → silently keeps only `Rep 1`. **Bug (silent data loss).**
- `import` leaves `cMax: 500` from the template when the data top out at 300, and `signalLabel` "Rep 1"/"Signal". Harmless in replicates mode but confusing in the JSON.
- `separate … --n 1` and `simulate … --n 1` → "n must be between 2 and 1000". A single read is the product.
- `requirements` `range` row: fails on the upper LoQ (107.5) but reports the lower LoQ (1.65) as its value.
- `requirements` `levels` row: "met (11)" while two of four clinical edges can't be resolved.
- Verdicts flip between table interpolation and the fitted 4PL (60 vs 140: 2.88 ✗ → 4.07 ✓; upper LoQ 107.5 → 193.6) with no warning.
- `read` "above" rows: `lo: 240.4` known, but `resultLo: null`; the useful bound is dropped.

## Ideas mined

Ranked by how much each one unblocks the semi-quantitative claim.

1. **[math][CLI] Fixed user-defined bands** (`bands: [10, 40, 80, 200]` in the Series; `calwizard bands SERIES`) → per-band confusion matrix for single reads with cut-offs at the edge signals, plus a grey zone per edge (c range where P(correct) < target). *Friction: Scene 5, I had to write `bands.py` outside the tool.*
2. **[report][GUI] "Band claim" section** in the report and a Bands view in Requirements/Present: the matrix, grey zones drawn as shaded strips on the concentration axis, and one sentence per edge. *Friction: Scene 7, two sources of truth for the client.*
3. **[CLI] Importer robustness:** pick the delimiter by consistency over the header/data block (not "any line contains `;`"); treat `Rep N` columns as replicates even when other numeric columns (C line, T line) exist; let `--signal` take several columns or a pattern. *Friction: Scene 1, silent loss of 5/6 replicates.*
4. **[math] Band requirement kind** `{"kind": "band", "c": 80, "maxMisread": 0.1, "within": 0.15}` that replaces "distinguish two stand-in concentrations" and the LoD-based "detect" for cut-offs. *Friction: Scene 3, verdict depends on invented representatives.*
5. **[math][CLI] Edge optimiser:** "best k edges" (maximise the worst band's correct rate) and "fixed edges → SD factor needed per edge". *Friction: Scene 6, no way to ask where 4 edges should go.*
6. **[CLI][math] Allow n = 1** in `separate` and `simulate` (power/t-test fields null), since single-read classification is the semi-quant use case. *Friction: Scene 5 rejection.*
7. **[math][report] Model-sensitivity flag:** run requirements under the table interpolation and the best fit, and mark rows whose verdict flips; optionally show SD confidence from replicate n. *Friction: Scene 4, 107.5 vs 193.6 uLoQ.*
8. **[CLI] `fit --apply`** (or `fit -o series.json`) that writes an equations-mode series from the chosen mean/SD fits. *Friction: Scene 4, hand-editing JSON.*
9. **[report][GUI] Read-back band column** and keep one-sided bounds for `above`/`below` rows (`≥ 240`, `≤ 1.0`), so ">200" calls survive. *Friction: Scene 6/7, P-10 range dropped, P-8 "aboveLoq" reads as an error.*
10. **[GUI] Requirement value fix:** the `range` row should show the failing bound (upper LoQ 107.5), and the `levels` row should say *where* the levels sit (e.g. "11 levels, 9 below 60"). *Friction: Scene 3.*
11. **[math] Prevalence weighting** for the band matrix (uniform, log-uniform, or a pasted patient distribution), because band accuracy depends on who is tested. *Friction: Scene 5, "I had to assume that spread".*
12. **[CLI] `read -o` also prints rows** (or a `--both` flag), and `import` sets `cMax`/analyte sensibly from the data. *Friction: Scene 7 / Scene 1.*
13. **[math][GUI] Hook-risk note** when the highest calibrator's replicate spread reaches the top read range, or when `above` reads sit within the top calibrator's scatter. *Friction: Scene 6, CRP >300 in sepsis.*
