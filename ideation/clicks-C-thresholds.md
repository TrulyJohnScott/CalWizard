# Click study C: thresholds and clinical questions

Driven live in the browser (tab-3, http://localhost:5173, Sandwich gallery example: `4000 + (50 - 4000)/(1 + (c/40)^1.2)`,
σ = `sqrt(15^2 + (0.08*S)^2)`, CRP ng/mL). Starting state for every question: Sandwich loaded, Curve workspace (1).
Clinical cut-off used throughout: **10 ng/mL**; ±25 % samples: **7.5 and 12.5 ng/mL**.
Clicks count mouse clicks; "fields" count typed values (each value = select + type + Enter). Scrolls are listed separately.
Numbers marked *(off-screen)* were computed outside the app (same model) to show what the app could not.

---

### Q21. Set a clinical cut-off concentration and show the signal threshold that calls it.

> **CEO:** Our cut-off is 10 ng/mL. What signal does the reader call positive at?
> **Scientist:** There's no "cut-off" field anywhere. Separate (2) has a "cut-off" on its picture, so I go there and type 10 into A.
> **Scientist:** The card under "A · 10 ng/mL" says 679.2 ± 56.4. That's the mean signal at 10.
> **CSO:** But the chart says "cut-off 753.9".
> **Scientist:** That's the best line between A and B (B is still 12.5 from before), not my clinical cut-off. The 679.2 is the threshold; the big "cut-off" label is something else.

- **Answered:** partly. Threshold signal = μ(10) = **679.2 a.u.** (read off the A card). The app's labelled "cut-off" is the A/B crossing (753.9 for 10 vs 12.5), which the CEO will read as the answer.
- **Clicks:** 2 clicks, 1 field — Separate tab · A field → type `10` ↵ → read "A · 10 ng/mL 679.2 ± 56.4".
- **Prerequisites:** 1 — know that a "cut-off concentration" is expressed as one end of an A/B pair (there is no cut-off concept).
- **Visibility:** one level deep (Separate), but the number is in a secondary card; the prominent "cut-off" means something different.
- **Discoverability:** low. A first-timer would read the dashed "cut-off" line and quote the wrong number.
- **CLI:** `uv run calwizard evaluate examples/sandwich.json --grid 10` (mean at 10); no cut-off command.

### Q22. Sensitivity and specificity for samples at ±25 % of the cut-off.

> **CSO:** Give me sensitivity and specificity at 7.5 versus 12.5.
> **Scientist:** Separate, A = 7.5, B = 12.5. "Best cut-off 645.4 — calls B correctly 99.7 % · A 99.8 %."
> **CSO:** Is that at *our* cut-off?
> **Scientist:** No — it's at the line the app picked between them (645.4), not at 10 ng/mL's signal (679.2). I can't pin the threshold.

- **Answered:** partly. At the app's best cut-off 645.4: sensitivity **99.7 %**, specificity **99.8 %**. At the clinical threshold 679.2 *(off-screen)*: sensitivity 98.8 %, specificity ≈ 99.99 %. The words "sensitivity / specificity" do not appear; it says "calls B correctly · A".
- **Clicks:** 3 clicks, 2 fields — Separate · A → `7.5` ↵ · B → `12.5` ↵ → "Best cut-off" card.
- **Prerequisites:** 1 — compute ±25 % by hand (no "±%" around a centre).
- **Visibility:** one level deep, "How well separated" block, second row.
- **Discoverability:** medium: the numbers are there, but the vocabulary is not clinical and the threshold is not the user's.
- **CLI:** `uv run calwizard separate examples/sandwich.json 7.5 12.5` → `threshold 645.4, sensitivity 0.997, specificity 0.998` (same limitation: no `--threshold`).

### Q23. Show the ROC curve / AUC.

> **CEO:** Where's the ROC curve?
> **Scientist:** There isn't one. Under "Overlap of the two spreads" in small grey text: "AUC 1 · d′ 5.51".
> **CSO:** AUC of exactly 1?
> **Scientist:** It's rounded — with a weaker curve it says 0.9999, so 1 is really 0.99995.

- **Answered:** partly. AUC **1** (displayed; true 0.99995), d′ 5.51 for 7.5 vs 12.5. No ROC plot anywhere (grep of frontend/backend: no "ROC").
- **Clicks:** 3 clicks, 2 fields (same as Q22) — AUC is in the subtitle of the Overlap tile.
- **Prerequisites:** 1 — the A/B pair.
- **Visibility:** hidden-ish (small grey subtitle); ROC curve not available.
- **Discoverability:** low for AUC; zero for ROC.
- **CLI:** `calwizard separate ... ` → `auc`; no ROC points.

### Q24. Show a confusion matrix per 1000 tests.

> **CEO:** Show me TP/FP/TN/FN per thousand tests.
> **Scientist:** Nothing like that. I can only turn "calls B correctly 99.7 % · A 99.8 %" into 997/3 and 998/2 in my head — and that's 1000 of each, not a population.

- **Answered:** no. Hand-derived: per 1000 samples at 12.5 → 997 TP / 3 FN; per 1000 at 7.5 → 998 TN / 2 FP (at 645.4).
- **Clicks:** 3 clicks, 2 fields + mental arithmetic.
- **Prerequisites:** 2 — A/B pair, and a prevalence the app does not take.
- **Visibility:** not available.
- **Discoverability:** n/a.
- **CLI:** none.

### Q25. How many replicates per sample for 95 % power to separate them?

> **CSO:** How many strips per sample to separate 7.5 from 12.5 with 95 % power?
> **Scientist:** Bottom of Separate, "In an experiment", there's a "strips per concentration" box set to 3: "t-test significant in 98.3 % of experiments". I try 2: 47.3 %. So 3.
> **CEO:** So no number that just says "3 for 95 %"?
> **Scientist:** No, I hunt for it. For 10 vs 12.5 the "What would resolve them" block does say "average 3 readings per sample" — but that's the SSMD rule, not power.

- **Answered:** yes, by trial: **3 strips per concentration** (98.3 %; 2 gives 47.3 %). The SSMD-target rate is separate: 82.5 % at n = 3.
- **Clicks:** 4 clicks, 3 fields, 1 long scroll — Separate · A `7.5` · B `12.5` · scroll to bottom · strips box → `2` ↵ (and back).
- **Prerequisites:** 1 — the A/B pair.
- **Visibility:** scroll far (last block of the page, box at far right).
- **Discoverability:** medium; the 47 % → 98 % jump between n = 2 and 3 is unexplained and there is no "n for target power" answer.
- **CLI:** `uv run calwizard separate examples/sandwich.json 7.5 12.5 --n 3` → `power.pSig`, `nNeeded`.

### Q26. Add disease populations (healthy vs diseased) with prevalence — PPV and NPV?

> **CSO:** Healthy population lognormal around 3 ng/mL, diseased around 20, prevalence 5 %. PPV, NPV?
> **Scientist:** There's no population, distribution or prevalence input anywhere — every workspace compares single concentrations.
> **CEO:** So we can't answer the question the regulator asks.

- **Answered:** no.
- **Clicks:** n/a (searched Curve, Separate, Limits, Requirements, Variability).
- **Prerequisites:** not possible.
- **Visibility:** not available (grep: no prevalence / PPV / NPV in code or spec).
- **Discoverability:** n/a.
- **CLI:** none.

### Q27. False positive rate at the cut-off for the healthy population.

> **CSO:** What fraction of healthy people test positive?
> **Scientist:** Without a healthy population, the nearest things are Limits' "false positives α" (5 % of blanks above the LoB) and in Separate "A 99.8 %" for one sample at exactly 7.5 → 0.2 % false positive.
> **CSO:** Neither is a population.

- **Answered:** partly (proxy): **0.2 %** false positives for a single concentration at 7.5 vs the 645.4 line; α = 5 % at the LoB for blanks.
- **Clicks:** 3 clicks, 2 fields (Separate pair).
- **Prerequisites:** 2 — A/B pair; a population the app cannot take.
- **Visibility:** proxy one level deep; real answer not available.
- **Discoverability:** low.
- **CLI:** `calwizard separate` → `specificity`; `calwizard limits` → LoB at α.

### Q28. The C5–C95 interval around the cut-off.

> **CSO:** Where do calls go from 5 % to 95 % positive?
> **Scientist:** Nothing gives C5/C95. I could take 679.2 ± 1.645·56.4, type 586.4 into Read and get 8.56 ng/mL… but σ changes along the curve so that's approximate, and I can't do the inverse properly.
> **CEO:** Too much hand-work for a standard CLSI EP12 number.

- **Answered:** no (workaround gives ~8.6 for C5). Exact *(off-screen)*: **C5 = 8.72, C95 = 11.70 ng/mL** at threshold 679.2.
- **Clicks:** workaround 5+ clicks, 3 fields + calculator.
- **Prerequisites:** 3 — threshold signal (Q21), σ at the threshold, the 1.645 arithmetic.
- **Visibility:** not available.
- **Discoverability:** n/a.
- **CLI:** none (could be assembled from `recover`/`evaluate` with scripting).

### Q29. A weaker lot (10 % less gain) — how do call rates at the cut-off change?

> **CEO:** A lot with 10 % less gain. What happens to our calls?
> **Scientist:** What-if (W) has background / top / midpoint / noise, no "gain". I compute top = 50 + 0.9·(3818 − 50) = 3441 and type it.
> **Scientist:** Separate now says cut-off 586.6, B 99.7 %, A 99.8 % — barely changed.
> **CSO:** That's because it moved the cut-off with the lot. The reader keeps the old 645.4 line. What then?
> **Scientist:** The app can't hold the old threshold, so I can't show it.

- **Answered:** partly. App: best cut-off moves 645.4 → **586.6**, calls 99.7 % / 99.8 % (re-optimised — misleading). With the threshold held *(off-screen)*: 12.5 ng/mL positives 99.7 % → 96.2 %; a sample exactly at 10 ng/mL called positive 50 % → 11 %.
- **Clicks:** 5 clicks, 3 fields — Separate · A `7.5` · B `12.5` · What-if · top → `3441` ↵ (plus "Back to the curve as measured" to undo; retyping 3818 did not restore exactly — the ladder shifted 6.753 → 6.754).
- **Prerequisites:** 2 — convert "10 % gain" to a top value by hand; the pair.
- **Visibility:** What-if one level deep (top bar); gain lever not available; fixed-threshold call rate not available. (§24's per-layer `biasPct` in Variability is a near-equivalent fixed shift, but it is about error budgets, not call rates.)
- **Discoverability:** low; the result looks reassuring and is wrong for the question.
- **CLI:** `calwizard separate` on a series with a what-if `top` (or `bake` first); no fixed-threshold option.

### Q30. Read a patient's signal back to a concentration with its range and a positive/negative call.

> **CEO:** Patient strip reads 720. Positive?
> **Scientist:** Read (4), type 720 in the first row: 10.6 ng/mL, 95 % range 9.05 – 12.9, CV 8.9 %, Note empty.
> **CSO:** Positive or negative?
> **Scientist:** The sheet doesn't know our cut-off. 10.6 is above 10, but the range straddles it — I'd call it indeterminate, by hand.

- **Answered:** partly. **10.6 ng/mL (9.05 – 12.9), CV 8.9 %**; no positive / negative / indeterminate call (flags are only below/LoD/LoQ/above).
- **Clicks:** 2 clicks, 1 field — Read tab · signal cell → `720` ↵.
- **Prerequisites:** 0 for the read-back; a call is not possible.
- **Visibility:** one level deep, first screen of Read.
- **Discoverability:** high for read-back; the call is missing. (Typing a second value straight after ↵ was lost once in testing — Enter may not advance focus reliably.)
- **CLI:** `uv run calwizard read examples/sandwich.json 720`.

---

## Summary

| Q | Answered | Clicks | Fields | Prerequisites | Visibility |
|---|---|---|---|---|---|
| 21 cut-off → threshold signal | partly (679.2; labelled "cut-off" is a different number) | 2 | 1 | 1 | one level deep, misleading label |
| 22 sens/spec at ±25 % | partly (99.7 % / 99.8 % at app's 645.4, not at 679.2) | 3 | 2 | 1 | one level deep |
| 23 ROC / AUC | partly (AUC "1", no ROC) | 3 | 2 | 1 | hidden (grey subtitle); ROC n/a |
| 24 confusion matrix /1000 | no | 3 | 2 | 2 | not available |
| 25 replicates for 95 % power | yes (3 strips, 98.3 %) by trial | 4 + scroll | 3 | 1 | scroll far |
| 26 populations, PPV/NPV | no | — | — | impossible | not available |
| 27 FPR in healthy | partly (0.2 % at one conc.; α 5 % at LoB) | 3 | 2 | 2 | proxy only |
| 28 C5–C95 | no (exact 8.72–11.70 off-screen) | 5+ | 3 + calc | 3 | not available |
| 29 weaker lot call rates | partly (re-optimised cut-off; fixed-threshold answer missing) | 5 | 3 | 2 | one level deep, no gain lever |
| 30 patient read-back + call | partly (10.6, 9.05–12.9, no call) | 2 | 1 | 0 | one level deep |

Score: 1 yes, 6 partly, 3 no. The machinery (μ, σ, read-back ranges, separation) is all there; what is missing is a single
**clinical cut-off** object that the other workspaces respect.

## Fixes

1. **A clinical cut-off on the Series (Q21, Q22, Q27, Q28, Q29, Q30).** `cutoff: {c}` (or a signal), set once, shown as a
   chip in the top bar. Separate's threshold becomes "Clinical cut-off 679.2 (10 ng/mL)" with the best crossing as a
   secondary line; sensitivity / specificity are computed at the clinical line. Same in CLI (`--cutoff`) and API.
2. **A Cut-off (clinical) section — or a mode of Separate — with the EP12 picture (Q21, Q22, Q28, Q29).** Probability of a
   positive call against concentration (the logistic-like hit curve from μ, σ and the threshold), C5 / C50 / C95 marked,
   a "±25 %" helper that fills A and B around the cut-off, and the call rates at ±x %. Python + TS parity, `calwizard cutoff`.
3. **Populations and prevalence (Q24, Q26, Q27).** Two populations (lognormal: median, geometric SD) and a prevalence;
   outputs sensitivity, specificity, PPV, NPV and a confusion matrix per 1000 tests, as a small table + stacked bar. A
   ROC curve (plain SVG) over the threshold sweep, with the clinical cut-off marked and AUC to 4 decimals (Q23 — show
   "> 0.9999" rather than "1").
4. **Hold the threshold through what-if and lots (Q29).** Add a `gain ×` lever to What-if (beside top), and when a clinical
   cut-off exists, report call rates for the shifted curve *at the original threshold* ("this lot calls 12.5 ng/mL
   positive 96.2 % instead of 99.7 %; a sample at the cut-off 11 % instead of 50 %"). Also: retyping the displayed top
   should restore the measured curve exactly (rounding currently leaves a what-if active).
5. **A call column in Read (Q30).** With a cut-off set: Positive / Negative / Indeterminate (range straddles the cut-off),
   included in the Excel export and `calwizard read`.
6. **Power as an answer, not a hunt (Q25).** In "In an experiment", add "strips for 95 % power: 3" (smallest n with
   pSig ≥ target) and move the strips box next to the sentence; explain the n = 2 → 3 jump (df). CLI: `nForPower`.
7. **Small things.** Gallery cards are unnamed buttons in the accessibility tree (name them for agents and screen
   readers); use clinical vocabulary in Separate ("sensitivity / specificity" alongside "calls B / A correctly"); check
   that Enter in a Read cell always advances to the next row.
