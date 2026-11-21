# 5 — Feasibility what-if: which knob first, and what the hook does to the claims

**Persona:** Sam, contract-development scientist at a CRO, week 2 of feasibility on a client's new biomarker
("Biomarker X", ng/mL, sandwich LFA). Eleven pilot strips, mostly guesswork, a visible hook at 10 µg/mL.
Has to pick the first development knob and give the client a go/no-go plus a plan next week.

**What was run (all real, from `backend/`, files in the session scratchpad `personas/`):**
`fit` on the pilot (with and without the hook point, and with one strip dropped), `evaluate` / `limits` /
`requirements` on a base equations series and eight `adjust` copies, a hand-built ±20 % tornado (14 more runs),
`simulate` (pilot `--measured-n`, base and combo at the client's levels, n = 3 and n = 10), `separate 5 7.5`,
`plan`, `read` / `recover` on hook-region signals, `bake`, `report`.

Pilot (replicates, test line a.u.): blank 61/48/55 · 1 ng/mL 70/82 · 10: 190/232 · 100: 1450/1210 ·
1000: 3480/3820 · 10 000: 2150/1890 (the hook).

Client spec typed as requirements: detect 1 ng/mL · quantify 2–1000 within 20 % CV · tell 5 from 7.5 ·
at least 10 levels · plus a probe Sam added, "quantify 5–5000", to see what the tool says about the hook.

---

## Scene 1 — CRO lab office, Tuesday, 4:40 pm

*SAM has the pilot JSON open in one window and a terminal in the other. PRIYA, a senior scientist on another
program, leans on the desk with a coffee.*

**PRIYA:** You look like someone who's been fitting curves to eleven points.

**SAM:** Eleven strips, six concentrations. And the tool's favourite model is a parabola.

[TOOL] `calwizard fit pilot.json` (all six levels): best by AICc is **Quadratic, R² 0.92**; the 4PL comes second
with a top of **2604** — the hook point at 10 000 has dragged the plateau down to below what we measured at 1000
(3650).

**PRIYA:** Well, of course. You can't fit a 4PL through a hook.

**SAM:** So I dropped the 10 000 point and fit 0–1000 only. Quadratic still wins: R² 0.995, AICc 5.2. 4PL is
R² 0.9955, AICc 9.1, EC50 266, slope 1.00.

[FRICTION] There is no hook model in the fit menu (4PL × `1/(1 + (c/H)^p)`), so the only way to keep the hook point
is to exclude it, fit, and then hand-write the hook term back in. Sam does exactly that:
`55 + 4555*(c/266)/(1 + c/266)/(1 + (c/8000)^1.6)`, sd `sqrt(3.4^2 + (0.104*S)^2)` (the Floor + CV fit), where
**H = 8000 is a guess** chosen to hit ~2000 at 10 000.

**PRIYA:** Why not just take the quadratic? It fits better.

**SAM:** Watch. [TOOL] I made the quadratic into a series with cMax 10 000 and ran `evaluate` and `limits`:
**42 resolvable levels**, LoB at **c = 1332**, upper LoQ signal **−938 743**.

**PRIYA:** *(laughs)* Negative a million.

**SAM:** The parabola peaks at 666 and dives. Then the tool decides the assay is competitive because the signal at
cMax is below the blank, and everything downstream flips.

[FRICTION] The fit ranks by AICc over the fitted points only. Nothing warns that the winner goes negative inside
[0, cMax], and nothing stops the 5PL from reporting `ok: true` with its asymmetry `g` pinned at the bound (20). A
scientist who trusts the ranking gets a nonsense series and no error.

**PRIYA:** How sure are you of that 4PL, then?

**SAM:** Not very. I dropped one of the two strips at 100 and refit. EC50 goes 266 → **325**, top 4611 → 4849, and
the ranking reorders — Log comes first now. Also the AICc jumped from 5 to 97 between two almost identical data
sets, which I can't interpret at all.

[FRICTION] `fit` returns point estimates only: no parameter SEs, no confidence band, no "how much would the LoD move".
Sam's jackknife was manual: edit points, refit, copy the expression into a new series, re-run limits. AICc values are
not comparable across datasets (weights change when a level has one strip) but the output doesn't say so.

[TOOL] Propagating by hand — same noise model, three plausible curves:

| curve | levels | LoD | LoQ |
|---|---|---|---|
| 4PL from all strips (base) | 9 | 1.52 | 3.93 |
| 4PL, one strip at 100 dropped | 11 | 1.55 | 4.31 |
| Log × hook term | 10 | 1.43 | 3.79 |

**PRIYA:** So the LoD is "about one and a half" whichever you pick. That's actually reassuring.

**SAM:** The LoD is stable because it lives on the blank SD and the low slope. The level count isn't: 9, 11, 10.
And look at where the extra levels are — 1630 and 7967. They're on the far side of the hook.

**PRIYA:** That's not a level. That's a second answer for the same signal.

**SAM:** Right. [TOOL] Base with H = 3000 instead of 8000: 11 levels, including **4635 and 7099**. With noise ×0.7:
16 levels including **6462 and 9855**. The better the noise, the more fake levels on the descending limb.

[FRICTION] The ladder tests `|SSMD|`, so a step down the hook "resolves". The headline "N resolvable levels" goes up
when the hook gets worse. Sam has to cap cMax at 1000 to get an honest count, which then hides the hook entirely.

**PRIYA:** OK, knobs. The client's going to ask what you do first.

**SAM:** I ran each lever as a what-if copy. [TOOL] `adjust` blocks, cMax 10 000, base LoD 1.52 / LoQ 3.93:

| what-if | LoD | LoQ | 5 vs 7.5 SSMD |
|---|---|---|---|
| affinity 2× (`cScale 0.5`) | 0.76 | 1.96 | 2.01 |
| conjugate "top 6900" | 0.40 | 1.01 | 2.29 |
| conjugate gain 1.5× (`top 2794`) | 1.01 | 2.58 | 1.93 |
| background 55 → 35 | 1.10 | 2.67 | 1.93 |
| noise ×0.7 | 1.01 | 2.07 | 2.42 |
| affinity 2× + noise ×0.7 | 0.50 | 1.04 | 2.87 |

**PRIYA:** Why are there two conjugate rows?

**SAM:** Because I got it wrong first. I typed top = 6900 thinking "plateau 1.5× higher". But `top` is the signal
*at cMax*, and at cMax we're in the hook — 1882, not 4600. So 6900 is a gain of **3.75×**. The bake gave it away:
`...*(3.7473809360471466)`.

[FRICTION] `top` means "signal at cMax", which on a hooked curve is the bottom of the hook, not the plateau. A
conjugate knob should be a gain (×1.5), not an absolute signal at an arbitrary concentration.

**PRIYA:** And background — doesn't dropping the background also drop the blank SD?

**SAM:** In equations mode, yes: the SD follows the signal, so the blank SD went 6.65 → 4.98 for free. In a table
series it wouldn't. Same lever, different physics depending on how I typed the data.

[FRICTION] Bottom-and-noise coupling depends on input mode, and the GUI doesn't say which one you're getting.
Also every lever is independent; in reality more conjugate raises background, and higher affinity doesn't
necessarily move the hook. The tool can't express "this knob costs that".

**PRIYA:** That table mixes a 2× change with a 0.7× change. You can't rank on that.

**SAM:** Exactly, so I did ±20 % on each, curve capped at 1000 so the hook can't pad the count.
[TOOL] (14 runs, no built-in way to do this):

| ±20 % | levels | LoD | uLoQ | 5 vs 7.5 |
|---|---|---|---|---|
| baseline | 9 | 1.52 | 227 | 1.69 |
| noise ×0.8 | **12** | **1.17** | **345** | **2.12** |
| affinity (cScale 0.8) | 9 | 1.22 | 182 | 1.81 |
| conjugate gain ×1.25 | 10 | 1.21 | 230 | 1.83 |
| background ×0.8 | 10 | 1.29 | 230 | 1.81 |
| noise ×1.25 | 7 | 2.00 | 127 | 1.35 |

**SAM:** Noise wins on every column. Affinity improves the LoD as much as conjugate but slides the whole window
down — uLoQ drops 227 → 182. It doesn't add a single level.

**PRIYA:** That's a nice result. Shame you had to build a tornado by hand in a for-loop.

[FRICTION] Sam wanted a tornado chart: each knob ±X %, bars for levels / LoD / LoQ / uLoQ / a chosen pair, sorted.
And a per-knob "cost" (weeks, money) so the ranking is effect per effort, not effect per 20 %.

**PRIYA:** What does the tool say about the hook claims? The client will ask "what if the patient is really high".

**SAM:** This is the bit I don't trust. [TOOL] `limits` on the base gives upper LoQ **10 000 ng/mL, CV 0.117**.
That's on the descending limb. With cMax capped at 1000 the same curve gives upper LoQ **227**.

**PRIYA:** So the quantifiable range is 4 to 227, not 4 to 10 000.

**SAM:** And the requirements check agrees with the wrong one: my probe "quantify 5–5000" comes back **met** in
every full-range scenario. And `read`: the pilot's own 10 000 strip, signal 2020, reads back as
**202.8 ng/mL, flag ok**, range 148–10 000. A 3600 signal reads 1163 with **CV 0.91 and flag ok**.

[FRICTION] This is the one that would end up in front of a client. Upper LoQ = the largest c with CV ≤ 20 %, which
on a hooked curve is past the peak. The range requirement checks only its two endpoints, so it misses the CV hole at
the peak. The read-back flag only says `aboveLoq` above the uLoQ, so a CV of 91 % is "ok". `recover`'s range is
the hull of both branches (148–10 000) with no "two answers" flag.

---

## Scene 2 — Thursday, video call with DANA, client program manager (not a scientist)

*SAM shares a screen with the Cal Wizard report page. DANA has a slide template open in another window.*

**DANA:** Give me the headline. Are we go?

**SAM:** Conditional go. The pilot shows the antibody pair works: a 1 ng/mL sample is visible above the blank. Today
it meets none of your four numbered targets, and with the changes we're proposing the model says three of four are
reachable.

[TOOL] `requirements` (base): detect 1 → LoD **1.52**, met if noise ×**0.70**; quantify 2–1000 → LoQ 3.93,
noise ×0.68; tell 5 from 7.5 → SSMD **1.69**, noise ×**0.56**; ≥ 10 levels → 9.

**DANA:** "Met if noise were 0.56." Is that bad?

**SAM:** It means we'd have to cut the strip-to-strip scatter almost in half to tell 5 from 7.5 on one strip. With
both changes we're planning — a better antibody and a cleaner membrane — the model gets to 2.87, needs 3. Close, not
there.

**DANA:** What's "SSMD"? My CEO will ask.

**SAM:** How many spreads apart the two readings are. Three is the bar we use; at three, about 1.7 % of single strips
would be misread. Here it is in your words: [TOOL] `separate 5 7.5` — at the best cut-off, **87 % of 7.5s read high,
91 % of 5s read low**.

[FRICTION] The report shows SSMD columns. Dana needed "87 of 100 patients at 7.5 called correctly". `separate` has
those numbers, the report doesn't carry them.

**DANA:** Can't we just run more strips?

**SAM:** Per patient? [TOOL] `nNeeded = 4`: average four strips per sample and 5 vs 7.5 passes. That's not a product,
it's a lab method. For the claim study, more strips help the *estimate*, not the assay. With 3 strips per level, a pair
whose true SSMD is 2.81 "passes" in **51 %** of simulated experiments, because three strips underestimate the spread.
With 10 strips, 41 %.

**DANA:** So with three strips we'd fool ourselves half the time.

**SAM:** Yes. And "statistically significant" isn't the same as "tells them apart": at 10 strips, blank vs 1 ng/mL
is significant in **100 %** of runs and passes our bar in **1 %**.

[FRICTION] Sam had to explain pSig vs pPass verbally. A "don't fool yourself" note on small-n runs (the estimate is
biased upwards at n = 3) would help the report.

**DANA:** OK. How confident are you in all of this? It's two weeks of data.

**SAM:** Honestly, the pilot is two strips per level. [TOOL] `simulate pilot.json --measured-n`: blank vs 1 ng/mL has
a true SSMD of 2.0, but a pilot like ours could have shown anything from **0.88 to 6.4**. The curve shape moves too —
drop one strip and the midpoint moves 22 %. The LoD barely moves, 1.43–1.55 across three plausible fits.

[FRICTION] The report shows one curve and single numbers. There is no place to say "LoD 1.4–1.6 across plausible
fits" — the uncertainty Sam computed by hand isn't in the claim sheet. Fit bands propagated to LoD / levels are what a
week-2 report needs most.

**DANA:** Hook effect. Our medical lead says patients can be very high. Does that kill it?

**SAM:** It doesn't kill it, but it has to be in the claim. At 10 000 ng/mL our strip gives the same signal as about
200. The tool, read naively, would tell you the range is up to 10 000 — it isn't. Real quantifiable range today is
roughly **4 to 230**. Above that we're in a zone where one signal has two answers.

**DANA:** Can I put "4 to 230" on a slide?

**SAM:** "Model-estimated, from pilot", yes. Not as a spec.

[FRICTION] Sam can't hand the report page to Dana as is: it shows upper LoQ 10 000, "levels" that include hook-limb
values, no hook warning, and an `adjust` block printed as raw parameters (`b0, t0, gain, cScale, sdScale`) rather than
"Scenario: affinity 2×, noise −30 %, not measured". A client-safe report would show measured vs modelled, the
scenario name, ranges instead of single numbers, and hide internal levers.

**DANA:** What's the plan?

**SAM:** Three things, in order. One: membrane and blocking first — it's the biggest lever per unit of change and it
helps everything: a 20 % noise cut takes us from 9 to 12 levels and LoD 1.5 to 1.2. Two: screen two or three
higher-affinity pairs; that moves the low end down but slides the top down too, so we pair it with a hook study.
Three: map the hook properly — 8 levels from 1000 to 50 000 — because right now the hook constant is my guess.

**DANA:** And conjugate?

**SAM:** Conjugate load helps about as much as affinity on paper. In practice it raises background too, and the model
can't capture that trade, so I'm not leading with it.

**DANA:** How many strips for the LoD study at the end?

**SAM:** [TOOL] `plan`: 20 blanks + 20 at each of 1.52, 3.04 and the LoQ — 80 strips — and 90 % of such studies land
the LoD between **1.38 and 1.98**, median 1.66 against a true 1.52. Confirming the LoQ at exactly the LoQ passes
55 % of the time, so we'd claim slightly above it.

**DANA:** Send me the slide by Monday.

**SAM:** You'll get the go/no-go, the knob ranking, and a hook box. I'll build the side-by-side myself.

[FRICTION] Sam leaves the tool here: scenario comparison side by side (base vs noise ×0.7 vs combo, as columns with
LoD / LoQ / range / levels / spec met) lives in a spreadsheet. `compare` exists for conditions but takes separate
series, not what-if layers of one series, and none of the outputs is a slide.

---

## Ideas mined

1. **[math] Hook-aware limits and reads.** Restrict uLoQ, ladder and range checks to the monotone branch from 0 (first
   peak); flag `hook` / `ambiguous` in read-back when a signal has a second root; recover returns both intervals. —
   uLoQ 10 000 at CV 0.117, read 2020 → 202.8 "ok", 3600 "ok" at CV 0.91, range 5–5000 "met".
2. **[math] Range requirement checks every c, not the endpoints.** "Quantify a to b" is met only if CV ≤ target over the
   whole interval. — probe 5–5000 passed across the peak's CV hole.
3. **[CLI][GUI] Knob sensitivity (tornado).** `calwizard sensitivity SERIES --delta 0.2` → for each lever ±δ: levels, LoD,
   LoQ, uLoQ, pair metric; GUI as sorted bars in What if. — Sam wrote a 14-run loop to learn that noise beats affinity.
4. **[math][CLI] Fit uncertainty propagated to claims.** Fit returns parameter SEs and a bootstrap/jackknife band; a
   `--from-fit` mode reports LoD / LoQ / levels as ranges. — EC50 266 → 325 by dropping one strip; done by hand.
5. **[math] Hook model in fit and a sanity gate on ranking.** Add 4PL × hook term; demote fits that go negative, turn
   over, or hit a parameter bound inside [0, cMax] (5PL g = 20 was `ok`). — quadratic ranked first, then gave 42
   levels and a signal of −938 743.
6. **[math] `adjust` lever semantics: gain, not "signal at cMax".** Express conjugate as `gain ×1.5` (or top =
   plateau/peak), and show the effective gain. — "top 6900" was 3.75×, not 1.5×.
7. **[report] Client-safe report.** Scenario label ("Modelled: affinity 2×, noise −30 %"), measured vs modelled marking,
   ranges, sensitivity/specificity in plain words, hook box, no raw `b0/t0/gain`. — report showed upper LoQ 10 000 and
   raw whatIf params.
8. **[GUI][CLI] Scenario comparison of what-if layers.** Named scenarios on one series, compared side by side (claims
   and spec met per column), exportable. — Sam built the comparison table in a spreadsheet.
9. **[math] Direction from the low end, not the endpoints.** Decide sandwich vs competitive from the slope near 0, so a
   hook (or a bad extrapolation) can't flip LoB to c = 1332.
10. **[GUI] Headline levels counted on the monotone branch only**, with the hook limb greyed. — noise ×0.7 "improved" to
    16 levels partly via 6462 and 9855.
11. **[report] Small-n honesty note.** When a planned experiment's n ≤ 3, show the optimism (pair at true 2.81 passes 51 %)
    and the pSig-vs-pPass distinction. — Dana's "fool ourselves" moment.
12. **[GUI] Lever coupling hint.** Say in What if whether noise follows signal (equations) or not (tables), and allow an
    optional link (conjugate ↑ ⇒ background ↑). — bottom lever cut blank SD 6.65 → 4.98 only in equations mode.
13. **[CLI] Fit diagnostics in plain words.** Warn that AICc is not comparable across datasets and when a level has one
    strip. — AICc 5 → 97 on near-identical data.
