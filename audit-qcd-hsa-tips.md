# Audit: QCD, HSA, TIPS ladder (2026-10-20)

**Scope.** This covers `git diff 869e998..HEAD` plus the 12 uncommitted files. It was an independent audit: engine math, tax law, cross-feature interactions, persistence, UI and copy, and test quality. Five parallel auditors (QCD, HSA, TIPS, cross-cutting, UI) checked suspected bugs with throwaway probes; all probes have been deleted. I re-checked every High finding and most Mediums against the code myself.

**Baseline (current working tree):**
- Cold `tsc -b --force` is clean.
- `pnpm lint` is clean.
- `test:fast`: 1097 pass, 1 skip.
- `test:opt`: 81 pass.
- e2e was not run.

**Overall.**
- **Neutrality holds.** Plans that don't use a feature are bit-identical. The quantity × consumer table is consistent apart from H1. A combined-feature fuzz (300 runs mixing HSA + TIPS + charity) passed every invariant and the exact cash identity. The optimizer apply/re-project round trip is exact.
- **The problems are elsewhere.** They sit in (a) tax rules the model gets wrong or leaves out, (b) data-entry and edge-state handling, and (c) one uncommitted Sankey change.

Each finding is marked **[P]** (confirmed by a numerical probe) or **[R]** (confirmed by reading the code). **×2 / ×3** means that many auditors found it independently.

---

## High

| ID | Area | Finding | Evidence |
|---|---|---|---|
| H1 | HSA | **The retiree HSA deduction is capped at ordinary income, so it is lost when income is mostly capital gains.** `projection.ts:514` computes `hsaDed = max(0, ordinary − contrib)`, and the leftover is never taken off LTCG. As a result, AGI/MAGI, ACA MAGI, IRMAA MAGI and NIIT all ignore it. This is exactly the brokerage-funded early retiree the "ACA lever" (H-8) targets. | [P] ×2. planR at 55: ordinary 0, LTCG 43,915, contribution 8,750. ACA MAGI stays at 43,915, and the premium **rises** $639 instead of falling about $622. A brokerage-heavy planR loses 77-86% of the deduction each year, about $8k of ACA premium over 10 years. |
| H1a | HSA (knock-on) | **The HU-7 finding was misdiagnosed.** It blamed funding withdrawals for the deduction not lowering ACA income; the real cause is H1. The HSA Taxes card, Learn More and the HowToGuide now tell users that "the contribution doesn't lower your ACA income in this plan", which is false. `hsaBenefit.test.ts:74-81` and planR `.hsa.csv` (acaMagi/acaPremium, ages 55-64) lock in the wrong values. | [P] |
| H2 | UI, **uncommitted** | **The Sankey no longer balances in shortfall years that include giving.** `sankeyFlows.ts:175` now subtracts all giving from `spending`, but `fromGap` (the shortfall) still goes only to `spend`. The shortfall can then exceed the Net Spending node: sources ≠ uses, and a phantom "Other Portfolio Draw" appears. HEAD does not have this problem. | [P] planB single, spending ×4, $60k DAF giving at age 81: shortfall $371.5k vs spend node $339.4k; 16-27 bad rows per plan. |
| H3 | Tests | **Golden tests don't pin the date.** `__golden/golden.test.ts` has no `pinDate()` / `vi.setSystemTime`. With the clock at 2027-03-01, planA and planS fail (37 vs 38 rows). planS also hard-codes 2026-based maturity years. CI will start failing on 2027-01-01. The A-M part predates this work; planS makes it worse. | [P] by the TIPS auditor; [R] no pin in `__golden/*.ts` |

## Found after the audit

| ID | Area | Finding | Evidence |
|---|---|---|---|
| N1 | Tax, pre-existing | **§86 provisional income left out realized capital gains.** Every provisional-income site in `projection.ts` (gross-up loop, `resolveYearTaxes`, and the conversion and withdrawal estimates) added dividends but not `wdTax*gainFraction` or `tipsGain`, though provisional income starts from AGI. A retiree living off a low-basis brokerage paid too little tax on Social Security. | [P] Lifetime real federal tax: planA +$19.8k (+4.3%), planH +$21.7k, planI +$25.6k, planK +$28.7k (+6.9%), planB +$6.3k, planG +$4.2k, planS +$1.3k; endTaxAdjustedReal down 0.15-4.1%. **Fixed 2026-10-21** with the user's approval: goldens A, B, D, G, H, I, K, M, S, bit-exact and optimizer snapshots regenerated. |

## Medium: engine and tax rules

| ID | Area | Finding | Evidence |
|---|---|---|---|
| M1 | HSA | **The shared family limit applies only when both spouses are on family coverage** (`hsa.ts:70`; the warning at `planWarnings.ts:184` has the same gap). Under §223(b)(5), if either spouse has family coverage, both share one family limit. | [P][R] `{8750 family, 4400 self}` returns 13,150; the legal cap is 8,750 plus catch-ups. |
| M2 | HSA | **The HSA pays a spouse's IRMAA while its owner is under 65.** `hsaAvail` (`projection.ts:624`) is gated only on the policy age. Medicare premiums are qualified only once the account holder is 65 (Pub 969). The D4 text implies a 65 gate that isn't there. | [P] ×2. B is 60 with the policy set to Always: B's HSA pays A's IRMAA of $2.9-3.2k every year. |
| M3 | HSA | **The retiree deduction never reaches state tax.** IL and NY follow the federal deduction; only CA and NJ don't. `hsa.retirement.test.ts:52-58` ("IL+CA unchanged") asserts the wrong behavior. | [P] planR IL: state tax $1,884 with the contribution vs $1,677 without; about 4.95% of the contribution is overstated each year. |
| M4 | HSA | **A retiree contribution still happens when every other account is empty**, so the HSA funds its own contribution through the last-resort draw. That adds penalty and tax for nothing. | [P] `hsaOnlyPlan` + $4,400 at 55: non-qualified draw +6.4k, penalty +1.3k, end HSA −1.8k. |
| M5 | HSA, data | **The stock "Healthcare" template is tagged `medical`, but its hint says "Premiums + out-of-pocket"** (`streamTemplates.ts:96-105`). Pre-65 marketplace premiums and Medigap are **not** HSA-qualified. The engine still pays them from the HSA and, before the policy age, adds them to receipts. Those receipts later come back tax-free and count as Roth-like in the end value. | [R] About $18k/yr from 55 to 64 builds about $200k of mostly ineligible receipts. |
| M6 | TIPS | **When a taxable carve-out exceeds basis, gains disappear.** `projection.ts:373` reduces basis dollar for dollar (floored at 0), and the rung's cash later comes back at full basis. `taxableBasis` defaults to 0, so anyone who never entered a basis is affected. The builder also models no gain realized on the purchase. (A user who owns the TIPS and entered a basis that includes them is fine.) | [P] $300k taxable with basis 0 and a $200k rung: unrealized gain $106.5k vs $319.5k; endTaxAdjusted +$26k. |
| M7 | TIPS | **On-top rungs (`balancesIncludeLadder:false`) disappear once their maturity year passes.** `tipsLadder.ts:95` drops them whatever the flag says; the money was never in any balance. The warning says "Remove it or update its maturity year", where it should say "add the proceeds to the account balance". | [P] endTotalReal $3.14M becomes $2.23M after the year rolls over. |
| M8 | TIPS | **`faceValue` has no upper bound**, so a typo creates money. Par above adjusted principal only happens after cumulative deflation. | [P] A $50k rung with face $500k: year-1 endTotal $465k vs $110k. |
| M9 | QCD | **The `qcd-no-ira` warning fires while the engine does pay QCDs.** It checks only the row's `whose`, but `allocateQcd` pays from either spouse (`planWarnings.ts:138-151`). It also ignores the row's age window. | [P][R] planQ, `whose:'A'`, A's IRA 0: the warning fires, yet the engine pays $866k of QCDs from B. |
| M10 | QCD, copy | **"Same withdrawal plan" in the QCD savings card isn't true under bracket-fill conversions.** `disableQCD` re-solves the conversions, so the headline nets out the extra conversions the QCD made room for. The insight's "fewer Roth conversions are usually needed" is also contradicted there (conversions rise $247k). | [P] planQ: tax saved $159k (conversions off), $176k (auto-window), $88k (bracket-fill; conversions $1.79M vs $1.54M). |
| M11 | QCD, law | **The §408(d)(8)(A) anti-abuse rule is not modeled.** Deductible IRA contributions after 70½ (the engine sends spousal contributions to traditional by default) should reduce the excludable QCD. | [P] B is 74 and gets an $8k/yr spousal contribution: all $30k of QCD is excluded, where the law makes $8k/yr taxable. |
| M12 | Pre-existing | **Inherited-IRA forced distributions are not reserved before withdrawals and conversions** (`tradAvail` at `projection.ts:844`, `maxConv` at `:749`). The IRA can be drained and the distribution then paid as phantom cash. Not caused by these features, which only change which plans hit it. | [P] Trad OVERDRAW and a $13,293 conservation leak; 82 of 486 feature-free grid plans fail. |

## Medium: UI and store

| ID | Finding | Evidence |
|---|---|---|
| M13 | **Tabbing through the HSA return field marks the optimizer result out of date.** The field shows `hsaReturn ?? tradReturn`, and blur always commits, which writes `hsaReturn = tradReturn` (rounded: 0.0625 is saved as 0.063). It also pins the HSA rate, so later pre-tax return edits no longer move the HSA (`InputsPage.tsx:791`). | [P] Key changes on defaultSavedPlan. |
| M14 | **A partly valid TIPS CSV paste adds rungs twice.** The good rows are added but stay in the textarea; after the user fixes the bad line and clicks Add again, they are added a second time (`TipsLadderCard.tsx:113-119`). | [P] 3 rungs instead of 2. |
| M15 | **`removePersonB` leaves rungs owned by B behind** (`usePlanStore.ts:102`). With the ladder carved out (default), the rung is silently dropped but stays in the key; the owner select shows A while B is stored, and picking A fires no change. With the ladder on top, it moves silently into A's RMD base. | [P] ×3 |
| M16 | **Projections tooltips show nominal dollars while the cells show today's dollars** (Giving, RMD, QCD, HSA, Ladder Bal., Maturity tooltips: `Projections.tsx:65,75,132-150`). | [R] Cell $25,000, tooltip "$37,113 paid from your IRA as a QCD". |

## Low

**Engine**
- **HSA tax totals:** the 20% HSA penalty is left out of `fedTax` and lifetime and min-tax totals (`recommender.ts:22`).
- **HSA limit:** the limit is not rounded to $50. The warning labels it with `new Date().getFullYear()`, so the label is wrong from 2027.
- **Scenario:** the "Lower Returns (4%)" scenario (`scenario.ts:100`) leaves an explicit `hsaReturn` unchanged.
- **TIPS CSV:** it accepts years from 1900 (`tipsCsv.ts:67`) while the schema minimum is 1990. Export then import of such a plan fails Zod. [×2]
- **Builder rungs that can't be bought:**
  - A current-year first rung, which earns a free year of CPI plus coupon.
  - Years with no TIPS issued (e.g. 2037-39).
  - Years past the longest maturity.
- **Copy uses the wrong person:**
  - `tipsWarnings` quotes A's ages for B's unmet RMD.
  - The QCD card and insight quote A's age when B is the giver (`qcdBenefit.ts:60,82`; `rules/qcd.ts:27`).
- **`qcdBenefit.taxableSsOf`** leaves TIPS and HSA income in, so `lowersTaxableSS` can flip.

**UI**
- **Category tag:** choosing General writes `category:'general'`, which marks the result out of date (`InputsPage.tsx:723`). [×2]
- **Keystroke commits:** maturity year and coupon are saved on every keystroke before validation (2, 20, 203…; coupon 0.25 > schema max) until blur.
- **Medical hint:** "Your HSA can pay this tax-free" shows even with no HSA (`InputsPage.tsx:746`).
- **"Stays invested" figure:** the pre-tax tile pools both people, which is wrong when one is over-subscribed (`TipsLadderCard.tsx:236`). [×2]
- **Raw formatting:** `TaxAdjustedBreakdown` uses raw `.toFixed(0)`; `builderBlocker`, `tipsValidation` and `hsaWarnings` use `toLocaleString` instead of `lib/format`.
- **Monte Carlo compare:** `compareLadder` has no catch, so a worker error becomes an unhandled rejection.
- **Modals:**
  - The builder modal has no `aria-modal`, focus trap or focus restore.
  - Clicking the backdrop (or a drag that ends outside) discards the inputs.
  - The HSA and rung inputs have no labels.
- **Tooltip width:** long tooltips use `nowrap` and run off-screen (RMD Unmet, about 300 characters).

**Uncommitted**
- **Builder shortfall text:** `fmtK(-after)` shows "short by $0K" (`TipsBuilderModal.tsx:151`).
- **Stale docblock:** `TipsLadderCard.tsx:11` still says "+ Add TIPS ladder".
- **Release entry:** the edit to `releases.ts` 2.3.0 is fine only because 2.3.0 hasn't shipped.

## Model limitations (decide: document or fix)

**HSA**
- **Receipts at death:** min(HSA, receipts) is treated as tax-free at the end of the plan. For a non-spouse heir the whole balance is taxable (§223(f)(8)(B)); receipts help only if reimbursed before death. The heir pays it all in one year, so the flat `taxAdjOrdRate` (D5) understates the tax.
- **Medicare proration:** none. A late claimer gets a full contribution in the 6-month Part A lookback year (overstated); the 65 year gets none (conservative).

**TIPS**
- **Excess deflation:** it is dropped rather than deducted (§1.1275-7(f)), which overstates tax up to 3× on deflation paths (historical Monte Carlo only, conservative). Test R10e asserts this behavior.
- **Unmet RMDs:** clamped, never taxed, no 25% excise. This understates tax (deferred, not avoided).
- **Purchase cost:** `adjustedPrincipal` serves as both purchase cost and maturity value. Secondary-market bonds bought at a discount or premium are carved out at the wrong amount.
- **Builder rungs inside an IRA or Roth:** their payments go back into the account. Under `taxfirst` they can simply be reinvested, which defeats the bridge.
- **Year-0 and phantom income:** year 0 accrues a full year from Jan 1 on top of the year-end index convention (P3-3). Phantom income in working years is a permanent exclusion, not a deferral (P3-2).

**QCD**
- **No itemizing:** "tax saved by QCD" is overstated for donors well above the standard deduction.
- **Inherited IRAs** are excluded (D3; documented, conservative).
- **The 70½ year** gets full-year eligibility; legally only gifts after the half-birthday qualify.
- **401(k) money:** still-working 70+ owners' 401(k) money counts as QCD-able.

**Copy that overstates the law**
- **"From 70½ … counts toward your required withdrawal":** RMDs start at 73/75.
- **"Private foundations don't qualify":** private operating foundations do.
- **TIPS_HELP's deflation sentence:** it states the tool's simplification as if it were law.

## Test-quality gaps
- **Flaky QCD fuzz property** (`__fuzz__/fuzz.test.ts:91-113`): "QCD never raises lifetime tax" is false (a beyond-RMD QCD raises later capital-gains tax while increasing wealth), and it has no fixed seed. About 0.8% of QCD plans fail, roughly a 5% chance per CI run. This is the "known random QCD fuzz" failure logged at H-5 and TU-5. Fix the seed and assert an after-tax measure instead.
- **Golden planQ barely exercises the feature:** the charity deduction is always 0, there is no QCD beyond the RMD, the limit never binds, there are no QCD/deduction columns, and planQ is not in the bit-exact harness. The "Single-filer deduction" guard never sees a nonzero deduction.
- **HSA deduction tests** use only a Roth-funded plan with pension income above the contribution, the one shape where H1 can't show.
- **Tests asserting wrong behavior:**
  - `hsa.retirement.test.ts:52` (IL state tax unchanged).
  - `hsaBenefit.test.ts:74-81`.
  - planR `.hsa.csv` ACA columns.
  - `tips.risks.test.ts:197` (over-taxation on deflation).
- **Tests that don't check what their names claim:**
  - `tips.projection.test.ts:51` never asserts the basis, and its fixture never reaches the floor.
  - "only A eligible … B's IRA untouched" asserts only invariants.
  - `tipsBuilder.test.ts` checks the sleeve rather than the funding account.
- **Missing tests:**
  - Mixed family+self HSA coverage.
  - An under-65 owner paying IRMAA.
  - A retiree contribution in a depletion year.
  - A matured on-top rung.
  - Face value above principal.
  - Carve-out above basis.
  - removePersonB with B-owned rungs.
  - Sankey with a shortfall plus giving.
  - The HSA+TIPS combination in fuzz.
- **Harness issues:**
  - `runAndCompareHsa`/`Tips` silently create a missing CSV.
  - The Trad OVERDRAW invariant leaves `lumpSumInjectTrad` out of the "available" side (false alarm in the injection year).

## Verified correct (summary)
- **No-feature plans** are bit-identical. Every `rmdAmt` site is classified correctly; QCD money is never double-counted or double-funded (year-0 change in end total = change in total tax, to the cent).
- **QCD eligibility and limits:** the 70½ month rule, the $111k limit and the OBBBA $1k/$2k (2026+, unindexed, DAF excluded, below the line) are right.
- **HSA:** limits are correct for 2026, and contributions stop at Medicare. Last-resort draws run in the right order and the penalty applies only under 65. The spousal merge is correct, and ACA premiums are never paid from the HSA.
- **TIPS income and state tax:** ladder income is in every federal measure (provisional income, ordinary income, MAGI, NIIT, ACA, IRMAA) and in no state measure. IRA and Roth rung cash reaches the right owner.
- **TIPS RMDs and survivors:** the RMD base and survivor transfer are correct.
- **Builder:** the bootstrap math is right, and its cost equals the carve-out.
- **Monte Carlo:** runs use sampled CPI. The with/without comparison is apples to apples (same seed, model and equity share).
- **Persistence:** every fact edit changes the key, migrations are true no-ops, the stores write defaults as absent (except M13 and the Category tag under Low), and nothing was weakened in the invariants or snapshots.
- **Optimizer:** the objective equals the projection's `endTaxAdjustedReal`.

## Suggested order
**Status (2026-10-21):** steps 1-7 are done; step 8 is listed below for decision. e2e 25/25 at every UI step. N1 (§86 provisional income without realized gains, found after the audit) fixed in 22c977c with the user's approval to regenerate goldens A, B, D, G, H, I, K, M, S, bit-exact and the optimizer snapshot. Step 5 (UI) in 29288f6: M13, M14, M16, the Category tag, keystroke commits, plus the medical hint gate (M5 part), tooltip width, and NumberInput clamps that six scaled fields gave in display units. M9 in 8855804. Step 6 (copy) in 8fe3eaa: M5 template split, M10 (the cash run keeps the QCD run's conversions; 'fewer conversions' only when the optimizer sizes them), the giver's age, B's ages for B's unmet RMD, and the RMD/foundation/deflation/70½ wording. Step 7 (tests) in 51f1d07: fixed-seed QCD fuzz on an identity that holds, golden planT with .qcd.csv sidecars for Q and T, missing golden files fail, OVERDRAW counts injections, tightened tests, HSA+TIPS fuzz. Lows in 8f7b009, except the $50 HSA limit rounding (moves planR) and input labels. Steps 1-4 (e085092): Step 3: TIPS gain the basis didn't cover is realized as capital gain as the rungs mature (new `tipsGain` row field, plus an info note); the matured-rung advice now differs for on-top ladders; face value is capped at 1.25x principal and flagged above 1.05x; the CSV rejects years before 1990; removing Person B drops B's pre-tax rungs. Step 4: the clock is pinned at module load in the golden test and in 27 other date-sensitive test files, and the whole fast tier passes with the clock at 2027-03-01. Step 2 also covers H1a: the HSA card now reports the years the contribution lowers ACA income and the net premium effect. The audit found the HU-7 cause was the deduction clamp, not the funding withdrawals; in planR the brokerage now runs out a year sooner, so a later pre-tax year crosses the ACA cliff. planR's two CSVs were regenerated, and the v38 migration and freshness tests compare planR's numbers with the current engine.

1. **Before committing the working tree:**
   - Fix H2 (Sankey gap split plus a shortfall+DAF fixture).
   - Fix the small uncommitted items: the "$0K" shortfall text and the stale docblock.
2. **Engine fixes that change only feature plans** (planR's CSV gets deliberately regenerated, which is acceptable because it is new in this release): H1 (+H1a copy and tests), M1, M2, M3, M4.
3. **TIPS data safety:** M6, M7, M8, the CSV year bound, M15.
4. **H3:** pin the date in the golden tests before 2027-01-01.
5. **UI:** M13, M14, M16, the Category tag, keystroke commits.
6. **Copy:** H1a, M5 template split, M10, the 70½/RMD wording.
7. **Test fixes:** the QCD fuzz seed and property, a planQ `.qcd.csv`, the missing-case tests.
8. **Decide on the model limitations:** document each or move it to the Phase 5 backlog. M11 and M12 need a design decision.
   - **Also for decision (found in step 7):** in an inherited account's injection year the tracked inherited balance earns a year of growth that the account itself does not (300k x 1.065 - 29k tracked vs 300k - 29k in the account), so "inherited > account" fires when the owner's own account is empty. Related to M12.
   - **Done (2026-10-21):**
     - **M11:** per-person running offset of spousal traditional contributions made from 70½ (`qcdOffsetOn`, hoisted; plans without one bit-identical); the taxed part is the new `qcdTaxable` row field, added to income via `rmdIncome`. Working-year contributions are treated as 401(k)-type and don't count. Surfaced in the QCD decision note, the Projections QCD/RMD tooltips and the Taxes QCD card. Tests: `qcd.antiAbuse.test.ts`.
     - **M12 + injection-year growth:** forced distributions from inherited balances already held are reserved in `tradAvail`/`rothAvail` (`maxConv` already excluded the inherited balance); no growth on the tracked balance in its injection year (estimate and depletion step); with inherited money present, conversions split by each spouse's own balance; the tracked balance is capped at its owner's account (excess attributed to the other spouse's draws). New grid `__invariants__/inheritedGrid.test.ts` (360 single and 540 couple plans; before the fix 182 of the couple cases failed). No golden CSV, bit-exact row or optimizer snapshot moved; the `richPlan` upgrade baseline is listed in `engineChanges.ts`.
     - **Documented in the Learn-more topics:** Medicare proration (HSA), unmet RMDs untaxed with no excise, purchase cost, IRA/Roth rungs, year-0 and phantom income (TIPS), the itemizing caveat (QCD help and card). Already documented: excess deflation, the 70½ year, inherited IRAs, 401(k) money.
     - **Open:** HSA receipts at death (user question pending).
