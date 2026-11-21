# 2 — The cut-off: can we threshold it?

Persona study. Marcus (assay developer, competitive drugs-of-abuse LFA, visual + reader), Priya (statistician),
Dan (product manager). All numbers below are real Cal Wizard outputs (CLI, `backend/`, Nov 2026) unless marked
*[hand calc]*, which means Marcus had to leave the tool to get them.

**Setup.** `backend/examples/competitive.json` rescaled so the midpoint sits at the cut-off:
`meanExpr = 150 + 3800/(1 + (c/50)^1.1)`, `sdExpr = sqrt(20^2 + (0.06*S)^2)`, analyte THC-COOH, ng/mL,
levels `0, 25, 37.5, 50, 62.5, 100, 200`, cMax 300, SSMD ≥ 3. Requirements: distinguish 37.5/50, 50/62.5, 37.5/62.5;
CV ≤ 20% at 50. Weaker lots as what-if layers: **Lot B** `bottom 3000` (blank signal down from 3950, ~ -20% signal
everywhere); **Lot C** `bottom 3300, cScale 0.85, sdScale 1.15`. A third file adds a `Lot` variability layer
(3 units, cv 3%, gainCv 5%, noiseCv 10%).

---

## Scene 1 — Dan's question

*Small meeting room. Marcus has a laptop open on a terminal. DAN leans in the doorway with a coffee.*

**DAN:** Simple question. Regulatory cut-off is 50. Can the strip call it, yes or no? And I need a false positive
rate I can put on a slide.

**MARCUS:** "Yes or no" is the problem — it's competitive, so line *gone* means positive. Let me ask the tool.

> [TOOL] `calwizard requirements thc.json`
> `-25% vs cut-off` **not met**, SSMD −1.58, sdScale 0.53 · `cut-off vs +25%` **not met**, −1.39, sdScale 0.46 ·
> `-25% vs +25%` **not met**, −2.94, sdScale 0.98 · `cut-off CV` **met**, 0.119. `met 1 / 4`.

**DAN:** One out of four. So no.

**MARCUS:** Hang on. That's not the question I asked, it's the question I typed.

> [FRICTION] There is no `cutoff` requirement kind. The nearest thing, `distinguish`, asks "are 37.5 and 50 separable
> as two populations at SSMD ≥ 3", which for a cut-off assay is the wrong test: nobody needs to tell 37.5 *from* 50, they
> need 37.5 called negative ≥ 95% of the time with the threshold *at* 50. A PM reading "1 of 4 met" walks away with
> the wrong conclusion. Marcus had to explain the tool's verdict away in front of the person it was meant to inform.

**PRIYA** *(arriving, laptop under arm)*: The 37.5-versus-62.5 one is the honest one. What does it say in detail?

## Scene 2 — Separate, and a label that's backwards

> [TOOL] `calwizard separate thc.json 37.5 62.5`
> mu 2348 vs 1818, sd 142 vs 111, SSMD −2.94, err **0.018**, threshold **2057.6** (signal), sensitivity **0.979**,
> specificity **0.985**, AUC 0.998, nNeeded 2, power (n=3): pSig 0.884, pPass 0.572.

**MARCUS:** So a threshold at 2058 signal units, 1.8% average misread, sensitivity 98%, specificity 98.5%.

**PRIYA:** Which side is "sensitivity"? For you a positive is the *low* signal, the 62.5 side.

**MARCUS:** Let me check… P(37.5 reads above 2057.6) is Φ(2.04) = 0.979. P(62.5 reads below it) is Φ(2.16) = 0.985.
So the tool's "sensitivity" is the *negative* sample correctly called negative.

**PRIYA:** That's specificity.

> [FRICTION — wrong label] `separate` sorts the two groups by **signal** and calls "the higher-signal group above the
> threshold" sensitivity (`analysis.py` lines 290–295). For a competitive assay (direction −1, which `limits` already
> knows) the high-signal group is the low concentration, so sensitivity and specificity are swapped. Here they're
> 0.979/0.985, close enough not to matter; on an asymmetric pair it would put the wrong number on Dan's slide.

> [FRICTION] The threshold is in signal units only. Marcus had to run `calwizard inverse thc.json 2057.58` → **49.64
> ng/mL** to say it in the language of the cut-off.

**DAN:** Fine. Can I say "1.8% false positives"?

**PRIYA:** The 1.8% is the *average* of false-positive and false-negative at the PDF crossing. And it's at the crossing
between 37.5 and 62.5, not at the regulatory cut-off. For a regulated cut-off you put the threshold at the signal of
50, which is 2050, and then ask what happens at each side.

**MARCUS:** Tool can't do "threshold at 50, give me P(positive) at c". I'll do it by hand.

> [FRICTION — left the tool] No "P(call positive) versus concentration" curve. Marcus wrote 20 lines of Python: threshold
> T = mean(50) = 2050, P(pos | c) = Φ((T − mean(c)) / sd(c)).
>
> *[hand calc]* T = 2050: **P(pos | 37.5) = 1.81%**, **P(neg | 62.5) = 1.82%**, P(pos | 50) = 50%.
> Moving the threshold trades one for the other: T = 2000 → FP 0.72%, FN 5.0%; T = 2100 → FP 4.1%, FN 0.55%.

**DAN:** So: 1.8% each way at ±25%. That's the slide.

**PRIYA:** On *one* lot, *one* reader, within-run noise only. Hold that thought.

## Scene 3 — C5 and C95

**PRIYA:** EP12 language. Where's C50, and what's the C5–C95 interval?

**MARCUS:** Not in the tool either. *[types]*

> [FRICTION — left the tool] No C5/C50/C95. This is the single most-requested number for a qualitative cut-off claim
> and every ingredient (mean, sd, inverse, direction) is already in the model.
>
> *[hand calc]* single read: **C5 = 40.2, C50 = 50.0, C95 = 59.8 ng/mL**. Averaging 2 reads: 43.1–56.9; 3 reads:
> 44.3–55.7.

**PRIYA:** 40.2 to 59.8. That's inside ±20%, barely. Inside ±25% comfortably. Good.

**MARCUS:** The tool *sort of* says it another way:

> [TOOL] `calwizard recover thc.json 2050` → c 50.0, range **38.3–61.7** (95%).
> `calwizard read thc.json 2050 2100 2000 2300 1800` → every row `flag: "ok"`, e.g. 2300 → 39.3 (28.8–49.8).

**PRIYA:** That's an inverse-prediction interval on one strip, not a C5–C95. Related, and it lines up — 38–62 is a
two-sided 95% where C5–C95 is a 90% — but don't put "38–62" in the EP12 section, a reviewer will ask why it's not the
C5–C95.

> [FRICTION] `read` flags `ok / belowLod / belowLoq…` but has no idea there's a cut-off. Signal 2300 (reads as 39.3,
> range 28.8–49.8) and 1800 (63.6, 50.3–77.0) both come back `ok`. Marcus wants `negative`, `positive`, and
> **`indeterminate`** when the range straddles 50 (2050 → 38.3–61.7 straddles; 2300 does not).

## Scene 4 — How many replicates?

**DAN:** How many strips for the precision study? Finance wants a number.

**MARCUS:** The tool has a simulator. *[types]*

> [TOOL] `calwizard simulate thc.json --concs 37.5 50 62.5 --n 40 --runs 1000 --seed 7`
> pair 37.5/50: SSMD median −1.58 (90%: −1.95 to −1.27), **pPass 0.0, pSig 1.0**; pair 50/62.5: median −1.39,
> pPass 0.0, pSig 1.0. pAllPass 0.

**DAN:** Zero percent pass. With forty strips each?

**PRIYA:** It's answering "will the *estimated* per-reading SSMD exceed 3". More strips make the estimate tighter
around −1.58; they never push it past 3. And pSig = 1.0 just says the means differ, which nobody doubted.

> [FRICTION — concept mismatch] `n` in `simulate` is "readings to estimate the curve", not "replicates per sample in the
> claim", and the output is metric quantiles and t-test power. An EP12 study is 40 (or 20–60) *binary calls* per level
> around C50, analysed as % positive with a binomial CI. Nothing in `simulate`, `separate` or `plan` speaks
> binomial. And `simulate --concs 50 --n 40` errors: `need at least two concentrations` — you can't simulate the
> single most important level of the study on its own.

> [TOOL] `calwizard separate thc.json 37.5 62.5 --n 40` → power pSig **1.0**, pPass **0.438**.

**MARCUS:** And `nNeeded` says 4 for 37.5/50, 5 for 50/62.5, 2 for 37.5/62.5. That's "average this many strips per
sample". We sell a single-strip test.

> [FRICTION] `nNeeded` is real but answers a design Marcus can't ship (averaging strips per patient sample). It *would*
> be useful as "reads per strip" on the reader (e.g. scan 2×), but the tool doesn't say which.

**PRIYA:** So, by hand again.

> *[hand calc]* With true P(pos | 37.5) = P(neg | 62.5) ≈ 1.8%, acceptance "≥ 95% concordant":
> N = 20 per level (≤ 1 discordant): P(pass) 0.950 each side, **0.902 both**.
> N = 40 (≤ 2): 0.964 each, **0.930 both**. N = 60 (≤ 3): 0.977, **0.953 both**.
> Zero-failure upper 95% bound on the FP rate: N = 20 → 13.9%, N = 40 → 7.2%, N = 60 → 4.9%.

**PRIYA:** So 40 per level, three levels, gives you a 93% chance of passing a study you *should* pass. If you want to
*claim* "≤ 5% false positives" from the data alone — not the model — you need about 60 at each level with zero
discordants.

**DAN:** 3 × 40 = 120 strips per lot, times three lots, times visual and reader…

**MARCUS:** The reader and visual come from the same strips. Visual is the problem.

## Scene 5 — The eye

**DAN:** Most of our customers read by eye. Same numbers?

**MARCUS:** No idea, and the tool has no idea either. At the cut-off the test line signal is 2050 out of a 3950
blank. That's half-intensity — on a competitive strip, "is there a faint line or not" happens near the *top* of the
range, around 300–600 a.u., which is way past 200 ng/mL.

> [TOOL] `calwizard inverse thc.json 600 900 1200` → `null, 179.0, 120.0`. (600 is below mean(cMax) = 614.7, so null.)

**PRIYA:** So if your visual rule is "any visible line = negative", the visual cut-off is somewhere above 120. That's
not a 50 ng/mL test by eye. You'd need a reference card — "line lighter than the control = positive" — and then
the reader's noise model doesn't apply: the operator *is* the noise.

> [FRICTION — no visual model] No way to say "a person calls positive when the line is lighter than X, with
> inter-reader spread Y". Visual reads are half the product. Marcus wants a "visual reader" layer: a threshold
> (absolute or relative to the control line) plus an observer SD and a lighting/colour-card bias, giving its own
> C5–C95, so reader and visual can be compared side by side, plus a reader-vs-visual agreement table.

## Scene 6 — The weak lot

**PRIYA:** Now the part I was worried about. Lot B came in at about 20% lower signal.

> [TOOL] `calwizard compare thc.json thc_lotB.json thc_lotC.json -c 37.5 50 62.5`
> Lot B: signal bias −21%, −20%, −19%; **readsAs 60.3, 74.4, 88.2** on the reference curve (concBias +61%, +49%,
> +41%). Lot C: readsAs 59.1, 74.9, 90.5. Levels 7 → 6 → 6; LoD 13.2 → 14.2 → 13.5.
> `between`: offsetSd 486, gainCv 0.165.

**MARCUS:** If the reader keeps Lot A's threshold of 2050, a 37.5 sample on Lot B reads as 60. That's a positive.

> *[hand calc]* Fixed T = 2050 on Lot B: **P(pos | 37.5) = 95.8%**; C50 moves from 50 to **28.4** ng/mL, C5–C95
> 19.9–37.0. Lot C: P(pos | 37.5) = 90.8%, C50 = 30.4.

**DAN:** Ninety-six percent false positives?

**PRIYA:** With a non-lot-specific threshold, yes. That's a recall. With a lot-specific calibration — threshold at
Lot B's own mean(50) = 1641 — it's fine:

> [TOOL] `calwizard separate thc_lotB.json 37.5 62.5` → err **0.031**, threshold 1650, SSMD −2.62.
> *[hand calc]* Lot B own threshold: FP(37.5) 3.0%, FN(62.5) 3.4%, C5–C95 **39.1–61.2**.

**MARCUS:** So we can live with a weaker lot *only* if the threshold travels with the lot. The tool showed me the bias,
but I had to translate "readsAs 60.3" into "96% of negatives at −25% go positive" myself.

> [FRICTION] `compare` reports bias and `readsAs`, the right raw material, but not the consequence for a cut-off
> claim: per-condition P(positive) at the guard-band levels with (a) the reference threshold and (b) its own threshold.
> That one table is the lot-release decision.

> [FRICTION — naming] The what-if lever for the blank signal is called `bottom` (f(0)) and the other one `top`
> (f(cMax)). In a competitive assay `bottom` is the *highest* signal. Marcus set `top` first, got the wrong lot,
> and re-read §14.

**PRIYA:** And if lots vary continuously rather than one bad lot?

> [TOOL] Added `Lot` layer (3 units, cv 3%, gainCv 5%, noiseCv 10%):
> `calwizard separate thc_layers.json 37.5 62.5` → sd 178/164, SSMD −2.19, **err 0.060**, sens 0.936, spec 0.943.
> `calwizard tolerance thc_layers.json -c 37.5 50 62.5 --tea 0.25` → total error at 50 = **±16.2 ng/mL (32%)**,
> worst-case 22.8 (46%); within-run sdC 6.0 vs Lot sdC 5.4; **0 / 3 levels within 25%**.

**PRIYA:** Lot-to-lot is the same size as within-run at the cut-off. Your 1.8% becomes about 6% once lots move, and
the error budget says ±25% isn't held quantitatively. Qualitatively — a call either side — you're borderline.

> [FRICTION] `tolerance --tea 0.25` is a quantitative total-error check (bias + 2·SD as a % of c). For a cut-off what
> matters is whether 37.5 and 62.5 stay on their sides of the threshold *including* lot spread, i.e. C5–C95 with
> layers on. Two related ideas, two commands, neither one the claim.

## Scene 7 — What goes on the slide

**DAN:** Give me three lines.

**MARCUS:** One: single lot, reader, threshold at the 50 ng/mL signal: C5–C95 is 40–60, about 1.8% false calls at
±25%. Two: with realistic lot spread it's about 6%, so the threshold must be lot-specific — a weak lot with a fixed
threshold calls 96% of 37.5 samples positive. Three: visual read is not characterised; by eye the cut-off lands
somewhere above 120 unless we use a reference card.

**PRIYA:** And the study: 40 strips at each of 37.5, 50, 62.5 per lot gives 93% odds of passing ≥ 95% agreement;
60 if you want the claim from data alone.

**DAN:** How much of that came out of the tool?

**MARCUS:** *(beat)* The curve, the noise, the separations, the lot bias, the layer spread, the error budget — all
of it, and all reproducible from the CLI. The *claim* — C5/C95, P(positive) at a fixed threshold, the binomial
study size, the agreement table — I did in a scratch script. Every number in it came from the tool's model. The tool
just never asks "where is your cut-off?".

**PRIYA:** Then that's the feature.

*END.*

---

## Ideas mined

1. **[math][CLI] Cut-off mode: `calwizard cutoff SERIES C [--threshold S|--at-cutoff] [--reads N]`** → C5/C50/C95,
   P(positive) curve, FP/FN at ±20/±25/±50%, threshold in signal *and* concentration. — *Friction: left the tool for
   C5–C95 and P(pos | c) at a fixed threshold (Scenes 2–3).*
2. **[math] Fix sensitivity/specificity direction in `separate` for competitive curves** (use concentration order,
   not signal order; positive = higher concentration). — *Friction: labels swapped (Scene 2).*
3. **[math][CLI] `cutoff` requirement kind** ("Call c−25% negative and c+25% positive ≥ 95% of the time at the
   cut-off threshold"), replacing misuse of `distinguish`. — *Friction: "1 of 4 met" misled the PM (Scene 1).*
4. **[math][CLI] EP12 study planner (binomial):** N per level → P(study passes), zero-failure upper bound, N needed
   for a claimed rate; allow a single concentration. — *Friction: `simulate` pPass 0 with n = 40; "need at least two
   concentrations" (Scene 4).*
5. **[math][CLI] Lot-transfer table in `compare`:** per condition P(pos) at guard-band levels under the reference
   threshold and under its own threshold, plus shifted C50. — *Friction: had to turn readsAs 60.3 into 96% FP (Scene 6).*
6. **[GUI] Separate workspace "cut-off" toggle:** threshold pinned to a concentration, the two tails shaded and labelled
   FP/FN, a P(positive) S-curve with C5/C50/C95 ticks. — *Friction: hero picture shows the PDF crossing, not the
   regulatory threshold (Scene 2).*
7. **[math] Visual-read layer:** threshold relative to blank/control line, observer SD, card bias → its own C5–C95 next to
   the reader's. — *Friction: no way to model half the product (Scene 5).*
8. **[report] Qualitative claim section:** 2×2 / 3×N agreement table (expected % pos at each level, with binomial
   CI for the planned N), C5–C95, lot statement. — *Friction: Dan's slide was assembled by hand (Scene 7).*
9. **[CLI] `read --cutoff C`** adds `positive / negative / indeterminate` (range straddles C). — *Friction: everything
   flagged `ok` (Scene 3).*
10. **[math] Layers flow into cut-off numbers** (C5–C95 and FP/FN with lot/reader layers on, not just within-run).
    — *Friction: 1.8% → 6% only visible via `separate` err on the layered file (Scene 6).*
11. **[CLI][math] Say what `nNeeded` means in the output** (`readsPerSample`) and offer it as reader multi-scan, with the
    C5–C95 it buys (40–60 → 43–57 at 2 reads). — *Friction: "we sell a single strip" (Scene 4).*
12. **[GUI][math] Rename what-if `bottom`/`top` to "signal at 0" / "signal at cMax"** (or "blank" / "top standard"). —
    *Friction: wrong lever on a competitive curve (Scene 6).*
13. **[CLI] `evaluate --no-grid`** (or grid off by default): the 500-point grid buries rows/levels in terminal output. —
    *Friction: first command was a wall of numbers.*
14. **[math] Threshold optimiser:** pick the signal threshold for a target FP at c−25% (or minimise weighted FP/FN cost)
    and show the trade-off table (T 2000 → 0.7%/5.0%, 2100 → 4.1%/0.6%). — *Friction: trade-off computed by hand (Scene 2).*
