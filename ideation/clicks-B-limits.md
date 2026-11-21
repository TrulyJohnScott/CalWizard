# Click study B: limits (questions 11–20)

Method: driven live in the built-in browser at http://localhost:5173 (tab-2), on the Sandwich gallery example
(`Sandwich 4PL`: μ = 4000 + (50 − 4000)/(1 + (c/40)^1.2), σ = sqrt(15² + (0.08·S)²), cMax 500 ng/mL).
Starting state for every question: the Sandwich example just loaded from the gallery, Curve workspace open. Loading the
example (gallery button + card = 2 clicks) is not counted. "Clicks" counts mouse clicks and keys (Enter, digit keys for
workspaces); "fields" counts typed entries. Numbers are copied from the screen and cross-checked with the CLI.

---

### 11. What is our LoB?

> **CEO:** What's our limit of blank?
> **Scientist:** Clicks *Limits* in the top bar. First card, top left: "LoB 0.602 ng/mL, signal 75.53".
> **CSO:** So a blank reads up to 75.5 on the test line five times in a hundred?
> **Scientist:** Yes — the picture right underneath shades the 5% blank tail in orange against the LoB line.

- **Answered:** yes — LoB = 0.602 ng/mL (signal 75.53, α = 5%).
- **Clicks:** 1 (Limits tab, or key `3`). Fields: 0.
- **Prerequisites:** 0.
- **Visibility:** one level deep (workspace tab), then first screen.
- **Discoverability:** high. The tab tooltip literally says "LoB, LoD, LoQ…". A newcomer might look on the Curve first
  (the curve shows a `LoQ` mark but no LoB), but the tab name "Limits" is the obvious second guess.
- **CLI:** `uv run calwizard limits examples/sandwich.json --no-profile` → `lob: {signal: 75.53, c: 0.602}`.

### 12. What is our LoD?

> **CEO:** And the detection limit?
> **Scientist:** Same screen, the headline sentence: "Detects down to 1.13 ng/mL…". The LoD card adds "signal 103.7 · CV there 27%".
> **CSO:** 27% CV at the LoD — so we detect it but can't quantify it.
> **Scientist:** Right, the LoQ card next to it is higher.

- **Answered:** yes — LoD = 1.13 ng/mL (signal 103.7, CV 27%).
- **Clicks:** 1. Fields: 0.
- **Prerequisites:** 0.
- **Visibility:** one level deep, then headline (largest text on the page).
- **Discoverability:** high.
- **CLI:** `uv run calwizard limits examples/sandwich.json` → `lod.c = 1.126`.

### 13. What is our LoQ at 20% CV?

> **CSO:** LoQ at 20% CV?
> **Scientist:** Third card: "LoQ 1.53 ng/mL, signal 127". The "CV allowed at LoQ" field below already says 20%.
> **CSO:** And the top end?
> **Scientist:** Fourth card, "Quantifiable range 1.53 – 69.4, 45-fold".

- **Answered:** yes — LoQ = 1.53 ng/mL at 20% CV (upper LoQ 69.4 ng/mL).
- **Clicks:** 1 (a different CV: + 1 field). Fields: 0.
- **Prerequisites:** 0 (20% is the default).
- **Visibility:** one level deep.
- **Discoverability:** high. The settings row is unlabelled as "settings" but sits right under the cards.
- **CLI:** `uv run calwizard limits examples/sandwich.json --cv 0.2`.

### 14. Does the LoD meet a product spec? (target 1 ng/mL, just under today's 1.13)

> **CEO:** Our spec says detect 1 ng/mL. Do we meet it?
> **Scientist:** Looks on the Limits screen for a "spec" or "target" box — none. Goes to *Requirements*: there is already a
> line "Detect 2 ng/mL — met". Clicks the 2, types 1, Enter.
> **Scientist:** Now the header says "2 of 3 requirements are met", and the line reads "LoD is 1.13 ng/mL — met if the noise were 0.88× of today".
> **CEO:** So 12% less noise and we're there. Good.

- **Answered:** yes — not met (LoD 1.13 > 1.0); closes at noise × 0.88.
- **Clicks:** 1 (Requirements tab) + 1 click into field + Enter = 3. Fields: 1. (With no existing Detect row: + 1 click on
  `+ Detect`, + 1 field.)
- **Prerequisites:** 1 — know that specs live in a separate Requirements workspace; Limits has no link to it.
- **Visibility:** one level deep (another workspace).
- **Discoverability:** medium. The natural first look is next to the LoD card on Limits; nothing there says "set a
  target". Requirements links back to Limits ("See limits") but not the other way.
- **CLI:** `uv run calwizard requirements SERIES` (with `requirements: [{kind: "detect", c: 1}]` in the Series JSON —
  no flag to add a requirement on the command line).

### 15. Over what range is the CV under 20%? (precision profile)

> **CSO:** Show me where we're under 20% CV.
> **Scientist:** The "Quantifiable range" card already says 1.53 – 69.4 ng/mL. The precision profile chart below shows only
> the low end by default (0–6 ng/mL); clicks *Whole range* to see the CV climb back over 20% near the top.
> **CSO:** Why does it go bad at the top?
> **Scientist:** The curve flattens toward saturation, so the same signal noise means a wider concentration range.

- **Answered:** yes — 1.53 to 69.4 ng/mL (45-fold).
- **Clicks:** 1 for the number; 2 for the whole-range profile picture. Fields: 0.
- **Prerequisites:** 0.
- **Visibility:** number on first screen of Limits; upper end of the profile one toggle deep.
- **Discoverability:** high for the number. The profile defaults to "Low end", so the upper LoQ is not visible on the
  chart until the toggle is found. The 20% line is labelled; the ULoQ is not marked on the chart (only LoD and LoQ).
- **CLI:** `uv run calwizard limits examples/sandwich.json` → `loq`, `uloq`, `profile[]`.

### 16. How many blank and low-level replicates do we need for the LoD verification study?

> **CSO:** How many strips do we need to verify the LoD?
> **Scientist:** Scrolls down to "Plan the experiment that confirms it": 20 blank strips, 20 per low level, low levels 1.13
> and 2.25, plus 20 at the LoQ — 80 strips. "Your LoD estimate would land between 0.987 – 1.36 ng/mL in 90% of experiments (±16.4%)."
> **CSO:** That's what 80 strips give. I asked how many we *need*.
> **Scientist:** It doesn't solve for n. I'd have to type 40, 60… into the strip fields and watch the ± shrink until it's
> tight enough. And it doesn't say what EP17 asks for.

- **Answered:** partly — a design (20 + 20 + 20 + 20 = 80 strips) and its precision (±16.4%), not a required n.
- **Clicks:** 1 + scroll (planner is below the fold). Each trial n: + 1 field.
- **Prerequisites:** 1 — decide what "enough" means (target ± on the LoD); the app has no field for it.
- **Visibility:** one level deep, below the fold (scroll ~1.5 screens).
- **Discoverability:** medium. The section title "Plan the experiment that confirms it" is clear once scrolled to; the
  answer is the reverse of the question asked.
- **CLI:** `uv run calwizard plan examples/sandwich.json --n-blank 20 --n-low 20` (also forward only; loop over n by hand).

### 17. What's the probability the verification study passes?

> **CEO:** If we run that study, what are the odds it passes?
> **Scientist:** Reads the planner text: "Detected above the LoB: 1.13 ng/mL in 94.8% of strips". And for the LoQ: "the 20%
> claim is confirmed in 56.3% of experiments… claim a LoQ a little higher or run more strips".
> **CEO:** So 94.8% for the LoD?
> **Scientist:** No — that's the share of *strips*, not of studies. There's no "the LoD study passes in X% of runs" number.
> Only the LoQ part gives a per-study pass rate, and it's a coin flip.

- **Answered:** partly — LoQ confirmation passes in 56.3% of simulated studies; for the LoD only a per-strip hit rate
  (94.8%) and the spread of the estimate (0.987–1.36), no per-study pass probability (e.g. "≥ 95% of low strips above LoB"
  or "estimated LoD ≤ claim").
- **Clicks:** 1 + scroll. Fields: 0.
- **Prerequisites:** 0.
- **Visibility:** one level deep, bottom of page, inside running text.
- **Discoverability:** low — the pass probability is buried in the third paragraph of prose; "94.8%" invites the wrong reading.
- **CLI:** `uv run calwizard plan examples/sandwich.json` → `loq.pPass`, `detect[]`, `lodFound`; no LoD pass probability.

### 18. Enter our real blank and low-level readings (20 each) and estimate the LoD from data

> **CSO:** Here are our 20 blanks and 20 strips at 1 ng/mL. What LoD do *they* give?
> **Scientist:** Limits says "Load replicate readings with at least two blanks and one low level to also get the classical
> estimate from data" — but no button or box there. Goes back to *Curve*, clicks *Table*, finds the "quick add" field with
> the hint `0:48,52,47 1:55±2.5`. Types `0:48,52,…(20) 1:95,112,…(20)`, Enter. Toast: "Added 2 columns; the table now drives the curve".
> **Scientist:** Back to *Limits*: a new block "From your replicates": LoB 64.12 (rank-based 64.5, 0.303 ng/mL), LoD 0.716 ng/mL,
> pooled SD 12.3 with 19 df, "Against the curve 1.1×".
> **CSO:** Wait — the curve LoD also changed, from 1.13 to 0.665.
> **Scientist:** Because our readings replaced the model's SD at 0 and 1 ng/mL. So the "1.1× against the curve" is against the
> *new* curve, not the one we started with.

- **Answered:** yes — data LoD 0.716 ng/mL (LoB signal 64.12). Side effect: the curve's own LoD moved to 0.665 ng/mL.
- **Clicks:** Curve already open; Table tab (1) + quick-add field (1) + Enter (1) + Limits tab (1) = 4. Fields: 1 (40 numbers
  in a special `c:r,r,r` syntax). Alternatives: paste a reader CSV anywhere (replaces the whole series).
- **Prerequisites:** 2 — switch the input to Table mode; learn the quick-add syntax (or prepare a CSV).
- **Visibility:** hidden — the entry point is in another workspace, inside a mode tab, as a placeholder hint.
- **Discoverability:** low. A first-time user reads the Limits hint and looks for an input on Limits; nothing there.
  Entering data also silently changes the model being validated.
- **CLI:** put the replicates in a Series table and run `uv run calwizard limits SERIES` → `data` (or
  `uv run calwizard import readings.csv` then `limits`).

### 19. What if blank noise halved?

> **CEO:** What if we halved the blank noise?
> **Scientist:** Clicks *What if* (W). Levers: background, top, midpoint ×, noise ×. Sets noise × 0.5. The bar shows
> "levels 10 → 21, LoD 1.13 → 0.613, LoQ 1.53 → 0.777".
> **CSO:** That's *all* noise halved. I said the blank.
> **Scientist:** There's no blank-noise lever. I'd go to *Curve*, edit σ from `sqrt(15^2 + …)` to `sqrt(7.5^2 + …)`, Enter,
> back to *Limits*: LoB 0.364 ng/mL, LoD 0.694, LoQ 0.97 ng/mL. But that rewrites the model, and there's no before/after.

- **Answered:** partly/yes — all noise ×0.5: LoD 0.613, LoQ 0.777 (with before → after shown). Floor noise only (15 → 7.5):
  LoB 0.364, LoD 0.694, LoQ 0.97 ng/mL (no comparison shown; requires editing the formula).
- **Clicks:** all-noise: 1 (Limits) + 1 (What if) + 1 field + Enter = 3, 1 field. Blank-only: Curve stays open → 1 field
  (formula edit) + Enter + Limits tab = 2 clicks, 1 field — fast only for someone who reads the σ formula.
- **Prerequisites:** 1 — understand that the 15 in the σ formula is the floor (blank) noise.
- **Visibility:** What if is on the top bar (first screen); the blank-only route is hidden in a formula.
- **Discoverability:** medium for "noise ×", low for blank-only.
- **CLI:** what-if via the Series `whatIf` field then `uv run calwizard limits`; or edit `sd` in the JSON. No `--noise` flag.

### 20. Change α and β to 1% — what happens to LoB/LoD?

> **CSO:** Regulators want 1% false positives and negatives. What does that do?
> **Scientist:** On Limits, sets "false positives α" to 1 and "false negatives β" to 1. LoB 0.602 → 0.806 ng/mL (signal 86.11),
> LoD 1.13 → 1.55 ng/mL, and the LoQ is now pinned to the LoD at 1.55.
> **CEO:** What were the old numbers again?
> **Scientist:** I have to remember them — this screen shows no "was". And when I hit Undo, the numbers went back but the α box still said 1.

- **Answered:** yes — LoB 0.806 ng/mL (signal 86.11), LoD 1.55 ng/mL (CV 19.7%), LoQ = LoD = 1.55.
- **Clicks:** 1 (Limits) + 2 field clicks + 2 Enter = 5. Fields: 2.
- **Prerequisites:** 0.
- **Visibility:** one level deep, settings row on first screen.
- **Discoverability:** high (labelled "false positives α", "false negatives β", with tooltips).
- **Bug seen:** after Undo, the model reverts (LoD back to 1.13, caption "5% of blanks…") but the α input still shows "1".
- **CLI:** `uv run calwizard limits examples/sandwich.json --alpha 0.01 --beta 0.01`.

---

## Summary

| Q | Answered | Clicks | Fields | Prerequisites | Visibility |
|---|---|---|---|---|---|
| 11 LoB | yes — 0.602 ng/mL (signal 75.53) | 1 | 0 | 0 | one level (Limits tab) |
| 12 LoD | yes — 1.13 ng/mL | 1 | 0 | 0 | one level |
| 13 LoQ @ 20% | yes — 1.53 ng/mL (ULoQ 69.4) | 1 | 0 | 0 | one level |
| 14 LoD vs spec | yes — not met at 1 ng/mL; met at noise ×0.88 | 3 | 1 | 1 (know Requirements exists) | one level, other workspace |
| 15 CV < 20% range | yes — 1.53–69.4 ng/mL | 1 (2 for whole profile) | 0 | 0 | one level; chart upper end behind toggle |
| 16 Replicates needed | partly — 80-strip design gives ±16.4%; no required n | 1 + scroll (+1 field per trial) | 0+ | 1 (own precision target) | one level, below fold |
| 17 P(study passes) | partly — LoQ 56.3%; LoD only per-strip 94.8% | 1 + scroll | 0 | 0 | one level, buried in prose |
| 18 LoD from data | yes — 0.716 ng/mL (but curve LoD shifts to 0.665) | 4 | 1 (40 numbers, special syntax) | 2 (Table mode, quick-add syntax) | hidden (other workspace, placeholder) |
| 19 Blank noise ½ | partly — all noise ½: LoD 0.613; floor ½: LoD 0.694 | 3 (all) / 2 (formula) | 1 | 1 (read σ formula) | first screen (What if) / hidden (formula) |
| 20 α = β = 1% | yes — LoB 0.806, LoD 1.55 ng/mL | 5 | 2 | 0 | one level |

## Fixes

1. **Q18 — data entry where the hint is.** Under "Load replicate readings…" on Limits, add an inline two-column paste box
   ("blanks | low level(s)") that feeds the classical estimate. Keep the curve as is (data as an overlay, not replacing the
   model's SD), so "Against the curve" compares with the model being validated; say so if the table does drive the curve.
2. **Q17 — one pass probability per study.** Give the planner a headline: "This study passes in X% of runs" for the LoD
   (e.g. ≥ 95% of low strips above the LoB, or estimated LoD ≤ claim), next to the LoQ's 56.3%. Rename "94.8% of strips"
   to avoid reading it as a study pass rate. Mirror in `calwizard plan` (`lod.pPass`).
3. **Q16 — solve for n.** Add a target ("LoD within ±15%" / "passes in 90% of studies") and a "strips needed" answer;
   mention the EP17 minimums (e.g. 60 blanks to establish, 20 to verify) as the default. CLI: `plan --target`.
4. **Q20 / Q13 — show before → after on Limits.** When α, β, CV or reads change, show the previous value under each card
   ("was 1.13"), as the What-if bar already does. **Bug:** Undo restores α but the α field keeps showing the typed value —
   the settings inputs don't resync from the model.
5. **Q19 — a blank-noise lever.** Split "noise ×" into "blank noise ×" (floor) and "proportional noise ×", or add a
   `sd(0) ×` lever; the formula edit is the only route today and shows no comparison.
6. **Q14 — target next to the LoD card.** A "Spec: ≤ __ ng/mL" field or "Set as requirement" action on each limit card that
   writes a Requirements row and shows met / not met + the "noise ×0.88" gap in place.
7. **Q15 — mark the ULoQ on the profile** and default the profile to "Whole range" when the upper LoQ exists (or show both ends).
8. Minor: planner heading says "Simulates the EP17 design 400 times" while spec §15 says `runs = 500`; align one with the other.
