# Click study A: curve and resolvability

Driven live in the built-in browser at http://localhost:5173 (tab-1) on 2026-11-20, branch `scientist-modes`.
Starting state for every question: Sandwich assay loaded from the gallery (`Cal Wizard` → Sandwich assay), Curve
workspace, levels 0 · 1 · 5 · 25 · 100 · 500 ng/mL, rule SSMD ≥ 3. Click counts start from that state and do not
include loading the example. Numbers below were read off the screen; the Q3 and Q8 values were also checked with the CLI
(`measure`, `limits`), and they match.

Caveat: other agents were using the same app in other tabs, so the persisted UI state sometimes changed between my
steps (for example, the left panel switched to Table). I reloaded Sandwich when a clean state mattered.

---

### Q1. How many concentration levels can we tell apart across the whole curve?

> **CEO:** How many levels can this thing actually tell apart?
> **Scientist:** It's up in the top bar: "10 levels", next to "SSMD ≥ 3".
> **CSO:** Which ten?
> **Scientist:** If I hover the number, a tooltip lists them: 0, 1.43, 2.81, 4.50, 6.75, 9.93, 14.7, 22.6, 37.5, 76.9 ng/mL. If I click it, it replaces my levels with that ladder.
> **CSO:** So clicking it to look also overwrites your levels?
> **Scientist:** Yes, but Undo appears in the toast.

- **Answered:** yes. **10 resolvable levels** from 0 to 500 ng/mL (SSMD ≥ 3, about 1.7% misread).
- **Clicks:** 0 for the count. To see the values: hover only (0 clicks), or 1 click on `10 levels`, which also overwrites the levels.
- **Prerequisites:** 0.
- **Visibility:** the count is on the first screen. The list of levels is hidden: it appears only in a hover tooltip, or by clicking, which changes the data.
- **Discoverability:** good for the count. A first-time user would not guess that clicking the number replaces their levels. They would expect it to show the list.
- **CLI:** `uv run calwizard ladder examples/sandwich.json` → `{levels, n}`

### Q2. Where on the curve does resolvability collapse: low end, plateau?

> **CSO:** Where does it fall apart, at the bottom or at the top?
> **Scientist:** In the levels panel, two rows are red: 0→1 (SSMD 2.03) and 100→500 (SSMD 2.07).
> **CSO:** That's just your levels. Where does it really stop?
> **Scientist:** I click `10 levels` to load the ladder. The steps get wider and the last one is 76.9. There's nothing between 77 and 500, so the plateau is where it dies. The low end is fine: 0 → 1.43 already passes.
> **CEO:** Does the app say that anywhere?
> **Scientist:** Not in words. I have to work it out from the gaps. There are faint ticks on the concentration axis.

- **Answered:** partly. You have to infer it: **resolution runs out on the plateau above ~77 ng/mL.** No level is resolvable between 76.9 and 500. At the low end, 0 vs 1 fails (SSMD 2.03), but 0 vs 1.43 passes. No sentence or chart states where it collapses.
- **Clicks:** 1 (`10 levels` → read the ladder in the levels panel), then interpretation. The default level rows give a hint with 0 clicks.
- **Prerequisites:** 0, but it needs the mental step "a gap in the ladder means collapse".
- **Visibility:** one level deep, plus interpretation. The ladder ticks on the axis are faint and unlabelled.
- **Discoverability:** poor. The natural place to look first is the curve itself, for a shaded "resolution profile" or a note like "plateau starts here". Neither exists.
- **CLI:** `uv run calwizard evaluate examples/sandwich.json` (adjacent rows, `resolvable`) plus `ladder`. Neither states the collapse point either.

### Q3. Can we tell 5 from 10 ng/mL apart?

> **CEO:** Can we tell 5 from 10?
> **Scientist:** Separate tab, type 5 in A, 10 in B… "5 ng/mL and 10 ng/mL are resolved." SSMD 5.07 against a target of 3, so a single reading is misread 0.0095% of the time.
> **CSO:** How much margin?
> **Scientist:** "The spread could grow 1.69× before they stop being resolved." The nearest concentration resolved from 5 is 7.44.

- **Answered:** yes. **Resolved, SSMD 5.07** (target 3), misread 0.0095%, cut-off 472.5 a.u., one resolvable step between them, noise headroom 1.69×.
- **Clicks:** 3 clicks (`Separate` tab → A field → B field), 2 typed fields (5 ⏎, 10 ⏎). The pair chips only offer existing neighbouring levels (1·5, 5·25, …), so 5·10 has to be typed. Shortcut: the Sandwich example happens to include a requirement "Tell 5 from 10 ng/mL", so `Requirements` gives it in 1 click. That only works because the example preloads it.
- **Prerequisites:** 0.
- **Visibility:** one level deep (tab).
- **Discoverability:** good. The tab tooltip says "can the assay tell them apart?". The label `Separate` is fine once read.
- **CLI:** `uv run calwizard measure examples/sandwich.json 5 10` (verified: ssmd 5.07, sdScale 1.69) or `calwizard separate examples/sandwich.json 5 10`.
- **Side observation (bug):** the small "Where they sit on the curve" chart keeps a 0–15 ng/mL x-axis. When the pair is 100 vs 500, both handles are off the chart. The B card for 500 ng/mL reads "reads back 144 – > 144", which is confusing.

### Q4. If not, what would it take: how much less noise?

5 vs 10 passes, so I used the pair that fails: 100 vs 500 ng/mL.

> **CSO:** And 100 versus 500? That's where customers live.
> **Scientist:** On the Curve screen, under that red row, it already says "needs Δμ ≥ 1169 (has 805) · or SD ×0.69".
> **CEO:** In English?
> **Scientist:** Separate → chip 100·500: "Tighten the spread to 0.69× of today (CVs near 5.5%). Or average 3 readings per sample. Or a signal difference of 1169 instead of 805."

- **Answered:** yes. **Noise must drop to 0.69× (CV ~8% → ~5.5%)**, or average 3 readings, or the signal gap must grow from 805 to 1169 a.u. Today the pair is misread 7% of the time (SSMD 2.07).
- **Clicks:** 0 for the terse version (inline under the failing row in the levels panel). 2 clicks for the plain-language version (`Separate` → `100 · 500` chip). Alternatively `look closer` under the row (1 click).
- **Prerequisites:** 0.
- **Visibility:** on the first screen (terse), one level deep (full).
- **Discoverability:** good. "look closer" is a clear invitation. "SD ×0.69" is jargon on the first screen, but the Separate wording is excellent.
- **CLI:** `uv run calwizard measure examples/sandwich.json 100 500` → `whyNot.sdScale`, `needDmu`. `calwizard separate ...` gives replicates needed.

### Q5. What if we read every strip twice (two reads averaged)?

> **CEO:** What if we just read every strip twice and average?
> **Scientist:** There's no "reads" lever on the curve. I can open What if and set noise × 0.707, since averaging 2 cuts the SD by √2. Levels go 10 → 15, LoD 1.13 → 0.828, LoQ 1.53 → 1.07.
> **CSO:** That assumes all the noise is in the reader. Reading the same strip twice doesn't average out the strip-to-strip spread.
> **Scientist:** Right. Limits has "strips averaged per result". Set to 2, it gives LoD 0.828 and range 1.07–104 (97-fold). But the top bar still says 10 levels, so that setting doesn't reach resolvability.
> **CEO:** So which number do I believe?

- **Answered:** partly. Upper bound if all noise averages out: **10 → 15 levels, LoD 1.13 → 0.83 ng/mL, quantifiable range 1.53–69.4 → 1.07–104 ng/mL.** The app cannot split reader noise from strip noise in the Curve workspace. The Variability layers could model it via a Reader layer's noise, but the scientist did not get there in the room. The `reads` setting in Limits does not change the ladder or Separate.
- **Clicks:** path (a) 2 clicks (`What if` → noise field), 1 field (0.707 ⏎), and the scientist must know 1/√2. Path (b) 2 clicks (`Limits` → "strips averaged per result"), 1 field (2 ⏎). That gives limits only.
- **Prerequisites:** 1: knowing that averaging n reads scales SD by 1/√n and deciding that all noise is read noise. A proper answer also needs a Reader layer configured in Variability.
- **Visibility:** one level deep, but split across two workspaces that disagree (Limits changes, top bar does not).
- **Discoverability:** poor. "Read twice" maps to neither "noise ×" nor "strips averaged per result" (strips ≠ reads).
- **CLI:** `uv run calwizard limits examples/sandwich.json --reads 2` (limits only). For levels, no direct command: edit `sdExpr` (× 0.707) and run `ladder`, or put a what-if `adjust` in the JSON and `bake`.

### Q6. What if antibody affinity improved 2× (curve shifts left)?

> **CSO:** Suppose the new antibody has twice the affinity.
> **Scientist:** What if → midpoint × … affinity up means the curve shifts left, so midpoint × 0.5. Levels 10 → 11, LoD 1.13 → 0.563, LoQ 1.53 → 0.764 ng/mL.
> **CEO:** Only one more level?
> **Scientist:** The plateau is still the limit. It just starts earlier now.

- **Answered:** yes. **Levels 10 → 11, LoD 1.13 → 0.56 ng/mL, LoQ 1.53 → 0.76 ng/mL** (what-if bar, live deltas in green).
- **Clicks:** 2 clicks (`What if` → `midpoint ×` field), 1 field (0.5 ⏎). Alternatively, drag the midpoint diamond on the curve.
- **Prerequisites:** 1 conceptual: translate "affinity 2×" into "midpoint × 0.5", not 2.
- **Visibility:** one level deep (What if, key W). The deltas show in the bar itself, which is very good.
- **Discoverability:** medium. A scientist says "affinity", "EC50" or "Kd", not "midpoint". The direction (0.5 vs 2) is easy to get wrong.
- **CLI:** none direct. Edit `meanExpr` (c/40 → c/20) and run `ladder` / `limits`, or add an `adjust` layer and `bake`.

### Q7. Show me the calibrator curve with the replicate spread.

> **CEO:** Show me the curve with the scatter.
> **Scientist:** That's the main chart: the mean line, ±1 and ±2 SD bands, and replicate dots with whiskers at each level.
> **CSO:** Are those dots real readings?
> **Scientist:** No, in equations mode they're simulated (n = 5). For numbers I hover a level, or Separate shows 100 ng/mL as 3013 ± 242.

- **Answered:** yes for the picture, partly for the numbers. Example: **100 ng/mL = 3013 ± 242 a.u. (CV 8%)**, 1 ng/mL = 96.7 ± 16.9 (CV 17.5%).
- **Clicks:** 0 for the picture. Numbers: hover (hidden), the Table tab (1 click, canvas grid), or Present (1 click, the neighbouring-levels table with signal and CV).
- **Prerequisites:** 0 for the picture. For real replicate spread, load table data first (paste or import).
- **Visibility:** on the first screen. Per-level numbers are hover-only on the Curve.
- **Discoverability:** good. Nothing on screen says the dots are simulated, so a CEO could mistake them for real data.
- **CLI:** `uv run calwizard simulate examples/sandwich.json --n 5 --runs 1` (readings). `calwizard evaluate` (mean, sd per level). No figure from the CLI.

### Q8. What's the working range (lowest to highest quantifiable)?

> **CSO:** What's the working range?
> **Scientist:** Limits: "Detects down to 1.13 ng/mL and quantifies from 1.53 to 69.4 ng/mL." The tile says 45-fold at 20% CV.
> **CEO:** So everything above 70 is just a "high" result?
> **Scientist:** Above the quantifiable range, yes.

- **Answered:** yes. **1.53–69.4 ng/mL (45-fold) within 20% CV.** LoD 1.13, LoB 0.60 ng/mL.
- **Clicks:** 1 (`Limits` tab, or key 3). Also on Present (1 click).
- **Prerequisites:** 0.
- **Visibility:** one level deep.
- **Discoverability:** good. The term used is "Quantifiable range", not "working range", but the verdict sentence makes it obvious. The top bar does not show it, although the CEO asks for it in the same breath as "levels".
- **CLI:** `uv run calwizard limits examples/sandwich.json` → `loq.c` 1.53, `uloq.c` 69.4 (verified).

### Q9. Is there a hook effect, and where?

> **CEO:** Any hook effect?
> **Scientist:** The sandwich curve just rises to a plateau, so no hook up to 500. But the model is a 4PL, which can't hook, and the app never says either way.
> **CSO:** Show me what a hook would look like.
> **Scientist:** Gallery → High-dose hook. The curve rises, then falls past a few hundred ng/mL. The app doesn't mark the peak, and Limits says it "quantifies from 2.27 to 5000 ng/mL".
> **CSO:** That's wrong. A 5000 sample reads like a 44.
> **Scientist:** The ladder also jumps from 112.6 to 4232, counting a level on the falling side.

- **Answered:** no. Sandwich: no hook visible in 0–500, by eye only. The app has no hook detection, marker or warning. On the hook example, the peak (~593 ng/mL, signal ~3640) and the ambiguity (5000 ng/mL gives the same signal as ~44 ng/mL) are not shown. I computed them offline. The Limits verdict and the ladder silently include the falling side, which is a **misleading claim**.
- **Clicks:** 0 to eyeball the curve. No number is obtainable in the GUI. Loading the hook example takes 2 clicks.
- **Prerequisites:** a mean model that can hook (a 4PL can't). Raising `c max` would not reveal anything for Sandwich.
- **Visibility:** not available (only the shape of the line).
- **Discoverability:** a CSO would look for a marker on the curve or a line in Limits ("hook above X"). Neither exists.
- **CLI:** none.

### Q10. Give me a one-line headline I can put on a board slide.

> **CEO:** Give me one line for the board.
> **Scientist:** The top bar says "10 levels · SSMD ≥ 3", and Limits has a sentence. Present puts tiles together: 10 resolvable levels, LoD 1.13, quantifiable range 1.53–69.4, requirements 3 of 3.
> **CEO:** Can I copy a sentence?
> **Scientist:** No. I'll write it from the tiles: "CRP strip: 10 distinguishable levels from 0 to 500 ng/mL; detects 1.1 ng/mL, quantifies 1.5–69 ng/mL (45-fold, 20% CV)."

- **Answered:** partly. All the facts are on one screen (Present), but there is no ready one-liner and nothing to copy.
- **Clicks:** 1 (`Present`), then retyping by hand. Getting all the pieces without Present takes 1 click (Limits) plus reading the top bar.
- **Prerequisites:** 0.
- **Visibility:** one level deep (Present, key P).
- **Discoverability:** Present is obvious. "Copy headline" is where the CEO would expect it, in Share or Present, and it isn't there.
- **CLI:** `uv run calwizard report examples/sandwich.json` (all the parts, no one-liner). `calwizard rule` gives the pass rule in words.

---

## Summary

| Q | Answered | Clicks | Fields | Prerequisites | Visibility |
|---|---|---|---|---|---|
| 1 Levels across curve | yes: 10 | 0 (list: hover or 1) | 0 | 0 | first screen (list hover-only) |
| 2 Where it collapses | partly: plateau > ~77 ng/mL, inferred | 1 + interpretation | 0 | 0 (mental step) | one level deep, not stated |
| 3 5 vs 10 | yes: resolved, SSMD 5.07 | 3 | 2 | 0 | one level deep |
| 4 What it would take | yes: SD × 0.69 (CV ~5.5%) or 3 reads (100 vs 500) | 0 terse / 2 full | 0 | 0 | first screen (terse) |
| 5 Read twice | partly: ≤ 10 → 15 levels, LoD 0.83 | 2 | 1 | 1 (√n reasoning; reads vs strips) | one level deep, inconsistent |
| 6 Affinity 2× | yes: 10 → 11 levels, LoD 0.56 | 2 | 1 | 1 (affinity → midpoint × 0.5) | one level deep |
| 7 Curve with spread | yes picture / partly numbers (3013 ± 242 at 100) | 0 (numbers: hover or 1) | 0 | 0 (real data: load table) | first screen |
| 8 Working range | yes: 1.53–69.4 ng/mL, 45-fold | 1 | 0 | 0 | one level deep |
| 9 Hook effect | no: no detection; hook example overclaims to 5000 | 0 (eyeball) | 0 | model must allow a hook | not available |
| 10 Board headline | partly: facts in Present, no one-liner | 1 + retyping | 0 | 0 | one level deep |

## Fixes

1. **Q9: detect the hook and stop overclaiming.** When μ(c) turns over, mark the peak on the Curve chart ("hook at ~593 ng/mL"), cap the ULOQ, the quantifiable range and the ladder at the peak, and add one line to Limits and the report: "above X a result is ambiguous with Y". Today the hook example claims a range of 2.27–5000 ng/mL and puts a ladder level at 4232. Add a `hook` field to `limits` and `report` in the CLI.
2. **Q2 / Q1: show where resolution runs out.** Add one sentence under the levels panel or in the top-bar popover: "Resolvable from 0 to 76.9 ng/mL; nothing more resolvable above that (plateau). Low end: first step 1.43." Draw the ladder ticks visibly, or as a thin "resolution profile" band under the x-axis showing steps per decade. Make clicking `10 levels` open a popover listing the ladder, with a separate "Use as levels" button, so looking never overwrites the data.
3. **Q5: a "reads averaged" lever that reaches every claim.** Put `reads ×` (or "strips averaged") in the What-if bar and make it drive the ladder, Separate and Limits together. Today Limits' "strips averaged per result" changes LoD and range while the top bar stays at 10 levels. Optionally offer "read noise share" so reading one strip twice averages only the reader part. Point to the Reader layer for the exact answer.
4. **Q6: speak the scientist's language in What if.** Rename `midpoint ×` to `midpoint (EC50) ×`, with a tooltip saying "2× affinity → 0.5". Or add an `affinity ×` lever that sets midpoint = 1/value. Same for `top` ("max signal / gold load").
5. **Q10 / Q8: a copyable headline.** Add `Copy headline` in Share and Present that produces one sentence: "{name}: N resolvable levels from 0 to cMax units; detects LoD; quantifies LoQ–ULOQ (k-fold, CV%)". Show the quantifiable range in the top bar next to `N levels`, since the CEO asks for both together. Add `calwizard report --headline` (or a `headline` field) to the CLI.
6. **Q3: Separate polish.** Let the A/B fields take "5 vs 10" in one field, or add a free "pick on curve" chip. Fix the mini-curve: its x-axis stays at 0–15 ng/mL, so for 100 vs 500 both handles are off the chart. Fix the "reads back 144 – > 144" wording on a plateau level.
7. **Q4: one click from diagnosis to what-if.** Make "or SD ×0.69" under a failing row a button that opens What if with noise × 0.69 already applied, so the "what would it take" answer turns into the whole-curve consequence in one click. Rephrase it on the first screen as "needs ~31% less noise (CV ~5.5%)".
8. **Q7: label simulated against real.** Caption the dots "simulated, n = 5" in equations mode, and show mean ± SD (CV) for a level when it is clicked on the curve, not only on hover. Present's table already does this well.
