# Core one-screen design: persona walk-through and critique

Review of `ideation/CORE_DESIGN.md` on paper, against spec §1–§6, §15–§16 and requirements §2.1–§2.13.

## 1. Bench scientist: "I just ran strips"

1. Opens the app. The design does not say what an empty screen shows. If it is the default 4PL (spec §2), she sees a
   curve that is not hers, with brackets and a headline about *someone else's* assay. She hesitates: "is this my data?"
2. Copies the reader export and presses Ctrl+V. "Pasting anywhere lands in Data", so the left column switches to Data
   and the curve redraws. Good: zero clicks. But if her cursor happens to be in the Read box on the right, the same paste
   goes there instead. Two paste targets with different meaning, and the design gives one rule for both.
3. Sees mean and ±1/2/3 SD lines, her concentrations as points, brackets between them. The headline says "6 points
   apart · detects 1.1 · measures 1.5–69". Hesitation: are the "points" her calibrators or things the tool added? The
   design never says how data concentrations are drawn compared with points.
4. Wants 5 vs 10 ng/mL. Her data has 0, 1, 5, 10, 50. So 5 and 10 are neighbours, and she clicks the 10 point. If she had
   run 0, 1, 5, 25, she would have to "click the curve to add a point" at exactly 10. There is no typed concentration,
   so she drags until a tooltip says 10.0. If 7 is between 5 and 10, she cannot compare 5 with 10 at all: a selected
   point is only ever compared with its *lower neighbour*.
5. The panel below shows two gaussians, a threshold, ROC, per-1000 counts. The sentence: "5 and 10 are too close; they
   need a third less noise, or 3 strips averaged." That is clear. But "strips averaged" and the Spread split (read noise
   vs cassette noise) interact: averaging three reads of one strip only reduces read noise (R-23). The sentence must say
   which, and the design does not.
6. LoD: a tick on the axis. Under SSMD it is "the first separation above 0" (ladder). Under the third rule it is the
   EP17 LoD. She switches the rule and the LoD moves. Which one goes in her notebook?

## 2. Validation scientist

1. Loads a series with 20 blanks and low replicates. Looks for LoB/LoD/LoQ, finds them under the *rule switch*. Picks
   "LoB / LoD / LoQ". The brackets now apply an α/β rule between *every* pair of neighbours, including 50 vs 100, where
   it has no meaning; EP17 is a blank-vs-c rule (spec §15), and LoQ is a CV criterion, not a separation at all. She will
   distrust the whole chart.
2. Wants the classical estimate from her replicates (spec §15 `data`) next to the model estimate (R-36 "one LoD to
   claim"). The design does not show it. α, β and the CV target have no home (settings?).
3. Clinical cut-off is 20 ng/mL; she wants 15 vs 25. She adds two points, selects 25, but 20 sits between them if
   it is a data concentration, so 25 compares with 20. She deletes 20 from points; she cannot delete a data
   concentration. Stuck.
4. Drags the threshold to the company's shipped cut-off signal. Selects a different pair: the threshold resets to that
   pair's crossing. The shipped cut-off was never stored. R-1 (the strongest requirement in the study) is missed.
5. Sensitivity/specificity per 1000: good. But at which reads, which strips?
6. "How much would a repeat differ?" Turns on Repeat ×100. A fan appears, and the sentence becomes "a reading at 25 would
   come back between 21 and 29". That answers read-back spread, not her question (how much would *LoD* move; the §15
   planner). The planner has left the GUI. And with a pair still selected, which sentence wins?
7. Has to sign off: no report, no Present. She exports to Excel or runs the CLI.

## 3. CEO over the shoulder

1. Reads the headline: "8 points apart · detects 1.1 · measures 1.5–69 ng/mL". "Points apart" means nothing to him, and
   it counts what the scientist clicked, not a property of the assay. Moving a point changes "8" to "7".
2. Asks "can we claim 1 ng/mL?" There is no yes/no. Red/green brackets read as traffic lights, but for pairs, not
   claims. No margin, no "how sure" (R-14, R-41).
3. Asks "what's the risk?" Per-1000 counts appear only after a pair is selected. The sentence is the best part for him,
   but it changes with every touch, so what he reads depends on what the scientist last clicked.
4. Asks for something to take to the board. Report and Present are gone.

## What is clear and good

- Three columns in working order (make → understand → use) is a real simplification over six workspaces.
- One sentence that says what it means and what to do is the strongest idea; it is the R-42 risk language done right.
- Paste-to-define and the Data | Stats | Function trio, each showing the same curve, are sound and keep spec §1.
- Scrub fields with "was → now" on the headline make what-if visible without a mode toggle.
- The pair panel (gaussians, draggable threshold, ROC, per-1000) puts R-9 and R-52 where they belong.
- Read rows linked to a line on the curve, with hook/below-LoD flags, are exactly §18 made visible.
- Dropping Z′ and the levels sidebar removes known confusion.

## Where people get stuck

- **"Points"**: used for user test points, Fill ghosts and (implicitly) data concentrations. Need two words.
- **Lower-neighbour pairing**: no way to compare non-adjacent concentrations; no typed concentration.
- **"noise" appears three times**: σ(signal) in Function, `noise` in Adjust, read/cassette noise in Spread. Which one
  does "a third less noise" mean?
- **`Keep`** in Data mode: does it rewrite her readings? `Reset` in Function mode: "the measured curve" does not exist.
- **Dragging a reading line updates that row**: it silently edits a measured value. Should be a ghost row.
- **"background / top"** on a falling (competitive) curve (R-39).
- **Read-back range (9–13)**: at what confidence, with how many reads?
- **Histograms "as today"**: only meaningful to people who used the old tool.

## Contradictions inside the design

1. **Points vs data concentrations.** Brackets are "between neighbouring points", the headline counts points, and 0
   "cannot move". If data concentrations are points, they can't be deleted or dragged; if not, the chart has two kinds
   of dots with brackets only between some.
2. **Threshold per pair vs clinical cut-off.** One threshold per selection contradicts R-1/R-3 and the fixed-threshold
   feature just built (spec §16 `at`).
3. **LoB/LoD/LoQ as a rule.** It is not a separation rule: LoD = blank vs c with z_α·σ₀ + z_β·σ_c (not k(σ₁+σ₂) unless
   α = β and the SDs are used one-sided); LoQ is a CV target. And it makes the LoD tick depend on the rule.
4. **Two LoDs.** "LoD/LoQ ticks: the first separations above 0" vs spec §15. The headline "detects 1.1" must be one.
5. **Sentence with several things on.** Pair selected + Repeat on + a what-if active + a read row clicked: four
   candidate sentences. No priority given.
6. **Repeat with data.** "From the true curve": with Data defining it, the "truth" is the interpolated data, which then
   gets re-noised and re-fitted; the fan understates spread from the fit itself. Repeat uses "same strips per point"
   while the pair sentence talks about strips averaged per sample: two different n's, one word.
7. **Paste anywhere → Data** vs the Read box that takes pasted signals.
8. **"Every answer on the chart or in one sentence"** vs a below-chart panel with ROC and histograms. Fine, but say so.

## Missing states

- **Empty / first run**: example curve or blank canvas with "paste your strips"? Needs a visible "example" label.
- **No points**: only 0 exists; brackets none; what does the headline say?
- **Error**: invalid expression, unparseable paste, a column with one reading (no SD). Where does the message go?
- **Flat curve**: no LoD, no brackets pass. The sentence must say "the curve never rises above blank noise".
- **Hook**: points past the peak; brackets there must be grey "past the hook", Fill stops at the peak, LoQ upper open.
- **Competitive**: falling curve; ROC positive side; Adjust labels.
- **Many points** (Fill on a good assay: 30+): bracket labels overlap; need a collapsed "all apart" band.
- **Narrow window / phone**: three columns do not fit. Order on stack: middle (chart + sentence), then right, then left
  collapsed.
- **Long computation**: Repeat ×1000 with re-fitting needs a progress state and must not block scrubbing.

## Clutter risk

- **The rule switch** will grow (dsum, SSMD, EP17, cut-off agreement, bands). Keep it to two choices.
- **Spread** is designed to grow (reader, day, lot, stability, nested). Without presets and collapse it becomes the old
  Variability tab in a column.
- **Settings** in the top bar will collect α, β, CV target, confidence, units, reads, seed. That is where the removed
  workspaces will quietly come back.
- **Right-column "error budget per row"**: one row expanded is fine; budgets on every row is a table again.
- **The panel below the chart** switching on selection will acquire tabs (histograms / pair / profile / planner).

## Decisions to settle

1. **Points vs data concentrations.** Points start as a copy of the data concentrations, then are independent: data
   stays the definition (solid dots, no editing on the chart), points are what you test (brackets, headline). Deleting
   a point never deletes data. This matches `extraLevels` and removes the "can't remove 20" trap.
2. **Strips per point.** One setting for the screen, labelled "strips per result", printed in the sentence and used
   by separation, LoD, read-back and Repeat alike; per-point n stays in the CLI. Per-point would put a control on
   every dot.
3. **Report and share.** Keep share link and save/open. Bring the printable report back as "Print" in the share menu
   (it already exists); the CEO and the validation sign-off both need paper, and a CLI-only report is out of their
   reach.
4. **Threshold.** One optional clinical cut-off on the series, drawn on the chart and used by the pair panel; with
   none set, the pair's best crossing is used. Dragging is a local what-if with "Set as cut-off". This is R-1, the most
   requested gap.
5. **Colour.** Agree, with two additions: brackets also carry the word or a shape (colour-blind readers), and read
   flags get one amber warning colour; LoD/LoQ ticks stay grey.

## Five highest-value changes, smallest first

1. **Rule switch = SSMD | σ₁+σ₂ only.** LoB/LoD/LoQ always shown as ticks from spec §15 (α, β, CV in one popover on
   the ticks). Removes contradiction 3 and the two-LoD problem.
2. **Typed concentrations and free pairs.** A point's label is editable ("10"); shift-click any two points to compare.
3. **A sentence priority and a state table.** Write down which sentence wins (error > pair > repeat > what-if >
   summary) and the text for empty, flat, hook, falling and many-points states before building.
4. **Clinical cut-off on the series**, one chip in the top bar and a line on the chart; the pair panel defaults to it.
5. **A claims line for the CEO**: replace "8 points apart" with the claims (detects ≤ X: yes, margin; quantifies
   A–B; N levels from the ladder, not from clicks), with measured vs assumed marked, and Print from share.
