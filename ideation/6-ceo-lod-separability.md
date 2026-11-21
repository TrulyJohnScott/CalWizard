# 6 — Go / no-go: "Can we hit the LoD, and can we call the decision point?"

A screenplay built from real Cal Wizard output. All numbers below came from `uv run calwizard ...` against scenario files
in the session scratchpad (`personas/ceo_*.json`), which are `examples/sandwich.json` (CRP 4PL, SD = √(15² + (0.08·S)²))
with:

- levels `0, 1, 1.5, 3, 10, 50, 500`;
- requirements *LoD ≤ 1.0 ng/mL* (product spec), *tell 1.5 from 3* (rule-out level vs. clinical decision point),
  *CV ≤ 15 % at 3*;
- `ceo_full.json`, the same curve plus five §22 layers for the scale-up: Site (5 units, offsetSd 6, gainCv 6 %,
  noiseCv 10 %), Lot (3, cv 2 %, gainCv 8 %), Reader (10, offsetSd 4, cv 3 %, noiseCv 10 %), Day (5, offsetSd 3, cv 3 %),
  Stability 12 mo (4 time points, gainCv 4 %, `biasPct −0.10`);
- what-if copies: lot noise +10 % (`sdScale 1.1`), lot signal −10 % (top 0.9×), read-twice (`--reads 2`), and a Site B
  condition (`3600 + (55 − 3600)/(1 + (c/44)^1.2)`).

Population figures (PPV/NPV, per-1000 matrices, ROC AUC over patients) were **not** computable in the tool. They came
from a 60-line scratch script (`ceo_pop.py`), with healthy patients lognormal (median 1.0 ng/mL, GSD 1.8) and diseased
patients lognormal (median 8, GSD 2.2).

**Cast.** DANA (CEO). PRIYA (CSO). MARCUS (bench assay developer, ran the pilot: 1 site, 3 readers, 5 days).
LENA (statistician, driving Cal Wizard on the wall screen).

---

## Act I — The headline

*Conference room. 4:05 pm. A board deck lies open on DANA's laptop at the slide "Q3: design freeze". LENA's screen shows
Cal Wizard, Requirements workspace.*

**DANA:** I've got eleven minutes before the investor call. Two questions. Can we hit the LoD in the product spec, yes or
no? And can we call the decision point? Go.

**LENA:** I'll answer the first one straight from the tool. Requirements view.

> [TOOL] Requirements: **2 of 3 met.**
> ✗ *Product spec: LoD ≤ 1.0 ng/mL*: value **1.126**, "met if the noise were **0.876×** of today".
> ✓ *Rule-out 1.5 vs decision point 3*: SSMD **3.196** (rule: SSMD ≥ 3).
> ✓ *CV ≤ 15 % at decision point*: **11.9 %**.

**DANA:** So no.

**LENA:** On the pilot data, no. The modelled LoD is 1.13 against a spec of 1.0, which misses by 13 %. To get there we'd
need about 12 % less noise everywhere on the curve.

**DANA:** Twelve percent. Is that a lot?

**MARCUS:** It depends where the noise comes from. If it's the conjugate pad, maybe one formulation round. If it's
the reader, then no.

> [FRICTION] "0.876× of today" is a number about SD. The CEO's actual question is "how hard is that?", and the tool has no
> idea which lever moves the SD. Nothing connects "12 % less noise" to effort, cost or risk.

**PRIYA:** Before anyone writes "1.13" on a slide, where does it come from? Is that a measured LoD?

**LENA:** No, it's modelled. The fitted curve and noise model go through the CLSI EP17-style formula. LoB 75.5 signal,
which is 0.60 ng/mL. LoD is the lowest concentration whose reading clears the LoB 95 % of the time.

> [TOOL] `calwizard limits` → blank mean 50.0, SD 15.52; LoB 75.5 (0.602 ng/mL); **LoD 1.126** (signal 103.7, CV 27 %);
> **LoQ 1.528** at CV 20 %; upper LoQ 69.4. `data: null`.

**PRIYA:** `data: null`. So we don't have a classical estimate from replicates?

**LENA:** The series runs in equations mode. The pilot replicates are stored, but the from-data LoD only works in a
replicate *table* series. I'd need to switch modes to get it.

> [FRICTION] The CSO wants the model-based LoD and the empirical LoD side by side, with a flag when they disagree. The
> tool shows one at a time, depending on input mode, and "null" reads like "missing" to anyone else in the room.

**DANA:** Fine. Modelled says no. What's the *probability* we pass, though? Because if I tell the board "no" and the
verification study comes back at 0.98, I'll look stupid.

**LENA:** That's the right question, and Plan is the closest thing we have. It simulates the CLSI verification study,
20 blanks plus 20 strips each at the LoD, at 2× the LoD, and at the LoQ, so 80 strips, 500 times.

> [TOOL] `calwizard plan` → design 80 strips. True LoD 1.126. Estimated LoD over 500 simulated studies:
> 90 % range **0.997 – 1.356**, median 1.171, min 0.844. Detection rate at 1.13: 94.6 % (truth 95.1 %). LoQ sample at
> 1.53: pPass **0.574**.

**LENA:** If we run the standard 80-strip study, roughly one study in twenty would show an LoD at or below 1.0, and only
by luck.

**DANA:** One in twenty. So five percent.

**LENA:** About five percent. The tool doesn't print that number. I'm reading it off the lower end of a 90 % range,
which happens to sit at 0.997.

> [FRICTION] The tool has no "P(verification study shows LoD ≤ target)". It gives quantiles of the estimate, and the
> statistician has to invert them by eye. That probability is the single number the CEO needed, and it's one line of code.

**PRIYA:** I also want it noted that the median of those simulated studies is 1.17 while the truth is 1.13. The estimator
runs high.

**LENA:** That's real. The default low levels are LoD and 2× LoD, and the SD is larger at 2× LoD. Pooling them inflates
SD_L, so the classical estimate lands about 4 % high. With 480 strips it still centres on 1.18.

> [FRICTION] The CSO distrusts a planner whose central estimate sits off the truth with no explanation on screen. It is
> methodologically correct (CLSI assumes constant SD), but nobody would know that without reading spec §15.

---

## Act II — The CEO's what-ifs

**DANA:** OK. Three ideas, fast. One: what if we just read it twice?

**LENA:** *(types)* `--reads 2`.

> [TOOL] `calwizard limits --reads 2` → LoB 68.1 (0.45 ng/mL), **LoD 0.828**, LoQ 1.075.
> `plan` with the noise scaled by 1/√2 (the planner has no `--reads`, so this used a what-if layer) → 90 % range
> **0.718 – 0.980** at 80 results; with 240 results, 0.771 – 0.925.

**DANA:** There it is. 0.83. Done. Read it twice.

**PRIYA:** Read *what* twice? The same strip in the same reader?

**MARCUS:** If it's the same strip, the second read only averages out the optics. Most of our noise is the strip:
flow, conjugate release, membrane. A second read of the same strip does almost nothing to that.

**LENA:** The tool assumes the two reads are independent, as if they were two strips. So "read twice" really means
"run two strips per patient".

**DANA:** That doubles the cost of goods.

**MARCUS:** And the sample volume. A fingerstick doesn't give us two strips' worth.

> [FRICTION] `reads` is one number with no idea which part of the noise it averages. The tool offers no "reader
> repeat" vs. "duplicate strip" choice, and none of the COGS or sample-volume consequences that make it a business lever.

> [FRICTION / probably wrong] `calwizard plan` has no `--reads` and **ignores the series' `limits.reads`**. With
> `limits.reads = 2` saved in the series, `limits` reports LoD 0.828, while `plan` on the same file still reports
> `truth.lod 1.126` and simulates single reads. Two commands on one file disagree, and nothing says so.

**DANA:** Two: what if the next lot is ten percent worse?

**LENA:** Worse how? Ten percent more noise, or ten percent less signal?

**DANA:** …Worse. You tell me.

**LENA:** I'll run both.

> [TOOL] Lot noise +10 % (`adjust.sdScale 1.1`): **LoD 1.228**, LoQ 1.70. Pair 1.5 | 3: SSMD **2.905 → fails**;
> sensitivity 97.8 %, specificity 98.4 %.
> Lot signal −10 % (top at 0.9×): **LoD 1.183**, LoQ 1.61. Pair 1.5 | 3: SSMD **3.075 → passes**; 98.4 % / 98.8 %.

**LENA:** A lot with ten percent more noise breaks the decision-point claim as well as the LoD. A lot with ten percent less
signal hurts the LoD but still separates the pair.

**DANA:** So the pair claim survives one kind of bad lot and not the other.

**PRIYA:** It's sitting on a knife edge. SSMD 3.2 against a bar of 3 means we're 6.5 % above the line.

> [FRICTION] "10 % worse" has no single meaning in the tool. The what-if bar has four levers in assay language
> (background, top, midpoint, noise). The CEO's question was a scenario: a lot at the edge of our release spec.
> Scenario presets, and a "which claims break first" table, would have answered it in one step.

**DANA:** Three: how many more strips do we need to be *sure*?

**LENA:** Sure of what? This is the part people get backwards. More strips make the estimate tighter around the *true*
value, and the true value is 1.13.

> [TOOL] `plan --n-blank N --n-low N`, single reads:
> 80 strips → 0.997 – 1.356 · 160 → **1.041 – 1.319** · 240 → 1.067 – 1.275 · 480 → 1.099 – 1.249.

**LENA:** At 160 strips the best plausible study already lands above 1.0. More strips make us *more* certain we miss.

**DANA:** So strips can't buy this.

**LENA:** Right. Strips buy certainty, and only chemistry buys LoD.

> [FRICTION] A "what would it take" solver would have helped. Asked which noise level, how many strips per result and
> how big a verification study give an 80 % chance to demonstrate LoD ≤ 1.0, it would reply with a small table. Today
> that takes four commands and mental arithmetic.

---

## Act III — The whole curve, not two points

**PRIYA:** Before we go further, I don't want this meeting deciding off two concentrations. Lena, show the whole curve.
Where can this assay actually tell levels apart?

> [TOOL] Curve workspace, headline "**10 resolvable levels**" (SSMD ≥ 3 · 1.7 % misread):
> `0 · 1.43 · 2.81 · 4.50 · 6.75 · 9.93 · 14.7 · 22.6 · 37.5 · 76.9` ng/mL. Upper LoQ 69.4. Nothing resolvable above ~77;
> cMax is 500.

**LENA:** Read it as a ladder. At the low end each rung is about 2× (1.4 → 2.8), because blank noise dominates there. In the
middle, around 3–20, rungs are about 1.5× apart. That's the working range. Above roughly 70 the curve flattens into the
plateau: the signal stops changing faster than the noise and the rungs blow up to 2× and more. The last one is 37 → 77,
and above that nothing is resolvable at all.

**DANA:** What does "1.7 % misread" mean?

**LENA:** If you put a sample on one rung and the next, the tool estimates it would mix them up 1.7 % of the time.

**DANA:** Then why didn't the screen say that?

> [FRICTION] The rule string "SSMD ≥ 3 · 1.7 % misread" is the only plain-language translation, and it's printed in
> statistician's shorthand. Executives need "neighbours are confused 1 in 60 times".

**PRIYA:** So the decision point at 3 sits right on rung two to three. Our clinical cut is in the steep part, just above
the low end. That's not bad design.

**MARCUS:** It's where we put it on purpose. Moving the midpoint lower would cost us the top end, and the clinicians don't
care above 50.

**PRIYA:** The CV claim, then. Eleven point nine percent at 3. And the 1.5–3 pair *passes* with Z′ at **−0.32**? A negative
Z′ normally means "no assay window".

**LENA:** Z′ is a screening metric with a ±3σ budget on both sides. For one-to-one sample calls it's far too strict, which
is why the series is set to SSMD. The tool shows all five metrics, so Z′ shows up negative next to a green tick.

> [FRICTION] Showing contradictory metrics without a sentence on why the chosen one governs makes a CSO distrust the
> green tick. Collapse the others behind a disclosure, or annotate them.

---

## Act IV — Thresholds, ROC, confusion matrices… and patients

**DANA:** Question two. Can we set a threshold that calls 1.5 apart from 3? What are the false positive and false negative
rates?

**LENA:** Separate workspace.

> [TOOL] `calwizard separate 1.5 3` → threshold signal **167.5** (reads back as **2.19 ng/mL**, via `inverse`);
> sensitivity **98.7 %**, specificity **99.0 %**, AUC 0.9993, d′ 4.52, error 1.13 %, fold 2.0.
> 95 % read-back: 1.5 reads 0.93 – 2.14 · 3 reads 2.37 – 3.79. Power with n = 3 per level: pSig **0.939**, pPass **0.64**.

**LENA:** For a sample that's truly at 3, we call it positive 987 times in a thousand. For a sample truly at 1.5, we call
it negative 990 times in a thousand. The threshold sits at about 2.2 ng/mL on the concentration scale.

**DANA:** 2.2? The decision point is 3.

**LENA:** Two different thresholds. 2.2 is the best line for telling a 1.5 from a 3. The *clinical* cut at 3 is a
different question: there, a patient sitting exactly at 3 is a coin flip by definition.

> [FRICTION] `separate` returns the threshold in **signal units only**. The CEO thinks in ng/mL, so the statistician
> had to run `inverse` to translate it. And the tool's threshold is the analytically optimal one, never the clinical
> cut-off the product will actually use.

*LENA goes to the whiteboard and draws a 2×2.*

```
                     called + | called −          (per 1000 samples at each level, pilot noise)
 true 3 ng/mL          987    |   13
 true 1.5 ng/mL         10    |  990
```

> [FRICTION] No confusion matrix in the tool, only rates as fractions. The 2×2 per 1000 is what executives and
> regulators read. The room left the tool for the whiteboard.

**PRIYA:** And this is all contrived. Patients aren't "exactly 1.5" and "exactly 3". What happens across real patients?
PPV and NPV at our prevalence?

**LENA:** That's where the tool stops. It has no populations and no prevalence. I wrote a scratch script: healthy
patients lognormal around 1.0 ng/mL, diseased around 8, our curve and noise, cut at 3.

> [FRICTION] The biggest gap of the meeting. The tool's clinical reach ends at "two concentrations". There's no
> diseased/healthy distribution input, no prevalence, no PPV/NPV, no patient-level ROC. The analysis moved to a
> Python script nobody else in the room can check.

*LENA pastes the script's output into the slide deck.*

| cut at 3 ng/mL, per 1000 tests, prevalence 10 % | sens | spec | TP | FN | FP | TN | PPV | NPV |
|---|---|---|---|---|---|---|---|---|
| *perfect assay (true c > 3)* | 0.893 | 0.969 | | | | | | |
| pilot noise | 0.891 | 0.966 | 89 | 11 | 30 | 870 | 0.75 | 0.988 |
| all scale-up layers | 0.887 | 0.964 | 89 | 11 | 32 | 868 | 0.74 | 0.987 |
| layers + 12-month drift (−10 %) | 0.855 | 0.977 | 85 | 15 | 21 | 879 | 0.80 | 0.984 |
| at 2 % prevalence, pilot noise | 0.891 | 0.966 | 18 | 2 | 33 | 947 | **0.35** | 0.998 |

Patient-level ROC AUC: 0.980 (pilot noise) vs 0.978 (all layers).

**PRIYA:** *(long pause)* So a perfect assay scores 89 % / 97 %, and ours scores 89 % / 97 %.

**LENA:** Yes. With these populations, misclassification is driven by biology: healthy and diseased patients overlap
around the cut. Assay noise adds almost nothing. The analytical 1.5-vs-3 question only matters for the few patients
whose true value sits near 3.

**DANA:** That's the best news today. So the LoD doesn't matter?

**PRIYA:** It matters for the *label*. The spec says 1.0 because the competitor's IFU says 1.0. Clinically it doesn't
change the 2×2. Commercially and regulatorily, it does.

**DANA:** And the 35 % PPV?

**PRIYA:** That's a screening setting at 2 % prevalence: two out of three positives are false. It's a positioning
decision, not an assay problem. We sell it as rule-out with a 99.8 % NPV.

> [FRICTION] The insight of the meeting ("the assay isn't the bottleneck for the clinical claim; the label LoD is")
> came from leaving the tool. A view that shows the analytical contribution to clinical error beside the biological
> overlap would have made it visible on screen.

---

## Act V — Scale-up: five sites, fifty readers, a year on the shelf

**DANA:** Last thing. The pivotal is five sites, ten readers each, three lots, a year of stability. Does any of this
survive?

**LENA:** Our pilot was one site, three readers, five days, so the curve's noise is effectively "within run". I've added
the scale-up as variability layers, sized from Marcus's best guesses plus the literature: Site, Lot, Reader, Day, and
12-month Stability as a 10 % signal loss plus 4 % gain spread.

**PRIYA:** Guesses.

**LENA:** Guesses, so treat everything in this act as a stress test, not a measurement.

> [TOOL] Variability workspace, `calwizard budget`. Share of variance by source:
> at c = 0: within 79 %, Site 12 %, Reader 6 %, Day 4 %, Lot 0.3 %. Total SD 17.7 vs within 15.7.
> at c = 3: within 52 %, **Lot 19 %**, Site 13 %, Reader 6 %, Day 5 %, Stability 4 %. Total SD 32.2 vs within 23.3.
> at c = 50: Lot 33 %, Site 17 %, Stability 8 %.
> Cumulative resolvable levels: within **10** → +Site 9 → +Lot **7** → +Reader 7 → +Day 7 → +Stability 7.

**LENA:** The story by concentration: at the blank, it's still the strip itself. At the decision point, lot-to-lot
gain becomes the biggest outside source, and it dominates at the top. Readers and days barely register.

**MARCUS:** That fits. Lot is conjugate. We've seen gold sizing drift.

> [TOOL] `calwizard limits` / `ladder` / `requirements` / `separate` with all layers on:
> **7 levels** `0 · 1.71 · 3.86 · 7.58 · 15.2 · 35.7 · 261`; **LoD 1.306**, LoQ 2.06, **upper LoQ 28.1** (was 69.4).
> Requirements **0 of 3**: LoD 1.306 (noise ×0.754 needed); pair SSMD **2.39 fails** (×0.797); CV at 3 = **16.6 %**
> (×0.903).
> Pair 1.5 | 3: threshold 166.3, sensitivity **94.9 %**, specificity **96.7 %**, error 4.2 %, readings to average **2**;
> power at n = 3: pPass 0.36.

**DANA:** Zero of three.

**LENA:** Zero of three if our guesses are right. LoD goes from 1.13 to 1.31. The 1.5-vs-3 call gets about four times
worse: misses at 3 go from 13 to 51 per thousand, false positives at 1.5 from 10 to 33. Quantitation now stops at
28 instead of 69.

**DANA:** And the "read twice" fix?

> [TOOL] `calwizard limits --reads 2` with all layers → **LoD 0.942**. ✓

**LENA:** And this one I don't believe. *(beat)* The tool divides the **whole** SD by √2, lot and site included. A
second strip from the same lot at the same site doesn't average out the lot. When I split it by hand (scratch script,
only within-run variance divided by reads) I get **1.04**. Still a miss.

> [FRICTION / wrong number] `limits --reads N` with layers on divides `sd_eff` (lot, site, reader and day included) by
> √N. Spec-consistent (§15 + §22.1), scientifically wrong: replicate reads only average within-run noise (and reader
> noise if read on different readers). It flips LoD 1.04 ✗ to 0.94 ✓ on exactly the question the CEO asked.

**PRIYA:** That's the kind of thing that ends careers in front of FDA. Flag it.

**LENA:** Stability is worse than it looks, too. The tool treats drift as **bias**, and bias doesn't touch the ladder,
the LoD or the threshold. So the curve-level numbers above don't include the 10 % loss at month 12 at all. Only the
error budget sees it.

> [TOOL] `calwizard tolerance -c 1 1.5 3 10` (k = 2, allowed total error 30 %): **0 of 4 levels within**. At 3 ng/mL:
> bias **−0.34 ng/mL (all from Stability)**, SD 0.50, total ±1.34 (**45 %**), worst-case stack 2.53 (84 %).

**LENA:** I pushed the month-12 drift through the threshold by hand. A sample truly at 3 drops from 94.9 % to **82.9 %**
called positive. Patient-level sensitivity goes from 0.887 to 0.855.

> [FRICTION] Drift over time isn't a first-class concept. Here, a 10 % signal loss at month 12 "doesn't change" the
> LoD or the threshold error rates, because §24 bias is excluded from them, yet it costs 12 points of sensitivity at
> the decision point. Shelf life needs a time axis: claims at t = 0, 6 and 12 months, and an "expiry-limited" flag.

**PRIYA:** And how sure are we of that lot number, nineteen percent of variance at 3?

**LENA:** We're not. Watch this. I simulated the full pivotal design, everything crossed, with two readings per cell.

> [TOOL] `calwizard design --concs 0 1.5 3 --n 2 --runs 50` → **6000 readings per concentration**. Estimated variance
> at 1.5 (true → 90 % range over studies): Site 56 → **9 – 92**; Lot 43 → 8 – 90; Reader 30 → 10 – 77; Day 23 → 2 – 66;
> within 326 → 269 – 410. Pair 1.5 | 3 measured SSMD 2.22 – 2.95, pPass **0.02**.

**LENA:** Eighteen thousand strips, and the site variance is still only known to within a factor of ten. Precision on a
component depends on how many *units* you have (five sites, three lots), not how many strips. Five units gives a 90 %
range of about ×0.65 to ×2.4 on the SD.

**DANA:** Eighteen thousand strips? The budget is four thousand.

**LENA:** Two more caveats. The tool crosses everything: every reader at every site, every lot on every day. Our real
design is readers *nested* in sites, ten per site, and the tool can't express that. And the 6000 counts every
combination, which we'd never run.

> [FRICTION] §22.3 design is fully crossed only. Multi-site studies are nested (readers within site, days within
> site), and the reading count explodes (5×3×10×5×4×n). There's no "design under a strip budget" mode, and no output
> of "strips needed to pin component X within ±Y %".

**MARCUS:** We do have something real. Site B ran a calibration curve last month.

> [TOOL] `calwizard compare siteA siteB` → Site B: LoD **1.37** (A: 1.13), 10 levels each. Site B reads a true 3 as
> **2.56** (−14.6 %), 10 as 8.27 (−17 %), 50 as 38.0 (−24 %). Between-condition layer: offsetSd 3.5, **gainCv 15 %**
> (from 2 units).

**LENA:** One real data point, and it says site-to-site gain is more like **15 %**, not the 6 % I assumed. Two units
can't estimate an SD to better than a factor of several, but it's the wrong direction. Rerunning with Site gainCv 15 %
the patient-level numbers barely move (sens 0.881, spec 0.963), because biology still dominates. The analytical claims
get worse.

> [FRICTION] The first Site B file had the 4PL asymptotes swapped, which gives a falling curve. `compare` accepted it
> silently and reported LoD 16.6, gainCv 1296 %, with no warning that one condition runs in the opposite direction from
> the reference. A sanity check ("Site B's curve falls; Site A's rises") would have caught it before it hit the screen.

---

## Act VI — Decision

**DANA:** I need one sentence for the board.

**PRIYA:** Here's mine. "The assay meets its *clinical* job today: rule-out at the decision point, at 99.8 % NPV in
screening prevalence. It does **not** yet meet the 1.0 ng/mL LoD on the label, and the decision-point claim is fragile
to lot and site variation. Design freeze slips one formulation cycle."

**DANA:** Confidence?

**LENA:** On the LoD: roughly a 5 % chance a verification study run today would show ≤ 1.0, and less once multi-site
noise is in. On the clinical claim: high. It's insensitive to the assay noise we're arguing about.

**DANA:** Then the question I'm asking is whether we change the *spec* or change the *strip*.

**PRIYA:** Both on the table. Labelling LoD 1.3 costs us the "matches competitor" bullet, not the clinical claim. Hitting
1.0 needs ~25 % less noise once scale-up variance is in, mostly lot-to-lot gain, which is a conjugate manufacturing
problem.

**DANA:** Decision: **conditional no-go on design freeze for Q3.** We hold the date for four weeks. If the conjugate
fix shows the noise target on a pilot lot, we freeze with the 1.0 claim. If not, we freeze with LoD 1.3 on the label and
lead with rule-out. Lena, I want the board slide to have a yes/no line and a percentage, not SSMD.

*DANA leaves for the investor call. The rest stay.*

### Action items

| # | Owner | Action | Due |
|---|---|---|---|
| 1 | Marcus | Two conjugate formulations; 3-day × 2-reader pilot each; target ≥ 25 % lower SD at blank and 3 ng/mL | 3 wk |
| 2 | Lena | Re-run requirements + plan on the new lots; report **P(verification LoD ≤ 1.0)** explicitly | 3 wk |
| 3 | Lena | Write up the "reads" issue (within-only averaging) and use the hand-corrected LoD 1.04 in all slides | 2 d |
| 4 | Priya | Decide the label LoD fallback (1.3) with RA; reframe the claim as rule-out with NPV | 2 wk |
| 5 | Marcus | Run 2 more sites' calibration curves (A, B, C, D) to size the site gain before sizing the pivotal | 6 wk |
| 6 | Lena | Pivotal design under 4000 strips: nested readers-in-site, power on the 1.5 | 3 claim and LoD | 4 wk |
| 7 | Priya / QA | Accelerated stability on 3 lots; month-12 signal loss limit to keep sensitivity at 3 ≥ 95 % | 8 wk |
| 8 | Lena | Board slide: yes/no + probability + per-1000 2×2, built by hand this time | tomorrow |

---

## Ideas mined

Ranked by value for executive decision-making.

1. **[CLI][GUI][report] Go / no-go card**: one line per claim: met / not met, *probability the verification study will
   show it* (from `plan` / `design`), and the margin ("13 % short"), with a traffic light and no metric names. *Source: CEO
   "yes/no and with what confidence"; P(LoD ≤ 1.0) had to be read off a 90 % range.*
2. **[math][CLI] `plan` / `design` report P(claim demonstrated)** for a stated target (`--target-lod 1.0`, pair pass,
   LoQ CV), and the strips needed for 80 % / 90 % assurance. *Source: "how many more strips to be sure?" took 4 runs and
   showed that strips can't buy it.*
3. **[math] Fix `reads` with layers on**: only within-run (plus reader noise when reads go to different readers) averages
   with reads; lot / site / day / stability don't. *Source: LoD 0.94 ✓ vs hand-corrected 1.04 ✗, the wrong answer to
   the CEO's live question.*
4. **[math][GUI] Clinical layer: diseased / healthy concentration distributions + prevalence** → patient-level sens /
   spec, PPV / NPV, ROC with the analytical contribution shown separately from biological overlap. *Source: the meeting's
   key insight came from a scratch script.*
5. **[report][GUI] Confusion matrix per 1000** (pair and population) next to every threshold, plus the threshold in
   concentration units, not just signal. *Source: whiteboard 2×2; `separate` threshold needed `inverse`.*
6. **[math][CLI] "What would it take" solver**: for an unmet claim, search noise scale, reads/duplicate strips, curve
   midpoint and study size, and return the cheapest combos as a table. *Source: CEO's three what-ifs; `sdScale 0.876`
   gives no route.*
7. **[math][GUI] Stability as a time axis**: drift as bias(t) applied to threshold error rates and claims at t = 0 / 6 /
   12 months, with an "expiry-limited" flag. *Source: −10 % drift changed no claim, yet cost 12 points of sensitivity
   at 3.*
8. **[GUI] Scenario presets for what-ifs** ("lot 10 % noisier", "lot 10 % weaker", "next site like Site B") with a
   "which claims break first" table across scenarios. *Source: "10 % worse" was ambiguous; the pair claim breaks under
   one meaning and not the other.*
9. **[math][CLI] Nested designs and strip budgets in `design`** (readers within site, days within site), `--max-strips`,
   and component precision as "known within ×a–×b". *Source: fully crossed = 6000 readings/conc; real plan is nested and
   capped at 4000 strips.*
10. **[CLI] `plan --reads`, and honour `limits.reads`**. Today `limits` says LoD 0.828 on a file and `plan` says truth
    1.126 on the same file. *Source: silent disagreement between two commands.*
11. **[report] Decision memo export** (one page): question, answer, confidence, margin, the 3 biggest risks
    (dominant variance source, drift, fragile claim), and assumptions flagged as guesses vs measured. *Source: board slide
    built by hand; CSO "these layers are guesses".*
12. **[GUI][report] Risk language for executives**: "neighbours confused 1 in 60" instead of "SSMD ≥ 3 · 1.7 % misread";
    "6.5 % above the bar" for closeness. *Source: CEO asked what the rule string meant.*
13. **[GUI] Claim fragility / headroom**: for each met claim, how much noise or bias it tolerates before failing (SSMD 3.2
    vs 3 = 6.5 % headroom; fails at lot noise +10 %). *Source: CSO "knife edge".*
14. **[GUI] Curve regions annotated**: low end (blank-limited), working range, plateau (no resolution above ~77, ULoQ
    69 → 28 with layers), with the clinical cut marked on the ladder. *Source: CSO's "whole curve" ask.*
15. **[report] Model vs empirical LoD side by side** with a disagreement flag, in every input mode (no bare `data: null`).
    *Source: CSO "is that a measured LoD?"*
16. **[GUI] Explain the planner's bias**: show that pooling SD at LoD and 2×LoD inflates the classical estimate (median
    1.17 vs truth 1.13), or offer a heteroscedastic estimator. *Source: CSO distrust of a median off the truth.*
17. **[GUI] Metric disclosure**: when SSMD governs, hide or annotate Z′ (−0.32 next to a green tick). *Source: CSO
    distrust.*
18. **[CLI][GUI] Condition sanity checks in `compare`**: warn on opposite curve direction, a > 3× LoD jump, or
    gainCv > 50 %. *Source: swapped 4PL asymptotes gave gainCv 1296 % silently.*
19. **[GUI] Budget → action**: name the dominant source per concentration with the lever that addresses it ("Lot gain
    19 % at 3 → conjugate lot release spec"). *Source: Marcus mapping "Lot" to gold sizing by hand.*
20. **[math] Rough-estimate warnings on few units** in `compare` / `design` ("site gain from 2 sites: ±factor 5").
    *Source: Site B's 15 % from 2 units was nearly overused.*
