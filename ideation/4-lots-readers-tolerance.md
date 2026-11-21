# Persona 4: Tom, design transfer — lots, readers, tolerance budget

**Cast.** TOM (assay development lead, owns the CRP sandwich LFA), PRIYA (manufacturing engineer, owns conjugate
lots and reader calibration), DANA (quality lead, signs the release specs and the precision protocol).

**Setup (real runs, 2026-11-20, branch `scientist-modes`).** Starting point `backend/examples/sandwich.json` (CRP 4PL,
blank 50 a.u., σ = √(15² + (0.08·S)²), claims: detect 2, tell 5 from 10, quantify 2–60 ng/mL at CV 20%). Copies in
the scratchpad `personas/` folder:

- `tom.json`: four layers. Lot (3 units, gainCv 5%, noiseCv 5%), Reader (4, offsetSd 3, cv 3%, noiseCv 5%), Day (5,
  offsetSd 4, cv 2%, noiseCv 5%), Operator (2, offsetSd 2, cv 2%).
- `tom_gain{10,15,20}.json`: Lot gainCv raised. `tom_bias5.json`: Reader `biasPct` 0.05. `tom_8lots.json`: 8 lot units.
- `Lot1/2/3.json`: three conditions, the rise above the blank scaled ×1.00, ×1.07, ×0.85 (Lot 3 = "15% low").
- `tom_precision.csv`: a synthetic 3 lots × 4 readers × 5 days × 2 operators × 2 reps × 6 concentrations study
  (1440 rows), with reader R4 deliberately reading 6% high.
- `tom_scan.py`: a loop over gainCv and reader biasPct, calling `limits`, `requirements`, `tolerance`, `evaluate`
  on stdin. (The loop exists because the tool has no solver.)

---

## Scene 1. The budget, before anyone argues

*A small meeting room. Tom has a laptop on the projector, a terminal open.*

**TOM:** Before we fight over numbers, here's where the variance comes from. This is the sandwich assay with our
best guesses for lots, readers, days and operators layered on top.

[TOOL] `calwizard budget tom.json --c 0 1 2 5 25 100`. At c = 5: within-run 69% of the variance, Lot 15%, Reader 8%,
Day 4%, Operator 4%. At c = 100: within 61%, Lot 23%. At the blank: within 88%, Lot 0% (a gain error has nothing to
scale at zero). Cumulative ladder: 10 levels within a run → 9 with Lot → 9 with everything.

**PRIYA:** So within-run noise is most of it. Good. That's your problem, not mine.

**TOM:** Mostly. But look at the shape. At the blank, lots don't matter at all. At the top of the curve, lot is a
quarter of everything. Your conjugate spec is a high-end problem.

**DANA:** Ten levels down to nine sounds harmless. What does it mean for the claims on the label?

**TOM:** That's the next screen.

[FRICTION] "10 → 9 levels" is the headline the tool gives for adding layers, but no one in this room signs off on
"levels". Dana wants the three label claims (detect 2, 5 vs 10, range 2–60) against each added layer, the
cumulative story told in requirements, not ladder length.

---

## Scene 2. How much lot-to-lot gain can manufacturing have?

**TOM:** Priya's question is the one we're here for: how much can the conjugate lots differ in gain before a claim
breaks. The tool has no "solve for the spec" button, so I scripted a loop.

[TOOL] `tom_scan.py`: Lot gainCv from 0 to 12%, every other layer fixed.

| gainCv | LoD | LoQ | ULoQ | SSMD 5 vs 10 | levels | tolerance rel (k = 2) at 2 / 5 / 10 / 25 |
|---|---|---|---|---|---|---|
| 0% | 1.20 | 1.68 | 59.1 | 4.52 | 9 | 0.35 / 0.21 / 0.20 / 0.25 |
| 4% | 1.21 | 1.70 | 52.4 | 4.22 | 9 | 0.35 / 0.22 / 0.21 / 0.27 |
| 6% | 1.21 | 1.74 | 45.7 | 3.92 | 8 | 0.36 / 0.24 / 0.23 / 0.29 |
| 8% | 1.22 | 1.80 | 38.6 | 3.58 | 8 | 0.37 / 0.26 / 0.25 / 0.32 |
| 10% | 1.23 | 1.89 | 31.6 | 3.26 | 7 | 0.39 / 0.28 / 0.28 / 0.36 |
| 12% | 1.25 | 2.02 | 25.2 | 2.96 ✗ | 6 | 0.40 / 0.30 / 0.31 / 0.40 |

**PRIYA:** The LoD hardly moves. 1.20 to 1.25 ng/mL across the whole range.

**TOM:** Right, and that's the first surprise. The LoD claim is set by the blank, and gain does nothing at the
blank. Lot gain variation is not what threatens the LoD. It threatens the top of the range and "5 vs 10".

**DANA:** Then what's the limit?

**TOM:** Depends on which claim you're protecting. "Tell 5 from 10" at SSMD 3 breaks between 10 and 12%. The 25
ng/mL total error stays under 30% up to about 6–7%. And the range claim to 60...

**PRIYA:** ...is already broken at 0%. ULoQ 59.1.

**TOM:** Yes. With readers, days and operators in, the upper LoQ is 59 before your lots add anything. With 5%
gain CV it's 49. The range claim of 2–60 doesn't survive transfer even with perfect conjugate.

[TOOL] `calwizard requirements tom.json`: detect ✓ (LoD 1.21), distinguish ✓, range ✗ with `sdScale` 0.87 ("met if
the noise were 0.87×"). At gainCv 15%: distinguish ✗ (sdScale 0.86), range sdScale 0.52.

**DANA:** So the honest answer is the label says 2–50, or development fixes the high end.

**TOM:** Or we argue about 60 for a week. I'd rather change the label.

[FRICTION] Tom wrote a 30-line script to find a number the tool should give directly: "largest Lot gainCv such that
every requirement is still met", per requirement. `sdScale` is close in spirit, but it scales *every* SD at once,
including within-run, so it can't answer "how much of the remaining room can manufacturing have". The question
is always about one layer.

[FRICTION] The answer needs to be rounded to something Priya can write on a release form: "lot gain within ±X%
of the reference lot at the 25 ng/mL control", not "gainCv 0.06". The tool speaks in an SD of a random effect;
manufacturing releases individual lots against limits.

---

## Scene 3. Lot 3 comes in 15% low

*Priya slides a printout across: the incoming QC on the third pilot lot.*

**PRIYA:** Lot 3's test line is 15% down at every control level. Lots 1 and 2 were fine, Lot 2 a bit hot, plus 7%.
Do I scrap it?

**TOM:** Let's treat each lot as its own curve and read them all off Lot 1's calibration.

[TOOL] `calwizard compare Lot1.json Lot2.json Lot3.json -c 0 1 2 5 10 25 60 100`.

| c (ng/mL) | Lot 2 reads as | Lot 3 reads as |
|---|---|---|
| 1 | +5.9% | −12.8% |
| 5 | +6.3% | −13.6% |
| 10 | +7.0% | −14.7% |
| 25 | +9.4% | −18.4% |
| 60 | +17.0% | −27.2% |
| 100 | +28.8% | −35.9% |

Per lot on its own: LoD 1.13 / 1.06 / 1.29 ng/mL, LoQ 1.53 / 1.44 / 1.76; all three pass every requirement
*on their own curve*. `between`: gainCv 11.5%, offsetSd 0, units 3.

**DANA:** So Lot 3 meets the LoD claim.

**TOM:** It meets it with its own calibration. Read against the master curve, it reads 14% low in the middle and
27% low at 60. A 15% signal deficit becomes a 27% concentration deficit where the curve flattens. That's the bit
people get wrong: the signal spec and the concentration spec are not the same number.

**PRIYA:** So the release spec has to be tighter at the top?

**TOM:** Or the lot gets its own calibration. If every lot ships with a lot-specific curve, a 15% low lot costs us
the LoD going from 1.13 to 1.29. If we ship one master curve, a 15% low lot costs 27% bias at 60.

**DANA:** And if I plug the three lots in as a layer?

**TOM:** The between-lot gain from these three is 11.5%. That's the 12% row in my table: "5 vs 10" fails.

**DANA:** From three lots.

**TOM:** From three lots. I wouldn't put that in a submission.

[FRICTION] `compare` answers "how does this lot read on the reference curve", which is the right question, but
there's no verdict per lot against an allowed bias. Dana wants a column: "Lot 3: concentration bias −18% at 25,
limit ±10%: REJECT". Today she reads the table and decides.

[FRICTION] There's no notion of a lot calibration factor. The real-world fix ("assign Lot 3 a gain of 0.85 on the
master curve / QR-code recalibration") can't be modelled except by keeping three separate series. Tom wants a
"recalibrate on lot" switch that shows the *residual* bias after a one-point or two-point lot adjustment.

[FRICTION] `between.gainCv` from 3 conditions is printed to three significant figures with no uncertainty. `dialin`
warns "3 units give a rough estimate (0.58–4.4×)", `compare` doesn't. Same number, different honesty.

---

## Scene 4. Reader calibration tolerance

**PRIYA:** Readers next. Field service calibrates them against a reference cassette. What tolerance do I put in the
service procedure? ±5%?

**TOM:** I gave Reader a known bias in the layer and ran the error budget.

[TOOL] `calwizard tolerance` with Reader `biasPct` scanned (Lot gainCv 5%, TEa 30%, k = 2). Relative total error
`|bias| + 2·SD` over c:

| reader bias | c = 5 | c = 10 | c = 25 |
|---|---|---|---|
| 0% | 23.1% ✓ | 22.3% ✓ | 27.9% ✓ |
| +2% | 25.2% ✓ | 24.4% ✓ | 30.6% ✗ |
| +5% | 28.4% ✓ | 27.6% ✓ | 34.6% ✗ |
| +8% | 31.5% ✗ | 30.8% ✗ | 38.7% ✗ |

At c = 5 and +5% the reader source is `bias` 17.5 a.u. → `biasC` 0.263 ng/mL (5.3%); at c = 60 the same 5% signal
bias is 6.7 ng/mL (11%) because the slope is 18.6 a.u. per ng/mL there.

**PRIYA:** So ±2% for readers if you want 25 ng/mL inside 30%. That's tighter than our reference cassette's
certified value.

**TOM:** That's the 25 level being already at 27.9% before any reader bias. There's no room up there. In the
middle of the range you can have about ±7%.

**DANA:** What does reader bias do to the LoD?

**TOM:** According to the tool, nothing.

[TOOL] Reader `biasOffset` = +10 a.u.: `limits` LoD unchanged at 1.211; `tolerance` shows `bias` 0.18 ng/mL at c = 1.

**DANA:** That can't be right. A reader that adds 10 counts to a blank strip will call more blanks positive.

**TOM:** It's by design: spec §24 says bias changes accuracy, not spread, so the LoB and LoD stay where the
calibration put them. But you're right about the field. The cutoff is fixed at 77.3 a.u. The blank on that reader
now sits at 60 with an SD of 16.6. False-positive rate goes from 5% to about 15%.

[FRICTION] Here Tom leaves the tool and does a z-score on the whiteboard: (77.3 − 60)/16.6 = 1.04 → 15% false
positives. For a qualitative cut-off, a fixed reader offset is *the* LoB risk, and the tool says "unchanged". It
needs "LoB / LoD as seen by a biased unit": false-positive rate at the blank and detection rate at the LoD under
each layer's bias, against the factory cutoff.

[FRICTION] The bias is a single `biasPct` on the whole layer, meaning "every reader reads 5% high". Priya's real
model is "each reader is anywhere within ±5%", which is a uniform tolerance band, not a fixed shift and not a
Gaussian SD. The tool has the two extremes and not the thing a calibration spec describes.

---

## Scene 5. Stack or RSS?

**DANA:** Your 23% at c = 5, is that a root-sum-square?

**TOM:** `total` is |bias| + 2·√(Σ SD²). The tool also gives `worst`, every source at its limit at once.

[TOOL] `tolerance tom.json -c 1 2 5 10 25 60`: met 3/6. At c = 5: `total` 1.16 ng/mL (23.1%), `worst` 2.20 (44%).
Sources at 5 (sdC, ng/mL): within 0.479, Lot 0.226, Reader 0.164, Day 0.121, Operator 0.109.

**DANA:** 23 versus 44. Which goes in the risk file?

**TOM:** Neither, honestly. The worst-case stack adds 2× the within-run SD linearly with everything else, as if
within-run noise could be "at its limit" in a coordinated way. It can't, it's a fresh draw every strip. The
defensible version is: fixed per-unit effects (this lot, this reader) stacked at their release limits, within-run
and day-to-day as RSS on top.

**PRIYA:** Can the tool do that?

**TOM:** No. I'd compute it by hand: lot at its +5% limit, reader at +2%, then 2·√(within² + day² + operator²).

**DANA:** And c = 1 and c = 2 fail at 66% and 36%.

**TOM:** Those are below and at the LoQ. By construction a level at the LoQ has CV 20%, so with k = 2 it's 40%
total error before anything else. A 30% TEa and a 20% LoQ CV can't both hold at the low end. The low end should
be judged as an absolute error, ± something in ng/mL, not a percentage.

[FRICTION] `tolerance` judges every level against one relative TEa, including levels under the LoQ that are only
ever reported qualitatively. CLSI-style specs use "±X ng/mL or ±Y%, whichever is larger". Dana marked c = 1 and 2 as
failures in her notes before Tom talked her out of it.

[FRICTION] `worst` is a third definition next to RSS and |bias|+k·SD, and it is the most conservative possible one
(random terms added linearly). Without a per-source "fixed at limit / random" switch it overstates; Dana will
either never use it or use it and over-tighten every spec.

---

## Scene 6. How big a precision study?

**DANA:** Protocol. Lots × readers × days × operators. What's the minimum that tells us the lot component?

**TOM:** I simulated the full crossed design.

[TOOL] `calwizard design tom.json --concs 0 2 5 10 --n 2 --runs 200 --seed 7`: 3 × 4 × 5 × 2 × 2 = 240 readings per
concentration. Every adjacent pair passes in 100% of runs. Variance components at c = 5, 90% range of the estimate:
within 843–1208 (true 1013); **Lot 0.9–692 (true 226)**; Reader 4.9–293 (true 120); Day 0–183 (true 65).

`tom_8lots.json` (8 lots, rest the same, 640 readings per concentration): Lot 65–446 (true 226).

**PRIYA:** 240 strips a level and the lot variance could be anywhere from zero to three times the truth.

**TOM:** Three lots can't estimate a lot SD. The readings don't help, the number of lots does. Eight lots gets the
range down to about 0.3–2× in variance, which is still ±50% on the SD.

**DANA:** We are not making eight pilot lots.

**TOM:** Then we don't claim a lot SD. We release lots against a fixed acceptance limit, verified per lot, and the
precision study only has to show that within-lot, reader and day are what we think.

**PRIYA:** Can I cut replicates to one per cell to save strips?

**TOM:** The tool won't let me try it.

[TOOL] `design --n 1` → `{"ok": false, "error": "n must be between 2 and 1000, got 1"}`, exit 2.

[FRICTION] n = 1 per cell is a legitimate crossed design (the residual still has degrees of freedom from the
interactions); the tool refuses it. Also no nested design: real conjugate lots are made into strip lots, and
operators are nested within sites, but `design` only does fully crossed, and the 240-readings-per-level design isn't
what anyone would run. Tom wants to type "3 lots, 2 readers, 5 days, 1 rep" and see cost (strips) next to the
precision of each component.

[FRICTION] `plan` (LoB/LoD verification, 80 strips: 20 blank, 20 at 1.21, 20 at 2.42, 20 at the LoQ 1.72) ignores
layers entirely: no lots, no days. CLSI EP17 asks for at least two reagent lots and the LoD stated as the worst lot.
`plan` should draw its strips from the layer design.

---

## Scene 7. The study comes back

*Two weeks later. Priya has the synthetic stand-in for the study: 1440 rows, CSV.*

[TOOL] `calwizard dialin tom.json tom_precision.csv`:
- Lot measured cv 11.3% (predicted gainCv 5%), note: "gain and proportional CV cannot be told apart on this curve
  ... reported together as CV"; rough range 0.58–4.4×.
- Reader offsetSd **11.0** (predicted 3), cv 3.3%; Day offsetSd **14.1** (predicted 4), cv 1.5%; Operator cv 2.3%.
- Per-concentration rows at c = 0: Reader variance 23.2 (SD 4.8), Day 71.2 (SD 8.4).

**PRIYA:** Lot came back at 11%. You budgeted 5.

**TOM:** It's the actual three lots: 1.00, 1.07 and 0.85 have an SD of 11%. That's Lot 3. The tool is right and it
tells me the number is rough.

**DANA:** Reader offset SD 11 counts? You budgeted 3.

**TOM:** That one I don't believe. Look at its own blank row: the reader variance at c = 0 is 23, an SD of 4.8. The
fitted offset is 11, more than twice what the blank itself shows. The fit runs across all concentrations and the
high ones have variances in the tens of thousands; they swamp the blank. Same thing for Day: 14 fitted, 8.4 at the
blank.

**PRIYA:** And reader R4? We know it was reading 6% high.

**TOM:** It disappears into "Reader cv 3.3%". `dialin` gives the size of the reader spread, not which reader.

[FRICTION] Tom distrusts `measured.offsetSd` for Reader and Day: the fit is unweighted least squares on absolute
variances, so c = 60 (Lot variance 79,903) dominates and the offset term is whatever's left over. It contradicts the
c = 0 row in the same output. A relative (1/var²) weighting or fitting the offset from the blank alone would fix it.

[FRICTION] No per-unit table. For manufacturing, "R4 is +6% against the others, recalibrate it" is *the* output of a
reader precision study; the variance component is secondary. Same for lots: "L3 −15%" should come out of
`dialin` as a unit effect, so `dialin` and `compare` agree.

[FRICTION] Priya's data comes from a LIMS export in nested long format with lot/strip-lot/run IDs and a "QC level"
name instead of a concentration. `dialin` wants exactly `c,<layer names>,y`, header names matching layer names.
She'd do the rename in Excel. A column-mapping step like `import --conc COL` has would remove that.

---

## Scene 8. What goes in the specs

**DANA:** Summarise.

**TOM:** One: LoD 1.2 ng/mL is robust: it moves to 1.25 at 12% lot gain CV and 1.29 for a lot 15% low. Lots aren't
the LoD risk; reader offsets at the blank are, and the tool doesn't model that, so we compute false-positive rate
by hand. Two: the range is 2–50, not 2–60; at 60 the upper LoQ fails even with perfect lots. Three: lot release
within ±6% of the reference lot's rise at the 25 ng/mL control if we ship one master curve, or lot-specific
calibration if we want to accept lots like Lot 3. Four: reader calibration ±2% if we keep a 30% TEa at 25, ±7% if the
TEa only applies 5–10. Five: precision study 3 lots × 4 readers × 5 days × 2 operators is fine for reader and day,
useless for the lot SD; lots get per-lot acceptance testing instead.

**PRIYA:** ±6% on a conjugate lot. That's going to scrap lots.

**TOM:** Then we buy the lot calibration. That's a decision, not a number the tool can make.

**DANA:** Put it in a document I can sign.

**TOM:** I'll write it. The report doesn't have a tolerance section yet.

[FRICTION] `calwizard report` (the claim sheet) has levels, limits, requirements and read-back, but no layers, no
error budget, no conditions, no allowed specs. The design-transfer deliverable is precisely "claims + the
manufacturing tolerances they imply", and Tom leaves the tool to write it.

[FRICTION] (agent) The CLI table in `AGENTS.md` lists `compare` and `tolerance` but not `budget`, `design` or
`dialin`; an agent working from AGENTS.md alone wouldn't know they exist.

---

## Ideas mined

1. **[math][CLI] Allowable-spec solver**: `calwizard allow SERIES --layer Lot --field gainCv` → largest value per
   requirement (and for the TEa per level) such that it is still met; the per-layer sibling of `sdScale`. Source:
   Scene 2, Tom scripted a loop.
2. **[math] Bias-aware LoB/LoD**: false-positive rate at the blank and detection rate at the LoD under each layer's
   known bias, against the calibration's cutoff. Source: Scene 4, "LoD unchanged" with +10 a.u. reader offset; Tom
   did the z-score on a whiteboard (5% → ~15%).
3. **[math] Fix the dial-in offset fit**: weight the per-concentration NNLS relatively (or take the offset from the
   blank) so `offsetSd` agrees with the c = 0 component. Source: Scene 7, Reader 11.0 vs √23 = 4.8, Day 14.1 vs 8.4.
4. **[math][CLI] Per-unit effects from dial-in**: per-lot gain and per-reader bias with an outlier flag ("R4 +6%"),
   consistent with `compare`. Source: Scene 7, R4 vanished into a 3.3% CV.
5. **[math][GUI] Fixed-at-limit vs random per source in the stack**: each layer marked "release limit ±X" (stacked
   linearly) or "random" (RSS); within-run always RSS. Replace or redefine `worst`. Source: Scene 5, 23% vs 44%
   with neither defensible.
6. **[math] Uniform tolerance band for bias**: `biasPct` as ±X (each unit somewhere in the band), not one shift for
   all units. Source: Scene 4, calibration spec is a band.
7. **[report] Tolerance / transfer section in the claim sheet**: layers, error budget, conditions, and derived
   release limits in `calwizard report` and the Present workspace. Source: Scene 8, Tom writes it outside the tool.
8. **[CLI][GUI] Lot acceptance verdict in compare**: allowed concentration bias per level → ACCEPT/REJECT per
   condition, plus the signal-level release limit it implies at a named control. Source: Scene 3, Lot 3 −18% at 25.
9. **[math] Lot calibration factor**: "recalibrate per lot" (one- or two-point) and show residual bias after it.
   Source: Scene 3, master curve vs lot-specific calibration is the real decision.
10. **[math] TEa with absolute floor and measuring-range scope**: "±X ng/mL or ±Y%, whichever is larger", and levels
    below LoQ not judged (or judged qualitatively). Source: Scene 5, c = 1 and 2 fail by construction with LoQ CV 20%
    and TEa 30%.
11. **[CLI][math] Design: n = 1 and nested factors, with strip cost**: allow 1 rep per cell; strip-lot within lot,
    operator within site; print strips next to each component's 90% range. Source: Scene 6, `--n 1` refused.
12. **[math] Layer-aware `plan`**: LoB/LoD verification drawn across lots/days per EP17, LoD reported per lot and as
    the worst lot. Source: Scene 6, 80-strip plan has no lots.
13. **[CLI][GUI] Uncertainty on `compare.between`**: show the same rough range `dialin` shows for few units. Source:
    Scene 3, 11.5% from 3 lots looked authoritative.
14. **[GUI][CLI] Cumulative story in requirements, not levels**: `budget.cumulative` per requirement met/not.
    Source: Scene 1, "10 → 9 levels" meant nothing to quality.
15. **[CLI] `dialin` column mapping + AGENTS.md rows for budget/design/dialin**: `--map "QC level=c,Strip lot=Lot"`.
    Source: Scene 7 LIMS export; Scene 8 agent note.

Ranked by impact on Tom's actual deliverable: 1, 2, 3, 5, 8, 7, 4, 10, 9, 11, 12, 6, 13, 14, 15.
