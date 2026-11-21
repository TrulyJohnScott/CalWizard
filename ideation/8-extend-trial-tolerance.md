# 8. Extend the trial? A decision meeting on total variability and the tolerance stack

**Scene.** A clinical-development decision meeting, Thursday 14:00. The pivotal trial of the CRP sandwich LFA on its
reader (base `backend/examples/sandwich.json`, clinical cut-off 10 ng/mL) has been running for 9 months at 3 sites.
Interim: clinical sensitivity 132/150 = 88.0% (target 90%), specificity 288/300 = 96.0%. Primary endpoint in the
protocol: lower 95% bound of sensitivity ≥ 85%, of specificity ≥ 92%. Right now the sensitivity lower bound is 81.8%
(Wilson; Clopper-Pearson 81.7%). Question on the table: extend (more sites, subjects, months, lots, readers), or not?

**Cast.** MAYA (VP Clinical, chairs). OWEN (CSO). PRIYA (biostatistician). DEV (assay development lead, drives Cal
Wizard on the big screen). ROSA (CFO). TOM (regulatory lead).

All tool numbers below are real outputs of `uv run calwizard ...` on series files built from `sandwich.json`; the
clinical numbers are from a scratchpad script (`clin.py`) that sits outside the tool, because the tool cannot do it.
Work files: `scratchpad/personas8/` (trial.json, trial_ext.json, trial_fix.json, lotA–C.json, only_*/wo_* variants).

---

## 1. Setting the table

**MAYA:** Sixty minutes. One question: do we spend money to extend, or not. Priya, the headline.

**PRIYA:** 132 of 150 diseased called positive, 88.0%. Wilson lower bound 81.8%, Clopper-Pearson 81.7%. Specificity
288 of 300, lower bound 93.1%, so specificity passes today. Sensitivity is the problem. With a flat prior, the
probability that the true sensitivity is at least 90% is 0.18. The probability it is at least 85% is 0.83.

**OWEN:** So with enough subjects the 85% lower bound is reachable, and the 90% target probably isn't.

**PRIYA:** That's the sampling-only view. It assumes the next 150 subjects are measured by the same assay as the first
150. That's the part I don't trust.

**MAYA:** Dev, that's yours.

**DEV:** It is. I've built the whole trial as one variability model in Cal Wizard: the sandwich curve, mean
`4000 + (50 − 4000)/(1 + (c/40)^1.2)`, within-run SD `sqrt(15² + (0.08·S)²)`, plus six layers. Site (3 units, offset
SD 5, cv 4%, noise 5%, known bias +3%), Lot (3 units, gain CV 6%), Reader (6 units, cv 3%, offset SD 4), Operator
(9 units, noise CV 10%, cv 2%), Day (20 units, cv 3%), and Drift (1 unit, `biasPct` −6%, what our real-time stability
says we lose by month 12).

> [TOOL] `calwizard evaluate trial.json` → resolvable levels 8 (0, 1.67, 3.56, 6.41, 11.27, 20.8, 45.5, 311 ng/mL);
> at c = 10 the mean is 679.2 a.u. and the effective SD is 80.4 (within-run alone 56.4).

> [FRICTION] Drift has to be a "layer" with `units: 1` and a single `biasPct`. Stability is a ramp over lot age, not one
> number. I entered the month-12 endpoint (−6%); the trial's average subject saw a lot about 4.5 months old (≈ −2.25%).
> The tool has no notion of time, so I had to pick which of those two numbers it believes.

**TOM:** And "Site, known bias +3%" means what?

**DEV:** Site 2 reads about 3% high in the comparator data. The tool only lets me put a bias on the layer as a whole,
not on one unit, so the model now says every site reads 3% high.

> [FRICTION] §24 bias is per layer, not per unit. A site bias is really "one site +3%, one −1%, one 0": a fixed effect
> per unit. Entering it as one signed number makes it a calibration bias of the whole layer, which it isn't.

---

## 2. Where does the variability go?

**DEV:** Budget first, at the cut-off.

> [TOOL] `calwizard budget trial.json --c 0 5 10 20 100`: at c = 10 the total variance is 6465 a.u.², within-run 3233
> (50%). Shares of the layers that are on: Lot 22.2%, Site 11.8%, Day 6.5%, Reader 6.7%, Operator 2.9%, Drift 0.0%.
> Cumulative headline levels: within-run 10 → + Site 9 → + Lot 8 → (Reader, Operator, Day, Drift) 8.

**OWEN:** Lot is the biggest thing we can control. Within-run is half, but that's chemistry plus strip physics; we're
not reformulating in a trial.

**PRIYA:** Drift 0%?

**DEV:** Budget is a variance budget. Drift is pure bias, so it's invisible here by design. It only shows up in the
tolerance stack.

> [FRICTION] Operator was given a 10% noise CV, its biggest effect, but budget and tolerance show Operator at 2.9% /
> sd 13.6 a.u.: only its `cv` term. The `noiseCv` inflation goes into the "within run" row (56.4 → 56.9 a.u. with all
> layers on). Attributing noisier units to "within run" hides the operator effect in exactly the place it isn't.

**DEV:** Lots as real conditions, too. I made three lot curves from the release data: Lot B gain 0.92 with a +4 a.u.
blank, Lot C gain 1.07 with −3.

> [TOOL] `calwizard compare lotA.json lotB.json lotC.json -c 0 5 7 10 14 20 100`: at 10 ng/mL Lot B reads as 9.27
> (concBias −7.3%), Lot C as 10.65 (+6.5%); at 14 ng/mL −8.0% / +7.2%. LoD 1.13 / 1.22 / 1.06, levels 10 / 10 / 11.
> `between` = {units 3, offsetSd 3.5, gainCv 0.0753}.

**DEV:** So the 6% gain CV I put in the Lot layer is, if anything, kind. The three lots we're running say 7.5%.

**ROSA:** In English?

**DEV:** A patient at exactly 10 tested on Lot B reads 9.3. Negative. On Lot C, 10.7. Positive. Same patient.

---

## 3. The tolerance stack, read critically

**DEV:** Now the error budget at the cut-off. §24: per source, bias and SD converted to concentration through the
slope; total = |Σ bias| + k·√Σ sd², worst = Σ|bias| + k·Σ sd. k = 2, allowed total error 30%.

> [TOOL] `calwizard tolerance trial.json -c 2.5 5 7 10 14 20 50 100` (slope at 10 = 63.5 a.u. per ng/mL):
>
> | source | biasC (ng/mL) | sdC (ng/mL) |
> |---|---|---|
> | within run | 0 | 0.896 |
> | Site | +0.321 | 0.435 |
> | Lot | 0 | 0.597 |
> | Reader | 0 | 0.327 |
> | Operator | 0 | 0.214 |
> | Day | 0 | 0.323 |
> | Drift | −0.642 | 0 |
>
> bias −0.321, sd 1.267 → **total 2.85 ng/mL (28.5%, ok)**; **worst 6.55 ng/mL (65.5%)**. Across the curve: rel
> 37.2% at 2.5, 29.1% at 5, 28.2% at 7, 28.5% at 10, 30.0% at 14, 33.0% at 20, 52% at 50, 90% at 100. Met 3 of 8.

**TOM:** So we pass at the cut-off. 28.5% under 30%.

**PRIYA:** Look at the bias line. Total bias is −0.321. That's the drift, −0.642, *cancelled* by the site's +0.321.
The total-error number gets better because one source happens to point the other way.

**DEV:** I checked that with a one-at-a-time sweep. Here's the tornado, by hand, because the tool doesn't have one.

> [TOOL] 12 extra series files (`only_<layer>.json`, `wo_<layer>.json`), each through `calwizard tolerance -c 10`:
>
> | layer | only this layer on: total / worst | all but this one: total / worst |
> |---|---|---|
> | Site | 2.30 / 2.97 | **3.02** / 5.35 |
> | Lot | 2.14 / 2.97 | **2.55** / 5.35 |
> | Reader | 1.89 / 2.43 | 2.77 / 5.89 |
> | Operator | 1.84 / 2.21 | 2.81 / 6.11 |
> | Day | 1.89 / 2.42 | 2.77 / 5.90 |
> | Drift | 2.42 / 2.42 | 2.85 / 5.90 |
>
> (all on: 2.85 / 6.55; within-run alone contributes 2 × 0.896 = 1.79)

**DEV:** Removing Lot is the biggest win: 2.85 → 2.55. Removing Site makes the total *worse*, 2.85 → 3.02, because
its +3% was hiding the drift.

**OWEN:** That's absurd. Getting rid of a source of error makes the error budget worse.

**PRIYA:** It's what |Σ bias| does with signed biases. Fine for a single known calibration offset you will correct.
Not fine for a risk file, where the site bias of a site you haven't opened yet has an unknown sign.

> [FRICTION] No tornado. Each one-at-a-time case is a hand-made Series file. The GUI's layer on/off toggle gives the
> same thing one click at a time, but there's no "rank sources by Δtotal" view and no CLI flag for it.

> [FRICTION] The cancellation in `|Σ bias|` is silent. Nothing marks that two biases of opposite sign offset each other.

**TOM:** Then which number goes in the risk file? 2.85 or 6.55?

**PRIYA:** Neither as it stands. 6.55 adds within-run k·SD *linearly* with lot k·SD, reader k·SD, everything: every
random source at its 2-sigma tail on the same reading. The chance of that is roughly nothing. For random,
independent sources RSS is the defensible combination. For *biases*, which are systematic and don't average out
across a patient's result, add the magnitudes linearly. Hybrid: Σ|bias| + k·√Σ sd².

**DEV:** That's 0.963 + 2 × 1.267 = **3.50 ng/mL, 35%**. Over the 30% allowed error.

> [FRICTION] The hybrid "bias linear, random RSS" stack is the one I'd defend, and it's the one the tool doesn't
> print. I computed it by hand from the `sources` array. The tool gives the two ends (2.85 optimistic, 6.55
> pessimistic) and nothing in between.

**OWEN:** And between lots, is the lot effect random or a bias?

**DEV:** Depends who's asking. For the population of lots we'll ever ship, random. For a patient tested on Lot B,
it's a −7.3% bias. The tool has to have both views: it models a lot as variance (Lot layer) or as a separate curve
(compare), but the tolerance stack only takes the first.

> [FRICTION] `compare` sizes lot-to-lot as a layer (`between`), and `tolerance` stacks layers, but there's no way to
> ask "the error budget *for Lot B*": per-condition bias as a fixed source in the stack.

**PRIYA:** And what does any of this do to my sensitivity? A tolerance of ±3.5 ng/mL around 10 means nothing to a
reviewer reading a 2×2 table.

**DEV:** That's the wall. The tool stops at analytical error. It has no cut-off, no population, no 2×2.

> [TOOL] Closest thing: `calwizard separate trial.json 7 14` → threshold 646.0 a.u., sensitivity 99.46%, specificity
> 99.73%, AUC 0.9998, power pPass 0.755 (n = 3).

**DEV:** But it picks its own threshold (the PDF crossing, 646 a.u.), not our locked cut-off at 679.2, and it ignores
the drift bias. With the real cut-off and −6% drift, my script gives P(positive | 14 ng/mL) = **95.9%**, not 99.5%.

> [FRICTION] `separate` can't take a fixed threshold, and ignores `biasPct`/`biasOffset`. For a qualitative clinical
> claim the threshold isn't free. It's locked in the protocol.

---

## 4. Leaving the tool: analytical spread to clinical performance

**DEV:** So I left. Scratchpad script. I pulled sd(c) on a grid out of `calwizard evaluate --grid` for four models
(within-run only; trial; extended-uncontrolled; extended-controlled), applied bias as a fraction of the signal, and
convolved with two lognormal populations: healthy median 3.0 ng/mL, diseased median calibrated so the interim model
gives exactly 88%. That came out at 23.6 ng/mL, both with SD 0.30 log10. A subject at c is positive if their reading
exceeds the calibrated cut-off signal T = μ(10) = 679.2.

> [FRICTION] Left the tool. Needed: P(positive | c) with bias and the full layered SD (a CLSI EP12 style hit-rate
> curve, C5/C50/C95), and its integral over a population. Duplicated the 4PL in Python to do it.

**DEV:** First, the grey zone: the concentration range where a subject is called positive between 5% and 95% of the
time.

> [SCRIPT] P(pos) = 5% / 50% / 95% at:
> - within-run only, no bias: 8.72 / 10.00 / 11.71 ng/mL
> - trial, all layers, interim drift −2.25%: 8.44 / 10.25 / 13.05
> - trial, original lots aged to month 12 (−6%): 8.74 / **10.69** / 13.79
> - extended uncontrolled (5 sites, 5 lots, gain CV 8%), fresh lots (−1.5%): 8.23 / 10.17 / 13.33
> - extended controlled (lot gain CV 3%, reader cv 1%, site cv 2%), fresh lots: 8.64 / 10.17 / 12.33
>
> 18.5% of diseased subjects sit between 7 and 14 ng/mL.

**DEV:** Layers widen the grey zone from 3.0 ng/mL to 4.6; aged lots move the effective cut-off from 10.0 to 10.7.

**MAYA:** And the sensitivity?

> [SCRIPT] Modeled clinical performance (cut-off 10):
>
> | condition | sens | spec |
> |---|---|---|
> | perfect assay (truth = c ≥ 10) | **89.3%** | 95.9% |
> | within-run only | 89.1% | 95.9% |
> | interim model (calibration point) | 88.0% | 96.1% |
> | all layers, no drift | 88.7% | 95.8% |
> | original lots, months 9–15 (−6%) | 86.7% | 96.6% |
> | extended uncontrolled, fresh lots | 88.1% | 95.9% |
> | extended uncontrolled, aged lots | 86.5% | 96.5% |
> | extended controlled, fresh lots | 88.5% | 96.0% |

**OWEN:** Wait. Perfect assay, 89.3%?

**DEV:** At this cut-off, with these populations, yes. 10.7% of diseased patients have CRP below 10 ng/mL. No assay
calls them positive. Analytical spread costs us only 1.3 points of the 11.

**OWEN:** So 90% is a biology and cut-off problem, not a variability problem.

**PRIYA:** *Under this population model.* With narrower populations (SD 0.20 log10), the perfect assay gives 90.2%
and aged lots drop to 86.0%: analytics matter more. With wider ones (0.40), the perfect assay is 89.0%. The split
between biology and analytics is the single most important unknown, and it's not something either Dev's tool or my
script can tell us.

**DEV:** But our trial can. Every subject has a comparator-method value. If the 18 false negatives sit at 8–13 ng/mL,
it's analytical. If they're at 2–6, it's biology.

> [FRICTION] The tool has no place for paired (comparator c, device result) data. That's the single most useful
> dataset in the room, and the tool can only read it as calibration samples.

**TOM:** And moving the cut-off?

> [SCRIPT] Interim model, cut-off moved: 9.5 → sens 89.4% / spec 95.4%; 9.0 → 90.8% / 94.6%; 8.5 → 92.0% / 93.7%;
> 8.0 → 93.3% / 92.5%.

**TOM:** Not in this trial. The cut-off is pre-specified. Changing it after unblinding interim data makes this a
training set, and the pivotal becomes the next study. I'll take a 9 ng/mL cut-off to the agency as a pre-sub question
for a confirmatory study, not as a rescue.

---

## 5. The extension, priced

**ROSA:** My numbers. Running site-month: $45k (coordinator, monitoring, reader service). New site start-up: $180k
and two months before the first subject. Per subject with comparator: $1,100. A new lot made and released: $90k.
Dev's "fix first" package (lot release spec, reader calibration programme, shorter dating): $400k and three months.
Every month the launch slips costs about $1.2M in contribution.

**PRIYA:** Enrolment has been 5.6 diseased per site-month, twice that healthy. I simulated each scenario 4,000 times:
the interim 132/150 is fixed, each new cohort's positives are binomial at its modeled sensitivity, then Wilson on
the pooled count.

> [SCRIPT] (D = diseased, H = healthy subjects added; cohort sens from the table above)
>
> | scenario | new D/H | new-cohort sens | E[pooled sens] | P(LB ≥ 85%) | P(point ≥ 90%) | cost | months |
> |---|---|---|---|---|---|---|---|
> | A pure sampling, +6 mo, 3 sites, nothing changes (counterfactual) | 100/200 | 88.0 | 88.0 | 0.136 | 0.074 | $1.14M | 6 |
> | B +6 mo, 3 sites, same lots ageing | 100/200 | 86.7 | 87.5 | **0.070** | 0.036 | $1.14M | 6 |
> | C +2 sites +6 mo, 2 new lots, uncontrolled | 144/289 | 86.5 / 88.1 | 87.5 | 0.140 | 0.025 | $2.19M | 6 |
> | D +2 sites +12 mo, uncontrolled | 311/622 | 85.9 / 87.6 | 87.0 | 0.186 | 0.011 | $4.09M | 12 |
> | E fix first (3 mo), +2 sites +6 mo, controlled | 144/289 | 88.5 | 88.2 | 0.307 | 0.087 | $2.59M | 9 |
> | F fix first, +2 sites +9 mo, controlled | 228/456 | 88.5 | 88.3 | 0.438 | 0.072 | $3.54M | 12 |
> | G fix first, +2 sites +18 mo, controlled | 478/956 | 88.5 | 88.4 | **0.675** | 0.057 | $5.45M | 21 |
>
> Specificity lower bound ≥ 92% holds in every scenario (joint probability = sensitivity probability).

**MAYA:** So the cheap extension, B, *halves* our chances compared to doing nothing different.

**PRIYA:** Because the new subjects are measured on lots at month 9 to 15. Their sensitivity is 86.7%. Every extra
subject pulls the pooled estimate down. The CI narrows around a worse number. C is the same story with more money:
the new sites start on fresh lots, but the old sites keep running old ones and the extra lots add lot-to-lot spread.

**ROSA:** And D, a year, four million, 19%.

**PRIYA:** D is the "more is better" instinct, and it's the worst value on the table. 0.186 for $4.09M.

> [SCRIPT] Break-even: the pooled Wilson lower bound reaches 85% (expected counts) only if the new cohort's sensitivity
> is ≥ 0.87: 920 new diseased at 0.87, 400 at 0.88, 230 at 0.89, 160 at 0.90. For an 80% chance of success: 2,070 /
> 860 / 470 / 290. At ≤ 0.86 never.

**PRIYA:** That's the break-even in one line. Extending helps only if the new subjects are measured at ≥ 88%
sensitivity. Below 87% it can't help at any size. Every month of drift on old lots costs about 0.5% of signal, and each 1%
of signal costs about 0.35 points of sensitivity (−2.25% → −6% took 88.0% to 86.7%). The analytical side decides whether recruitment is worth paying for.

> [FRICTION] None of this is in the tool: no probability of trial success, no cost per site-month, no "how many
> subjects for an 80% chance at the lower bound". `design` is the closest and it answers a different question.

**DEV:** About `design`, I did run it, for completeness.

> [TOOL] `calwizard design trial.json --concs 7 10 14 --n 2 --runs 200 --seed 3`: units [3, 3, 6, 9, 20, 1],
> **19,440 readings per concentration** (fully crossed), pairs 7 vs 10: SSMD median 2.14 (90% 1.79–2.48), pPass 0.0;
> 10 vs 14: median 1.98, pPass 0.0. Components at c = 10: Site true 763 a.u.², estimates median 619, 90% range
> **51–2,247**; Lot true 1,434, median 887, range 88–3,801. Output file 1.1 MB.

**DEV:** Two things. First, it's a fully crossed design: every operator at every site on every reader on every day.
Our trial is nested: operators and readers belong to a site. 19,440 readings per level is not a trial. Second, the
component ranges are the useful bit. With three sites, our site variance is known to a factor of 40. That's an
argument *for* new sites, for a different reason: not to get the sensitivity up, but because the agency will ask
about reproducibility across sites, and three is too few to say anything.

> [FRICTION] `design` is crossed-only; no nested design (operator within site, reader within site), no unbalanced
> enrolment, no "subjects" as a unit. The default output dumps every reading of the first run (1.1 MB); a `--summary`
> flag is needed.

**OWEN:** And the extended-uncontrolled model in the tool itself?

> [TOOL] `calwizard tolerance trial_ext.json -c 10` (5 sites cv 5%, 5 lots gain CV 8%, 10 readers, drift −12%):
> bias −0.963, sd 1.408, total 3.78 (37.8%, fails), worst 7.79 (77.9%). Met 0 of 8 (was 3 of 8).
> `requirements trial_ext.json`: range 2–60 needs sdScale 0.679 (was 0.762); 10 ng/mL CV 14.1% (target 15%, still
> met). `limits`: LoD 1.31 (was 1.29), upper LoQ 32.2 (was 39.7). Headline levels 7 (was 8).
>
> `calwizard tolerance trial_fix.json -c 10` (lot gain CV 3%, reader cv 1%, site cv 2% with no bias, drift −3%):
> bias −0.321, sd 1.052, **total 2.43 (24.3%)**, worst 4.47 (44.7%); hybrid = the same 2.43 (one bias source).

**DEV:** Uncontrolled extension takes the error budget from 28.5% to 37.8% at the cut-off. Controlled brings it
to 24.3%. That's the condition.

---

## 6. Arguing it out

**ROSA:** I hear "fix first" and I hear three months. That's $3.6M of launch delay before we enrol anyone.

**OWEN:** The alternative is spending $1–4M to make the number worse. B and C aren't cheaper versions of E. They're
negative-value options.

**TOM:** Two regulatory points. First, a protocol amendment that adds sites and lots mid-trial is fine. A change to
the *device* is not: a new lot release spec is fine if the device design is unchanged, but reformulation is a new
device and the old 150 subjects don't pool. Dev's fix has to be manufacturing controls and reader calibration, not
chemistry. Second, a sample-size increase after an unblinded look needs a pre-specified adaptive rule or an alpha
penalty. Priya?

**PRIYA:** We have a promising-zone clause in the SAP. 88% at the interim sits in it. We can increase without alpha
penalty if we stay within the pre-specified maximum, 450 diseased. G at 628 total is over it. F, 378, is under it.

**MAYA:** So G is out on regulatory grounds, F is the biggest we're allowed.

**DEV:** And F's 44% assumes the controlled assay really gives 88.5% sensitivity. That's a model number. Every input
(gain CV 3%, drift −1.5%) is a target, not something we've demonstrated.

**PRIYA:** And my populations are a guess calibrated to one number. If the comparator values show the false
negatives at 8–13 ng/mL, the analytical fix is worth more than I've modeled. If they're at 2–6, it's worth less, and
nothing we do to the assay matters for the 90%.

**OWEN:** Then we don't decide the extension today. We decide what we need to know by when.

**ROSA:** What does knowing cost?

**DEV:** Comparator values for the 18 false negatives: we have them. A day. A lot-to-lot bridging panel at 7, 10,
14 ng/mL on all three lots and the two candidate lots: three weeks, about $40k. Reader calibration check: a week.

**ROSA:** That's cheap enough. I'm fine with that.

---

## 7. Decision

**MAYA:** Decision, for the minutes.

1. **No extension as currently specified.** Scenarios B, C and D (more months on ageing lots, or more sites and lots
   without controls) are rejected: modeled P(success) 7–19% for $1.1–4.1M, and B is worse than standing still.
2. **This week:** Priya and Dev pull comparator concentrations for the 18 false negatives and classify each as
   grey zone (8.2–13.8 ng/mL) or below. Above 10 of 18 in the grey zone means analytical; go to 3. Mostly
   below 7 ng/mL means biology; go to 5.
3. **Conditional extension (scenario F, ≤ $3.54M, 12 months, ≤ 450 diseased in total per the SAP),** authorised only
   when all of these hold:
   - lot release: gain within ±5% of the reference lot at 10 ng/mL on a 7/10/14 panel (lot gain CV ≤ 3%); Lot B
     (−7.3% at cut-off) is withdrawn from the trial;
   - reader calibration: check cassette at 10 ng/mL each day, readers within ±2% (reader cv ≤ 1%, offset SD ≤ 2 a.u.);
   - dating: no strip older than 6 months at a site (mean drift ≤ −1.5%), with stability re-confirmed at 6 months;
   - hybrid error budget (Σ|bias| + 2·RSS) at 10 ng/mL ≤ 25%, demonstrated on the bridging panel, not just modeled.
4. **Futility rule:** after the first 100 new diseased subjects, stop if the new cohort's sensitivity is below 86%
   (where the break-even says no size can work).
5. **In parallel, Tom:** pre-sub to the agency on a 9 ng/mL cut-off (modeled 90.8% / 94.6%) for a confirmatory study,
   in case step 2 says biology.
6. **The 90% point target is formally retired as a success criterion for this trial.** Under every scenario the
   probability of reaching it is below 9%. The primary endpoint (lower bound ≥ 85%) stands.

**OWEN:** Agreed. And Dev, I want the tolerance stack in the risk file as the hybrid, not as either of the two
numbers the tool prints.

**DEV:** Then I'm calculating it by hand. Noted.

*End of meeting.*

---

## Ideas mined

Ranked by how much they would have changed this meeting.

1. **[math][CLI] Clinical performance from analytical spread**: `calwizard clinical SERIES --cutoff C --pop
   diseased=lognorm(m,s) healthy=lognorm(m,s)` → sens/spec with and without analytical error, and the share of
   misclassification due to the assay vs biology. (Friction: left the tool for `clin.py`; the 89.3% "perfect assay"
   ceiling was the turning point of the meeting.)
2. **[math][CLI][GUI] Fixed-cut-off hit-rate curve (CLSI EP12 C5/C50/C95)** including bias and all layers:
   `calwizard hitrate SERIES --cutoff 10`. (Friction: `separate` picks its own threshold and ignores bias; 99.5% vs a
   real 95.9% at 14 ng/mL.)
3. **[math] Hybrid tolerance stack**: print `hybrid = Σ|bias| + k·√Σsd²` beside `total` and `worst`, and make it the
   default for risk files. (Friction: computed by hand; the defensible number wasn't printed.)
4. **[math][GUI] Flag bias cancellation in |Σ bias|**: warn when signed biases offset each other, and show the
   per-source sign. (Friction: removing Site made the total go up from 2.85 to 3.02.)
5. **[CLI][GUI] Per-source tornado**: `calwizard tolerance --tornado` → for each layer Δtotal/Δhybrid/Δworst when it is
   removed and when it is alone, ranked; a tornado bar in the Error budget section. (Friction: 12 hand-made files.)
6. **[math][CLI] Probability-of-trial-success calculator**: interim x/n plus new cohorts (n, modeled sens) →
   P(Wilson/CP lower bound ≥ bar), P(point ≥ target), break-even sens. (Friction: Monte Carlo in scratchpad.)
7. **[math] Bias per unit, not per layer**: allow `units: [{name, biasPct}]` so a site or lot can carry its own known
   shift, with the unmentioned units treated as random. (Friction: "+3% site bias" became "every site +3%".)
8. **[math][CLI] Drift over time**: a drift layer with a rate (%/month) and an age distribution (`--age-mean`, or
   per-cohort ages) instead of a single `biasPct`; tolerance and hit rate at "month t". (Friction: −6% endpoint vs
   −2.25% average.)
9. **[CLI] Condition-specific error budget**: `calwizard tolerance --condition lotB.json` uses compare's per-level
   bias as a fixed source. (Friction: "the budget for a patient on Lot B" was not expressible.)
10. **[math] Attribute `noiseCv` to its own layer** in budget and tolerance instead of folding the inflation into
    "within run". (Friction: Operator's 10% noise CV showed up as 2.9% share.)
11. **[math][CLI] Nested designs in `design`**: `nestedIn: "Site"` for Operator and Reader, unbalanced enrolment;
    report readings per concentration that a trial could actually run. (Friction: 19,440 crossed readings per level.)
12. **[CLI] `design --summary`** (no `first` readings dump) and top-level component precision as a ratio
    ("site variance known to ×44"). (Friction: 1.1 MB JSON for a two-line answer.)
13. **[math][CLI] Cost-aware study sizing**: costs per site-month, start-up, subject, lot; output cost per point of
    P(success) and the cheapest scenario hitting a target probability. (Friction: CFO's table done by hand.)
14. **[CLI][GUI] Paired comparator data import**: `{c_ref, device_result}` rows → observed false negatives placed on
    the hit-rate curve (grey zone vs biology). (Friction: the most useful trial data had no place in the tool.)
15. **[math] Cut-off what-if**: sens/spec vs cut-off from the population model, with the error budget re-evaluated at
    the new cut-off. (Friction: moving the cut-off was a hand loop.)
16. **[report] Risk-file block in the claim sheet**: hybrid stack per level, dominant source, grey zone at the decision
    limit, and the assumptions (k, tea, bias treatment) stated in words. (Friction: two numbers, no guidance on which
    to file.)
17. **[GUI] Requirement kind `decide`**: "classify at cut-off C with ≤ x% misclassification between C·a and C·b",
    checked against the hit-rate curve with `sdScale`. (Friction: requirements had to stand in with precision at 10
    and distinguish 7 vs 14.)
18. **[CLI] `compare --as-layer` output piped straight into a series' layers** (bake `between` into a Lot layer).
    (Friction: copied gainCv 0.0753 by hand.)

## Tolerance stack evaluation

**Is §24 the right construct?** Half right. Per-source bias and SD in concentration units through the slope is the
right currency, and the table of `sources` is excellent raw material. But the two summaries are the two wrong ends:
`total = |Σ bias| + k·√Σ var` lets signed biases cancel (unsafe for unknown-sign site/lot effects; removing a source
can increase the total, as seen 2.85 → 3.02), and `worst = Σ|bias| + k·Σ sd` stacks independent random sources
linearly, including within-run, which no reviewer will accept as a plausible case (65% at the cut-off).

**What's missing.** (1) A hybrid `Σ|bias| + k·√Σ sd²` (systematic linear, random RSS), with a per-source flag for
"systematic / random / known-and-corrected". (2) Per-unit biases (one site or lot high). (3) `noiseCv` attributed to its
own source. (4) Time: drift as a rate × age, so the stack is evaluated "at month t". (5) The coverage the user is
claiming: k = 2 on a sum of a bias and an SD is not 95% coverage of anything; an option for a true coverage
interval (e.g. a 95% tolerance interval by Monte Carlo over the unit draws) would make the number defensible.
(6) The bridge to the decision: at a cut-off, the stack should become a grey zone (C5–C95) and a misclassification
rate, which is what a clinical team reads.

**What I'd change.** Keep `total` and `worst`, add `hybrid` as the headline, mark the assumption beside each, warn on
bias cancellation, add `--tornado`, and add a `decision` mode at a stated cut-off that reports C5/C50/C95 and the
shift of C50 due to bias. With those additions the stack would be a risk-file artefact rather than a slide.
