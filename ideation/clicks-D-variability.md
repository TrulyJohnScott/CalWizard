# Click study D: variability and scale-up (Q31–Q40)

Driven live in the browser (http://localhost:5173, tab-4), branch `scientist-modes`, 2026-11-20. Starting state for every
question is the **Sandwich assay** gallery example (Sandwich 4PL, CRP ng/mL, 10 resolvable levels, SSMD ≥ 3) opened in the
Curve workspace. A click is a mouse click on a control. A typed field means focusing a field (one click), typing a value
and committing it with Enter or Tab. Hovers are listed separately. Numbers are copied from the screen.

Scene: the CEO and CSO stand behind the bench scientist (BS). Current data: 1 site, 3 readers, 5 days. Plan: 5 sites × 10
readers each, plus 1 year of stability.

---

### Q31. Add reader-to-reader variability (10 readers)

> **CEO:** We'll have ten readers per site. Put them in.
> **BS:** Variability tab, `+ Reader`... it comes in as 4 readers at 2% CV and 10% noise. Set it to 10.
> **CSO:** Where do 2% and 10% come from?
> **BS:** They're defaults. We'd have to measure them.
> **CEO:** And?
> **BS:** "Across reader, all 10 levels of a single run survive."

- **Answered:** yes. All 10 levels survive. The ladder stretches (top level 76.85 → 102.9 ng/mL), but the count stays 10.
- **Clicks:** 3 clicks + 1 typed field. Path: `Variability` tab → `+ Reader` → units field, type `10`, Enter.
- **Prerequisites:** 0 to try it. 1 to make it meaningful: a real reader CV, because the defaults are guesses and nothing marks them as unmeasured.
- **Visibility:** one level deep (the Variability tab is in the top bar). `+ Reader` is on the tab's first screen.
- **Discoverability:** good. The units field is only labelled `×` (its tooltip says "units an experiment uses"). The
  sizes `offset / CV % / gain % / noise %` are bare labels, and their meaning is in hover titles only.
- **CLI:** no command adds a layer. You hand-edit `layers` in the Series JSON, then run `uv run calwizard budget SERIES`.

### Q32. Add day-to-day variability

> **CSO:** Days. We ran five.
> **BS:** `+ Day`. It defaults to 3 days, so I'll change it to 5.
> **CEO:** Still ten?
> **BS:** Still ten: "Across reader, day, all 10 levels of a single run survive."

- **Answered:** yes. 10 levels with Reader ×10 + Day ×5 (ladder top 140 ng/mL).
- **Clicks:** 1 click + 1 typed field once Q31 is done. From fresh: 2 clicks + 1 field (`Variability` → `+ Day` → units `5`).
- **Prerequisites:** 0, plus the same caveat about default sizes (Day defaults to CV 2%, everything else 0).
- **Visibility:** one level deep.
- **Discoverability:** good. The chain strip at the top (`one run 10 · + Reader 10 · + Day 10`) tells the story well.
- **CLI:** edit the JSON by hand, then `uv run calwizard budget SERIES`.

### Q33. Which source of variability dominates, and at which concentrations?

> **CEO:** So which one is hurting us?
> **BS:** The "where the spread comes from" bars are almost all grey, so it's within-run.
> **CSO:** How much, though? I need a number for the slide.
> **BS:** I have to hover each bar... 0: within-run 99%; 25 and up: within-run 89%, Reader 5%, Day 5%.
> **CEO:** And once sites are in?
> **BS:** (after Q34) Site takes 22% at 25 ng/mL and 26% at 100–500. Within-run still leads.

- **Answered:** partly. The answer is there, but the shares are hover-only. With Reader ×10 and Day ×5, within-run
  dominates everywhere: 99% at 0, 97% at 1, 91% at 5, 89% at 25/100/500 ng/mL; Reader and Day are 0→5% each. Adding Site at 5%
  CV gives Site 2% / 7% / 22% / 25% / 26% / 26% across 0…500.
- **Clicks:** 0 clicks after Q31–32, plus 6 hovers (one per level). From fresh: 4 clicks + 2 fields + 6 hovers.
- **Prerequisites:** 2 (at least one layer, with sizes).
- **Visibility:** the bars are visible. The percentages are **hidden** (bar title on hover); only the total SD is printed.
  No sentence names the dominant source or the concentration where the ranking flips.
- **Discoverability:** poor for a meeting. The CEO's question gets no one-line answer.
- **CLI:** `uv run calwizard budget SERIES` (shares per concentration in `rows[].layers[].share`).

### Q34. What survives (levels, LoD) at 5 sites × 10 readers? Add a site layer too.

> **CEO:** Five sites, ten readers each. What's left?
> **BS:** There's no `+ Site`, so `+ other`... it's called "Layer 3" with every size at zero. I'll rename it Site, 5 units, and guess 5% CV.
> **BS:** "Across reader, day, site, 9 of the 10 levels of a single run survive."
> **CSO:** And the LoD?
> **BS:** Limits tab: 1.17 ng/mL. It was 1.13 without layers, but this page doesn't say layers are on, and it doesn't show the before value.

- **Answered:** partly. 9 of 10 levels (chain: one run 10 → +Reader 10 → +Day 10 → +Site 9). LoD 1.17 ng/mL (LoB 0.613, LoQ
  1.68, quantifiable range 1.68–52.1). The 1.13 baseline comes from the Conditions table, not from Limits.
  **Model caveat:** the design is crossed (`10 readers × 5 days × 5 sites`, 1000 readings per level), so every reader
  reads at every site. "10 readers *at each* site" (50 readers, nested) cannot be expressed.
- **Clicks:** from fresh: 5 clicks (`Variability`, `+ Reader`, `+ Day`, `+ other`, `Limits`) + 5 typed fields (reader units, day
  units, site name, site units, site CV).
- **Prerequisites:** 3 (Reader and Day layers, a custom Site layer, and a site size you have to invent).
- **Visibility:** levels on the first screen of Variability. LoD is one level deep in another tab, and nothing there marks it as "with layers".
- **Discoverability:** `+ other` for the most common scale-up source (site) is a stretch. Limits, Separate and Requirements never mention
  that layers are on.
- **CLI:** hand-edit `layers`, then `uv run calwizard budget SERIES` (cumulative levels) and `uv run calwizard limits SERIES`.

### Q35. Add a second conjugate lot as its own curve and compare it with the first

> **CSO:** Lot 2 came in flatter. Put it next to lot 1.
> **BS:** `+ Add a condition` makes a copy called "Sandwich 4PL 2". I'll go to Curve, Equations, and change top 4000 → 3700, midpoint 40 → 48.
> **BS:** Back on Variability: lot 2 LoD 1.45, LoQ 1.96; lot 1 LoD 1.13, LoQ 1.53. Lot-1 samples read +28% to +62% on lot 2's curve.
> **CEO:** Why does lot 2 say "reference"?
> **BS:** The one you're editing becomes the reference.

- **Answered:** yes. Both have 10 levels. LoD 1.45 vs 1.13 ng/mL, LoQ 1.96 vs 1.53. "Reads on this curve" for lot 1 is +28.3% to
  +62.3%. "Between these 2 curves the blank moves by an SD of 0 and the response by 15.8%." `Use as a layer` is offered.
- **Clicks:** 5 clicks + 1 typed field (`Variability` → `+ Add a condition` → `Curve` → `Equations` toggle → edit μ(c) → `Variability`).
  Renaming to "Lot 2" adds +1 click + 1 field (name popover). With real data, paste replaces the formula edit.
- **Prerequisites:** 1 (the second lot's curve or data).
- **Visibility:** `+ Add a condition` is on the first screen of Variability (and in the name menu).
- **Discoverability notes:** (a) The copy becomes the reference, which reads backwards. (b) Default names are "X 2". (c) Loading a
  gallery example afterwards keeps the extra condition, so the table showed two rows both named "Sandwich 4PL".
  (d) My first formula edit (triple-click, type, Enter) did not stick; click + Ctrl-A + type + Tab did. I saw this once and did not narrow it down.
- **CLI:** `uv run calwizard compare lot1.json lot2.json`.

### Q36. One reader reads 5% high: enter it and show its effect

> **CEO:** Reader 7 at site 3 reads 5% high. What does that do?
> **BS:** Each layer has a "known bias" line, so `signal + 5 %` on Reader.
> **BS:** Levels don't change. In the error budget, 5 ng/mL goes to +5.3% bias, 25 to +6.8%, 100 to +17%. Within 30%: 2 of 5 → 1 of 5.
> **CSO:** That's every reader being 5% high, not one.
> **BS:** ...yes. There's no way to say "one of the ten".

- **Answered:** partly. The bias is entered and shown (with Reader/Day/Site on): bias +8.7% at 1, +5.3% at 5, +6.8% at 25,
  +17% at 100 ng/mL; within 30% drops from 2 of 5 to 1 of 5. Levels and LoD are unchanged (by design, §24). It models
  the whole reader population being 5% high, not one outlier among N.
- **Clicks:** 1 typed field once a Reader layer exists. From fresh: 2 clicks + 1 field.
- **Prerequisites:** 1 (Reader layer).
- **Visibility:** visible on the layer card (`known bias`), but it is small and there's no hint that it only changes the error budget.
- **Discoverability:** OK for "the reader type reads high". Misleading for "one unit reads high".
- **CLI:** set `biasPct: 0.05` on the layer in JSON, then `uv run calwizard tolerance SERIES`.

### Q37. Error budget per level against an allowed total error of 20%

> **CSO:** Our claim is ±20% total error.
> **BS:** Error budget, bottom of Variability, allowed total error 30 → 20.
> **BS:** Plain curve: only 5 ng/mL passes (±19.1%). 25 is ±21.8%, 1 is ±61%, 100 is ±54%.
> **CEO:** With sites and the biased reader?
> **BS:** 0 of 5.

- **Answered:** yes. Fresh Sandwich at TEa 20%, k 2: within at 1 of 5 levels (1: ±61%, 5: ±19.1%, 25: ±21.8%, 100: ±54.4%,
  500: ±293.73%). With Reader/Day/Site + reader bias 5%: 0 of 5 (±73.2 / 27.9 / 33.6 / 84.1 / 454.34%).
- **Clicks:** 1 click + 1 typed field (`Variability` → allowed total error `20`).
- **Prerequisites:** 0.
- **Visibility:** one level deep, below the fold. The per-source breakdown (SD % per source) is hover-only.
- **Discoverability:** fine, but "per level" means the 5 table concentrations, not the 10 resolvable levels in the headline.
  The 500 ng/mL bar (±294%) shows only that the curve is flat there.
- **CLI:** `uv run calwizard tolerance examples/sandwich.json --tea 0.2`.

### Q38. How big must the multi-site precision study be to size each source?

> **CEO:** How big a study do we fund?
> **BS:** "2 · Plan" says: with 10 readers × 5 days × 5 sites × n = 4, Site SD 74 would be estimated anywhere from 31 to 112.
> **CSO:** So what do we need for ±25%?
> **BS:** It won't solve for that. I have to keep changing the unit counts and watch the range. And n is set back in the Curve tab, under Experiment.

- **Answered:** partly. The app sizes a given design but doesn't solve for one. 90% range of SD estimates at c = 25: within 120
  → 111–128, Reader 29.6 → 15–40, Day 29.6 → 11–46, Site 74.1 → 31–112. There is no target precision → required units/n.
- **Clicks:** 0 more once layers exist. From fresh: 4 clicks + 5 fields (Q34 setup). Each what-if iteration is 1 more field.
  Changing n: `Curve` → Levels sidebar `Experiment` → n field → back (3 clicks + 1 field).
- **Prerequisites:** 3 (layers with sizes, unit counts, n in another workspace).
- **Visibility:** visible on Variability, but n is **hidden** in another workspace. The two Plan columns (significant /
  meets separation target) have no headers, only hover titles. "100%–100%" reads oddly. The readings count and the
  per-source rows lagged (showed "16 readings" for 10×4 and "Layer 3 SD 0") for a moment after each edit.
- **Discoverability:** it answers "how well would this design do" but not the CEO's "how big".
- **CLI:** `uv run calwizard design SERIES --n 4`. The CLI default is n = 2, and the GUI showed n = 4.

### Q39. Paste real multi-reader results to dial in the predicted sizes

> **CSO:** Here's last week's data: 3 readers × 3 days, duplicates, 4 levels.
> **BS:** I have to add the Reader and Day layers first so the CSV headers match. Then paste into "dial in from real results", Estimate.
> **BS:** Measured: Reader offset SD 18.9, CV 0%; Day offset SD 40, CV 0%. It warns 3 units give a rough estimate (0.58–4.4×).
> **BS:** Adopt measured → 8 of 10 levels.

- **Answered:** yes, with caveats. The table I invented had 72 rows (`c,Reader,Day,y`; readers ×1.00/1.05/0.97, days ×1.00/1.02/0.99).
  Measured Reader offset SD 18.9 and Day offset SD 40, both CV 0% (predicted CV 2%). Notes: "gain and proportional CV cannot be
  told apart… reported together as CV", and "3 units give a rough estimate". After Adopt: 8 of 10 levels (one run 10 →
  +Reader 9 → +Day 8). The proportional effect I generated came back as an offset with CV 0%, which contradicts the note's wording.
- **Clicks:** 5 clicks + 1 pasted field (`Variability` → `+ Reader` → `+ Day` → paste → `Estimate` → `Adopt measured`).
- **Prerequisites:** 2 (layers whose names exactly match the CSV headers; data in long format).
- **Visibility:** visible on Variability (the textarea placeholder shows the expected header).
- **Discoverability:** decent. Bug: the measured-vs-predicted panel **persisted after loading another example** and still showed
  Reader/Day results under a series whose only layer was "Month".
- **CLI:** `uv run calwizard dialin SERIES data.csv` (it reports only; no adopt/write-back).

### Q40. Model one year of stability drift (−1%/month)

> **CEO:** Twelve months on the shelf, minus 1% a month. Show me month 12.
> **BS:** There's no stability or time feature. I can fake it: `+ other`, "Month", 12 units, CV 3.5% (the spread of a 0 to −12% ramp), known bias −6% (the average).
> **CSO:** That's the average, not month 12.
> **BS:** Right. For month 12 I'd set bias −12% and drop the CV. It's arithmetic I did in my head.

- **Answered:** no (workaround only). With the stand-in layer: 10 levels survive; within 30% at 1 of 5 (from 2); bias −6.3% at
  5, −8.1% at 25, −20.4% at 100 ng/mL. There is no time axis, no "at month m", and no drift-rate input.
- **Clicks:** 2 clicks + 4 typed fields (`Variability` → `+ other` → name, units, CV, bias), plus mental arithmetic.
- **Prerequisites:** 1 (a statistics conversion from drift rate to bias + CV).
- **Visibility:** not available.
- **Discoverability:** none. "Stability", "drift" and "shelf" appear nowhere in the spec or UI.
- **CLI:** none (the same hand-edited JSON layer, then `tolerance` / `budget`).

---

## Summary

| Q | Answered | Clicks | Fields | Prerequisites | Visibility |
|---|---|---|---|---|---|
| 31 Reader ×10 | yes (10 levels) | 3 | 1 | 0 (sizes are guesses) | one level deep |
| 32 Day | yes (10 levels) | 2 | 1 | 0 | one level deep |
| 33 Dominant source | partly (within-run 89–99%; Site 26% at ≥100) | 4 + 6 hovers | 2 | 2 | bars visible, % hover-only |
| 34 5 sites × 10 readers | partly (9 levels, LoD 1.17 vs 1.13; nesting not expressible) | 5 | 5 | 3 | one level deep + other tab |
| 35 Second lot | yes (LoD 1.45 vs 1.13, reads +28–62%) | 5 (+1 rename) | 1 (+1) | 1 | one level deep |
| 36 Reader 5% high | partly (bias +5.3…+17%; all readers, not one) | 2 | 1 | 1 | one level deep |
| 37 TEa 20% | yes (1 of 5 plain; 0 of 5 with layers) | 1 | 1 | 0 | one level deep, below fold |
| 38 Study size | partly (ranges for a given design; no solver) | 4 (+3 for n) | 5 (+1) | 3 | visible; n hidden in Curve |
| 39 Dial-in | yes (8 levels after adopt) | 5 | 1 paste | 2 | one level deep |
| 40 Stability drift | no (workaround) | 2 | 4 + arithmetic | 1 | not available |

Other things observed:
- Reloading with a 10 × 5 × 5 design hung the tab for over 60 s once (the browser tools timed out three times).
- UI state (what-if bar open, top 3818) came back on reload. localStorage is shared by every tab on the origin, so
  parallel sessions overwrite each other's state.
- AGENTS.md's CLI table omits `budget`, `design` and `dialin`, though they exist (`calwizard --help`).

## Fixes

1. **Q33, Q37: print the answer, don't hide it in hover.** Under the budget bars, add one sentence: "Within-run dominates at
   every level; Site is the largest between-run source above 25 ng/mL (26%)". Print each source's % inside or next to the bar,
   and the same for the error-budget SD % per source. Add CLI `budget --summary`.
2. **Q34: nested designs and a Site preset.** Add `+ Site` with sensible defaults, and a "within" (nested-in) choice per layer so
   "10 readers at each of 5 sites" means 50 readers, in the model (§22.1 variance unchanged; §22.3 draws and §22.4 ANOVA nested).
   Today every design is crossed.
3. **Q34, Q36, Q37: show layers wherever they change a number.** Limits, Separate, Requirements and Read should carry a chip like
   "with Reader, Day, Site (9 levels; one run: 10)" and show the one-run value beside each (LoD 1.17, one run 1.13).
4. **Q38: solve for the study size.** "Size each source to ±X%" → units per layer and n (from the χ² range already computed in
   §22.4 `rough`). Put n in the Plan block itself (it now lives in Curve → Experiment), label the two Plan columns, and align
   the CLI `design` default n with the GUI.
5. **Q40: stability as a first-class layer.** A "Time" layer with drift %/month and duration that shows the error budget and
   levels at month m (or at end of shelf life). Bias = rate × m, and the spread is derived for you, so no hand arithmetic.
6. **Q36: one-unit bias.** Let a known bias apply to "one of N units" (an outlier unit), not only to the whole layer, or make the
   label say "all readers read 5% high".
7. **Q35: condition hygiene.** Keep the original as reference (or let the user pick it); name new conditions "Lot 2" from the
   layer vocabulary; make loading a gallery example ask whether to clear or keep the other conditions; check that formula edits commit on Enter.
8. **Q39: dial-in robustness.** Clear stale dial-in results when the series changes. Auto-create layers from unknown CSV header
   columns instead of requiring them first. Make the "reported together as CV" note match the output (here the effect landed in
   offset with CV 0%). Add `dialin --adopt -o series.json` on the CLI.
9. **Agentic: a CLI way to add or edit layers** (`calwizard layer SERIES add Reader --units 10 --cv 0.02 -o out.json`), and list
   `budget`, `design` and `dialin` in AGENTS.md.
10. **Performance:** move `simulateDesign` off the main thread or cap its work; a 10 × 5 × 5 × n4 design made reload hang.
