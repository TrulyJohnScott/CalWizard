# Cal Wizard core: one-screen design

Draft for agreement before building. The deep variance stack (nested sources) is a later step; this design only leaves
room for it.

## The idea

One screen, three columns, in the order people work:

| Left | Middle | Right |
|---|---|---|
| **Make and play**: define the curve, adjust it, set its spread | **Understand**: how well the curve separates concentrations | **Use**: turn measured values into concentrations |

No tabs. No right-hand levels table. Every answer appears on the chart or in one sentence under it.

```
┌──────────────────────┬────────────────────────────────────────────┬─────────────────────┐
│ Data | Stats | Func  │ rule: SSMD | σ₁+σ₂ | LoB·LoD·LoQ           │ Read values         │
│ ── the definition ── │ [Fill] [Repeat ×1 ×100 ×1000]              │ ┌─────────────────┐ │
│                      │                                            │ │ paste / type    │ │
│ Adjust               │   curve: mean + ±1/2/3 SD lines            │ └─────────────────┘ │
│  background  top     │   0● ──●── ●── ●   your points             │ 720 → 10.6 (9–13)   │
│  midpoint  noise     │     [apart][too close] brackets            │ 3600 → >range  ⚠    │
│  Reset  Keep         │   repeat fan behind the curve              │ 40  → <LoD          │
│                      │                                            │                     │
│ Spread               ├────────────────────────────────────────────┤ click a row: its    │
│  read noise          │ histograms  ·or·  selected pair            │ reading line on     │
│  cassette noise      │ (gaussians, threshold, ROC, per 1000)      │ the curve           │
│  (more sources later)├────────────────────────────────────────────┤                     │
│                      │ one sentence: what it means, what to do    │                     │
└──────────────────────┴────────────────────────────────────────────┴─────────────────────┘
```

## Top bar

Name · headline ("8 points apart · detects 1.1 · measures 1.5–69 ng/mL") · undo / redo · share · settings.

Removed from the top bar: workspace tabs, the What-if toggle (levers live on the left), Present.

## Left: make and play

1. **Define** with `Data | Stats | Function`.
   - Data: readings per concentration.
   - Stats: mean and SD per concentration.
   - Function: signal(c) and σ(signal).

   Each view shows the current curve; editing a view makes it define the curve. Pasting anywhere lands in Data.
2. **Adjust**: background, top, midpoint, noise as scrub fields, always visible. Changes show live as "was → now" on
   the headline. `Reset` goes back to the measured curve; `Keep` folds the change in.
3. **Spread**: for now read noise and cassette noise (the within-run SD split in two). The section is where reader,
   day, lot and stability arrive later.
4. **Curves** (later): a second lot or a saved what-if as an overlay to switch between.

Collapsed state: a thin strip with one line ("4PL from 6 concentrations · SD 15 + 8%"); click to open.

## Middle: understand the separation

**The chart**
- Mean curve, ±1/2/3 SD lines (thinner and fainter outward). No haze.
- **Points**: 0 is always the first point and cannot move. Click the curve to add a point, drag to slide, select and
  Delete to remove.
- **Brackets** between neighbouring points: green "apart" or red "too close" under the chosen rule.
- **Fill**: places points at each separable step from 0 (the ladder) as ghost markers; click a ghost to keep it.
- **LoD / LoQ** ticks on the concentration axis: the first separations above 0.
- **Repeat ×1 / ×100 / ×1000**: simulated experiments from the true curve, same strips per point, each rebuilt into
  a calibration curve and drawn as a faint fan. Off by default; one click to show, one to hide.

**Below the chart** (one panel, switches by what is selected)
- Nothing selected: the read-back histograms (as today).
- A point selected: that point against its lower neighbour. Two gaussians, a threshold you drag, the ROC with the
  current threshold marked, sensitivity / specificity, misses and false alarms per 1000.

**One sentence** under everything, changing with what you touch.
- Nothing selected: "8 points, all apart. Detects from 1.1 ng/mL; above 77 the curve is too flat to add more."
- A pair selected: "5 and 10 are too close; they need a third less noise, or 3 strips averaged."
- Repeat on: "Across 100 repeats a reading at 25 ng/mL would come back between 21 and 29."

**The rule switch** has three choices:
- SSMD.
- Δμ ≥ k(σ₁+σ₂).
- LoB / LoD / LoQ: the σ₁+σ₂ rule with k from α and β, applied from the blank.

Z′ goes.

## Right: values to concentrations

- One box: type or paste signals (one per line, or a column from a spreadsheet).
- One row per value: signal → concentration with its range, and a flag: below LoD, below LoQ, above range, or
  ambiguous (hook).
- Click a row: its reading line appears on the curve. Dragging the reading line on the chart updates that row.
- Later: a row's error budget (bias plus k·SD per source against the allowed error) opens under it.

## What leaves the screen

These stay in the CLI and API; only the GUI drops them:
- the Separate, Limits, Read, Variability and Strips tabs;
- the levels sidebar, the Levels / Experiment switch and the Ladder panel;
- the Present mode and the report;
- the LoD verification planner and the precision profile;
- conditions and the error budget section, until the variance step brings them back in the left and right columns.

## Agreed in the interview (2026-11-21)

- **The curve and your points are separate.** The curve (from data, stats or function) is the truth being traced.
  Your points (`Series.points`, `[{c, strips}]`) are the concentrations you evaluate, e.g. 0, 2, 5, 10, 25, 40; never
  fractional ladder values. 0 is always first and not stored.
- **Entry:** a typed list above the chart (`2, 5, 10×3, 25, 40`; `×n` = that point's strips). Alt+click places a point
  (2 significant figures), drag slides it (2 s.f.), a plain click selects, Delete removes.
- **Strips:** a default (strips per result = `limits.reads`), overridable per point. Strips affect the evaluation only:
  one result's SD is `sdOfReads(c, strips)` (within-run averages, layers don't). The curve is the truth.
- **Capability vs your concentrations:** without points the headline gives what the assay could separate ("14 steps
  apart · 0–441 ng/mL"); with points it gives their verdict ("your 6 concentrations: 4 of 5 steps apart"), red when any
  step fails. "None apart from the blank" is said in red with how far off and what it would take.
- **Fill** places round concentrations (1-2-5 series) from 0, each kept only when apart from the previous one.
- **Rules:** Classify = gap ≥ N × (σ₁+σ₂) (default, N = 3, ≈1 misread in 740), Order = gap ≥ N × √(σ₁²+σ₂²) (SSMD,
  for comparing lots or conditions). Settable by N or by misread %. Z′ leaves the screen.
- **LoB / LoD / LoQ** are one overlay, on by default, α = β = 5%, LoQ CV target 15%.
- **Pairs:** each point against the one below it.
- **Threshold:** a clinical cut-off if set, else where the spreads cross; dragging explores without changing the spec.
- **Repeat** re-runs the calibration (the data's concentrations and replicates, or an editable default
  0, 1, 5, 25, 100, 500 × 3 for a function) and reports verdict stability, LoD spread and read-back spread.
- **Fits from data:** mean by 4PL by default (auto-pick by AICc among 4PL, 5PL, linear, hook when clearly better).
  SD per concentration, interpolated in CV between calibrators, held beyond the ends (marked), a single reading
  borrows the neighbours' CV. Floor + CV drawn faintly for reference.
- **Read panel:** each value can carry its strips averaged.
- **Levers:** background, top, midpoint, noise floor ×, CV × (noise split in two).
- **Outputs:** share link, save/open, Excel (curve and SDs, your points, limits, read-back).
- **Competitive curves:** handled automatically, same words.
- **Explainer:** "?" by the rule opens it in the bottom quarter; opens by itself on first use.
- **Later, with variance:** overlays of several curves; reader, day, lot, site and stability sources.

## Decisions to settle (first draft; answered above)

1. **Points vs data concentrations.** With Data or Stats defining the curve, the data's concentrations are fixed. Do
   your points sit on top as extra points to test (proposed), or replace them?
2. **Strips per point.** Is it one setting for the whole screen (proposed: next to Repeat), or one per point?
3. **The report and share.** Keep a share link and save/open file (proposed). Does the printable report come back
   later, or stay CLI-only?
4. **Threshold.** Is it per selected pair (proposed), or one clinical cut-off for the whole curve shown on the chart?
5. **Colour.** Only the brackets carry red / green (proposed); everything else is the curve's colour and grey.
