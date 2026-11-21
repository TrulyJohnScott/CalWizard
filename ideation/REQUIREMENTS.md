# Cal Wizard — requirements and software ideas from the role-play study

Draft 1, 2026-11-20. Sources: persona scripts 1–8 and click studies A–E (all in this folder).

Click-study scorecard (50 questions): A curve 6 yes / 3 partly / 1 no; B limits 7 / 2 / 0 (+1 hidden); C thresholds
1 / 6 / 3; D variability 5 / 4 / 1; E data and sharing 6 / 4 / 0. Not available at all: hook detection, confusion
matrix, C5–C95, populations/PPV/NPV, stability drift. Note: the five click agents shared one browser storage, so some
saw each other's state (D-19); click counts hold, odd state changes in their notes may be cross-talk.

What the role-play concluded about the assay itself (sandwich example, all sources on): levels 10 → 7, LoD 1.13 →
1.39, upper LoQ 69 → 34 (the 2–60 range claim fails), lot is the largest source at the cut-off (≈20% of variance),
drift fails the error budget from month 9, and clinical error is dominated by healthy/diseased overlap (≈30 per 1000)
rather than assay noise (5.5–9 per 1000). The tool could show the first four; the last needed a scratch script.

How to read this: **D-** items are defects (wrong or misleading numbers), **R-** items are requirements (each with a
user story, acceptance criteria and the surfaces it must reach: CLI, API, GUI, report), **S-** items are larger software
ideas that several requirements share. Source tags: P1–P8 persona scripts, A–E click studies.

Caveat on evidence: the agents read the spec first and found things by text, so discoverability findings are optimistic,
and their "friction" is a model's guess at a scientist's. Defects marked *verified* were checked against the code;
the rest are reported and need a reproduction before fixing. Validate the top requirements with 3–5 real scientists
before building the large ones.

---

## 1. Defects (fix first: they give a wrong answer to a real question)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| D-1 | `separate` labels sensitivity/specificity by signal order, so on falling (competitive) curves they are swapped. Positive must mean the higher concentration. | `analysis.py:290–295` sorts by mean signal (P2) | **verified** |
| D-2 | Averaging reads divides the whole effective SD by √reads, including lot, site, day and stability layers. Only within-run (and reader noise when reads go to different readers) averages. With layers on, LoD 0.94 (pass) is really ≈1.04 (fail). | `limits.py:40` `model.sd(c)/sqrt(reads)`; `model.sd` includes layers (P6) | **verified** |
| D-3 | High-dose hook: the whole stack treats the falling side as usable. Upper LoQ lands past the peak (10000, CV 0.117); "range 5–5000" is reported met; the ladder counts levels on the falling side because the pass test uses \|SSMD\|; read-back returns one concentration flagged `ok` for a signal that matches two (10000 ng/mL strip reads 203); `recover` merges both ranges (148–10000). | click A Q9, P5 | reported twice, independently |
| D-3b | Curve direction is decided from the endpoints, so a fit whose end dips below the blank is treated as competitive (LoB at c = 1332, ULoQ signal −938,743). `fit` ranks such a fit first and reports a 5PL with a parameter at its bound as `ok`. `adjust.top` on a hooked curve is the signal in the hook, so "top ×1.5" is really ×3.75. | P5 | reported |
| D-3c | A `range` requirement checks the CV only at its two ends, not across the interval. | P5 | reported |
| D-4 | `plan` ignores layers (no lots/days, effects not shared within a lot) and ignores `limits.reads`; `limits` and `plan` disagree on the same file without warning. | P1, P4, P6 | reported |
| D-5 | `dialin` overestimates offset SDs (Reader 11.0 vs true ≈3.7): the per-concentration fit is unweighted, so high-end variances swamp the offset term. | P4 | reported |
| D-6 | Upper LoQ in table/replicate mode returns cMax (end of data) when the CV is still under target there. | P1 | reported |
| D-7 | Importer: a `;` anywhere in the preamble makes the file unreadable even with `--conc/--signal`; with a `C line` column only `Rep 1` is kept (silent data loss); template `cMax` and labels left in. | P3, `importer.py:54`, `:119` | reported |
| D-8 | `reads` honoured inconsistently: `distinguish` requirement ignores `limits.reads` while detect/precision/range use it; top-bar level count ignores the Limits averaging setting. | P1, click A Q5 | reported |
| D-9 | What-if keeps the separation threshold moving with the curve, hiding the effect of a weaker lot (10 ng/mL sample: 50% → 11% positive at the original threshold, but the tool shows no change). | click C Q29, P2 | reported |
| D-10 | Undo restores the model but the α field keeps the typed value. | click B Q20 | reported |
| D-11 | Requirements table: `range` row fails on the upper LoQ but displays the lower; `levels` row says "met (11)" with 9 of 11 below 60. | P3 | reported |
| D-12 | `design` output lacks `truth` per pair (spec §13 promises it); `compare` accepts a curve of the opposite direction silently (gainCv 1296%). | P6 | reported |
| D-14 | `design` draws every layer, including those switched off, and reports their `true` variance; `budget` gives off layers a null share. Either is defensible, but the spec must say which and the two must agree. | `layers.py:128` `lays = list(s.layers)` (P7) | **verified** (behaviour); intent unclear |
| D-15 | The sandwich example contradicts itself: stored replicates read ≈96 at c = 5, the equations 351; switching mode gives 4 levels / LoD 1.71 instead of 10 / 1.13. Fix the example and add the R-34 warning. | P1, P7 | reported twice |
| D-16 | `separate` shows two different n's without saying which is which: `nNeeded` = 2 (reads averaged per sample) next to `power.pPass` 0.32 at n = 3 (strips per group). | P2, P7 | reported |
| D-17 | Changing units only relabels: "500 ng/mL" becomes "500 ng/L", a silent 1000× error. | click E Q42 | reported |
| D-18 | Copy link and Save as JSON carry only the active curve (other conditions, workspace, Separate pair dropped); opening a link or loading an example silently overwrites the active condition. | click E Q45, Q47, Q49 | reported |
| D-19 | Autosave lives in one `localStorage` key shared by every tab, so two open tabs overwrite each other. | click E | reported |
| D-20 | Dial-in: results panel stays after loading another series (Reader/Day results under a series whose only layer is Month); a built-in 3–5% proportional effect comes back as offset with CV 0% (same family as D-5). | click D Q39–40 | reported |
| D-21 | Conditions: the new copy becomes the reference (reads backwards); loading an example keeps the extra condition, leaving two rows with the same name. | click D Q35, click E Q47 | reported twice |
| D-22 | Reloading with a 10 × 5 × 5 crossed design hung the tab for over 60 s. | click D | reported once |
| D-23 | Error budget `total` lets signed biases cancel: +3% site bias hides −6% drift; turning Site *off* raises the total at 10 ng/mL from 2.85 to 3.02. | P8 | reported |
| D-24 | A layer's `noiseCv` (e.g. Operator 10%) is booked to the "within run" row in `budget` and `tolerance`, so the layer's share is understated (Operator 2.9%). | P8 | reported |
| D-25 | `separate` ignores bias and the locked threshold: on a drifted model it reports 99.5% sensitivity at 14 ng/mL against 95.9% at the real calibrated cut-off. Same family as D-9; fixed by R-1/R-3. | P8, P2, click C | reported three times |
| D-13 | AUC shown as "1" when it is 0.99995; Separate mini-curve axis stuck at 0–15; card reads "144 – > 144". | click A, C | reported |

Each defect gets one regression test (lean: the case that was wrong), both languages where the math lives in both.

---

## 2. Requirements

### 2.1 Clinical cut-off and qualitative claims (the most requested gap: P2, P3, P6, click C)

**R-1 Clinical cut-off on the Series.** *As a developer of a qualitative or cut-off test, I set the decision
concentration once and every workspace uses it.*
- `cutoff: {c, reads?}` in the Series; a chip in the top bar; `--cutoff` on CLI/API commands that use a threshold.
- Separate reports sensitivity/specificity at the cut-off threshold; the "best crossing" becomes a secondary line.
- The threshold is shown in signal **and** concentration everywhere (today `separate` gives signal only).

**R-2 Cut-off characterisation (`calwizard cutoff`).** *I need C5/C50/C95 and false positive/negative rates around
the cut-off without leaving the tool.*
- Output: P(positive | c) curve, C5/C50/C95, FP/FN at ±20/±25/±50%, with layers on and per reads.
- GUI: a P(positive) S-curve with C5–C95 marked and the tails shaded as FP/FN; a "±x% around the cut-off" helper.
- Acceptance: matches a closed-form normal calculation for a linear curve with constant SD.

**R-3 Threshold fixed under change.** *When a lot is weaker or a what-if moves the curve, I see call rates at the
threshold we actually ship.* Lot-transfer table in `compare`: P(pos) at guard-band levels under the reference
threshold and under each lot's own threshold, plus shifted C50.

**R-4 Cut-off requirement kind.** `{kind: "cutoff", c, band: 0.25, minAgreement: 0.95}`, replacing misuse of
`distinguish` ("1 of 4 met" for a cut-off that works).

**R-5 Calls in Read.** Positive / Negative / Indeterminate (range straddles the cut-off) in Read, its Excel export and
`calwizard read --cutoff`; keep one-sided bounds for above/below rows (`≥ 240`).

**R-6 Threshold optimiser.** Pick the threshold for a target FP at c−x%, or minimise weighted FP/FN cost; show the
trade-off table.

**R-7 Visual-read layer (later).** Observer threshold relative to the control line, observer SD, card bias → its own
C5–C95 next to the reader's (P2).

### 2.2 Disease populations and clinical performance (P6, click C Q26, P7/P8 pending)

**R-8 Population model.** *I enter healthy and diseased concentration distributions and a prevalence, and see what the
assay does to patients.*
- Lognormal by median + 99th percentile (or pasted patient values); prevalence.
- Output: patient-level sensitivity, specificity, PPV, NPV, ROC with the cut-off marked, AUC (never rounded to 1).
- Separates the **biological overlap** (perfect assay) from the **analytical contribution** (our spread, with layers).
  P6's key insight (clinical error comes from overlap, not assay noise: 0.893/0.969 vs 0.891/0.966) came from a scratch
  script.

**R-9 Confusion matrix per 1000 tests** next to every threshold, for a pair and for a population.

**R-10 Reference-population markers.** The 99th percentile of healthy as a named marker on every chart; "% healthy above
LoD" and "CV at the 99th" as the two high-sensitivity criteria (P1).

### 2.3 Semi-quantitative bands (P3)

**R-11 User-defined bands.** `bands: [10, 40, 80, 200]` in the Series, `calwizard bands`: per-band confusion matrix for
single reads, grey zone per edge (c range where P(correct) < target), prevalence weighting (uniform, log-uniform or
pasted).
**R-12 Band requirement kind** and a **Band claim** section in report and Present, grey zones shaded on the axis.
**R-13 Edge optimiser.** Best k edges (maximise worst-band accuracy), or fixed edges → SD factor needed per edge.

### 2.4 Study planning and assurance (P1, P2, P4, P6, click B)

**R-14 Probability of demonstrating a claim.** *The CEO asks "with what confidence?"* `plan`/`design` take a target
(`--target-lod 1.0`, a pair, a LoQ CV, a cut-off agreement) and return P(study shows it) and the strips needed for
80/90% assurance. GUI: one pass probability per study, not a per-strip rate that reads like one.
**R-15 Solve for N.** The planner answers "how many", with EP17/EP12 minimums as defaults.
**R-16 Layer-aware planning.** EP17 LoD per lot × day × reader with lot effects shared within a lot; report per-lot
LoD and the worst lot. Fixes D-4.
**R-17 EP12 binomial planner.** N per level → P(pass), zero-failure bound; a single concentration allowed.
**R-18 Real designs.** n = 1 per cell allowed in `design`, `simulate`, `separate`; nested factors (readers within site,
days within site); `--max-strips`; strips printed next to each component's 90% range.

### 2.5 Solvers: "what would it take" (P1, P4, P6, click A Q4)

**R-19 Per-term noise targets.** When a requirement fails, solve per noise term ("proportional CV ≤ 7.2%", "floor ≤
y"), not only a global `sdScale`.
**R-20 Allowable spec per layer.** `calwizard allow SERIES --layer Lot --field gainCv`: the largest value per
requirement and per TEa level that still passes. Becomes the release spec.
**R-21 Cheapest route.** For an unmet claim, search noise scale, reads, midpoint and study size and return the cheapest
combinations as a table.
**R-22 Claim headroom.** For each met claim, how much noise or bias it tolerates before failing (SSMD 3.2 vs 3 = 6.5%).

### 2.6 Variability and the tolerance stack (P4, P6; P7, P8, click D pending)

**R-23 Reads average only what they average.** Fixes D-2: within-run always; reader noise only when reads go to
different readers; never lot, site, day or stability. Spec §15/§22.1 change, both languages, parity fixture.
**R-24 Fixed vs random sources in the stack.** Each layer marked "release limit ±X" (stacks linearly) or "random"
(root-sum-square); within-run always RSS. Replaces today's `worst`, which adds k·SD of within-run noise linearly (44% vs
23%, neither defensible in a risk file).
**R-24b Hybrid stack as the headline.** `Σ|bias| + k·√Σsd²` (systematic linear, random RSS): 3.50 ng/mL (35%) at
the cut-off, between today's total 2.85 and worst 6.55. Keep `total` and `worst` as secondary lines; warn when signed
biases cancel inside `|Σbias|`; `tolerance --tornado` for a per-source sensitivity bar; from the stack to the grey zone
and misclassification at the cut-off (P8).

**R-24c Probability of trial success.** Interim counts + planned cohorts + the analytical model (with drift and lot
spread for the new subjects) → P(CI lower bound ≥ bar), break-even sensitivity below which more subjects cannot help,
and cost per scenario. Futility rule as an output (P8: extending on ageing lots gave 7% vs 13.6% for doing nothing).

**R-25 Bias as a band.** `biasPct` as ±X (each unit somewhere in the band), as calibration specs are written.
**R-26 Bias-aware limits.** False-positive rate at the blank and detection rate at the LoD under each layer's known
bias, against the calibration's cut-off (+10 a.u. reader offset: 5% → ≈15% FP, today invisible).
**R-27 TEa with an absolute floor and a scope.** "±X ng/mL or ±Y%, whichever is larger"; levels below the LoQ judged
qualitatively or not at all.
**R-28 Stability as a time axis.** Drift as bias(t); `--age` on every command; claims, threshold error rates and the
error budget by month (0/6/9/12), with an "expiry-limited" flag. −10% drift changed no claim yet cost 12 points of
sensitivity (P6); −8% decay fails the 30% budget at the cut-off from month 9 (P7). "Use as a layer" must not turn
directional drift into random spread.
**R-29 Per-lot recalibration.** One- or two-point lot calibration factor and the residual bias after it.
**R-30 Honest few-unit estimates.** Uncertainty ranges on `compare.between` and per-unit effects from `dialin` with an
outlier flag ("R4 +6%"); fixes D-5 with a weighted fit or the offset taken from the blank.
**R-31 Condition sanity checks.** Warn on opposite curve direction, > 3× LoD jump, gainCv > 50%.
**R-32 Budget → action.** Name the dominant source per concentration with the lever that addresses it, in a printed
sentence under the bars ("within-run is 89–99% everywhere; Site takes 26% from 100 ng/mL"), with per-source
percentages printed, not hover-only, in both the budget and the error budget (click D Q33, Q37).

**R-32b Layers visible everywhere.** When layers are on, Limits, Separate, Requirements and Read say so and show the
one-run value beside the layered one (LoD 1.17 vs 1.13) (click D Q34, Q36).

**R-32c Better layer entry.** Presets for Site (and Lot, Operator, Month) with labelled starting sizes, not `+ other`
at zero; bias per unit ("one reader reads 5% high", not all readers); n lives in the Plan block with labelled
columns; CLI `design` default n matches the GUI; a CLI way to add a layer and to adopt dial-in results (click D).

### 2.7 Curve integrity (P1, P3, click A)

**R-33 Hook detection.** Find the peak; only the rising part (0 to peak) counts for ULoQ, ladder, range and
requirements; warn "above X reads like Y"; a signal matching two concentrations is flagged and `recover` returns both
ranges; hook field in `limits`, `report` and the claim sheet; a hook model in `fit`. Fixes D-3, D-3b, D-3c.

**R-33b Fit uncertainty carried to the claims.** Parameter SEs plus a bootstrap or jackknife band, so LoD, LoQ and
levels come out as ranges (dropping one pilot strip moved the midpoint 266 → 325). Fit ranking sanity: reject fits
that leave the data's signal range, flag parameters at their bounds, explain AICc jumps (P5).

**R-33c Sensitivity (tornado).** `calwizard sensitivity SERIES [--delta 0.2]`: each lever ±δ → levels, LoD, LoQ, ULoQ,
a chosen pair; GUI tornado chart. P5 needed 14 hand runs to learn that noise is the strongest lever and affinity only
shifts the window.
**R-34 Model vs data check.** When equation and replicates disagree beyond their SE, say so (blank SD model 15.5 vs data
2.5 in the sandwich example).
**R-35 Model sensitivity flag.** Mark requirement verdicts that flip between table interpolation and the best fit.
**R-36 One LoD to claim.** Name the claimable LoD among model / replicate-curve / classical, with n-adequacy notes
(EP17: ≥ 60 blanks). Return the best achievable CV and where, when a LoQ is null.
**R-37a Explain the ladder's top rung.** The greedy ladder's last rung moves non-monotonically as noise is added
(76.9 → 136 → 84.8) because it steps up from zero; report the resolvable range from the pass/fail band, not the last
rung, or say so (P7, P3).

**R-37 Say where resolution runs out.** "Resolvable 0–77 ng/mL; plateau above", curve regions annotated (blank-limited,
working range, plateau), the cut-off marked on the ladder.

### 2.8 Scenarios (P1, P5 pending, P6, click A/B)

**R-38 Side-by-side scenarios.** `calwizard whatif SERIES --scenario name:top=6000,cScale=0.5 ...` → LoB/LoD/LoQ,
CV at c, requirements per scenario as a table; GUI: saved scenarios as columns, before → after on every limit.
**R-39 Levers in the scientist's words.** "affinity ×" (midpoint × 1/a), "signal at 0" / "signal at top" (not
bottom/top on a falling curve), a separate blank-noise (floor) lever, a gain lever for "weaker lot".
**R-40 Scenario presets.** "Lot 10% weaker", "lot 10% noisier", "next site like Site B", with "which claims break
first".

### 2.9 Executive decision support (P6)

**R-41 Go / no-go card.** One line per claim: met or not, margin, probability the verification study will show it,
traffic light, no metric names. Top of Present and of `calwizard report`.
**R-42 Risk language.** "Neighbours confused 1 in 60" alongside "SSMD ≥ 3 · 1.7% misread"; hide or annotate Z′ when
SSMD governs.
**R-43 Decision memo export.** One page: question, answer, confidence, margin, three biggest risks, assumptions marked
guessed vs measured; scenario comparison variant for design reviews.
**R-44 Copyable headline.** `Copy headline` in Share/Present and `report --headline`: "N resolvable levels 0–cMax;
detects at LoD; quantifies LoQ–ULoQ (k-fold, CV%)".

### 2.10 Data in and out (P1, P3, P4, click B; E pending)

**R-45 Importer robustness.** Delimiter chosen by consistency; `Rep N` columns are replicates whatever else is present;
`--signal` takes several columns or a pattern; `cMax`, analyte and labels set from the data. Fixes D-7.
**R-46 Paste replicates where they are asked for.** A blank/low-level paste box on Limits, shown as an overlay that does
not silently replace the model's spread.
**R-47 `fit --apply`** writes an equations-mode series from the chosen fits.
**R-48 Column mapping for LIMS exports** in `dialin` (`--map "QC level=c,Strip lot=Lot"`).
**R-49 Quiet defaults.** `evaluate` prints the summary; the 501-point grid only with `--grid`. `read -o` also prints
rows. AGENTS.md rows for `budget`, `design`, `dialin`.

### 2.11 GUI discoverability (click studies A–C)

**R-50** `N levels` opens a popover listing the ladder, with a separate "Use as levels" (today clicking it overwrites
the user's levels and hover is the only way to read it).
**R-51** One "reads averaged" setting in the What-if bar, driving ladder, Separate, Limits and the top bar.
**R-52** Separate: state the strips for 95% power instead of making the user adjust until it does; use the words
sensitivity/specificity; mini-curve rescales to the pair.
**R-53** Limits: "set as requirement" on each limit card; mark the ULoQ on the precision profile; one-click from
"or SD ×0.69" into What-if with that value.
**R-54** Gallery cards and icon buttons have accessible names (screen readers and agents).
**R-55 Whole-project save and share.** Link and JSON carry every condition, scenario, the open workspace and the
Separate pair; the menu says what is included; ask before replacing the current work. Ctrl+S / Ctrl+O. A CLI command
for a share link and for the HTML report (`calwizard report --html`).
**R-56 Full Excel workbook.** Limits, Requirements, Read-back, Layers/budget and Conditions sheets, or rename it
"Curve and levels".
**R-57 Units are quantities.** Changing between convertible units asks "relabel or convert ×1000?"; the analyte name
appears in every chart, sheet and the read-back histogram; import sets the name from the file.
**R-58 Requirements at a glance.** A "3/3 met" badge next to the level count in the top bar; both ends of the
quantifiable range shown, not just "from 1.53".
**R-59 Named undo history.** Undo steps with names ("midpoint ×0.5", "add Reader layer"), so "the last three" is not
guesswork.

---

## 2.12 Verdict on the tolerance stack (spec §24), from P4, P7 and P8

- **Right currency:** per-source bias and SD converted to concentration through the slope. Keep it.
- **Wrong summaries:** `total = |Σbias| + k√Σvar` lets opposite biases cancel (D-23); `worst = Σ|bias| + kΣsd` adds
  independent random sources, within-run included, linearly (44–74% at the cut-off, which no reviewer accepts).
- **Missing:** a systematic/random flag per source (R-24), the hybrid headline (R-24b), bias per unit and as a band
  (R-25), drift as rate × age (R-28), a coverage statement for k, scope limits below the LoQ and an absolute floor
  (R-27), and the step from the stack to the grey zone and misclassification at a cut-off (R-2, R-24b).
- **Change:** headline = hybrid; `total` and `worst` stay as bounds; cancellation warning; tornado; cut-off mode.

---

## 2.13 The topics you named: coverage and whether the usability approach holds up

My appraisal, not the agents'. "Holds up" means it fits the house rules (one workspace per job, defaults that just work,
power on demand, no new control on every screen) and cuts the steps the click study counted.

| Topic | Where it came up | Proposed approach | Holds up? |
|---|---|---|---|
| Whole calibration curve, resolvability by concentration | P6 act III, P7, click A | Annotated regions (blank-limited / working / plateau / past the hook) on the Curve chart, a "resolvable 0–77, plateau above" sentence, ladder in a popover (R-37, R-50) | **Yes.** Answers with zero clicks on a screen people already look at. The hook part is now built (v3.9). |
| LoD: can we meet it, how sure | P1, P6, click B | Go/no-go line per claim with margin and P(verification shows it) (R-41, R-14); planner that solves for N (R-15) | **Yes, with care.** One line at the top of Present and Requirements, not a new panel. P(demonstrate) is the number the CEO asked for and can't get today. |
| Two concentrations: separable and thresholdable | P2, P6, click C | A clinical cut-off saved once on the series, used everywhere, chip in the top bar (R-1); P(positive) S-curve with C5/C50/C95 in Separate (R-2); rates at the shipped threshold (R-3) | **Yes: the strongest case.** Four scripts and a click study asked for it independently. A cut-off you set once removes the "which threshold is this?" confusion (679 vs 754). The fixed-threshold part is built (v3.9). |
| Thresholds, ROC, confusion matrices | P2, P6, P7, click C | ROC with the cut-off marked and a 2×2 per 1000 tests beside every threshold (R-8, R-9) | **Yes**, as long as they sit in Separate and the report, not on every screen. Per-1000 counts are the format executives read correctly. |
| Disease conditions, prevalence, PPV/NPV | P6, P7, P8 | Population layer: healthy and diseased distributions plus prevalence; clinical error split into biology vs assay (R-8, S-4) | **Yes, and it changes decisions.** Three scripts found clinical error is mostly biological overlap, which reframes "fix the assay" vs "change the cut-off". Needs a sensible default (median + 99th percentile entry) or nobody will fill it in. |
| Stacked variability budgets | P4, P7, P8, click D | Hybrid stack headline, fixed vs random per source, cancellation warning, tornado, printed dominant source (R-24, R-24b, R-32) | **Yes for the math, partly for the UI.** Printing "within-run dominates; Site takes 26% above 100" is a clear win. The tornado plus the error budget plus the stack table risk clutter: show one bar per level and the tornado on demand. |
| 1 site × 3 readers × 5 days → 5 sites × 10 readers × 1 year | P6 act V, P7, click D | Nested layers (readers within site), site/lot/operator presets, study-size solver, stability as a time axis with `--age` (S-3, R-18, R-28) | **Yes, but it's the biggest build.** Nesting fixes a real modelling error (crossed = 6000 strips; nested is what people run). Presets cut "+ other at zero" to one click. |
| Extending a clinical trial | P8 | P(trial success) from interim counts, cohorts and the analytical model, with break-even and a futility rule (R-24c) | **Promising, least certain.** It answered the question decisively in the script, but rests on assumed patient distributions. Ship it with the assumptions visible and editable, never as a bare probability. |
| CEO/CSO guiding a scientist; clicks and steps before a task | click A–E, P6 | Ask in the room's words: risk language, a copyable headline, "what would it take" solver (R-42, R-44, R-21) | **Mostly yes.** Biggest step-savers: the cut-off (Q21–30 had 1–3 setup steps each), the paste box on Limits (4 → 1), dominant source printed (6 hovers → 0). Caveat: the agents knew the spec, so real discoverability is worse than counted. |

Where the approach does **not** hold up as written:
- **Too many new sections.** Taken literally, R-8, R-9, R-24b, R-33c, R-38 and R-41 would each add a panel. Each should replace or extend something already there, or open on demand, to keep the app uncluttered.
- **Some items are math wearing a usability label** (R-19, R-20, R-21 solvers). They are valuable, but the usability is in how the answer appears ("met if proportional CV ≤ 7.2%" in the requirement row), not in a new solver screen.
- **Executive outputs** (go/no-go, decision memo) must show which numbers are measured and which are guessed. Otherwise they will overclaim the way the hook example did.

---

## 3. Software ideas (structures that several requirements share)

**S-1 Claims as first-class objects.** Today requirements are checks against the model. Make a *claim* = statement +
current value + margin + headroom (R-22) + assurance (P(study demonstrates it), R-14) + evidence (model / data / both,
R-34). The go/no-go card (R-41), decision memo (R-43), requirement kinds for cut-off and bands (R-4, R-12) and solvers
all read from it. One object, one CLI command (`calwizard claims`), every surface consistent.

**S-2 One solver framework.** R-13, R-19, R-20, R-21 and `sdScale` are the same operation: find the boundary value of a
lever at which a claim flips. A generic `solve(series, claim, lever, bounds)` with levers registered once (noise term,
layer field, reads, midpoint, N, edge position) gives every "what would it take" question for free.

**S-3 Variance model with structure.** Layers today are independent, crossed and applied per reading. Extending them
to: *scope* (per reading / per strip / per unit), *nesting* (reader within site), *kind* (random vs fixed-at-limit
band) and *time* (drift) fixes D-2, D-4, R-16, R-18, R-24, R-25 and R-28 with one change to the model rather than five
patches. Spec §22 gets a variance-component table; `reads` becomes "average over the per-reading scope".

**S-4 Population layer.** Distributions of true concentration (healthy, diseased, or a pasted cohort) convolved with the
analytical model. Gives patient-level sens/spec/PPV/NPV, ROC, band matrices with prevalence weighting (R-8, R-9, R-11)
and the analytical vs biological split. Also the basis for the trial-extension question (P8).

**S-5 Scenario engine.** Named what-if sets stored in the Series (`scenarios[]`), evaluated together; every result
command takes `--scenario` or `--all-scenarios`. GUI shows them as columns. Presets (R-40) are just stored scenarios.

**S-6 Usability benchmark.** Keep the 50 questions in `ideation/` as a benchmark: for each, the shortest GUI path and the
CLI command. Re-run the click agents after each version; track clicks, prerequisites and "not available" counts per
release. Pair it with 3–5 real-scientist think-aloud sessions on the same questions.

---

## 4. Suggested order

| Version | Scope | Why first |
|---|---|---|
| v3.9-correct | D-1, D-2/R-23, D-3/D-3b/D-3c/R-33, D-6, D-7/R-45, D-8, D-9, D-10, D-11, D-13 | wrong numbers reach slides and boards |
| v4.0-cutoff | R-1–R-5, R-9, R-50–R-53, R-55–R-59 (with D-17–D-19) | the single most requested gap; small GUI wins alongside |
| v4.1-claims | S-1, R-14, R-15, R-17, R-41, R-42, R-44 | "yes/no and with what confidence" |
| v4.2-variance | S-3, R-16, R-18, R-24–R-32c (with D-5, D-14, D-20, D-23, D-24) | multi-site, lots, stability: the scale-up story |
| v4.3-population | S-4, R-8, R-10, R-11–R-13 | clinical performance and bands |
| v4.4-solvers | S-2, S-5, R-19–R-22, R-38–R-40, R-43 | "what would it take", scenarios, decision memo |
