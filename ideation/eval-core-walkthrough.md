# Cognitive walkthrough: the one-screen core design against the 50 questions

Design evaluated: [CORE_DESIGN.md](CORE_DESIGN.md) (on paper, not built). Baseline: the five click studies
(`clicks-A` … `clicks-E`), Sandwich example, rule SSMD ≥ 3, today's app on branch `scientist-modes`.

Method. For each question I walk the design as written, from the Sandwich example on screen. I credit only what the
design describes. Where it is silent I state the assumption I made. Clicks are mouse clicks on controls. Fields are typed
or scrubbed values. Drags (point slides, threshold, reading line) are counted apart, because the new design swaps typing
for dragging and that is not free (precision, discoverability).

Status words: **yes**, **partly**, **no**; **deferred** = the variance step the design leaves room for; **CLI-only** =
the design drops it from the GUI on purpose (it stays in the CLI / API).

Assumptions used throughout (each is an ambiguity, see the last section):

- S1. The proposed answers to "Decisions to settle" hold: test points sit on top of the data concentrations (1), one
  strips-per-point setting beside Repeat (2), share link + save/open file, no printable report (3), threshold per
  selected pair, no clinical cut-off (4).
- S2. A point can only be placed by clicking the curve and dragging. No typed concentration for a point is described,
  so I assume an exact value (5, 10, 7.5, 12.5) can be reached by dragging with snapping or a readout. If it cannot,
  Q3, Q21, Q22, Q23, Q24, Q27, Q29 get worse.
- S3. The headline "8 points apart" counts the user's points. The ladder count appears only after Fill.
- S4. k, α, β and the CV target for the LoQ live in "settings" (the only unnamed home left).
- S5. The pair panel compares a selected point with its lower neighbour only, as written.

---

## Per question

| Q | Question (short) | New | Clicks / fields (drags) | Where on screen | Today | Change |
|---|---|---|---|---|---|---|
| 1 | Levels across curve | yes | 1 click (Fill), count ghosts | Middle: Fill → ghost markers | yes, 0 (list: hover) | same: list is better (looking no longer overwrites), count costs a click (S3) |
| 2 | Where it collapses | yes | 0 | One sentence: "above 77 the curve is too flat to add more" | partly, 1 + inference | **better** |
| 3 | 5 vs 10 | yes | 2 clicks (add point, select) + 1 drag to 10 | Middle chart: bracket; pair panel + sentence | yes, 3 clicks + 2 fields | better if S2 holds (no typing); worse precision if it does not |
| 4 | What it would take | yes | 1 (select 500) | Red bracket + pair sentence ("a third less noise, or 3 strips averaged") | yes, 0 terse / 2 full | same |
| 5 | Read every strip twice | partly | 0 + 1 field (read noise × 0.71) | Left: Spread → read noise | partly, 2 + 1 field | **better**: read vs cassette split means only reader noise is averaged; still no "reads" lever, user must know 1/√2 |
| 6 | Affinity 2× | yes | 0 + 1 field (midpoint scrub) | Left: Adjust; "was → now" on headline | yes, 2 + 1 | **better**; affinity → midpoint × 0.5 translation remains; level count change only visible with Fill on (S3) |
| 7 | Curve with replicate spread | yes | 0 picture; 1 for numbers (Stats view) | Middle: ±1/2/3 SD lines; Left: Stats | yes / partly numbers | same: numbers now 1 click (Stats); but real replicate dots are no longer drawn on the chart (design mentions only SD lines and test points) |
| 8 | Working range | yes | 0 | Headline "measures 1.5–69 ng/mL" | yes, 1 | **better** |
| 9 | Hook effect | partly | 0 + 1 field (a value past the peak) | Right: row flag "ambiguous (hook)" | no | **better**; peak not marked on the chart, not named in the sentence |
| 10 | Board headline | yes | 0 | Top-bar headline is the one-liner | partly, 1 + retype | **better**; no copy button described |
| 11 | LoB | CLI-only | – | Not shown anywhere (ticks are LoD / LoQ only) | yes, 1 | **worse** (`calwizard limits`) |
| 12 | LoD | yes | 0 | Headline "detects 1.1"; LoD tick | yes, 1 | **better** |
| 13 | LoQ at 20 % CV | yes | 0 (changing 20 %: settings, S4) | Headline lower end; LoQ tick | yes, 1 | **better** |
| 14 | LoD vs 1 ng/mL spec | partly | 0 by eye; 2 for the fix (rule → LoB/LoD/LoQ, select point 1) | Headline vs spec in your head; pair sentence | yes, 3 + 1 | **worse**: no requirement object, verdict is the user's comparison; "what it takes" depends on the pair sentence under the LoB rule (assumed) |
| 15 | Range with CV < 20 % | yes | 0 | Headline "measures …" | yes, 1 (profile 2) | better for the range; the precision profile chart is gone (CLI-only) |
| 16 | Replicates for LoD verification | CLI-only | – | Planner dropped | partly, 1 + scroll | **worse** (`calwizard plan`) |
| 17 | P(verification passes) | CLI-only | – | Planner dropped; Repeat speaks about read-back ranges, not study pass | partly, 1 + scroll | **worse** (`calwizard plan`) |
| 18 | LoD from 20 blanks + 20 lows | partly | 1 (Data) + 1 paste | Left: Data; headline LoD | yes, 4 + 1 | **worse**: entry is easier, but the classical estimate from data (§15) has no GUI home; you get the curve LoD refitted to the data. Paste replace vs append unspecified |
| 19 | Blank noise halved | partly | 1 (Function) + 1 field, or 0 + 1 (read noise, if it is the floor) | Left: Function σ(signal) or Spread | partly, 2–3 + 1 | same; whether "read noise" = the blank floor is undefined |
| 20 | α = β = 1 % | partly | ~1 (settings, S4) + 2 fields | Rule switch says "k from α and β"; inputs not placed | yes, 5 clicks + 2 | **worse**: no described input; LoB result not shown (Q11) |
| 21 | Cut-off 10 → threshold signal | partly | 1 + 1 field + 1 drag (type a signal, click row, drag reading line to 10) | Right column + reading line | partly, 2 + 1 | same; no clinical cut-off (S1); a point's signal is not stated as shown |
| 22 | Sens / spec at ±25 % | yes | 3 clicks (add 7.5, add 12.5, select) + 2 point drags + 1 threshold drag | Pair panel: gaussians, threshold, sens/spec | partly, 3 + 2 | **better**: the threshold is now the user's; exact 679.2 by drag only; ±25 % by hand |
| 23 | ROC / AUC | yes | as Q22 | Pair panel ROC with threshold marked | partly (AUC only) | **better**; AUC value not mentioned |
| 24 | Confusion matrix / 1000 | partly | as Q22 | Pair panel "misses and false alarms per 1000" | no | **better**; per 1000 of each class, no prevalence |
| 25 | Replicates for 95 % power | partly | 1 (select) | Pair sentence "or 3 strips averaged" (rule-based, not power) | yes by trial, 4 + 3 | **worse**: power is no longer reachable in the GUI (`calwizard separate --n`) |
| 26 | Populations, PPV / NPV | no | – | – | no | same |
| 27 | FPR in healthy | partly | as Q22 | False alarms per 1000 at one concentration | partly (proxy) | same (proxy at a chosen threshold, slightly better) |
| 28 | C5–C95 | no | – | Read-back range and Repeat range are not C5–C95 | no | same |
| 29 | Weaker lot, call rates | partly | 3 + 1 field (top scrub) | Adjust + pair panel | partly, 5 + 3 | same; better only if the dragged threshold stays fixed in signal when the curve changes (unspecified); no gain lever |
| 30 | Patient read-back + call | partly | 0 + 1 field | Right: "720 → 10.6 (9–13)" | partly, 2 + 1 | **better** (always visible); still no positive / negative call |
| 31 | Reader ×10 | deferred | – | Spread "later" | yes, 3 + 1 | worse (GUI lost for now) |
| 32 | Day-to-day | deferred | – | Spread "later" | yes, 2 + 1 | worse |
| 33 | Dominant source | deferred | – | Read vs cassette split exists but no shares are described | partly | worse |
| 34 | 5 sites × 10 readers | deferred | – | – | partly | worse |
| 35 | Second lot as a curve | deferred | – | "Curves (later)" | yes, 5 + 1 | worse (`calwizard compare`) |
| 36 | One reader 5 % high | deferred | – | – | partly | worse |
| 37 | Error budget TEa 20 % | deferred | – | Right column "later" | yes, 1 + 1 | worse (`calwizard tolerance`) |
| 38 | Study size per source | deferred | – | – | partly | worse |
| 39 | Dial in from real data | deferred | – | – | yes, 5 + paste | worse |
| 40 | Stability drift | deferred | – | – | no | same |
| 41 | Import CSV | yes | 0 + paste | Anywhere → Data | yes, 2 (0 with Ctrl+V) | same |
| 42 | Analyte and units | partly | assumed 1 + 2 fields | Name in top bar; analyte / units not placed | yes, 1 + 2 | same if the name popover survives; unspecified |
| 43 | Excel, everything | CLI-only | – | Share lists link and file only | partly, 2 | **worse** (`calwizard export`) |
| 44 | PDF claim sheet | CLI-only | – | Report dropped | yes, 2 | **worse**; the CLI report is JSON, so no PDF exists anywhere |
| 45 | Link of exact state | partly | 2 | Share | partly, 2 | same; what the link carries (points, selection, Repeat) unspecified |
| 46 | Clean presentation mode | partly | 1 (collapse left column) | Left strip collapsed | yes, 1 | **worse**: a narrower working screen, not a presentation |
| 47 | Two what-ifs side by side | partly | 0 + 1 field | Adjust "was → now" on headline | partly, 1 + 1 / 6 | same; side by side waits for "Curves (later)" |
| 48 | Undo three | yes | 3 | Top bar | yes, 3 | same |
| 49 | Save and load file | partly | 2 save + 2–3 load | Share (proposed) | partly | same; contents of the file unspecified |
| 50 | Requirements at a glance | CLI-only | – | Requirements headless; report gone | yes, 1 | **worse** (`calwizard requirements`) |

---

## 1. Summary counts

| | yes | partly | no | deferred | CLI-only | median clicks (answered) |
|---|---|---|---|---|---|---|
| Today (all 50) | 25 | 20 | 5 | – | – | 2 |
| New (all 50) | 15 | 17 | 2 | 10 | 6 | 1 |
| Today, on the 34 questions the new design keeps in the GUI | 17 | 13 | 4 | – | – | 2 |
| New, same 34 | 15 | 17 | 2 | – | – | 1 |

Change across all 50: **14 better, 16 same, 20 worse** (10 of the 20 are the deferred variance questions, 6 are
deliberate CLI-only drops, 4 are in-scope losses: Q14, Q18, Q20, Q25).

Reading the numbers honestly:
- The design is clearly faster for the questions a CEO asks first (Q2, Q8, Q10, Q12, Q13, Q15: 0 clicks, on the
  headline or in the sentence). Median clicks drop from 2 to 1, and typed fields drop from about 1 to about 0.
- It answers fewer questions fully, even on the 34 it keeps (17 → 15 yes). It wins on thresholds (Q22–Q24 move up) and
  loses on limits detail (Q14, Q18, Q20 move down).
- The pair questions (Q3, Q22–Q24, Q27, Q29) trade typed values for drags. Without exact placement (S2) they degrade.

## 2. Regressions (worse, or losing a GUI answer)

| Q | Loss | Does it matter? |
|---|---|---|
| 50, 14 | Requirements: no "do we meet the spec" anywhere in the GUI | **Yes, most.** It is the CEO's bottom-line question, and the report it was moved into is gone too |
| 44, 46 | No printable claim sheet, no presentation mode; the CLI report is JSON only | **Yes.** The board pack and client call have no path at all, GUI or CLI |
| 11, 20 | LoB is not shown; α / β have no described input | **Yes** for the regulatory scientist: LoB is half of an EP17 claim, and the LoB rule cannot be tuned visibly |
| 25 | Power / replicates needed to separate a pair (the sentence gives the SSMD-rule replicate count, not power) | Medium: the CLI has it; the GUI sentence may be mistaken for it |
| 18 | Classical LoD from blank + low replicates | Medium: data entry is easier, but the number EP17 asks for is CLI-only |
| 16, 17 | LoD verification planner | Medium: specialist and pre-study; acceptable as CLI if the docs say so |
| 43 | Excel export | Low-medium: finance asks for it; one menu item would restore it |
| 31–39 | All variability layers, conditions, error budget, dial-in | Deferred by design. Five of these were "yes" today (31, 32, 35, 37, 39), so the gap is real until the variance step lands |
| 7 | Replicate dots no longer drawn | Low: the Data view still has them, and the SD lines carry the spread; but a curve without its readings looks like a model |
| 15 | Precision profile chart | Low: the range is on the headline |
| 1 | Level count needs a click (Fill) | Low, if the headline also states the count (gap G1) |

## 3. Gaps: add or specify without clutter

| # | Addition | Questions | Clutter cost |
|---|---|---|---|
| G1 | Headline states the ladder count as well as the points: "10 levels · 8 points apart · detects …" | 1, 6, 10 | One word group |
| G2 | Requirements badge in the headline only when a series has requirements ("3/3 met", red when not); click → one sentence per requirement in the sentence area | 14, 50 | None when there are no requirements |
| G3 | Exact point entry: type a number while a point is selected (or in the sentence: "5 → [10]") | 3, 21, 22, 23, 24, 27, 29 | None visible |
| G4 | Pair = any two selected points (shift-click), not only lower neighbour; "±25 % around this point" as a one-click pair | 3, 22, 28 | None visible |
| G5 | With rule = LoB/LoD/LoQ: an LoB tick beside the LoD / LoQ ticks, and α, β appear next to the rule switch (only for that rule) | 11, 20 | Appears only when that rule is chosen |
| G6 | Decide 4 = one clinical cut-off line (off by default): held fixed in signal through Adjust; a positive / negative / indeterminate flag in the right column; C5 / C95 marked on the axis | 21, 28, 29, 30, 27 | One optional line |
| G7 | Pair panel: AUC to 4 d.p.; sentence on a passing pair adds "with N strips, 95 % of experiments show it" | 23, 25 | A few words |
| G8 | Print: a print stylesheet of this screen (headline + chart + sentence + read rows) under Share, plus "Copy headline" | 10, 44, 46 | One menu item |
| G9 | "Excel workbook" stays in Share | 43 | One menu item |
| G10 | Spread: "reads per strip" beside read noise (averages only read noise); define read vs cassette noise in σ terms | 5, 19 | One field in an existing section |
| G11 | Mark the hook peak on the chart and in the sentence ("above 590 a result is ambiguous") | 9 | Only on hooked curves |
| G12 | A selected point shows c, mean ± SD, CV and n (real or simulated) in the sentence | 7, 21 | None visible |
| G13 | When Data has ≥ 2 blanks and a low level, the nothing-selected sentence adds the classical LoD from data | 18 | One clause, data-dependent |

## 4. Ambiguities that blocked a clear answer

1. **What the headline counts.** "8 points apart" reads as the user's points, not the ladder. That decides Q1, Q6 and
   Q10, and whether "was → now" shows a level count at all.
2. **Where settings live.** k for the σ₁+σ₂ rule, the SSMD target, α, β, the LoQ CV target, analyte and units are not
   placed. "Settings" is the only candidate (Q13, Q20, Q42).
3. **Exact placement of points.** Click and drag only. Every pair question depends on reaching 5, 10, 7.5, 12.5 exactly
   (Q3, Q21–Q24, Q27, Q29).
4. **Pair = lower neighbour.** Arbitrary pairs and pairs across intervening data concentrations are undefined (Q3, Q22).
5. **Threshold behaviour under Adjust.** Does a dragged threshold stay at its signal when the curve changes, or move
   with the pair? That is exactly the Q29 question.
6. **Read noise vs cassette noise.** "The within-run SD split in two" has no formula: which part is the constant floor,
   which the proportional part, the default split, and how it is estimated from data (Q5, Q19).
7. **Strips per point.** Does it change only the Repeat fan, or also the brackets, ladder and headline (Q5, Q25)? Today
   the Limits "strips averaged" and the headline disagreed. The design should not repeat that.
8. **Paste into Data: replace or append.** This decides whether 20 blanks can be added to an existing curve (Q18, Q41).
9. **Share menu contents.** Link and file are proposed; Excel and print are not mentioned either way. What a link and
   a file carry (points, selection, Repeat, rule) is open (Q43–Q45, Q49).
10. **LoB.** The rule is named "LoB / LoD / LoQ", but only LoD and LoQ ticks are described (Q11).
11. **Hook.** Only the read row flag is described. Nothing says whether the headline range and Fill stop at the peak
   (today's backend does) or whether the chart marks it (Q9).
