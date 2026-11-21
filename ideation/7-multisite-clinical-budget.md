# 7. Multi-site, clinical threshold and error budget: the evidence package before go/no-go

A half-day working session. Quantitative sandwich LFA for CRP on a reader, using `backend/examples/sandwich.json` as the
current curve (4PL, blank 50, top 4000, EC50 40 ng/mL, Hill 1.2; SD = √(15² + (0.08·S)²)). Clinical decision point:
10 ng/mL in the strip (10 mg/L after the 1:1000 sample dilution).

Current evidence: 1 site, 3 readers, 5 days, 1 lot. Plan: 5 sites × 10 readers each, 3 lots, 12 months real-time stability.

**People**

- **MAYA** — CSO. Owns the board recommendation.
- **RAJ** — senior assay developer. Built the curve.
- **LENA** — biostatistician. Distrusts every number until she knows where it came from.
- **TOM** — clinical affairs lead. Thinks in patients per 1000 tests.
- **PRIYA** — manufacturing and stability scientist. Owns lots and shelf life.

All runs from `backend/`. Work files (layered series, population model) in the session scratchpad `personas7/`.

---

## Scene 1 — The whole curve

*Conference room. Laptop on the projector, terminal in one pane, the app in the other.*

**MAYA:** One rule today: every number on the board slide comes from a command we can run again. Raj, start with the curve.

**RAJ:** Within-run, the sandwich curve.

> [TOOL] `uv run calwizard evaluate examples/sandwich.json`
> → `resolvable.n = 10`: 0, 1.426, 2.812, 4.504, 6.753, 9.933, 14.72, 22.57, 37.48, 76.85 ng/mL.
> Rule: "SSMD ≥ 3 · 1.7% misread".
> Calibrator rows: 0→1 SSMD 2.03 (fail, 7.5% misread); 1→5 7.06; 5→25 9.15; 25→100 5.68; 100→500 2.07 (fail, 7.0%).

**RAJ:** Ten resolvable levels within a run. Steps are roughly ×1.5 from 3 to 40 ng/mL, then they open up: 37 to 77,
and nothing after 77. The calibrator ends are weak. 0 against 1 fails, and 100 against 500 fails because we're on the
plateau.

**LENA:** "Resolvable" here means SSMD ≥ 3 between adjacent rungs, and every rung is a single reading?

**RAJ:** One reading per strip, yes. That's the default.

**LENA:** Fine. Shape?

**RAJ:** No hook. 4PL, so it rises from 50 to about 3800 at 500. The plateau is the problem: above about 100 ng/mL the
slope collapses.

> [TOOL] `uv run calwizard inverse examples/sandwich.json 3900 3990 4010 30` → all `null` (above the top calibrator /
> below the blank).
> [TOOL] `uv run calwizard recover examples/sandwich.json 679 3500` → 679 reads as 9.997 [8.50, 12.09];
> 3500 reads as 200 [101.3, 500 (open)].

**TOM:** So a reading of 3500 means "somewhere between 100 and the top". That's fine. Nobody makes a decision at 200.

**MAYA:** Limits.

> [TOOL] `uv run calwizard limits examples/sandwich.json`
> → LoB 75.5 signal (0.60 ng/mL), **LoD 1.13 ng/mL**, **LoQ 1.53 ng/mL** (CV 20%), **upper LoQ 69.4 ng/mL**.
> Precision profile (concentration CV): 2.5 → 13.4%, 5 → 9.5%, 10 → 8.9%, 25 → 10.9%, 50 → 15.8%,
> 75 → 21.3%, 100 → 27.2%, 200 → 53%, 500 → 147%.

**RAJ:** The quantifiable range is 1.5 to 69 ng/mL at 20% CV. The best point on the profile is about 8.9% at 10 ng/mL.
That's the decision point, so we're lucky.

**LENA:** I'm not convinced that's luck yet. Before I sign anything: the file has a replicate table in it. Three blanks
around 49, c = 5 reads 90–101. But your equation says c = 5 gives a mean of 351.

**RAJ:** ...The replicate table is from the old conjugate. The equations are the current fit.

**LENA:** One file, two curves that disagree by a factor of 3.7 at the same concentration, and nothing in the output
tells me which one you used.

> [TOOL] Switching the copy to `"mode": "replicates"`: `calwizard evaluate` → **4** levels (0, 1.46, 2.70, 4.18);
> `calwizard limits` → `data`: blank n = 3, SD 2.5; LoB 0.75 ng/mL; **LoD from data 1.71 ng/mL** (df = 4).

> [FRICTION] The Series holds an inactive replicate table that contradicts the active equations (c = 5: 95.6 measured
> against 351 modelled). No warning, no "data vs model" residual check. Lena wants a consistency flag before any number
> goes to the board.

> [FRICTION] The data-based LoD rests on 3 blanks and 2 low levels × 3. CLSI EP17 expects about 60 blank results across
> lots and days. The tool computes the number anyway and the only caution is `df: 4` buried in the JSON.

**MAYA:** Which curve goes to the board?

**RAJ:** The equations. They were fit to last month's 5-day study. I'll attach the fit.

**LENA:** Then delete the stale table, or we'll argue about it again in March.

**PRIYA:** For the record, does the tool see a hook? We have a hook example.

> [TOOL] `uv run calwizard evaluate examples/hook.json` → `n = 11`: ... 33.35, 55.2, 112.6, **4232**.

**LENA:** 4232 is past the peak. The curve peaks at about 593 ng/mL, signal 3640. At 4232 the signal is 1948, which is
exactly the signal at 55.2. Both are on the ladder, so the headline counts two levels that read the same.

> [FRICTION / suspected wrong number] The hook ladder counts a level on the far side of the peak as a new resolvable
> level. `recover` gets it right (1700 → 44.7 [36.4, 5000 open]), but the headline "11 levels" is one too many. The
> ladder should stop at the peak, or label everything past it "ambiguous (hook)".

**MAYA:** Not our assay, but put it on the list. If anyone ever runs the hook example for a partner, that number will
be wrong.

---

## Scene 2 — The decision point

**TOM:** My question is simple. At 10 ng/mL, how often do we call a patient on the wrong side?

**RAJ:** The tool asks it as a separation between two concentrations. 10 against its neighbours:

> [TOOL] `uv run calwizard separate examples/sandwich.json C1 C2` (within-run, n = 1 per sample)
>
> | pair | SSMD | pass | cut-off signal | sens | spec | AUC | nNeeded | pPass (n = 3) |
> |---|---|---|---|---|---|---|---|---|
> | 7.5 vs 10 | 2.26 | no | 592 | 93.9% | 95.5% | 0.988 | 2 | 0.319 |
> | 8 vs 12 | 3.14 | yes | 659 | 98.6% | 99.0% | 0.9992 | 1 | 0.614 |
> | 10 vs 15 | 3.08 | yes | 809 | 98.4% | 98.9% | 0.999 | 1 | 0.601 |
> | 5 vs 10 | 5.07 | yes | 473 | 99.99% | 99.99% | ~1 | 1 | 0.962 |
>
> 7.5 vs 10 `whyNot`: SD ×0.75, or move the upper concentration to 11.03.

**RAJ:** Within a run, 10 vs 15 passes and 7.5 vs 10 doesn't. The claim is a fold change of 1.5 at the cut-off.

**TOM:** But that's not my question. The cut-off isn't "halfway between 10 and 15". It's 10. The cut-off signal is
μ(10) = 679. A patient at 7.5 sits below it and one at 12.5 sits above it.

**RAJ:** `separate` puts the cut-off where the two densities cross. For 10 vs 15 that's 809, which is about 12.2 ng/mL.

> [FRICTION] `separate` has no fixed clinical cut-off. Tom wants "cut-off = 10 ng/mL, show P(called positive) for
> samples at 5, 7.5, 9, 11, 12.5, 15" — a probability-of-positive curve, which is the shape a regulator expects.
> It can't be asked headless or in the GUI.

**TOM:** And I want the confusion matrix per 1000 tests. Not sensitivity in a JSON field.

**LENA:** For 7.5 vs 10 with a 50/50 split, 1000 tests: 500 at each, 30 false negatives, 22 false positives. I did that
in my head. Real patients aren't split 50/50, and they don't sit at two concentrations.

> [FRICTION] No confusion matrix, no "per 1000 tests", no ROC curve. AUC is reported as one number
> (`auc = Φ(|Δμ|/√(σ₁²+σ₂²))`), with no plot. Tom left the tool and drew a 2×2 on the whiteboard.

**LENA:** Something else bothers me. For 7.5 vs 10, `nNeeded` = 2: average two readings and it passes. In the same
output, `power.pPass` at n = 3 is 32%. Which one do I believe?

**RAJ:** I think `nNeeded` assumes we know the true SDs and average the readings. `pPass` simulates an experiment where
we *estimate* the SSMD from three strips, and the pass is judged on the noisy estimate.

**LENA:** Then two different "n"s sit next to each other in one object. A reviewer will read "2 replicates needed" and
"32% chance of passing with 3" as a contradiction.

> [FRICTION] `nNeeded` (readings averaged per sample, known SDs) and `power.n` (strips per concentration in a
> verification experiment) are both labelled n. They need different words and a one-line explanation in the output and
> the GUI.

---

## Scene 3 — Patients, not concentrations

**TOM:** Real populations. In our ED triage dataset, healthy CRP is roughly lognormal with median 2 and geometric SD
2.2. The bacterial-infection group has median 30 and GSD 2.5. Prevalence is about 10% in the ED, and 2% if marketing
wins the screening argument.

**RAJ:** The tool doesn't do populations.

> [FRICTION] No population or prevalence model. The team wrote `personas7/pop.py` (`uv run python`): two lognormal
> populations, the sandwich curve and the §22.1 combined SD reimplemented by hand, "positive" = signal > μ(10), plus
> PPV, NPV and confusion counts per 1000. Lena had to re-derive `sd_eff` from the spec and cross-check it against
> `calwizard budget` (√total at c = 10: 66.4 and 86.6 — matches).

> [TOOL] `uv run python personas7/pop.py` — 10% prevalence, cut-off 10 ng/mL:
>
> | scenario | sens | spec | TP | FN | FP | TN | PPV | NPV | analytic flips /1000 |
> |---|---|---|---|---|---|---|---|---|---|
> | perfect assay | 88.5% | 97.9% | 88.5 | 11.5 | 18.5 | 881.5 | — | — | 0 |
> | within-run only | 88.3% | 97.9% | 88.3 | 11.7 | 18.9 | 881.1 | 0.823 | 0.987 | 5.5 |
> | current (reader + day) | 88.2% | 97.9% | 88.2 | 11.8 | 19.1 | 880.9 | 0.822 | 0.987 | 6.5 |
> | planned, month 0 | 88.7% | 97.6% | 88.7 | 11.3 | 21.2 | 878.8 | 0.807 | 0.987 | 8.7 |
> | planned, month 12 | 86.7% | 98.2% | 86.7 | 13.3 | 16.5 | 883.5 | 0.840 | 0.985 | 9.0 |
>
> At 2% prevalence: PPV 0.46 (within-run), 0.435 (planned month 0), 0.49 (month 12); NPV ≥ 0.997 throughout.
> Clinical AUC (cut-off swept): 0.971 within-run, 0.966 current, 0.955 planned month 12.

**TOM:** So the biology does most of the damage. A perfect assay already misses 11.5 per 1000 and falsely flags 18.5,
because the two populations overlap around 10. Analytical noise adds 5 to 9 patients per 1000 called on the wrong side
of the line.

**LENA:** And look at month 12. Sensitivity *drops* to 86.7% while specificity *rises*. That isn't spread, it's bias.
The aged strips read low, so the effective cut-off moves up.

> [TOOL] Same script, P(called positive) at a true concentration:
>
> | c (ng/mL) | 7.5 | 9 | 10 | 11 | 12.5 | 15 |
> |---|---|---|---|---|---|---|
> | within-run | 0.000 | 0.107 | 0.50 | 0.848 | 0.988 | 1.00 |
> | current | 0.001 | 0.145 | 0.50 | 0.808 | 0.973 | 0.999 |
> | planned, month 0 (+3% site bias) | 0.012 | 0.276 | 0.595 | 0.822 | 0.959 | 0.997 |
> | planned, month 12 (net −5% bias) | 0.002 | 0.114 | **0.347** | 0.607 | 0.857 | 0.979 |

**TOM:** A patient at 12.5 is called positive 99% of the time today, and 86% of the time on a 12-month-old strip. That
goes in the labelling discussion. The PPV at 2% prevalence goes in the screening discussion: half the positives are
false.

**MAYA:** That's a strong argument against screening. Keep it.

> [FRICTION] The most decision-relevant table of the day (P(positive) around the cut-off, at prevalence, at shelf-life
> end) came from a 90-line script outside the tool. It can't be shared through the app's report and doesn't follow the
> layers if someone edits them.

---

## Scene 4 — Stacking the variability

**MAYA:** Now the part the board will push on. What do sites, readers, days, lots and shelf life cost, and is our
1-site study enough to say anything?

**PRIYA:** I'll give you sizes from transfer and stability history. They're priors, not measurements, and we should
say so on the slide.

*Raj builds two series in the scratchpad (`personas7/cur.json`, `personas7/plan.json`). Layers, outermost first:*

| layer | units now → planned | offsetSd | cv | gainCv | noiseCv | known bias |
|---|---|---|---|---|---|---|
| Site | 1 (off) → 5 | 6 | 4% | 3% | — | +3% |
| Lot | 1 (off) → 3 | — | 2% | 6% | — | — |
| Reader | 3 → 10 per site | 8 | 3% | 2% | 10% | — |
| Day | 5 → 5 | 4 | 2% | 3% | — | — |
| Stability 12 mo | — → 4 timepoints | — | — | 3% | — | −8% |

> [FRICTION] "5 sites × 10 readers *each*" is a nested design. The layer model is crossed: every reader at every site.
> Raj entered Reader = 10 units and accepted that the design simulation would cross them. There is no "Reader within
> Site".

> [FRICTION] Site bias can only be one `biasPct` for the whole layer (+3%). Real sites are +3%, −2%, +1%... A random
> site *bias* is just `cv`, so the "known bias" field is really for a single reader or a single site, not a layer of
> five.

> [FRICTION] Stability is a time course: 0, 3, 6, 9, 12 months. As a layer it can only be one bias and one spread.
> Priya made five copies of the series (`m00`…`m12.json`) with the bias ramped linearly to −8%.

### 4a. What survives

> [TOOL] `calwizard evaluate` / `calwizard limits` / `calwizard requirements` on the three series:
>
> | | within-run | current (reader + day) | planned (all five) |
> |---|---|---|---|
> | resolvable levels | 10 | 9 | 7 |
> | ladder | 0, 1.43, 2.81, 4.50, 6.75, 9.93, 14.7, 22.6, 37.5, 76.9 | 0, 1.64, 3.33, 5.56, 8.83, 14.1, 23.4, 44.3, 136 | 0, 1.80, 3.93, 7.34, 13.7, 27.9, 84.8 |
> | LoB (ng/mL) | 0.60 | 0.68 | 0.72 |
> | LoD | 1.13 | 1.29 | 1.39 |
> | LoQ (20% CV) | 1.53 | 1.80 | 2.11 |
> | upper LoQ | 69.4 | 55.1 | **34.4** |
> | requirements met | 3/3 | 2/3 | 2/3 |
> | "range 2–60 at 20%" SD factor needed | — | 0.94 | 0.70 |

**RAJ:** LoD barely moves: 1.13 to 1.39. The blank is dominated by within-run noise. The upper end is what goes. The
quantifiable range shrinks from 69 to 34 ng/mL, so the "2 to 60" claim fails. To meet it with all layers on, every SD
would have to be 0.70× of today's.

**LENA:** Why does the *current* ladder end at 136 when the within-run ladder ends at 77? Adding noise made the top
level go up?

**RAJ:** The ladder steps from zero. With bigger steps the rungs land in different places, and the last one happens
to fall at 136 instead of 77.

**LENA:** So the top rung isn't a property of the assay. It's an artefact of where you start counting.

> [FRICTION] The ladder's top rung moves non-monotonically (77 → 136 → 85) as noise is added, which confused everyone
> for five minutes. The level count is meaningful; individual rungs past the upper LoQ are not. The ladder output should
> mark rungs beyond the upper LoQ, or the GUI should grey them.

### 4b. Which source dominates

> [TOOL] `calwizard budget personas7/plan.json --c 0 2 10 50 200` (share of variance; total SD in signal units):
>
> | c | total SD | within | Site | Lot | Reader | Day | Stability |
> |---|---|---|---|---|---|---|---|
> | 0 | 19 | 66% | 11% | 0% | 18% | 5% | 0% |
> | 2 | 26 | 59% | 13% | 8% | 14% | 5% | 2% |
> | 10 | 87 | 43% | 15% | **21%** | 9% | 7% | 5% |
> | 50 | 292 | 40% | 15% | **24%** | 8% | 8% | 5% |
>
> Cumulative levels: within 10 → +Site 9 → +Lot 8 → +Reader 7 → +Day 7 → +Stability 7.
> Current series at c = 10: within 73%, Reader 14%, Day 13%.

**PRIYA:** At the decision point, lot-to-lot gain is the largest single source after within-run: 21%. Readers matter at
the blank, lots matter at the cut-off.

**LENA:** The cumulative row is ordered outermost first, so Site "costs" a level only because it's added first. Day
and Stability cost nothing because the count is already down to 7. That's order-dependent. I want each layer's marginal
cost with everything else on.

> [FRICTION] `cumulative` is a single path in layer order. Leave-one-out ("levels if this layer were zero") would answer
> "which source should we fix first" without the order artefact. Lena computed it by toggling `on` by hand in four files.

### 4c. Lots as real curves

**PRIYA:** I'd rather show lots as curves than as a gainCv I typed in. Lot B is 8% less gain with a higher blank, Lot C
7% more gain.

> [TOOL] `calwizard compare personas7/lotA.json personas7/lotB.json personas7/lotC.json -c 0 1 2 5 10 25 100`
>
> | c | Lot B bias | Lot C bias | Lot B reads as | Lot C reads as |
> |---|---|---|---|---|
> | 2 | −2.2% | +3.5% | −2.8% | +4.4% |
> | 10 | −6.7% | +6.2% | **−7.1%** | **+6.7%** |
> | 25 | −7.4% | +6.6% | −9.7% | +9.3% |
> | 100 | −7.7% | +6.8% | −21.6% | +28.4% |
>
> Levels 10 / 10 / 11; LoD 1.13 / 1.22 / 1.06. `between`: gainCv **0.075**, offsetSd 3.6, units 3.

**PRIYA:** Measured from three curves, lot gain spread is 7.5%, not the 6% I assumed. And at 100 ng/mL a ±7% gain
difference becomes a −22% / +28% concentration error, because of the plateau.

**LENA:** gainCv from three lots is an SD with 2 degrees of freedom. The true value could be anywhere from 0.58× to 4.4×
that. It's a median of three ratios, presented to three decimals.

> [FRICTION] `compare.between` gives no uncertainty for its sizes. Dial-in (§22.4) reports a `rough` range factor;
> compare should too (for 3 conditions: 0.58–4.42×).

### 4d. Bias and the error budget

> [TOOL] `calwizard tolerance SERIES -c 1 2 5 10 25 50 100` (k = 2, allowed total error 30%):
>
> | c | current: total / worst | planned (month 12): bias / total / worst | ok (cur / plan) |
> |---|---|---|---|
> | 1 | 70.7% / 109% | −8.7% / 85.3% / 172% | no / no |
> | 2 | 36.6% / 56.9% | −6.3% / 47.8% / 102% | no / no |
> | 5 | 22.3% / 35.2% | −5.3% / 33.1% / 74.4% | yes / no |
> | 10 | **20.9%** / 33.2% | −5.4% / **32.6%** / 74.2% | yes / **no** |
> | 25 | 25.8% / 41.3% | −6.8% / 41.2% / 94.0% | yes / no |
> | 50 | 37.4% / 59.8% | −9.8% / 59.9% / 137% | no / no |
> | met | **3 of 7** | **0 of 7** | |

**MAYA:** Current evidence: 3 of 7 levels inside 30% total error. Planned with everything on: none. The decision point
goes from 20.9% to 32.6%.

**LENA:** The "worst" column adds k·SD of every source *linearly*, within-run included. Seventy-four percent at the cut-off
assumes every source hits +2 SD on the same strip. That isn't a credible worst case. It's a number designed to scare
people.

**RAJ:** It's the tolerance-stack convention. Worst-case on the biases is fair: site +3% and drift −8% could both point
the same way at a site that reads low.

**LENA:** Then I want three columns: RSS, linear on biases with RSS on spread, and full linear. Right now I get the first
and the last.

> [FRICTION] The worst-case stack mixes "bias at its limit" (defensible) with "every random source at +k SD at once"
> (not defensible for independent sources). The middle option, Σ|bias| + k·√Σsd², is the one Lena wants on the slide.

> [TOOL] Drift over shelf life: `calwizard tolerance personas7/mXX.json -c 2 10 25`, c = 10:
>
> | month | 0 | 3 | 6 | 9 | 12 |
> |---|---|---|---|---|---|
> | net bias | +3.2% | +1.1% | −1.1% | −3.2% | −5.3% |
> | total error | 29.8% | 27.7% | 27.9% | 30.2% | 32.6% |
> | levels within 30% (of 3) | 1 | 1 | 1 | 0 | 0 |
> | resolvable levels | 7 | — | — | — | 7 |

**PRIYA:** That's my drift story. The +3% site bias and the −8% decay cancel around month 4–5, then decay wins. We fail
the 30% budget at the cut-off from month 9. The *level count* never changes, because bias isn't spread. Stability is
invisible in the headline.

**LENA:** And the two tools disagree on what stability is. As an aged curve, `compare` against month 0:

> [TOOL] `calwizard compare examples/sandwich.json personas7/aged12.json` → reads as −6.8% at 1, −7.9% at 10,
> −22% at 100; LoD 1.13 → **1.21**; `between`: gainCv 0.059, offsetSd 0.

**LENA:** As a curve, aging moves the LoD. As a bias layer it doesn't, by design ("bias changes accuracy, not spread").
And `Use as a layer` on that comparison would turn a one-directional drift into a ±5.9% random gain spread, which is
the wrong model. Drift has a sign and a time axis.

> [FRICTION] No drift-over-time layer: bias(t) (linear or Arrhenius), with the claim evaluated at a chosen age and the
> budget shown against month. Five hand-made files, and the "Use as a layer" button would mislabel drift as spread.

### 4e. Threshold error rates with the layers on

> [TOOL] `calwizard separate SERIES 10 15` and `... 7.5 10`:
>
> | | within | current | planned |
> |---|---|---|---|
> | 10 vs 15 SSMD | 3.08 ✓ | 2.61 ✗ | 1.99 ✗ |
> | 10 vs 15 sens / spec | 98.4 / 98.9% | 96.4 / 97.6% | 90.7 / 94.2% |
> | 10 vs 15 AUC | 0.999 | 0.9955 | 0.9765 |
> | 10 vs 15 nNeeded | 1 | 2 | 3 |
> | 10 vs 15 "move B to" | 14.8 | 16.0 | **19.2** |
> | 7.5 vs 10 SSMD / sens / spec | 2.26 / 93.9 / 95.5 | 1.93 / 90.2 / 93.0 | 1.48 / 82.9 / 88.4 |

**TOM:** So the honest analytical claim at the cut-off, across sites, lots and a year: 10 is separable from 19, not
from 15. A 1.9-fold step.

**MAYA:** And the patient-level table said that costs us about 9 misclassified per 1000 instead of 5.5. Clinically
small compared with the biological overlap of 30 per 1000.

**TOM:** Small, but it's directional at month 12. The 1000-test numbers hide that the errors aren't symmetric.

### 4f. Can our studies even measure these sources?

> [TOOL] `calwizard design personas7/cur.json --n 3 --runs 200` — units [Site 1, Lot 1, Reader 3, Day 5],
> 45 readings per concentration, components at c = 25 (as SD, 90% of runs):
> within true 120 → 95–146; **Reader true 54 → 0–103**; **Day true 52 → 0–89**; Site and Lot → 0 (cannot be
> estimated from 1 unit).
>
> `calwizard design personas7/plan.json --n 2 --runs 200 --concs 0 2 5 10 15 25` — units [5, 3, 10, 5, 4],
> 6000 readings per concentration (crossed), components at c = 10:
> within 56 → 54–60; Site 34 → 15–49; **Lot 40 → 10–66**; Reader 25 → 14–35; Day 24 → 10–34; Stability 19 → 8–31.

**LENA:** Today, three readers tell us the reader SD is somewhere between zero and twice its true value. We have *no*
information on site or lot. Everything Priya typed in for those is a prior.

**LENA:** The plan fixes reader and site reasonably. Lot stays bad: three lots give an SD that could be a quarter of the
truth or 1.6× it. And lot is the biggest source at the cut-off.

> [TOOL] χ² range factor for an SD estimated from u units (90%), `personas7/pop.py`:
> 3 → 0.58–4.42×; 5 → 0.65–2.37×; 10 → 0.73–1.65×; 15 → 0.77–1.46×; 30 → 0.83–1.28×; 50 → 0.86–1.20×.

**PRIYA:** Three lots is the regulatory minimum for stability. It was never meant to *size* lot variance.

**MAYA:** How many lots would we need to know lot SD within ±30%?

**LENA:** About 30, by the table. The tool can't answer that directly. I'd iterate `design` with units 3, 5, 8, 12... and
read off the component spread, or just use the χ² table.

> [FRICTION] No study-size solver: "how many units of each layer to size its SD within ±X%, or to confirm the claim with
> power P". Lena iterated by hand and fell back to a χ² table in the script.

> [FRICTION / suspected bug] `design` draws every layer, including those with `on: false`, and reports their
> `true` variance (Site 73², Lot 91² at c = 25 in the current series) even though they're off. With 1 unit that adds a
> fixed per-run offset, which is physically arguable but contradicts §22 ("on = counts toward the variability the app
> uses") and the budget, where off layers show `share: null`.

> [FRICTION] `design` crosses everything: 5 × 3 × 10 × 5 × 4 = 3000 unit combinations × 2 = 6000 strips per
> concentration. The real plan is about 5 sites × 10 readers × 3 lots × a few days, nested. The strip count is off by an
> order of magnitude, so it can't be used for a budget or a timeline.

**RAJ:** And the LoD verification planner ignores the layer structure entirely.

> [TOOL] `calwizard plan personas7/cur.json --runs 300` → 80 strips (20 blank, 20 at 1.29, 20 at 2.58, 20 at the
> LoQ 1.80); LoD estimate 1.14–1.57 (truth 1.29); LoQ confirmation pPass 0.55.

> [FRICTION] The LoD planner draws its 80 strips as independent readings at the combined SD. It doesn't say "spread
> across 3 readers × 5 days" or account for the clustering. CLSI EP17 is about exactly that split (lots × days ×
> replicates), so the design table isn't something we can hand to the lab.

---

## Scene 5 — Conclusions for the board

**MAYA:** Let's write it. Short, and every number reproducible.

**For the board (go/no-go):**

1. **The curve supports the claim at the decision point.** At 10 ng/mL the assay is at its precision optimum
   (8.9% concentration CV within-run). LoD 1.13 ng/mL within-run, 1.39 ng/mL with all predicted sources. LoD is not the
   risk.
2. **The quantitative range claim must narrow.** "2–60 ng/mL at 20% CV" holds within-run (upper LoQ 69) but fails once
   site, lot, reader, day and stability are stacked (upper LoQ 34). The recommended claim is 2–30 ng/mL quantitative,
   with "> 30" reported semi-quantitatively. The plateau above 100 ng/mL is not quantifiable.
3. **Threshold performance is dominated by biology, not the assay.** At 10% prevalence and a 10 ng/mL cut-off,
   a perfect assay already gives 11.5 false negatives and 18.5 false positives per 1000. Our analytical spread adds
   about 5.5 (today) to 9 (multi-site, end of shelf life) patients per 1000 called on the wrong side.
   PPV 0.81–0.84, NPV ≈ 0.985. **At 2% prevalence (screening) PPV is about 0.45: do not pursue a screening claim.**
4. **Lot-to-lot gain is the largest controllable source at the cut-off** (21% of variance; measured 7.5% gain CV across
   three lots). Readers dominate at the blank. A lot release spec on gain (calibrator ratio within ±5%) is the cheapest
   improvement.
5. **Stability is a bias problem, not a spread problem.** A −8% signal decay over 12 months pushes total error at the
   cut-off from 29.8% (month 0) to 32.6% (month 12) and fails the 30% budget from month 9. P(called positive) for a
   patient at 12.5 ng/mL falls from 0.96 to 0.86. Options: a 9-month shelf life, a lot-specific calibration
   adjustment, or tighten the decay spec to ≤ 5%.
6. **The current evidence cannot size site or lot variance at all,** and only bounds reader variance to 0–2× its value.
   The site and lot numbers in this package are priors. The planned study sizes site (5) and reader (50) adequately but
   **lot (3) poorly** (true SD 0.58–4.4× the estimate). Lot variance will be a prior again unless we add a lot-variability
   study using ≥ 10 manufactured lots of calibrator material.
7. **Recommendation: GO for the multi-site study,** conditional on (a) the claim range narrowed to 2–30 ng/mL,
   (b) a lot release spec on gain, (c) shelf life provisionally 9 months pending real-time data, and (d) removing the
   stale replicate table and re-fitting the curve from the multi-site data before the claim is locked.

**LENA:** And a footnote: three of these numbers came from a script outside the tool. They're reproducible, but not in
the report.

**MAYA:** Noted. That's the first item on the tooling list.

*END.*

---

## Ideas mined

Ranked by how much they would have changed the board package.

1. **[math][CLI][GUI] Population and prevalence module**: healthy/diseased lognormal (or empirical) distributions plus a
   cut-off give sens, spec, PPV, NPV, AUC and a 2×2 per 1000 tests, with the combined layer SD and bias applied.
   (Scene 3: the whole clinical table was a hand-written script.)
2. **[math][CLI][GUI] Fixed clinical cut-off and probability-of-positive curve**: `calwizard cutoff SERIES C --at C...`
   gives P(called positive) at each concentration, with layers and bias. (Scene 2: `separate` only puts the cut-off at
   the density crossing.)
3. **[math][CLI] Drift-over-time layer**: bias(t) (linear or Arrhenius) and spread(t), with `--age` on every command and
   a budget-against-month table. Stop "Use as a layer" from turning a directional drift into random spread.
   (Scene 4d: five hand-copied files; compare vs bias layer disagree on LoD.)
4. **[math][CLI] Study-size solver**: units per layer to size each SD within ±X% (χ² factor), and the design size to
   confirm a claim with power P. (Scene 4f: Lena iterated `design` by hand and used a χ² table.)
5. **[math] Nested layers ("Reader within Site")**: correct variance components and strip counts for nested studies.
   The crossed design gave 6000 strips per concentration for a ~1500-strip plan. (Scene 4, 4f.)
6. **[math][CLI] Fix the hook ladder**: stop at the peak, or mark levels past it "ambiguous". `hook.json` reports 11
   levels, but 4232 reads the same signal as 55.2. (Scene 1: suspected wrong number.)
7. **[report][GUI] Data vs model consistency flag**: warn when an inactive replicate or summary table disagrees with the
   active equations (c = 5: 95.6 measured vs 351 modelled). (Scene 1.)
8. **[math][CLI] Third tolerance column**: Σ|bias| + k·√Σsd² (linear biases, RSS spread) next to `total` and `worst`.
   (Scene 4d: Lena rejected the full linear stack as not credible.)
9. **[CLI][math] Leave-one-out layer cost**: levels, LoD and upper LoQ with each layer zeroed and all others on, to
   replace the order-dependent cumulative path. (Scene 4b.)
10. **[GUI][report] ROC and confusion-matrix figures** in the Separate workspace and the report (plain SVG), with a
    prevalence field. (Scene 2: whiteboard 2×2.)
11. **[CLI][math] Per-unit known biases**: a list of biases per layer (site A +3%, B −2%, ...) instead of one `biasPct`,
    or a "random bias" note that tells the user to use `cv`. (Scene 4 layer table.)
12. **[math][CLI] `design` should respect `on: false`**, or say explicitly that off layers are drawn as fixed unknown
    effects, and leave their `true` out. (Scene 4f: suspected bug.)
13. **[CLI][math] Uncertainty on `compare.between`**: the χ² `rough` factor dial-in already reports (3 conditions:
    0.58–4.42×). (Scene 4c.)
14. **[math][CLI] Layer-aware LoD planner**: blanks and lows spread across readers × days × lots (EP17 style), with
    the design table split by unit. (Scene 4f.)
15. **[GUI][CLI] Mark ladder rungs beyond the upper LoQ** (or past the plateau) so the top rung can't jump
    77 → 136 → 85 unexplained. (Scene 4a.)
16. **[CLI][GUI] Rename the two n's in `separate`**: "readings averaged per sample" (`nNeeded`) vs "strips per
    concentration in a confirmation run" (`power.n`), with a one-line note on why 2 and 32% at 3 don't contradict.
    (Scene 2.)
17. **[report] Claim-sheet "evidence strength" column**: for each layer, measured (units, rough factor) vs prior
    (typed in), so priors aren't presented as data. (Scene 4f, Scene 5 item 6.)
18. **[report][CLI] Scenario comparison in one report**: within-run vs current vs planned vs month 12, side by side
    (levels, LoD, LoQ, upper LoQ, total error at the cut-off). The core board table was assembled by hand from 12
    commands. (Scene 4a, 5.)
