# 1. The LoD push: a high-sensitivity troponin week

Persona: **Dr. Priya Raman**, senior assay developer, sandwich-format fluorescent LFA for cardiac troponin I (cTnI).
Goal this week: push the LoD down far enough to support a high-sensitivity (hs) claim.

Data: a copy of `backend/examples/sandwich.json`, relabelled cTnI / ng/L / "Test line (RFU)", with her own requirements:
detect 3 ng/L, CV ≤ 10% at 26 ng/L (the 99th-percentile upper reference limit), tell 5 from 10 ng/L, and a 5–500 ng/L
reportable range at 20% CV. The curve is the example's 4PL, `4000 + (50 − 4000)/(1 + (c/40)^1.2)`, noise
`sqrt(15^2 + (0.08*S)^2)`. Every number below came from a real `uv run calwizard ...` run (files in the session scratchpad,
`personas/*.json`).

Cast: **PRIYA** (senior assay dev), **MARCUS** (junior scientist, ran last week's strips), **DANA** (QA / regulatory).

---

## Scene 1: Monday, the bench office. A whiteboard reads "hs-cTnI: LoD ≤ 3? CV ≤ 10% @ 99th".

**PRIYA:** Okay. Marketing wants "high-sensitivity". For troponin that means two things, and people always forget the second:
total CV at or below 10% at the 99th percentile, and a LoD low enough to measure most healthy people. Our 99th is
around 26 ng/L. Let's see where the curve puts us.

**[TOOL]** `calwizard evaluate ctni.json`

**MARCUS:** It printed... a lot. A five-hundred-and-one point grid of means and SDs before anything else.

**[FRICTION]** `evaluate` dumps the whole 0–500 grid by default. The headline she wants (`resolvable.n = 10`, levels
0, 1.43, 2.81, 4.50, 6.75, 9.93, 14.7, 22.6, 37.5, 76.9) is at the very end. She pipes it through `jq` to find it.
Nothing says "use `--grid 0` if you only want the summary".

**PRIYA:** Ten resolvable levels, and the first step off zero is 1.43. That's a ladder rule, SSMD ≥ 3. Not an LoD.
Give me the limits.

**[TOOL]** `calwizard limits ctni.json --no-profile`

**MARCUS:** LoB 0.60 ng/L, LoD **1.13 ng/L**, LoQ at 20% CV is 1.53, upper LoQ 69.4.

**PRIYA:** So 1.13 already beats my 3 ng/L target by almost three-fold. Which makes me suspicious. Dana, come look.

**DANA:** *(leaning in)* Where does the blank SD come from?

**MARCUS:** `blank.sd` is 15.52. That's from the noise equation, 15 RFU floor plus 8% of signal.

**DANA:** And your bench blanks? You ran three last week.

**MARCUS:** 48.1, 52.0, 47.3. SD about 2.5.

**PRIYA:** Then the equation is six times noisier at the blank than our strips. Either the equation is pessimistic or
three blanks is nothing. Let's ask the tool to use the replicates.

**[TOOL]** Copy the file, set `"mode": "replicates"`, run `calwizard limits ctni_reps.json --no-profile`.

**MARCUS:** Now it gives two answers. The curve through the replicates says LoD **1.16**. Then there's a `data` block,
the classical EP17 estimate from blank and low replicates, that says LoB 53.9 RFU, LoD signal 61.3, LoD **1.71 ng/L**.

**PRIYA:** And look at the means. At 1 ng/L the replicates average 55.7 RFU. The equation says 96.7. At 5 ng/L: 95.6
versus 351. That's not the same assay.

**[FRICTION]** The series carries an equation and replicate data that disagree by 3.7× at 5 ng/L, and nothing in the
output flags it. In equations mode the replicates are silently ignored (`"data": null`). In replicates mode she gets
three LoDs (1.13 equation, 1.16 replicate curve, 1.71 classical) with no sentence saying which one is the claim, and
no warning that n = 3 blanks is far below the 60 EP17 expects for establishing a LoB.

**[FRICTION]** In replicates mode, `uloq` comes back as `{"c": 5.0, "cv": 0.088}`. That is the highest concentration
she measured, not a limit of quantitation; the CV is still 8.8% there. It reads as a claim but it is only where the
data ends.

**DANA:** I can't put three LoDs in a design history file.

**PRIYA:** No. Here's the plan: the equation is the old pilot-lot fit. I trust Marcus's strips more on the mean and less
on the SD, because n is 3. I'll keep the equation as the working model for the what-ifs, but I'm writing on the
whiteboard "the model is pessimistic at the blank". *(She does. Then she opens Prism to fit the 4PL to the replicates,
because `calwizard fit` ranks mean/SD shapes but she wants the confidence band on EC50 she's used to.)*

**[FRICTION]** Left the tool for Prism to compare "old fit vs new strips" on one plot with residuals. The `compare`
command exists for conditions, but she didn't find a "data vs model" overlay with residuals or a goodness-of-fit
statement.

---

## Scene 2: The requirement that actually fails

**[TOOL]** `calwizard requirements ctni.json`

**MARCUS:** Two of four met. Detect 3 ng/L: met, value 1.13. Tell 5 from 10: met, SSMD 5.07. Precision at 26: **not
met, 11.1% CV**, and it says `sdScale 0.902`. Range 5 to 500: not met, `sdScale 0.136`.

**PRIYA:** *(laughs)* So I came in to push the LoD, and the tool is telling me the LoD isn't my problem. The
99th-percentile CV is.

**DANA:** What does 0.902 mean in words?

**MARCUS:** "Met if the noise were 0.9× of today."

**PRIYA:** Which noise, though? I have two terms: a 15 RFU floor and an 8% proportional term. Background noise and
pipetting/flow variability are different fixes. Cutting the floor is a buffer and blocking job; cutting the
proportional term is a membrane and conjugate-drying job.

**[FRICTION]** `sdScale` scales the whole SD. For a two-term noise model, the useful answer is "you need the
proportional CV ≤ x%" or "the floor ≤ y RFU". She has to bisect by hand.

**[TOOL]** She edits `sdExpr` three times: proportional term 0.070, 0.072, 0.075.

**MARCUS:** 0.070 gives 9.72% at 26 ng/L. 0.072 gives 9.99%. 0.075 gives 10.40%.

**PRIYA:** So the real spec is: **proportional CV at or below about 7.2%** from today's 8%. That's a number I can hand
to the membrane team. It took me four file edits to get it.

And the range failure, 0.136, means "cut all noise to 14%". That's never happening. The top of this curve is flat:
the 4PL tops out at 4000 and by 500 ng/L we're at 3818. The upper LoQ at 20% is 69 ng/L. Above that we dilute. *(writes
"500 needs 1:10 dilution" on the board)*

**[FRICTION]** The `range` requirement treats 5–500 as "no dilution allowed". `read` has a `dilution` column, but
requirements don't know that a reflex 1:10 dilution would cover 69–690 ng/L. She'd want "range met with a 1:10
dilution protocol" as a requirement option.

---

## Scene 3: What-if, the conjugate story

**PRIYA:** Okay, the LoD anyway, because the reviewers will look at it first. Three levers: more conjugate, lower blank
noise, more reads. Marcus, what does doubling the gold... sorry, the europium conjugate do on the bench?

**MARCUS:** Last time, top went from about 4000 to 6000 RFU, and background crept up to roughly 80.

**[TOOL]** Four `adjust` scenarios plus two `sdExpr` edits, each through `limits` (20% and 10% CV) and `requirements`.

| Scenario | LoB | LoD | LoQ 20% | LoQ 10% | uLoQ 10% | CV @ 26 | met |
|---|---|---|---|---|---|---|---|
| today | 0.602 | **1.126** | 1.528 | 4.32 | 19.5 | 11.1% | 2/4 |
| top 6000 (more conjugate) | 0.411 | 0.767 | 1.030 | 2.72 | 20.8 | 10.9% | 2/4 |
| top 6000 + bg 80 | 0.430 | 0.814 | 1.124 | 3.24 | 19.9 | 11.0% | 2/4 |
| cScale 0.5 (2× affinity) | 0.301 | 0.563 | 0.764 | 2.16 | 9.75 | **16.2%** | 2/4 |
| sdScale 0.7 | 0.447 | 0.821 | 1.065 | 2.28 | 42.8 | 7.8% | 3/4 |
| blank floor 15 → 8 RFU | 0.380 | 0.722 | 1.006 | 2.94 | 20.0 | 11.0% | 2/4 |
| proportional 8% → 5% | 0.592 | 1.079 | 1.381 | 2.84 | 50.7 | 7.0% | 3/4 |
| floor 8 + proportional 5% | 0.360 | **0.659** | 0.850 | 1.76 | 51.1 | 6.9% | 3/4 |

**PRIYA:** Look at that. More conjugate takes the LoD from 1.13 to 0.77 and does nothing for the 99th percentile.
The higher-affinity antibody halves the LoD to 0.56, and *ruins* the 99th: 16.2%, because the curve now saturates
earlier and the slope at 26 ng/L flattens. That's a trap I'd have walked into.

**MARCUS:** And the blank floor only moves the LoD.

**PRIYA:** Right. The floor sets the LoD, the proportional term sets the 99th. Two different knobs, two different
teams. The best case is both: LoD 0.66, CV 6.9% at the 99th.

**[FRICTION]** To build this table she wrote a PowerShell loop over eight hand-edited JSON files and three commands
each. There is no "scenario sweep" command (`calwizard whatif SERIES --top 6000 --c-scale 0.5 ...` returning the
headline deltas). The GUI's What-if bar shows `LoD 4.62 → 1.56`-style deltas, but only one scenario at a time and not
side by side.

**[FRICTION]** The `adjust` layer can't say "background goes up because of more conjugate *and* the floor noise goes up
with it". `bottom` moves the mean only; in equations mode `sdExpr` follows the new signal, so the 8% term follows, but
the 15 RFU floor doesn't. She'd want to tie a noise change to the lever, or at least a fifth lever "floor SD".

**DANA:** Where's the affinity number coming from? `cScale 0.5` is "the curve responds at half the concentration".
That's not a Kd.

**PRIYA:** It's a proxy. Honestly I'd want to type "Kd 2× tighter" and have it map, but the curve is phenomenological.
Fine for a what-if; I'll footnote it.

---

## Scene 4: More reads

**PRIYA:** The cheap lever: read each strip more than once? No, *replicate strips*. Average of duplicates.

**[TOOL]** `calwizard limits base.json --reads 2|3|4 --cv 0.1`

**MARCUS:** Reads 2: LoD 0.83, LoQ at 10% 2.31, uLoQ 42. Reads 3: LoD 0.69. Reads 4: LoD 0.61, LoQ 10% at 1.53,
uLoQ 69.4. Oh, funny, the 4-read 10% limits are exactly the 1-read 20% limits.

**PRIYA:** Because the SD halves. Good, it's doing the math right. And requirements?

**[TOOL]** Set `limits.reads = 2` in the file, `calwizard requirements reads2.json`.

**MARCUS:** Precision at 26 now 7.8%: met. Detect 0.83. Range LoQ 1.075. But "tell 5 from 10" is still 5.07, same as one
read.

**[FRICTION]** `limits.reads` changes detect, precision and range but not `distinguish`, which still uses single
readings. Mixed semantics inside one requirements table; she only spotted it because the number didn't move.

**DANA:** And duplicates on a point-of-care cassette is a product change, not an assay change. Two cassettes per
patient. Commercial will kill it.

**PRIYA:** Agreed. Duplicates are my fallback, not my claim.

---

## Scene 5: Can we prove it? (Dana's scene)

**DANA:** Suppose you get the floor down to 8 RFU. How many strips to *verify* a LoD near 0.7?

**[TOOL]** `calwizard plan ctni.json` (defaults: 20 blanks, 20 at each of LoD and 2×LoD, 20 at the LoQ, 500 runs)

**MARCUS:** 80 strips. True LoD 1.126; the estimate lands 1.00 to 1.36, 90% of the time; median 1.17. Detection rate at
1.13 is 94.6%. The LoQ check at 1.53 passes only 57.4% of runs.

**PRIYA:** That last bit is honest. If you put your LoQ claim exactly at the LoQ, you're flipping a coin. Claim a bit
above. Try 60 per level.

**[TOOL]** `calwizard plan ctni.json --n-blank 60 --n-low 60 --cv 0.1`

**MARCUS:** 240 strips. LoD 1.07 to 1.28. LoQ at 10% is 4.32 and passes 52.8%.

**DANA:** But EP17 wants two reagent lots, three days, multiple instruments. Is this plan one lot on one day?

**PRIYA:** Let's add the variability layers. Lot 2 units, gain CV 5%, 3% bias CV; Reader 3 units, 6 RFU offset; Day 3
units, 4 RFU.

**[TOOL]** Add `layers` and rerun `limits`, `requirements`, `plan`, `tolerance -c 1 3 26`.

**MARCUS:** With layers: LoD 1.25, blank SD 17.35. Precision at 26 drops to **13.95%**, `sdScale` 0.717. And `limits
--cv 0.1` gives LoQ... null. uLoQ null.

**PRIYA:** Null meaning nowhere on the curve gets to 10%. What's the best it does?

**MARCUS:** It doesn't say. I'd have to read the profile.

**[FRICTION]** A `null` LoQ with no "best achievable CV is x% at c = y". That minimum is the single most useful number
for an hs claim, and she has to dig it out of the 201-point profile (or Excel).

**MARCUS:** Tolerance at 26 ng/L: within-run SD in concentration 2.91, Lot 2.04, Reader 0.73, Day 0.09. Lot is the
second-biggest source.

**PRIYA:** That's the useful one. Lot-to-lot gain is eating my 99th percentile almost as much as within-run noise.

**DANA:** And the plan with layers?

**MARCUS:** Still 80 strips, LoD 1.11 to 1.53, median 1.32. But the design table is just "blank 20, low 1 20, low 2
20, LoQ 20". It doesn't say how to split them over two lots, three readers, three days.

**[FRICTION]** The planner reports the LoD scatter with layers on, but the design isn't laid out per lot/reader/day,
and the output doesn't say whether lot effects are shared within a run (clustered) or drawn per strip. The band
barely widens compared with no layers (0.42 wide vs 0.36), which makes her suspect the layers are treated as
independent noise per reading. EP17 also has you compute LoD **per lot** and report the larger; the planner returns
one pooled number.

**DANA:** Then I'll design the EP17 matrix in Excel as usual.

**[FRICTION]** Left the tool for Excel to build the run sheet (lot × day × reader × replicate).

---

## Scene 6: The honest question nobody asked the tool

**PRIYA:** One more criterion for hs: measurable values above the LoD in at least half of healthy people. Our healthy
median for cTnI is around 2–4 ng/L. With LoD 1.13 we're fine on paper. With the classical estimate of 1.71, still fine.

**DANA:** Can the tool show that?

**PRIYA:** No. It knows nothing about the population. I'd want to paste a reference distribution, even just "log-normal,
median 3, 99th 26", and get "% of healthy above LoD" and "CV at the 99th" as a pair.

**[FRICTION]** The two hs criteria are both population-anchored; the tool has no notion of a reference population or
the 99th percentile as a concept, so she encodes it as a bare `precision` row at c = 26 with a label.

**MARCUS:** And when I tested separating blank from 1 ng/L with `separate`, it said `pSig 1.0` but `pPass 0.23`. With
20 replicates in `simulate`, `pSig 1.0` and `pPass 0.01`. Which is it, can we tell them apart or not?

**PRIYA:** Both. Your *average* of 20 is significantly different every time. A *single strip* at 1 ng/L still
overlaps a blank: SSMD about 2, rule wants 3. The tool means the second when it says "pass".

**[FRICTION]** `pSig` and `pPass` sit side by side with no one-line explanation; a junior reads "significant 100%,
pass 1%" as a contradiction.

---

## Scene 7: Decision

**PRIYA:** Here's where I land.

1. The LoD is not the blocker. Today's model says 1.13 ng/L; the strips say somewhere 1.2–1.7 depending on which
   estimate. Both beat 3 ng/L.
2. The blocker is CV at the 99th: 11.1% within-run, 13.95% once lots and readers come in. We need the proportional
   term at or below about 7.2% *within-run*, and lot-to-lot gain variation down from 5%.
3. Don't switch to the high-affinity antibody: LoD halves, 99th-percentile CV goes to 16%.
4. Do push blocking buffer for the floor (15 → 8 RFU: LoD 0.72) and the drying process for the proportional term.
5. Duplicates are the fallback (7.8% at 26 ng/L), not the plan.
6. Upper range: reflex 1:10 dilution above 69 ng/L.

**DANA:** And the verification: 60 blanks and 60 lows per lot, two lots, three days. I'll draft it in Excel.

**MARCUS:** Should I re-run blanks so the model isn't six times too noisy at zero?

**PRIYA:** Yes, 60 of them, across two lots. Then we refit and see if the floor is really 15 or really 2.5. If it's
2.5, half this week's argument changes.

*(She exports nothing from the tool. The decision lives on the whiteboard and in a PowerPoint she builds by hand.)*

**[FRICTION]** No "decision memo" / scenario comparison export: the `report` is a claim sheet for one curve, not
"today vs option A vs option B" with the reasoning.

---

## Ideas mined

Ranked by value to Priya (hs-assay developer pushing LoD and the 99th-percentile CV).

1. **[math][CLI][GUI] Per-term noise targets.** When a precision/detect requirement fails, solve for each noise term
   separately ("proportional CV ≤ 7.2%" or "floor ≤ y RFU"), not just a global `sdScale`. *From:* four hand edits of
   `sdExpr` to find 7.2%.
2. **[CLI][GUI] Scenario sweep / side-by-side what-ifs.** `calwizard whatif SERIES --scenario name:top=6000,bottom=80
   --scenario ...` returning LoB/LoD/LoQ/CV-at-c/requirements per scenario as a table; GUI shows saved scenarios as
   columns. *From:* the eight-file PowerShell loop behind the Scene 3 table.
3. **[math][CLI] Model-vs-data consistency check.** When a series has both an equation and replicates (or summary)
   that disagree beyond their SE, say so ("blank SD: model 15.5, data 2.5 (n = 3)"; "5 ng/L: model 351, data 96").
   *From:* the example's equation and replicates disagreeing 3.7× with no warning.
4. **[report][CLI] One LoD to claim.** When `limits` returns model LoD, replicate-curve LoD and classical `data` LoD,
   state which is the claim and why, with n-adequacy notes (EP17: ≥ 60 blanks to establish). *From:* three LoDs, Dana
   can't file three.
5. **[math][CLI] Best achievable CV when LoQ is null.** Return `minCv: {c, cv}` from the profile alongside a null
   LoQ/uLoQ. *From:* `--cv 0.1` with layers returning null and nothing else.
6. **[math][CLI] EP17 multi-lot planner.** Lay the design out per lot × day × reader, simulate lot effects as shared
   within a lot (clustered), and report LoD per lot plus the max (the EP17 rule). Make the clustering explicit in the
   output. *From:* the layered plan barely widening and showing a flat 80-strip list.
7. **[GUI][math] Reference-population panel for hs claims.** Enter a healthy distribution (or median + 99th
   percentile); show "% healthy above LoD" and "CV at the 99th" as the two hs criteria, with the 99th as a named
   marker on every chart. *From:* encoding the 99th as a bare `precision` row at 26.
8. **[math][CLI] Requirements honour `reads` consistently**, or show per row which use single readings.
   *From:* `distinguish` staying at 5.07 when `limits.reads = 2` moved everything else.
9. **[math] A noise-floor lever in `adjust`** (or "floor follows bottom") so "more conjugate raises background and its
   noise" is one move. *From:* `bottom = 80` moving the mean but not the 15 RFU floor.
10. **[math][report] Don't call the end of the data an upper LoQ.** In table/replicate modes, when the CV is still
    under target at cMax, return `uloq: {c: cMax, open: true}` or "≥ 5 (end of data)". *From:* `uloq c = 5.0, cv =
    0.088`.
11. **[math][CLI] Range requirement with a dilution protocol.** `range` row with `dilution: 10`: met if the neat range
    plus the diluted range covers c..c2. *From:* the 5–500 range failing with `sdScale 0.136` when a 1:10 reflex fixes it.
12. **[GUI][report] Explain pSig vs pPass inline.** One sentence: "averages differ (pSig) vs a single strip is
    classified correctly (pPass)". *From:* Marcus reading 100% / 1% as a contradiction.
13. **[CLI] `evaluate` summary by default.** Print rows, levels, resolvable and rule; the 501-point grid only with
    `--grid` or `--full`. *From:* a 1000-number wall before the headline.
14. **[report] Scenario decision export.** A report variant comparing today vs chosen scenarios with the requirement
    table per scenario and a short "decision" field, printable for a design review. *From:* the decision living on a
    whiteboard and a hand-made deck.
15. **[GUI] Data-vs-model overlay with residuals and a fit statement** in the Curve workspace (EC50 with CI). *From:*
    leaving for Prism to compare the pilot-lot fit with this week's strips.
