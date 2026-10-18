# QCD, HSA, TIPS ladder: phased build plan and tracker

## Context
`hsa-tips-qcd-analysis.md` (2026-10-05) scoped three features: Qualified Charitable Distributions, an owned HSA, and a TIPS ladder. This plan turns it into phased, session-sized activities that cover the engine, tests, UI, docs and release gates. The main constraint is **zero regressions**: when a plan doesn't use a feature, its projection, optimizer result and saved-result status must not change.

**Corrections to the analysis (the code has moved since it was written):**
- The store is at **v35**, not v32. Features therefore take **v36 (QCD), v37 (HSA), v38 (TIPS)**. The app is at 2.2.3, so the releases are 2.3.0, 2.4.0, 2.5.0 and 2.6.0 (builder).
- Golden plans A–P already exist. Only A–M have CSVs; N/O/P are optimizer fixtures. New goldens start at **Q**: `planQ_qcdGiver`, `planR_hsaEarlyRetiree`, `planS_tipsLadder`.
- There are 19 balance consumers, not 27: 14 read rows directly and 5 read aggregates. `sankeyFlows.ts` reads flows only. More UI reads `row.rmd` as cash and must split out QCD: `CashFlowsBalanced`, `sankeyFlows`, `IncomeSourcesArea`, `RothVsRmd`, `Projections`.
- **Every push to `main` deploys** (`deploy-pages.yml`, `deploy-firebase.yml`). Work is committed directly on local `main` (no feature branches). Push `main` only after a release gate passes, and only when you intend to deploy.
- `optimizerKey` drops undefined values. A new `.default()` field, or a migration that writes a default, would change the key of every saved plan and mark its optimizer result stale. **All new fields are `.optional()` and migrations are true no-ops.**
- The golden harness tolerance is ±$2, which is too loose to prove "unchanged". A bit-exact snapshot is added first (P0-4).
- The projection uses `new Date().getFullYear()`. Calendar-dependent tests (QCD age, OBBBA from 2026, `maturityYear`) must use `vi.setSystemTime` or DOBs relative to the current year.

## Tracker
**How to update it** (part of every activity's definition of done):
1. When you start an activity, set its Status to ◐ and fill in the date.
2. When you finish:
   - set Status to ☑
   - add the commit hash
   - add a one-line note: deviations, follow-ups, test counts
   - tick its checkbox in the phase section below
   - add a line to the Session log
3. Commit the tracker change together with the activity's code (same commit). A commit can't contain its own hash, so fill it in with the next commit's tracker edit.
4. Use ⊘ for skipped or blocked work, with the reason in Notes. Never delete a row.

Legend: ☐ not started · ◐ in progress · ☑ done · ⊘ skipped/blocked

### Rollup
| Phase | Release / store | Activities | Done | Status |
|---|---|---|---|---|
| 0 Setup | none (tests + no-op refactor) | 6 | 6 | ☑ |
| 1 Foundation + QCD | 2.3.0 / v36 | 21 | 21 | ☑ |
| 2 HSA | 2.4.0 / v37 | 20 | 20 | ☑ |
| 3 TIPS core | 2.5.0 / v38 | 13 | 8 | ◐ |
| 4 TIPS builder | 2.6.0 / no bump | 4 | 0 | ☐ |
| Housekeeping | none | 2 | 0 | ☐ |

### Activities
| ID | Activity | Status | Date | Commit | Notes |
|---|---|---|---|---|---|
| P0-1 | Copy plan into repo as tracker; mark analysis §6 answered | ☑ | 2026-10-17 | e2cd7ac | Plan copied verbatim; analysis §6 marked answered and linked. |
| P0-2 | Verify IRS constants, cite sources | ☑ | 2026-10-17 | 7b4e8ea | All plan values confirmed, none differ. Flags: HSA catch-up $1,000 is statutory, NOT indexed (H-2 wording corrected: scale only the base limit); OBBBA $1k/$2k NOT indexed; $170(p) statute text not retrievable, rests on secondary sources + absence from Rev. Proc. 2025-32; Reg. 1.1275-7 / Notice 2011-21 not read at source. Added HSA_CATCHUP_AGE, OBBBA first-year consts (unused). |
| P0-3 | Record test and optimizer timing baselines | ☑ | 2026-10-17 | 66d4e4d | Baselines in Session log. pnpm is installed (`~/.npm-global/bin`) but that directory was not on the PATH of the shell these sessions ran in, so the same vitest commands were run via npx (`vitest run --project fast|opt`), which is what the pnpm scripts call. Add `~/.npm-global/bin` to PATH to use pnpm directly. |
| P0-4 | Bit-exact snapshot harness (fast) + optimizer snapshot (opt) | ☑ | 2026-10-17 | d4f8609 | Fast: 27 tests in __regression__/bitExact.test.ts (A-P, samplePlan, CA+payTaxFromBrokerage, 2 seeded MC trials, 1966 cohort, MC/sweep hashes), ~0.5s. Opt: 5 tests in optimizerSnapshot.test.ts (planF/G/P max-end, planP max-spending), ~10s, added to OPT_FILES. Stored as per-row hashes (full values would be ~3MB); BITEXACT_DUMP=dir writes rows for diffing. Proven to catch a 1-ulp change. Gate run found the optimizer cases timing out at vitest's 5s default under parallel load; fixed with explicit 300s timeouts (see gate line). `__regression__/**` added to tsconfig.app.json exclude (uses node: imports, same as `__golden`). |
| P0-5 | Hoist growth-rate consts in projection.ts | ☑ | 2026-10-17 | 4523572 | Pure move, 4 lines + comment; bit-exact snapshot and golden CSVs unchanged. Found pre-existing flake: strategyModel.test.ts 'holds I1-I10' (I4: spending edit must move end balance) fails ~1 in 12 fast runs; reproduced with seed -589645460 on the unmodified projection.ts, so not caused by this change. |
| P0-6 | Save mockups M1–M5 to `ui-mockups/hsa-tips-qcd.html` | ☑ | 2026-10-17 | 1c2b8fe; [PR #2](https://github.com/retireoptimizer/retireoptimizer.github.io/pull/2) | Generated by script from Appendix B (verbatim blocks), links real clarity.css; app loads no web fonts so the page doesn't either. Verified in browser preview: 5 sections render, no console errors, no horizontal overflow. Regenerate from the plan, don't hand-edit. |
| F-1 | Schema: expense `category`, `qcd` | ☑ | 2026-10-17 | 93f7bc9 | Optional fields only, no default, no migration. Fast tier green, bit-exact unchanged. |
| F-2 | `sumExpenseStreams` split (total bit-identical) | ☑ | 2026-10-17 | 69b3387 | sumExpenseStreams returns {total, medical, charitable}; total computed by the same expression and accumulation order. Bit-exact snapshot and fast tier green. |
| F-3 | Row fields `medicalSpend`/`charitableSpend` + invariant | ☑ | 2026-10-17 | 71ca054 | Row fields medicalSpend/charitableSpend (outside the bit-exact whitelist); invariant 7b. Fast tier green. |
| F-4 | [M1] Category select + QCD sub-row + templates | ☑ | 2026-10-17 | 8e47bfb | Category select, QCD sub-row, healthcare->medical, giving template, 9-col grid, mobile min-width 760. Deviation: the M1 medical hint ('Your HSA can pay this tax-free') is NOT shown yet: no HSA exists until Phase 2, so it would be false. Add it in HU-1. Verified in browser: tint, checkbox (untick writes qcd:false, ticking or leaving charitable removes the key), no console errors. |
| F-5 | Foundation tests, sensitivity skip | ☑ | 2026-10-17 | 3ce5543 | New expenseCategory.test.ts (9 tests: tag-neutrality bit-exact on 4 plans, split sums, schema no-default) + skipped sensitivity entry for category/qcd until Q-3. Bit-exact snapshot green. |
| Q-1 | `qcd.ts` eligibility, allocation, limit + unit tests | ☑ | 2026-10-17 | 39efb11 | qcd.ts: qcdEligible, qcdLimit, qcdAvailable, allocateQcd (pure, not yet wired). qcd.test.ts: 18 tests. |
| Q-2 | QCD integration in `runProjection` (A1 table) | ☑ | 2026-10-17 | e44ea9c | Wired per Appendix A1: rmdTaxable/trdForced/forcedA aliases (equal rmdAmt without a QCD), 9 trad-outflow, 14 income, 1 per-person and state-tax uses replaced, rmdAmt kept for lifetimeRMD, row rmd and the unused withdrawal arg. qcdOn hoisted; opts.disableQCD added; sumExpenseStreams gained charitableQcd. Bit-exact snapshot and golden CSVs unchanged. Sanity on planF + 20k charity: lifetime fed tax 3.39M -> 3.14M. |
| Q-3 | OBBBA non-itemizer deduction | ☑ | 2026-10-17 | 996827f | charDed = min(max(0, charitableQcd - qcd), 2000 MFJ / 1000 Single) from 2026, stdDEff at the 11 A1 sites, row charityDeduction (included in stdDeduction); magi/seniorBonus untouched. Deviation: the base is public-charity giving only (rows not marked qcd:false) because §170(p) excludes donor-advised funds, where the plan said all charitable spend. Computed even under disableQCD. Sensitivity skip entry removed; 2 active category/qcd cases added; invariant for the deduction. |
| Q-4 | QCD row fields + invariants | ☑ | 2026-10-17 | e44ea9c (with Q-2) | Built together with Q-2 so every commit stays green: row fields qcd/qcdBeyondRmd and invariants (trad outflow, mass balance, coverage cashIn += qcdBeyondRmd; qcd <= charitable; qcd <= owners x limit). |
| Q-5 | QCD projection tests (R3–R6) | ☑ | 2026-10-17 | 996827f (with Q-3) | qcd.projection.test.ts: 20 tests for R3-R6 (RMD/QCD income split, tax and IRMAA-lookback effects, CA vs IL, beyond-RMD window, conversion cap, oversized convAmt, per-person allocation, limits, DAF, deduction cases incl. survivor halving). Deviation: tradB path identity (R5) is checked via B's rows being identical while A's IRA is empty, since rows don't expose per-person balances. |
| Q-6 | QCD fuzz property | ☑ | 2026-10-17 | 86cbea4 | Generator: optional charitable row (qcd:false sometimes) and start ages 54-75. Property: with conversions off, QCD on never raises lifetime fed+state+IRMAA+NIIT tax beyond 0.5%+$500, and disableQCD is a no-op without charitable rows. Held over 1,500 runs; ~16% of charity plans actually exercise a QCD. Conversions are excluded on purpose: a QCD frees bracket room that a conversion can use. |
| Q-7 | Golden `planQ_qcdGiver` | ☑ | 2026-10-17 | 6523575 | planQ_qcdGiver (NY couple 74/72, 1.2M+0.8M pre-tax, 30k/yr giving): new CSV only, no A-M CSV changed. Guard test asserts QCDs and the Single-filer path really occur. |
| Q-8 | QCD opt-tier tests | ☑ | 2026-10-17 | 863a954 | qcd.optimizer.test.ts (opt tier, ~40s): planG with 20k giving tagged charitable vs general: score at least as good, QCDs actually paid, invariants hold, lifetime conversions no higher; plus a determinism test. FINDING that differs from the plan: pre-70½ conversions are NOT lower with charity (planF 977k vs 915k, planG 10.1k vs 6.5k; the OBBBA deduction on pre-QCD cash gifts opens a little room). Total lifetime conversions ARE lower (planF 2.88M vs 2.99M, planG 19k vs 44k) and the score is +4% (planF) / +4.4% (planG). Test asserts the total, and QU-5's insight copy must say 'fewer conversions overall', not 'before 70½'. |
| QU-1 | [M4-A] Projections QCD columns + RMD tooltip | ☑ | 2026-10-17 | b87da3a | New QCD column group (QCD, Charity ded.) in gold; shown by default only when lifetime QCD > 0 until the user changes columns (then their choice sticks; Reset clears it). RMD tooltip uses the mockup copy (+ a beyond-RMD sentence). Std Deduct column now excludes the charity deduction so the columns sum. Verified in browser. Pre-existing React key warning in this table (fragment in rows.map) left alone. |
| QU-2 | Split QCD out of cash RMD in charts and Sankey | ☑ | 2026-10-17 | 25ebe44 | Shared rmdCashOf() in qcd.ts. CashFlowsBalanced, IncomeSourcesArea, RothVsRmd: RMD bar is the cash part, new pale-gold 'QCDs' series only when a QCD exists. Sankey: new 'QCD · Pre-tax' source pinned to a new 'Charity (QCD)' use, Net Spending excludes it, taxable-SS back-out uses the cash RMD. 4 new sankey tests; ledger balances for all golden plans incl. Q. Chart verified in browser. Not changed here: explain-layer RMD readers (bracketCliff, optimizerRationale), handled in QU-5. |
| QU-3 | [M4-B] `qcdBenefit.ts` + Taxes card | ☑ | 2026-10-17 | 5cf93ca | qcdBenefit.ts (compareWithWithoutQCD: same plan with disableQCD, real $; copy builder) + gold info card at the top of Taxes > Federal, memoized, hidden without QCDs. 7 tests. Copy deviations from the mockup, to stay truthful: 'IRMAA surcharges in N years' (not 'tier 1'); each effect is mentioned only if it happened; a neutral title when the saving is under $100. Uses useEnginePlan (not the what-if projection) for both runs. Verified in browser. |
| QU-4 | [M4-C] QCD warnings | ☑ | 2026-10-17 | 69d2bd8 | Two warnings in planWarnings.ts: qcd-no-ira (warn: every owner who would pay the gifts has no IRA and none building) and qcd-optout (new 'info' severity for qcd:false rows, with .plan-warning.info style and an ⓘ icon in the strip). 6 tests. Copy deviates from the mockup to stay accurate: the age isn't quoted ('Charitable giving "X" can't be paid as QCDs because Y's IRA is empty…') since giving can start years before 70½. Not browser-checked (strip markup unchanged apart from the icon). |
| QU-5 | QCD explain notes + insight rule | ☑ | 2026-10-17 | 4172d5e | yearDecisions: rmdAmt renamed rmdTaxable (+ optional rmdGross/qcd/qcdBeyondRmd) and a non-binding 'qcd-rmd' note; headroom display already uses stdDEff (Q-3). bracketCliff and optimizerRationale now read the taxable (cash) RMD via rmdCashOf. New rule qcd.ts ('QCDs cut your required-withdrawal tax', taxes+strategy): only fires when QCDs satisfy RMD dollars; copy says 'fewer Roth conversions are usually needed overall', never 'before 70½' (Q-8 finding). 10 new tests. |
| QU-6 | QCD docs, Learn More, release notes | ☑ | 2026-10-17 | 39ab128 | HowToGuide Expenses: Category table + deduction tip. learnMoreTopics: QCD_HELP, opened from an 'ⓘ Learn more' link in the Taxes card. releases.ts: 2.3.0 entry (package.json version bump deferred to Q-REL). The guide says Medical is a tag with no effect yet. RELEASE_NOTES.md is stale (stops at 2.0.2) and was left alone. Modal verified in browser. |
| QU-7 | QCD E2E + v35 freshness | ☑ | 2026-10-17 | 2eb2d33 | 3 e2e tests (QCD column + Taxes card, QCD checkbox saved, v35 plan with a result opens with no stale banner and unchanged numbers); seedPlan gained a version arg and qcdGiver fixture. Includes the v36 store bump and planMigrationV36.test.ts (41 tests on 18 plans captured on the v35 code at 869e998 via a worktree: key, status and projection bit-identical), so the freshness check is real, not self-referential. |
| Q-REL | v36 migration + release gate | ☑ | 2026-10-17 | b36447b | 2.3.0 / store v36, no-op migration. Gate: cold tsc and eslint clean; test:fast 698 pass; test:opt 72 pass (10 files, 3:41 wall); e2e 18/18; golden CSVs: only planQ_qcdGiver added vs 869e998; bit-exact + optimizer snapshots unchanged; legacy exports import with identical status, key and numbers (new v35-legacy-imports.json). Optimizer timing: first re-time read ~11% over the P0-3 baseline on samplePlan, but a same-session A/B against the Phase 0 end (cdfa26e) shows no slowdown (26.7s vs 25.5s mean, machine noise ~10%). Not pushed (work is on local main, so nothing deployed). Not done: side-by-side mockup pass was done piece by piece in the browser while building, not as a final pass; legacy-export UI import is covered by exact unit tests, not a browser run. |
| H-1 | HSA schema (+ `hsaReturn` registry) | ☑ | 2026-10-17 | 26ab6e6 | Optional fields only, no default, no migration: per-person hsa/hsaContribution/hsaCoverage/hsaContribInRetirement/hsaReceipts, portfolio.hsaPolicy ({ payMedicalFromAge }), assumptions.hsaReturn ('fact' registry entry). 3 schema tests; fast tier 701 pass, bit-exact unchanged. |
| H-2 | `hsa.ts` limits, eligibility + tests | ☑ | 2026-10-17 | e884361 | hsa.ts: hsaLimit (indexed base + unindexed $1,000 catch-up at 55), hsaContribEligible (D6), allocateHsaContribution (shared family pool, A first, own catch-ups), hsaPayAge. Beyond spec: allocateHsaContribution and hsaPayAge. hsa.test.ts: 11 tests. Not wired yet. |
| H-3 | HSA projection core | ☑ | 2026-10-17 | 4870bec | HSA core in runProjection: hsaA/hsaB state gated by hasHSA, working contributions external (never in contribA/B) via allocateHsaContribution, spousal merge, balance update at hsaReturn (follows returnOverrides), endTotal appends HSA, rows begHSA/endHSA/hsaContrib. Retired-person contributions deliberately not wired (H-8). 10 tests; testutil __testutil__/hsaPlans.ts. Bit-exact unchanged; fast tier 722 pass. |
| H-4 | Qualified spending + receipts | ☑ | 2026-10-17 | 43900d5 | Qualified spending: availability per owner (balance after growth + contribution, from the policy age), pre-loop hsaQualEst in spendingGapEst, in-loop hsaQual=min(avail, medical+prevIRMAA) in gap and incomeAvailForTax, final value (medical first, then converged IRMAA) in cashIn and the balance debit (pro-rata split across owners via splitHsaPayment). Receipts: seeded from hsaReceipts, accrue medical not paid by the HSA, rows hsaQualifiedWD/hsaReceiptsBal. 6 new tests (16 in file). Bit-exact unchanged; fast tier green. |
| H-5 | Last-resort draws + penalty | ☑ | 2026-10-17 | b3f4a44 | hsaLastResortDraw (pure, in hsa.ts) used at the top-up loop's old break: unpaid qualified need, receipts, then non-qualified (taxed via PI/ordIncome/state nonExempt in resolveYearTaxes, 20% hsaPenalty for owners under 65, penalty-free owners first). residualOf extended (+HSA cash, - penalty). Rows hsaReimbursed/hsaNonQualWD/hsaPenalty; hsaQualifiedWD includes last-resort qualified. 6 unit + 5 projection tests; deeper depletion fixtures are H-9. One fast-tier run hit the known random QCD fuzz property (Q-6, fuzz.test.ts) once, 4 reruns green; not HSA related (generators have no HSA yet). |
| H-6 | `taxAdjustedValue` extras + seed + breakdown | ☑ | 2026-10-17 | a4994b7 | taxAdjustedValue gains optional 7th arg extras {hsa, hsaReceipts, preTax, clean} appended after the core sum (absent = bit-identical, tested with Object.is). HSA above receipts haircut at taxAdjOrdRate, min(HSA, receipts) Roth-like. Updated: projection endTaxAdjusted (extras only when hasHSA), optimizer max-spending gross-up seed, TaxAdjustedBreakdown (HSA rows only when an HSA exists), decisionTrace ordRate sensitivity exposure, legacy insight (receipts-backed HSA counts as tax-free). 6 new taxAdjusted tests + 1 projection test. Finding: the HSA pays IRMAA at 65+ even with no medical rows (D4), so end-value tests need policy age 120 to isolate the haircut. Optimizer snapshot green. |
| H-7 | HSA invariants | ☑ | 2026-10-17 | aa9078b | assertions.ts: HSA no-overdraw and mass balance (draws vs begHSA*(1+g)+contrib), negative fields, qualified <= medical+IRMAA, penalty <= 20% of non-qual and 0 when all owners 65+, receipts reimbursed <= on file (cross-row), endTotal identity includes endHSA, conservation adds begHSA growth, external contributions (hsaContrib - hsaContribRet) and the penalty as outflow, spending coverage counts HSA cash. Renamed the inherited-HSA local to inheritedHsaCash. Deviation: external contributions are ADDED to conservation inflows rather than skipping those years (stronger check, holds). Added row field hsaContribRet (0 until H-8). hsa.invariants.test.ts: 12 plan cases + a tamper test proving the checks fail; fuzz endTotal identity includes HSA. |
| H-8 | Retirement contributions / ACA MAGI lever | ☑ | 2026-10-17 | bd953f7 | Retiree contributions (D6: retired, election set, age < 65): hsaContribRetA/B from the shared allocator; cash need in spendingGapEst, incomeAvailForTax (-), gap and residualOf; above-the-line deduction subtracted from every PI expression and wrapped (clamped at 0) around every ordinary-income expression (7 estimate sites, in-loop, resolveYearTaxes); NOT in stateTax args. Row hsaContribRet now real; invariants (cash coverage, retiree contribution range / pre-65). hsaWarnings.ts: hsaAcaFloorWarning(plan, rows) fires only when the contribution is what drops ACA income under 100% FPL; wiring it into the warnings strip is HU-4. hsa.retirement.test.ts: 11 tests incl. exact cash identity (Roth draw = contribution - tax/premium saved), ACA premium vs acaNetPremium, IL+CA state tax unchanged. Bit-exact unchanged; fast 770 pass. |
| H-9 | HSA risk tests (R7, R9) | ☑ | 2026-10-17 | d28e3c2 | hsa.risks.test.ts (16 tests). R7: couple on a 240k pension in the IRMAA range spending from taxable; HSA pays medical+IRMAA: residual <$1 in every draw year, gross-up iterations <= baseline (HSA present, policy age 120) + 2 every year, IRMAA actually paid from the HSA in >=3 years. Added test-only ProjectionOptions.stats.grossUpIters (one counter assignment per iteration, no numeric effect). R9: depletion fixtures at 60 and 66: HSA touched only after every other account is empty, order qualified -> receipts -> non-qualified, penalty = 20% of non-qual under 65 and 0 from 65, ranOut age strictly later than without the HSA. Receipts: endTaxAdjusted rises by exactly 22% x min(HSA, receipts). Note: late survivor years legitimately sweep surplus (income > spending), so the residual check is limited to draw years. |
| H-10 | HSA fuzz | ☑ | 2026-10-17 | 7352e01 | __fuzz__/hsa.fuzz.test.ts + arbHsaPlan generator (separate from arbPlan so existing properties keep their samples): optional per-person HSA, policy, hsaReturn, medical row, ACA, 25% cash-poor plans (so last-resort draws occur: of 1,000 plans 810 qualified, 148 last-resort, 26 penalty, 187 retiree contributions). Properties: all dollar-flow invariants incl. HSA conservation; qualified path never adds taxable income (vs policy 120 in the first paying year); absent = zeros = unused policy bit-identical; determinism. Held over 3,000 runs. FINDING (existing engine behavior, not HSA): with ACA modeling on, plans sitting at the 100%-FPL cliff have no gross-up fixed point (premium jumps 0 <-> full benchmark), so a smaller draw can end with more income than a baseline; counterexample seed 1050108452. The income property therefore disables ACA; HSA/ACA behavior is covered in hsa.retirement.test.ts. |
| H-11 | Golden `planR_hsaEarlyRetiree` + MC test | ☑ | 2026-10-17 | dfe22ee | planR_hsaEarlyRetiree (A 55 / B 53 retired, ACA bronze benchmark 17k, family HSA 150k + 22k receipts, retiree contributions of the family limit to 64, medical 9k tagged, default policy, IL, A dies 88 / B 92). New CSVs only: planR_hsaEarlyRetiree.csv plus planR_hsaEarlyRetiree.hsa.csv (the 10-column golden format has no HSA column, so runAndCompareHsa in harness.ts stores contrib/qualified/reimbursed/non-qual/penalty/endHSA/receipts/acaMagi/acaPremium/irmaa; A-M and Q CSVs untouched). Guard test checks the plan really exercises retiree contributions, receipts, qualified payments from 65 and the survivor merge. monteCarlo.hsa.test.ts (4): one parametric trial reproduces HSA0 x prod(1+r) exactly along the sampled path, crash path moves HSA and total, HSA counts in the MC bands, determinism. Deviation: sankeyFlows.test.ts golden loop excludes planR (ledger has no HSA flows yet); HU-2 must remove PENDING_HSA_SANKEY. |
| H-12 | HSA opt-tier tests | ☑ | 2026-10-17 | 0ade0ab | hsa.optimizer.test.ts (opt tier, added to OPT_FILES, ~18s): determinism (raw optimizeStrategy twice on planF+HSA), windows keep the three-bucket shape and key set of the no-HSA run (no HSA share), objective = projection endTaxAdjusted incl. the HSA term (haircut above receipts, receipts untaxed; metric equals REC_GOALS score; scores above the no-HSA plan), max-spending seed/result with a legacy target on planP+HSA. Full opt tier: 75/76 first time; optimizer.isolation.test.ts hit its 180s timeout under the 11-file load (passes alone in 75s), so its timeout was raised to 300s like the P0-4 snapshot tests. |
| HU-1 | [M2] HSA inputs block + policy + return field | ☑ | 2026-10-17 | 65d5667 | components/inputs/HsaBlock.tsx: collapsible per-person HSA block (balance, contribution with live max hint incl. catch-up, over-limit note, Self/Family toggle, receipts, retirement-contribution checkbox only when retiring before 65, 'shared with <spouse>' hint for two family plans) placed before the contribution mix; HsaPolicyRow ('HSA pays medical expenses from age', Always/55-75, shown only when an HSA exists) under both people; 4th HSA column in the returns grid only when an HSA exists (shows the pre-tax rate while hsaReturn is absent); the deferred M1 medical hint under Medical expense rows; What-If return delta moves hsaReturn when it is set (store + WhatIfBar scenario snapshot); usePlanStore.setHsaPolicy. Zero/default values are written as absent (hsa 0, 'self', policy 65 -> key removed) so untouched plans keep their saved shape. Verified in the browser preview: block collapsed by default, store writes, over-limit text, family max 9,750, policy row and HSA return column appear, hint appears, no console errors. |
| HU-2 | [M4-D] HSA palette + charts + Sankey | ☑ | 2026-10-17 | cfe9d2f | Palette: bucketHSA = #2bb3b9 (+ bucketColors.hsa). The mockup teal #2a9d9a FAILED the dataviz validator against Taxable green (all-pairs normal-vision dE 9.9 < 15), so a hue sweep picked #2bb3b9: normal-vision dE 16.1 to green, no CVD pair under 12, adjacent order (.. inherited, HSA) 11.7/19.6. Contrast on the surface is <3:1 like the existing gold, so the legend stays. Applied in PortfolioTrajectory and BucketCompositionStacked (series only when endHSA > 0), CashFlowsBalanced ('HSA payments' in; 'HSA contribution & penalty' out; only when non-zero), Sankey ledger (HSA qualified pinned to a new 'Medical & IRMAA (HSA)' use, HSA reimbursed/withdrawn as a general source, 'Contributed to HSA' and penalty uses; removed the PENDING_HSA_SANKEY exclusion so planR and 3 new HSA plans tie out every year). 3 new sankey tests. BucketCompositionStacked pre-tax color (palette.warning vs navy elsewhere) left as is: the plan says to ask before changing, and no one was available to ask - flagged in the report. Browser: pages render, no new console errors (pre-existing React key warning in Projections remains); the Browser pane was not displayed so no screenshot. |
| HU-3 | [M4-A] HSA Projections columns | ☑ | 2026-10-17 | c530ab6 | New 'HSA' column group (green, header teal): HSA Bal., HSA Contrib, HSA Paid, HSA Reimb., HSA Non-qual, HSA Penalty, Receipts, all opt-in through the chooser and the CSV (not auto-shown, per M4-A), with tooltips (contrib tooltip explains the deduction/ACA effect, paid names the medical bill). Verified in the browser: the chooser lists the group and its 7 columns; no new console errors. |
| HU-4 | [M4-C] HSA warnings | ☑ | 2026-10-17 | e8360d4 | Plan-based (planWarnings.ts): contribution over the limit (mockup wording, catch-up aware), contributing on Medicare (age >= max(65, claim age): 'ignored'), two family-coverage spouses over one shared limit, CA non-conformity notice (only CA + an HSA). Projection-based (hsaWarnings.ts, only computed when the plan has an HSA, memoized in InputsPage): ACA income dropped below 100% FPL by the contribution (from H-8) and early non-medical draws with the 20% penalty. All severity warn (no error). 7 tests in hsa.warnings.test.ts. Verified in the browser strip (Medicare warning shows for a 76-year-old with a contribution). |
| HU-5 | [M4-B] HSA insights | ☑ | 2026-10-17 | e3368d9 | hsaBenefit.ts: computeHsaBenefit (qualified total in today's $, IRMAA part, first paying age; for a retiree contributor a counterfactual re-run with hsaContribInRetirement off gives per-year ACA MAGI lowered and subsidy raised; null without an HSA, skipped entirely when the plan has none) + hsaBenefitCopy (every clause appears only if its number exists). Taxes > Federal card (.insight-card.success, mockup M4-B). explain rule rules/hsa.ts ('Your HSA covers ... medical bills from N', taxes + strategy surfaces). Copy deviation from the mockup: 'Medicare surcharges' (IRMAA) rather than 'premiums', since base Medicare premiums are not modeled (D8). 5 tests; verified card in the browser; fast 816 pass. |
| HU-6 | HSA docs, Learn More, release notes, sensitivity | ☑ | 2026-10-17 | 844baa2 | HowToGuide: new 'Health savings account (HSA)' subsection in Portfolio (6-row field table + last-resort tip), HSA Return row in the returns table, Medical category row rewritten (no longer 'no effect yet'). learnMoreTopics.HSA_HELP (6 sections) opened from 'Learn more about HSAs' in the HSA block and from the Taxes HSA card. releases.ts 2.4.0 entry (package.json version bump is at H-REL). fieldSensitivity: 7 HSA cases (balance, contribution, coverage, receipts [only the after-tax end value moves, so that case asserts endTaxAdjustedReal], retirement election via the ACA fixture, policy age, hsaReturn). Line numbers in the plan (~L505/~L564) were stale; sites found by content. Learn More modal verified in the browser. |
| HU-7 | HSA E2E + v36 freshness | ☑ | 2026-10-17 | dccfd4c | 3 e2e tests: (1) planR seeded: HSA columns hidden until the chooser group is ticked, then 'HSA Bal.' shows a non-zero value; Dashboard Sankey at age 55 shows 'Contributed to HSA' and at 65 'Medical & IRMAA (HSA)'; Taxes shows the HSA card; (2) entering an HSA on Inputs is saved, the payment-policy row appears, policy 70 is saved and the default 65 is stored as absent; (3) a v36 plan with a current result opens with no stale banner and unchanged numbers. Chart.js canvas series can't be read from the DOM, so 'chart series' is covered through the SVG Sankey plus unit tests of the dataset builders' inputs. Includes the v37 store bump (PLAN_STORE_VERSION 37, no-op migration) and planMigrationV37.test.ts: 19 plans captured on the v36 release commit b36447b via a worktree (v36-baselines.json), store migration, export/import, and the 3 legacy exports against v35-legacy-imports.json (v36 reproduced them exactly): keys, statuses and projections bit-identical; no HSA key appears. FINDING fixed in copy: in planR (taxfirst) the retiree contribution does NOT lower ACA MAGI, because the withdrawals that fund it (gains, then pre-tax money) cancel the deduction; the HSA card now says so instead of promising a subsidy (Roth-funded plans still show the lever); Learn More and the guide carry the same caveat. |
| H-REL | v37 migration + release gate | ☑ | 2026-10-17 | ca0dc15 | 2.4.0 / store v37, no-op migration (the bump and planMigrationV37.test.ts landed in HU-7, as QU-7 did for v36). Gate: cold tsc -b --force clean; eslint . clean (fixed 3 unused imports in my test files); test:fast 871 pass / 1 skip (70 files); test:opt 76 pass (11 files, 226s vs 221s at Q-REL); e2e 21/21; golden CSVs vs the pre-Phase-2 commit: only planR_hsaEarlyRetiree.csv and .hsa.csv added (A-M and Q untouched), bit-exact and optimizer snapshots unchanged; legacy exports import with identical status/key/numbers (planMigrationV37.test.ts). Optimizer timing, same-session A/B vs b36447b: first pass samplePlan max-end 24.7s -> 26.6s (+7.5%), max-spending 51.0 -> 54.2s (+6%), planF max-end +6%, planF max-spend -1%, planP -5..-7%; an interleaved rerun of samplePlan max-end (2 rounds x 2 runs) gave v36 mean 28.6s (25.4-33.1) vs v37 27.1s (26.4-29.0), i.e. inside machine noise, no systematic slowdown (no-HSA path adds only a few gated scalars per year). Not pushed (local main only, nothing deployed). Not done: the side-by-side mockup pass was done piece by piece in the browser while building, not as a final pass, and the Browser pane was not displayed so there are no screenshots; Chart.js series are not asserted in e2e. |
| T-1 | TIPS schema + validation | ☑ | 2026-10-18 | 2eba101 | TipsRungSchema (refine: pre-tax rungs need whose A/B; coupon 0-20%, principal > 0) and PortfolioSchema.tipsLadder, all optional, no default, no migration; balancesIncludeLadder optional (absent = true, D10). Deviation: 'maturity >= start year' and 'rungs <= account balance' are NOT Zod refinements; they live in tipsValidation.ts (tipsLadderIssues(portfolio, startYear): matured / owner / overflow, overflow per account and per person for pre-tax) because a calendar-dependent refine would make a saved plan fail to load once a rung matures. The engine will stay safe on any input. 12 tests; fast tier 883 pass. |
| T-2 | `tipsLadder.ts` pure functions + tests | ☑ | 2026-10-18 | 12f6f13 | tipsLadder.ts (pure, not wired yet): rungYear (year-end index convention for every flow: coupon on year-end indexed principal, accrual = principal change, maturity pays max(indexed principal, face) with floorBonus), taxableRungIncome (max(0, coupon+accrual) + floorBonus: deflation offsets only that year's coupon), effectiveOwner, carveOut (capped, no 0/0), resolveTipsLadder (drops matured rungs, scales an over-subscribed account down so no money is created, returns null for the exact no-ladder path), tipsLadderYear (per-year aggregate by account/owner). 29 hand-computed tests; fast tier green. |
| T-3 | TIPS projection integration (A3) | ☑ | 2026-10-18 | 0af86ea | Wired per A3, found by code: carve-out after the opening balances (taxable + its basis floored at 0, each person's IRA, Roth); per-year sleeve tipsLadderYear at the year-end CPI index (idxE uses inflationOverrides, ignores returnOverrides); contribToTrad/contribToRoth gained the sleeve's returns (so every trad/Roth inflow site follows); taxable cash appended to the 4 cash-resource sites (gap est, incomeAvailForTax, gap, cashIn); tipsOrdInc appended to every PI / ordIncome / baseOrdInc expression (7 estimate sites, loop, resolveYearTaxes) and to the NIIT base, NOT to stateTax; RMD base + liquid-clamp with rmdUnmet (qcdAvailable now receives tipsToTrad); endTotal appends the sleeve, endTaxAdjusted extras {preTax, clean} only when hasTips; 13 new row fields. NO_TIPS zero object, so no per-year allocation without a ladder. Bit-exact, optimizer snapshot and all goldens unchanged. tipsPlans.ts fixtures; tips.projection.test.ts 18 tests (neutrality on 7 plans x 4 empty-ladder shapes, hand-computed Roth year-0, carve-outs, phantom income, maturity, RMD base and clamp). Design note: ALL flows of a year use the year-end index and the coupon is on year-end indexed principal. Invariants and Sankey for TIPS follow in T-4 / T-6 (no existing golden has a ladder yet); fast tier 930 pass. |
| T-4 | TIPS invariants | ☑ | 2026-10-18 | af81edc | assertions.ts: IRA/Roth availability and mass balance include tipsToTrad/tipsToRoth; new 2d block (sleeve mass balance beg+accrual+floor = end+maturity, cash split taxable+IRA+Roth = coupons+maturities, negatives, floor <= maturity, ordinary income <= coupons+positive indexation+floor and zero with no taxable rung, RMD clamp bound); endTotal identity adds the sleeve; coverage cashIn += tipsCash; conservation adds begTips + coupon + accrual + floorBonus (sleeve earns no account return); cross-row sleeve continuity. tips.invariants.test.ts: 10 plans (mixed three-account ladder, excluded balances, CA phantom income, all-trad RMD, survivor, RMD clamp, year-0 maturities, over-subscribed, QCD and HSA plans) + tamper tests that each fail with the intended message. Fast tier 943 pass. |
| T-5 | TIPS risk tests (R10) | ☑ | 2026-10-18 | ce3dda9 | tips.risks.test.ts, 16 tests for R10: (a) year-0 endTotal = entered totals grown + each sleeve at CPI+coupon instead of the return (hand-computed, three accounts), carve vs on-top openings; (b) ladder flows identical across calm/crash/boom return paths with CPI fixed, and the sleeve compounds the actual CPI path, plan inflation drives it in deterministic runs; (c) taxable rung: fed tax up, state tax exactly 0 in IL/CA/NY, control: same income as an Other stream IS CA/NY-taxed, NIIT base includes it, IRA rung taxes nothing in year 0; (d) A-owned pre-tax rung stays in B's RMD base after A dies (rmd x divisor = begTraditional + begTips) and counts in each owner's base before; (e) deflation floor: pays par only at maturity, negative indexation offsets only that year's coupon, floor bonus taxed as interest, lower faceValue = no bonus. FINDING (design consequence, not a bug): a rung is held to maturity, so a plan can show a shortfall / unmet RMD while a ladder it cannot sell is still on the balance sheet (planL after the liquid IRA is gone); docs and TU-3 copy must say so. Fast tier 959 pass. |
| T-6 | TIPS fuzz + golden `planS_tipsLadder` | ☑ | 2026-10-18 | 2ee5c10 | Fuzz: arbTipsPlan (separate generator; 1-8 rungs, 25% cash-poor so rungs outgrow accounts and IRAs run dry, 25% survivor with an A-owned pre-tax rung outliving A, 20% balances-exclude-ladder, ACA in about a third) and __fuzz__/tips.fuzz.test.ts, 5 properties: all invariants; invariants on a CPI path with deflation years; absent = empty = matured-only bit-identical; ladder flows identical across return paths; determinism. Each held at FUZZ_RUNS=3000, and 10000 once. Path coverage over 3000 plans (measured with a throwaway script, not kept): live ladder 2999; taxed phantom income 2181; taxable cash 2220; IRA payments 2331; Roth payments 2205; maturities 2555; RMD year with an IRA rung 2376; rung scaled down 1345; balances-exclude 583; rmdUnmet 861; dead owner's rung held by the survivor 618; shortfall while holding the ladder 691; NIIT with ladder income 788; under CPI -2%: deflation floor paid 2149, negative accrual offsetting a coupon 2157. FINDING from fuzz (fixed, engine): a taxable rung's indexation is phantom income with no cash, so in a working year with no cash on hand the gross-up pulled a $1 withdrawal to pay its tax, breaking the pre-retirement 'no withdrawals' invariant. Design decision (conservative, same as portfolio dividends): ladder income is taxed only from the first year someone has retired (tipsTaxed gate); the coupon cash still arrives and is saved; row tipsOrdInc is the taxed amount. Golden planS_tipsLadder (A 60 / B 58, IL, ACA, 6 taxable + 5 A-IRA + 2 B-IRA + 2 Roth rungs, 2027 rung has par below principal, A dies 85 with a 2055 rung outstanding): planS_tipsLadder.csv and .tips.csv (harness runAndCompareTips, 17 columns incl. stateTaxAmt, niit, acaMagi, acaPremium) are the only CSVs created; A-M, Q, R untouched. Guard test checks phantom income, IRA/Roth payments, survivor rung, no unmet RMD. Sankey ledger now carries a 'TIPS - Coupons & maturities' source (taxable cash, taxed by ladder income) and backs ladder income out of taxable SS; sankeyFlows.test.ts sweeps planS plus 2 ladder plans and has 2 new tests. Fast tier 973 pass. |
| T-7 | TIPS opt-tier tests | ☑ | 2026-10-18 | 117144b | tips.optimizer.test.ts (opt tier, added to OPT_FILES, ~30s, 5 tests): determinism (raw optimizeStrategy twice on planF + IRA ladder), the three-bucket window shape and key set of the no-ladder run (no ladder dimension), objective = projection endTaxAdjusted including the sleeve term (pre-tax rungs at the ordinary rate, taxable/Roth rungs untaxed; metric equals REC_GOALS score), max-spending on planP with a taxable+IRA+Roth ladder (ranOut false, legacy target met, within 15% of the same plan with the ladder removed: the carve-out moves money, it does not create it), and rungs on top of the balances raise sustainable spending. optimizer.ts amortizationSeed: opening sleeve (begTips) added to portfolioRealAtRetire; when the balances EXCLUDE the ladder the rungs are added to the blend (earning CPI), the gross-up denominator and the haircut (extras preTax/clean); all gated, bit-identical without a ladder (optimizer snapshot green). Full opt tier: 81 pass (12 files, 209s wall). Fast tier 973 pass. |
| TU-1 | [M3] TIPS ladder card | ☑ | 2026-10-18 |  | components/inputs/TipsLadderCard.tsx on the Portfolio panel after the HSA policy row (mockup M3): only a '+ Add TIPS ladder' link (and a Paste from CSV link) until a rung exists; then the header with rung count and total, the rung table (matures, adj. principal, face/par, coupon, account, whose only for pre-tax), phantom-income note once a taxable rung exists, '+ Add rung', totals by account with '<name>: $X of $Y' per person, the carve-out checkbox, and validation messages (overflow in the red error style, matured/owner as warnings). 'Build a ladder...' is left out (Phase 4). Writes go through usePlanStore.setTipsLadder: an emptied ladder is removed so the saved shape and optimizer key return to the original (tested); balancesIncludeLadder is written only when false; par is written only when it differs from the principal. Pasting: engine/tipsCsv.ts parseTipsCsv (tabs/semicolons/commas, quoted cells, header skipped, coupon as '1.25%', '1.25' or '0.0125', year from any date text, per-line errors; 8 tests). Copy deviation from the mockup: the phantom note adds that the plan counts this income from the first year either of you has retired (the T-6 working-year gate). tipsLadderIssues takes the people's names. TipsLadderCard.test.tsx (10) + tipsLadderStore.test.ts (2). Verified in the browser preview: link -> table, account change shows the owner select, CSV paste adds good rows and reports the bad line, Projections renders with no new console errors (the pre-existing React key warning in Projections remains). Fast tier 993 pass. |
| TU-2 | [M4-D, M4-A] TIPS charts + columns | ☐ | | | |
| TU-3 | TIPS warnings and notes | ☐ | | | |
| TU-4 | TIPS docs, Learn More, release notes | ☐ | | | |
| TU-5 | TIPS E2E + v37 freshness | ☐ | | | |
| T-REL | v38 migration + release gate | ☐ | | | |
| TB-1 | `tipsBuilder.ts` bootstrap + tests | ☐ | | | |
| TB-2 | [M5] Builder modal | ☐ | | | |
| TB-3 | With vs without ladder MC card (optional) | ☐ | | | |
| TB-4 | Builder E2E + release gate | ☐ | | | |
| HK-1 | Update CLAUDE.md | ☐ | | | |
| HK-2 | Mark analysis doc superseded | ☐ | | | |

## Decisions
**Confirmed by the user:**
- Separate releases.
- An expense `category` tag as the shared mechanism.
- QCD v1 includes the OBBBA non-itemizer deduction and the "tax saved by QCD" figure.
- HSA v1 includes contributions in retirement on an ACA plan, and shoebox receipts.
- TIPS v1 is the rung table; the builder comes in a later phase.

**Defaults, taken from the analysis recommendations and the engine review.** Revisit any of these before starting its phase.

| # | Decision | Default |
|---|---|---|
| D1 | QCD on/off | Applies automatically to charitable rows. A per-row `qcd?: boolean` (absent = on) excludes DAF or private-foundation gifts. The counterfactual uses an engine option, `opts.disableQCD`; there is no plan field. |
| D2 | IRA left to charity at death | Not modeled. |
| D3 | QCD source | The person's own traditional balance. The inherited-IRA part is excluded. UI copy assumes 401(k) money has been rolled into an IRA. |
| D4 | HSA policy | `portfolio.hsaPolicy?: { payMedicalFromAge }`. Absent means 65; 0 means always pay. From that age (owner's age) the HSA pays medical-tagged spending plus IRMAA (65+), before the spending gap. Medical paid from other buckets is added to a household **receipts** pool, seeded from `hsaReceipts`. Receipts are reimbursed tax-free only as a last resort, and they make `min(HSA, receipts)` Roth-like in the tax-adjusted value. |
| D5 | Ending HSA haircut | `taxAdjOrdRate` on the HSA above receipts. |
| D6 | HSA contribution stop | Working: contributes while `age < max(65, ssClaimAge)`, with no contribution in the claim year at 65+ (Part A). Retired: contributes while `age < 65` if `hsaContribInRetirement` is set. |
| D7 | CA HSA non-conformity | **Deferred.** Show a plan warning only. A single total-return figure can't separate taxable dividends from unrealized gains. |
| D8 | Engine-computed Medicare base premiums | Not added; adding them would move every golden. |
| D9 | `scaleExpenses` and the What-If spending slider | Still scale all categories. Semantics are unchanged. |
| D10 | TIPS balances | `balancesIncludeLadder` defaults to true. Rung value is carved out directly (taxable basis is reduced by the same amount, floored at 0). Validation error when rungs exceed an account. |
| D11 | IRA-held TIPS | Coupons and maturities go back into the IRA. Rung value counts in the RMD base but is excluded from the conversion cap. If the RMD exceeds the liquid trad balance, it is clamped, `rmdUnmet` is recorded, and a warning is shown. |
| D12 | TIPS precision | Indexed principal, coupon on indexed principal, and a deflation floor at maturity (`faceValue?`, default = adjustedPrincipal). Negative accrual can only offset that year's coupons. |
| D13 | Schema placement | Nested in existing 'fact' subtrees: expense rows get `category` and `qcd`; portfolio gets per-person `hsa*`, `hsaPolicy` and `tipsLadder`. No `SavedPlanSchema.pick` or registry edits are needed, except `assumptions.hsaReturn?`, which needs a `'fact'` entry in `ASSUMPTIONS` (TypeScript enforces this). |

## UI specification (locked before coding — mockups M1–M5)
The goal is one pass per UI activity with no design rework. Every UI activity's done-criterion is "matches its mockup and the rules below". P0-6 saves the mockups to the repo as `ui-mockups/hsa-tips-qcd.html`, built with the real `clarity.css`. The app is light-theme only (`clarity.css` has no dark mode), so only light mode is checked.

**Shared rules**
- Reuse existing classes only. No new design primitives.
  - Panels: `.panel`, `.subsection-label`, `.form-group`, `.input-prefix-wrap`, `.toggle-group`
  - Rows: `.stream-row`, plus full-width sub-rows (`gridColumn: '1 / -1'`, same as the inherited-IRA checkbox at `InputsPage.tsx:651`)
  - Checkboxes: gold `accentColor`
  - Messages: `.helper-text`, `.plan-warning`, `.insight-card`
- **Progressive disclosure.** New inputs appear only when they're relevant, so a plan that doesn't use a feature looks exactly as it does today:
  - The HSA return field appears only when an HSA exists.
  - The HSA block is collapsed when its balance is 0.
  - The retirement-contribution toggle appears only when that person retires before 65.
  - The TIPS card shows only a "+ Add TIPS ladder" link until a rung exists.
  - The QCD checkbox appears only on charitable rows.
  - New chart series, columns and insight cards render only when their value is non-zero.
- Copy style: sentence case, plain words, and "you"/"your", matching the existing helper text. The copy strings in the mockups are final unless you change them.

| Mockup | Surface / file | Spec |
|---|---|---|
| **M1** Expense rows | `InputsPage.tsx` Expenses (~L672). CSS `.expense-row` grid adds one 0.9fr column. | **Category** select after Description: General / Medical / Charitable. Medical rows get a one-line hint. Charitable rows get a full-width checkbox sub-row ("Paid directly to a public charity…", default ticked = `qcd` absent). Mobile `min-width` goes from 680 to 760px. |
| **M2** HSA | `PortfolioPersonSection` (~L1014), after the contribution fields and before the contribution mix. Returns grid (~L723) goes from 3 to 4 columns. A household row sits after Person B. | Bordered collapsible "Health savings account (HSA)" block: balance, annual contribution (live max hint, including catch-up), Self/Family toggle, unreimbursed receipts, the retirement-contribution checkbox. A household "HSA pays medical expenses from age" select (Always, 55–75, default 65) with an explanation line. |
| **M3** TIPS ladder | New `TipsLadderCard` component under the per-person sections in Portfolio. | Header with rung count and total, "Paste from CSV", and "Build a ladder…" (shown in phase 4). Rung table: matures, adj. principal, face, coupon, account, whose (whose is shown only for pre-tax). Inline phantom-income note on taxable rungs. Totals by account ("of Alex's $779,000"). The carve-out checkbox. An inline error when rungs exceed an account. |
| **M4-A** Projections | `Projections.tsx` COLUMNS | New groups: QCD (gold), HSA (green), TIPS (violet). QCD is visible by default only when lifetime QCD > 0. The rest are opt-in through the existing column chooser. The RMD tooltip text is as in the mockup. |
| **M4-B** Taxes cards | `TaxPlanning.tsx` insight area (~L97) | A QCD savings card (`.insight-card.info`) and an HSA card (`.insight-card.success`), with the copy templates in the mockup. |
| **M4-C** Warnings | `planWarnings.ts`, shown in the existing strip | Message templates exactly as in the mockup. Severity: warn, except a TIPS balance overflow, which is an error. |
| **M4-D** Charts | `charts/setup.ts` palette; `PortfolioTrajectory`, `BucketCompositionStacked`, `CashFlowSankey` | HSA gets a new solid color: teal `#2a9d9a`, a placeholder until it's validated with the **dataviz** skill. TIPS is a hatched pattern in its account's color (no 5th solid color). New Sankey links: Pre-tax → Charity (QCD), HSA → Medical, TIPS → Cash. |
| **M5** Builder | New `TipsBuilderModal` (phase 4), using the existing modal pattern from `LearnMoreModal`/`TaxAdjustedBreakdown` | Inputs: income per year (today's $), from and through age, real yield, funding account. Preview table, cost today, before → after balance of the funding account. Primary button "Add N rungs to ladder". |

**UI decision to confirm during HU-2:** `BucketCompositionStacked` draws pre-tax in `palette.warning`, while other charts use navy. Align it to navy in the same release? The default is to leave it as is unless you approve.

## Regression guardrails (every activity)
1. **FP-exact neutrality.** New quantities are written as `flag ? compute() : 0` or as an alias of the existing variable (`rmdTaxable = qcd > 0 ? … : rmdAmt`). Only append `± term` to existing left-associative sums. Never regroup a sum or add an unconditional `Math.max`, `Math.min` or division around existing values. Known hazards:
   - basis carve-out 0/0
   - `ratioA` (projection.ts:856) denominator
   - caps that default to 0 instead of Infinity
   - the L956 resolve trigger
   - the gross-up break test (L767-773)
   - L1076 inflation update (leave it untouched)
2. **Hot-path guards.** Hoist `qcdOn`, `hasHSA` and `hasTips` once per `runProjection`. Allocate nothing per year when they're false.
3. **Optional schema, no-op migrations, a version bump per release.**
4. **Bit-exact snapshot (P0-4) must pass at every commit.** New row fields go outside its key whitelist.
5. **Upgrade-freshness test per release.** A v(N-1) plan with a fresh result stays `fresh` and `savedOptimizerKey` is unchanged. Follow the `planMigrationV35.test.ts` pattern.
6. **Never run `UPDATE_GOLDENS=1` for A–M.** Only the new plan's CSV may be created.

## Release gate (before each release)
- [ ] `tsc -b --force` and `pnpm lint`
- [ ] `pnpm test:fast`: bit-exact snapshot green, no golden CSV diff except the new plan
- [ ] `pnpm test:opt`: optimizer snapshot for planF/G/P unchanged
- [ ] `pnpm test:e2e` (dev server running)
- [ ] Optimizer timing within about 5% of the P0-3 baseline
- [ ] Browser pass: the new UI compared side by side with its mockup (M1–M5), plus an imported legacy export (`src/engine/__fixtures__/exports/*.json`) with no stale banner and unchanged headline numbers
- [ ] `src/releases.ts`, `package.json` version, HowToGuide and CLAUDE.md updated where touched
- [ ] Push `main` only when the gate passes (a push deploys); CI must be green

---

## Phase 0: Setup (½–1 session)
- [x] **P0-1** Copy this plan into the repo as `hsa-tips-qcd-plan.md` and use it as the tracker. Mark analysis §6 as answered and link to this plan. Commit it on `main`.
- [x] **P0-2** Verify constants against IRS sources and cite them in `taxConstants.ts` comments:
  - QCD limit 2026: $111,000
  - HSA limits: $4,400 / $8,750, catch-up $1,000
  - OBBBA non-itemizer deduction $1k / $2k: start year, and whether it is indexed
  - Bronze/catastrophic HSA eligibility (Notice 2026-5 or later)
  - TIPS OID rules
- [x] **P0-3** Baselines: record `test:fast` and `test:opt` wall times, and optimizer times for samplePlan, planF and planP, in the session log.
- [x] **P0-4** Bit-exact harness, `src/engine/__regression__/bitExact.test.ts` (fast tier):
  - `JSON.stringify` of a **whitelist of today's `ProjectionRow` keys**, plus all `ProjectionResult` aggregates
  - Plans: golden A–P, samplePlan, one seeded MC trial, one historical cohort, and a CA plan with `payTaxFromBrokerage`
  - Snapshot taken at the base commit, with `vi.setSystemTime` pinned
  - Add an opt-tier companion that snapshots planF/G/P policy windows and score (use `optimizeCached`, placed in an `OPT_FILES` file)
- [x] **P0-6** Save mockups M1–M5 from Appendix B as `ui-mockups/hsa-tips-qcd.html`: one page with an M1–M5 heading over each block, using the fonts and colors from `src/styles/clarity.css`. Open it in the browser preview to confirm it renders. This file is the UI reference for every UI activity.
- [x] **P0-5** Pure const move: hoist `override` and `gRate*Year` (projection.ts:567-570) to just after L447. Snapshot stays green.

## Phase 1: Foundation + QCD → 2.3.0 / store v36
### 1A Expense category (1 session)
- [x] **F-1** Schema: add `category?: 'general'|'medical'|'charitable'` and `qcd?: boolean` to `ExpenseStreamSchema` (`src/schemas/plan.ts:178`).
- [x] **F-2** `sumExpenseStreams` (projection.ts:181) returns `{ total, medical, charitable }`. `total` keeps its accumulation order (`const amt = …; total += amt; if (…) charitable += amt`). At L422, `netSpend = s.total`.
- [x] **F-3** Add row fields `medicalSpend` and `charitableSpend`. Add the invariant medical + charitable ≤ netSpend.
- [x] **F-4** [M1] UI: a Category select on the expense row (`InputsPage.tsx`, header ~L677, row ~L687).
  - It writes only on user change and never back-fills.
  - Charitable rows show a "Paid to a public charity (QCD-eligible)" checkbox plus helper copy.
  - `streamTemplates.ts`: the healthcare template becomes `medical`; add a `giving` template.
- [x] **F-5** Tests: bit-exact stays green, and tags alone change nothing. Add `category` to the `fieldSensitivity.test.ts` skip list until Q-3.

### 1B QCD engine (1–2 sessions)
- [x] **Q-1** New `src/engine/qcd.ts`:
  - `qcdEligible(dob, age)`: true when age ≥ 71, or age 70 with birth month ≤ 6
  - `allocateQcd`: first covers RMDs A then B; the excess goes A then B; each person is capped by the limit and by own available trad excluding inherited
  - Constant `QCD_LIMIT_2026`, scaled by `inflationFactor`
  - `qcd.test.ts`: Jun 30 / Jul 1 DOBs, limit cap, MFJ split, survivor only, empty trad, inherited excluded
- [x] **Q-2** Integrate into `runProjection` following Appendix A1:
  - Derive `qcd`, `rmdTaxable`, `trdForced` and `forcedA/B`.
  - Replace each `rmdAmt` use according to the A1 table.
  - Add `opts.disableQCD`.
  - Charity that QCD doesn't cover stays in `netSpend` and is funded normally.
- [x] **Q-3** OBBBA deduction: `charDed = min(charitable − qcd, MFJ ? 2000 : 1000)` from 2026. `stdDEff` replaces `stdD` at the lines listed in A1; magi and seniorBonus are untouched. Add row field `charityDeduction`; `row.stdDeduction` includes it. Remove `category` from the sensitivity skip list and add QCD and deduction cases.
- [x] **Q-4** Row fields `qcd`, `qcdBeyondRmd`. Invariants (`__invariants__/assertions.ts`):
  - trad outflow `+= qcdBeyondRmd`
  - mass balance
  - coverage cashIn `+= qcdBeyondRmd`
  - qcd ≤ charitable
  - qcd ≤ limit per person
- [x] **Q-5** Projection tests, in a new `qcd.projection.test.ts`. These cover risks R3–R6:
  - RMD 30k with 20k charity: ordIncome includes 10k of RMD and trad is debited 30k
  - fedTax, taxable SS and IRMAA two years later all fall
  - CA/NY state tax falls; IL is unchanged
  - conversion cap shrinks
  - only A eligible: tradB path identical with QCD on and off
  - survivor/Single halves the OBBBA cap
  - deduction is 0 when QCD covers all giving
  - huge `convAmt` policy never overdraws
- [x] **Q-6** Fuzz (`__fuzz__/generators.ts`): an optional charitable stream and older ages. Property: enabling QCD never raises lifetime fed + state + IRMAA under a preset strategy.
- [x] **Q-7** Golden `planQ_qcdGiver`: a 72+ couple with large trad balances, in NY. Create its CSV only.
- [x] **Q-8** Opt tier (cheap fixture, `optimizeCached`): with charity, pre-70½ conversions are ≤ the no-charity run, and results are deterministic.

### 1C QCD UI and reporting (1 session)
- [x] **QU-1** [M4-A] `Projections.tsx` COLUMNS (~L61): add `QCD` and `Charity deduction`. The RMD tooltip shows "of which QCD $X". CSV export picks them up automatically.
- [x] **QU-2** Split cash RMD from QCD in `CashFlowsBalanced`, `IncomeSourcesArea`, `RothVsRmd` and `sankeyFlows` (add a Traditional → Charity link).
- [x] **QU-3** [M4-B] New `src/engine/qcdBenefit.ts`:
  - `compareWithWithoutQCD`: same policy, `disableQCD`, memoized on the main thread like `comparison.ts`
  - The Taxes page card (`TaxPlanning.tsx` ~L97) shows lifetime fed + state + IRMAA + NIIT + ACA saved in real dollars, labeled "same withdrawal plan"
  - The card is hidden when total QCD is 0
- [x] **QU-4** [M4-C] `planWarnings.ts`: charity at 70½+ with empty trad; charity rows marked non-QCD (info). Tests in `planWarnings.test.ts`.
- [x] **QU-5** Explain:
  - `yearDecisions` takes `rmdTaxable` and adds a QCD note
  - headroom display uses `stdDEff`
  - new insight rule in `explain/rules/` ("QCDs cut future RMD tax, so fewer conversions are needed overall"; Q-8 found pre-70½ conversions are not lower, so don't claim that)
- [x] **QU-6** Docs: HowToGuide Expenses (~L453), a `learnMoreTopics.ts` QCD topic, and the `releases.ts` 2.3.0 entry.
- [x] **QU-7** E2E (`e2e/smoke.spec.ts`): a seeded 72-year-old with charity sees a non-zero QCD column and the Taxes card. Seed a v35 plan with a result: no stale banner.
- [x] **Q-REL** No-op migration v36 plus `planMigrationV36.test.ts` (upgrade freshness). Run the **release gate**.

## Phase 2: HSA → 2.4.0 / store v37
### 2A Schema and core engine (2 sessions)
- [x] **H-1** Schema:
  - per person: `hsa?`, `hsaContribution?`, `hsaCoverage?: 'self'|'family'`, `hsaContribInRetirement?`, `hsaReceipts?`
  - `PortfolioSchema.hsaPolicy?` (D4)
  - `AssumptionsSchema.hsaReturn?`, absent = tradReturn, with its registry entry
  - `usePlanStore.addPersonB` unchanged
- [x] **H-2** New `src/engine/hsa.ts`: `hsaLimit` (self / shared family limit indexed by inflation; the $1,000 catch-up at 55+ is statutory and NOT indexed, so add it unscaled), `hsaContribEligible` (D6), constants, and `hsa.test.ts`.
- [x] **H-3** Projection core (A2):
  - `hsaA`/`hsaB` state; `gRateHsaYear` follows `returnOverrides`
  - working contributions are external (`hsaContribExtA/B`, kept out of `contribA/B`)
  - spousal merge after L432
  - balance update after L861
  - `endTotal` appends HSA
  - rows get `begHSA`, `endHSA`, `hsaContrib`
- [x] **H-4** Qualified spending (D4):
  - pre-loop estimate at L484/L710
  - in-loop `hsaQual = min(avail, medical + prevIRMAA)` reduces the gap
  - final value goes into `cashIn`
  - receipts accrue for medical paid elsewhere
  - rows get `hsaQualifiedWD`, `hsaReceiptsBal`
- [x] **H-5** Last resort in the top-up loop (L1001 break): `hsaDraw` takes, in order:
  1. Unpaid qualified need.
  2. Receipts.
  3. Non-qualified money: counts in PI, ordIncome and the stateTax nonExempt arg, plus a 20% `hsaPenalty` when the owner is under 65.

  `resolveYearTaxes` and `residualOf` are extended. Rows get `hsaReimbursed`, `hsaNonQualWD`, `hsaPenalty`.
- [x] **H-6** `taxAdjustedValue`: optional 7th argument `extras?: { hsa, hsaReceipts, preTax, clean }`, with its terms appended after the existing sum. Update:
  - the projection call
  - the optimizer seed (`optimizer.ts` ~L866, L879-884)
  - `TaxAdjustedBreakdown` rows
  - `decisionTrace.ts` L150 and `explain/rules/legacy.ts`
  - `taxAdjusted.test.ts`
- [x] **H-7** Invariants:
  - HSA mass balance and no-overdraw
  - `endTotal` identity includes HSA
  - conservation adds `begHSA*(1+r)` and `hsaContribExt`, and `hsaPenalty` as an outflow
  - the skip condition includes `hsaContribExt`
  - rename the inherited-HSA local at assertions ~L165

### 2B Retirement contributions / ACA lever (1 session)
- [x] **H-8** Retired, under 65, `hsaContribInRetirement` set:
  - `hsaContribRet` is a cash need (L484, L716, `residualOf`; and − in L710)
  - it is also an above-the-line deduction subtracted in every PI and ordIncome expression listed in A2, which carries through to magi, surchargeMAGI, ACA MAGI, IRMAA history and the senior bonus
  - it is not in the stateTax args
  - ordIncome effect clamped at 0

  Tests: the ACA premium falls by the expected subsidy change; IL vs CA state tax is unchanged; a warning fires when ACA MAGI drops below 100% FPL.

### 2C Tests and goldens (1 session)
- [x] **H-9** Tests for risks R7 and R9:
  - HSA paying IRMAA at 66+: residual under $1 and gross-up iterations ≤ baseline + 2
  - depletion fixtures at 60 and 66: draw order correct, penalty only under 65, `ranOut` delayed
  - receipts make that slice Roth-like in `endTaxAdjusted`
- [x] **H-10** Fuzz: optional HSA and medical streams. Properties: HSA conservation; the qualified path never adds taxable income; absent equals zero.
- [x] **H-11** Golden `planR_hsaEarlyRetiree` (55, ACA bronze, $150k HSA, contributions in retirement, receipts). MC test: the HSA follows the return path.
- [x] **H-12** Opt tier: deterministic results; the 3-bucket windows are unchanged in shape; the objective includes the haircut HSA.

### 2D UI (1–2 sessions)
- [x] **HU-1** [M2] Also add the deferred M1 hint under Medical expense rows ("Your HSA can pay this tax-free (see Portfolio › HSA)."; deferred from F-4). `PortfolioPersonSection` (`InputsPage.tsx` ~L1014) gets a collapsible HSA block:
  - balance
  - contribution, with a live limit hint
  - coverage
  - "Keep contributing on an HSA-eligible ACA plan until 65" (shown when the person retires before 65)
  - receipts
  - the household "HSA pays medical from age" control

  Also: an HSA rate in the returns grid (~L723), shown only when an HSA exists, and the What-If return delta applied to `hsaReturn` (`useWhatIfStore`).
- [x] **HU-2** [M4-D] Palette: add `bucketHSA` in `charts/setup.ts`, validated with the **dataviz** skill against the existing bucket colors (M4-D). Apply it in:
  - `PortfolioTrajectory`
  - `BucketCompositionStacked`
  - `CashFlowsBalanced`
  - Sankey (HSA → Medical)

  The `BucketCompositionStacked` pre-tax color mismatch (`palette.warning`) is noted; ask before changing it.
- [x] **HU-3** [M4-A] Projections columns: HSA balance, contribution, qualified, reimbursed, non-qualified, penalty, receipts.
- [x] **HU-4** [M4-C] Warnings:
  - contribution over the limit
  - contributing on Medicare
  - a non-qualified draw before 65
  - CA non-conformity notice (D7)
  - ACA MAGI below FPL
- [x] **HU-5** [M4-B] Insights: "HSA covers Medicare premiums from 65"; "Contributing $X lowers ACA MAGI by $X and raises your subsidy by $Y" (counterfactual, like `qcdBenefit.ts`).
- [x] **HU-6** Docs: HowToGuide account types (~L505) and Portfolio (~L564), a Learn More HSA topic, `releases.ts` 2.4.0, and `fieldSensitivity` entries for the HSA fields.
- [x] **HU-7** E2E: enter an HSA and see the column and chart series. A seeded v36 plan with a result stays fresh.
- [x] **H-REL** No-op migration v37 and upgrade-freshness test. Run the **release gate**.

## Phase 3: TIPS core → 2.5.0 / store v38
### 3A Schema and engine (2 sessions)
- [x] **T-1** Schema:
  - `TipsRungSchema { id, maturityYear, adjustedPrincipal, faceValue?, couponRate, account, whose }`
  - refine: traditional rungs require whose A or B
  - `PortfolioSchema.tipsLadder?: { rungs, balancesIncludeLadder }`
  - validation: maturity ≥ start year; rungs ≤ account balance
- [x] **T-2** New `src/engine/tipsLadder.ts` (pure):
  - `carveOut` (direct subtraction, guarded, no 0/0)
  - `rungYear(rung, idxS, idxE, isMaturity)` → `{ begVal, coupon, accrual, payout, floorBonus }`
  - `effectiveOwner(whose, aliveA, aliveB)`
  - `tipsLadder.test.ts`
- [x] **T-3** Projection integration (A3):
  - carve-out after L293
  - per-year sleeve step before L449, using `idxE = inflationFactor*(1 + (inflationOverrides?.[i] ?? inflation))` and ignoring `returnOverrides`
  - **taxable** rungs: cash treated like `distributedCash`; `tipsOrdInc` goes into PI, ordIncome and NII, not state
  - **traditional** rungs: in the RMD base; coupons and maturities flow into trad like a contribution; clamp the RMD to liquid and record `rmdUnmet` (D11)
  - **Roth** rungs: like `contribToRoth`
  - `endTotal` appends the sleeve; `endTraditional` excludes it; rows get `begTips`, `endTipsTaxable/Trad/Roth`, `tipsCoupon`, `tipsAccrual`, `tipsMaturity`, `rmdUnmet`
  - `taxAdjustedValue` extras get `preTax` and `clean`
- [x] **T-4** Invariants: sleeve mass balance; trad availability `+= tipsToTrad`; coverage cashIn `+= tipsCash`; conservation `+= begTips + coupon + accrual + floorBonus`.
- [x] **T-5** Tests for risk R10:
  - year-0 `endTotal` equals the entered totals grown, with no double count
  - with returns varied and CPI fixed, ladder cash flows are identical across paths
  - a taxable rung raises fedTax but not IL/CA/NY state tax
  - an A-owned trad rung stays in B's RMD base after A dies
  - deflation floor at maturity
- [x] **T-6** Fuzz (optional rungs; absent ≡ `{ rungs: [] }`) and golden `planS_tipsLadder` (IL, taxable plus IRA rungs).
- [x] **T-7** Opt tier: determinism; the objective and seed include the sleeve.

### 3B UI (1–2 sessions)
- [x] **TU-1** [M3] Portfolio "TIPS ladder" card:
  - rung table (maturity, principal, face, coupon, account, whose)
  - add/remove and CSV paste
  - totals by account
  - the "balances already include this ladder" toggle
  - validation messages
- [ ] **TU-2** [M4-D, M4-A] Charts: TIPS shown as a hatched sleeve inside its account color. Projections columns: coupon, accrual ("taxable, no cash"), maturity, sleeve balance, RMD unmet.
- [ ] **TU-3** Warnings and notes: phantom income on taxable rungs ("IRA often a better home"); `rmdUnmet`; "the ladder's value shows in Monte Carlo"; an MC hint to raise the equity slider.
- [ ] **TU-4** Docs: a Learn More TIPS topic, HowToGuide, `releases.ts` 2.5.0, `fieldSensitivity` entries.
- [ ] **TU-5** E2E: add rungs, check the columns and the MC page. A v37 plan stays fresh.
- [ ] **T-REL** No-op migration v38 and upgrade-freshness test. Run the **release gate**.

## Phase 4: TIPS builder → 2.6.0 (no store bump)
- [ ] **TB-1** `src/engine/tipsBuilder.ts`: (real income per year, from/to age, real yield, funding account) → rungs plus cost today, using a backward bootstrap so each rung's principal plus later rungs' coupons meets the target. Test against a hand-computed 5-rung case.
- [ ] **TB-2** [M5] Builder modal: a preview of rungs and cost; "Add to ladder" writes the rungs and debits the funding account under carve-out semantics.
- [ ] **TB-3** Optional "with vs without ladder" MC comparison card (success rate, P10 ending balance).
- [ ] **TB-4** E2E, then the **release gate**.

## Phase 5: Deferred backlog
- Itemized deductions and DAF bunching
- IRA charitable beneficiary
- CA HSA non-conformity modeling
- Engine Medicare base premiums
- HSA as an optimizer dimension
- TIPS sizing optimizer
- In-kind RMD from TIPS rungs
- I-bonds, CDs and nominal ladders
- Spending scaling of only 'general' expenses

## Final housekeeping (after 2.5.0)
- [ ] **HK-1** Update CLAUDE.md:
  - golden and migration counts
  - routes are now `/inputs`
  - the new modules `qcd.ts`, `hsa.ts`, `tipsLadder.ts`, `qcdBenefit.ts`
  - the bit-exact harness and the "optional fields only" rule
- [ ] **HK-2** Mark the analysis doc as superseded.

## Verification (per release)
- `tsc -b --force`, `pnpm lint`, `pnpm test:fast`, `pnpm test:opt`, `pnpm test:e2e`.
- `git diff --stat -- src/engine/__golden/*.csv` shows only the new plan's CSV, and the bit-exact snapshot is green.
- The upgrade-freshness test passes on fixtures from the prior version.
- Browser check via `/run` or the preview tools:
  - new inputs, columns, charts and warnings match M1–M5
  - a legacy export imports with no stale banner and unchanged numbers
  - Monte Carlo runs
- Optimizer timing within about 5% of baseline.

## Session log (one line per session)
| Date | Activities | Result / notes |
|---|---|---|
| 2026-10-17 | P0-1 | Branch `chore/phase0` cut from main (869e998). Plan copied into repo; analysis §6 marked answered. |
| 2026-10-17 | P0-2 | Constants verified (Notice 2025-67, Rev. Proc. 2025-19, Notice 2026-5 read from IRS PDFs). No value differs; indexing flags recorded in Notes. Added as unused exports in `taxConstants.ts`. |
| 2026-10-17 | P0-3 | **Baselines at 7b4e8ea** (Apple Silicon Mac, node via npx, `vitest run --project <tier>`): `test:fast` 9.5s vitest duration / 10.7s wall (52 files, 548 pass, 1 skip); `test:opt` 176s vitest duration / 2:57 wall (8 files, 65 tests). `optimizeStrategy(plan, goal, { thorough: false })` wall time, repeats listed: **samplePlan** max-end 21.4, 21.7s; max-spending 46.2s. **planF** max-end 2.5, 2.4, 2.4s; max-spending 5.4, 4.9s. **planP** max-end 1.1, 1.2, 1.0s; max-spending 3.7, 3.6s. Release-gate comparison: run the same loop, accept within about 5% (expect run-to-run noise of a few %). samplePlan is faster than the plan's 37s/80s estimate. |
| 2026-10-17 | P0-4 | Bit-exact harness built at base (no engine change since 869e998). `src/engine/__regression__/`: `snapshotUtil.ts` (69-key ROW_KEYS + RESULT_KEYS whitelists, exact number encoding, `pinDate` = 2026-06-15), `bitExact.test.ts` + `.snap.json` (fast), `optimizerSnapshot.test.ts` + `.snap.json` (opt). Both pass on unchanged code and are deterministic across reruns. Regenerate only with `UPDATE_BITEXACT=1`. |
| 2026-10-17 | P0-5 | `override` and `gRate*Year` hoisted above the RMD block in `projection.ts`. Bit-exact snapshot green, no golden CSV diff, tsc/lint clean. Pre-existing intermittent failure in `strategyModel.test.ts` I4 noted in P0-5 Notes (also fails on unmodified code with seed -589645460). |
| 2026-10-17 | P0-6 | `ui-mockups/hsa-tips-qcd.html` built (M1-M5, real `clarity.css`) and confirmed rendering at `localhost:5173/ui-mockups/hsa-tips-qcd.html`. |
| 2026-10-17 | Gate | `tsc -b --force` clean, `eslint .` clean, `test:fast` 575 pass / 1 skip (53 files), `test:opt` 70 pass (9 files, 3:23 wall vs 2:57 baseline; the extra file and load account for it), no golden CSV diff vs main, optimizer snapshot passes post-hoist. Fixed the snapshot test's default 5s timeout. Phase 0 complete; Phase 1 not started. Opened as [PR #2](https://github.com/retireoptimizer/retireoptimizer.github.io/pull/2) (not merged, awaiting review). |
| 2026-10-17 | Plan fix | H-2 wording corrected: HSA catch-up is not indexed (flagged in P0-2). No code change. |
| 2026-10-17 | Workflow change | By user decision, Phases 1+ are built as commits directly on local `main` (no feature branches, nothing pushed). Phase 0 was fast-forwarded into local `main` (cdfa26e). PR #2 is superseded and to be closed by the user. The release gates still run before each version bump; a push of `main` deploys, so push only after a gate. |
| 2026-10-17 | F-1 | `category?` and `qcd?` added to `ExpenseStreamSchema`. |
| 2026-10-17 | F-2 | `sumExpenseStreams` split; `netSpend = spend.total`. |
| 2026-10-17 | F-3 | `medicalSpend`/`charitableSpend` row fields and invariant 7b (tagged spend <= netSpend). |
| 2026-10-17 | F-4 | Expense Category UI built and browser-verified. Medical hint deferred to HU-1 (see F-4 Notes). |
| 2026-10-17 | F-5 | Foundation tests added. Phase 1A (F-1..F-5) complete. |
| 2026-10-17 | Q-1 | `qcd.ts` + 18 unit tests. Added `qcdLimit` and `qcdAvailable` helpers beyond the spec. |
| 2026-10-17 | Q-2, Q-4 | QCD wired into `runProjection` with its row fields and invariants in one commit (invariants had to move with the engine to keep tests green). Q-3 (OBBBA deduction) is next. |
| 2026-10-17 | Q-3, Q-5 | OBBBA deduction + 20 projection tests. Fast tier 624 pass. |
| 2026-10-17 | Q-6 | QCD fuzz property added; generator now covers charity and older ages. |
| 2026-10-17 | Q-7 | Golden `planQ_qcdGiver` created. |
| 2026-10-17 | Q-8 | QCD optimizer tests added; plan's pre-70½ conversion claim does not hold, total conversions claim does (see Q-8 Notes). Engine part of Phase 1 (Q-1..Q-8) complete. |
| 2026-10-17 | QU-1 | Projections QCD columns + RMD tooltip built and browser-verified. Full opt tier passed after the engine work (10 files / 72 tests, 3:35 wall). |
| 2026-10-17 | QU-2 | QCD split out of cash RMD in 3 charts and the Sankey. |
| 2026-10-17 | QU-3 | `qcdBenefit.ts` and the Taxes card built and browser-verified. |
| 2026-10-17 | QU-4 | QCD warnings (and an `info` severity) added with tests. |
| 2026-10-17 | QU-5 | Explain layer: QCD year note, taxable-RMD readers, new insight rule. |
| 2026-10-17 | QU-6 | QCD docs, Learn More topic and the 2.3.0 release entry written. |
| 2026-10-17 | QU-7 | E2E added and passing; store bumped to v36 (no-op migration) with a captured-baseline freshness test. Release gate next. |
| 2026-10-17 | Q-REL / Gate | v2.3.0 gate run: see Q-REL Notes. Phase 1 (Foundation + QCD) complete on local `main`; not pushed. |
| 2026-10-17 | H-1 | HSA schema fields and registry entry added (Phase 2 started). |
| 2026-10-17 | H-2 | hsa.ts limits, eligibility and household allocation with 11 unit tests. |
| 2026-10-17 | H-3 | HSA balance/growth/contributions/merge wired into runProjection. |
| 2026-10-17 | H-4 | HSA qualified spending and receipts wired in. |
| 2026-10-17 | H-5 | HSA last-resort draws, penalty and tax treatment wired into the top-up loop. |
| 2026-10-17 | H-6 | taxAdjustedValue extras, HSA haircut in end value, optimizer seed, breakdown and explain readers. |
| 2026-10-17 | H-7 | HSA invariants added and exercised on 12 plans, with a tamper test. |
| 2026-10-17 | H-8 | Retiree HSA contributions with the ACA/MAGI deduction, cash need and warning helper. |
| 2026-10-17 | H-9 | R7 convergence and R9 draw-order/penalty tests; stats hook for iteration counts. |
| 2026-10-17 | H-10 | HSA fuzz properties and generator; ACA-cliff oscillation finding recorded. |
| 2026-10-17 | H-11 | Golden planR with HSA CSV extension, Monte Carlo HSA tests. |
| 2026-10-17 | H-12 | HSA opt-tier tests; isolation test timeout raised. |
| 2026-10-17 | HU-1 | HSA inputs block, policy row, return field and Medical hint built and browser-verified. |
| 2026-10-17 | HU-2 | HSA palette validated, series in four charts and the Sankey ledger. |
| 2026-10-17 | HU-3 | Projections HSA column group added. |
| 2026-10-17 | HU-4 | HSA warnings added to the strip. |
| 2026-10-17 | HU-5 | HSA benefit card and insight rule. |
| 2026-10-17 | HU-6 | HSA docs, Learn More topic, 2.4.0 release entry and sensitivity cases. |
| 2026-10-17 | HU-7 | HSA e2e tests, v37 store bump and v36->v37 freshness test. |
| 2026-10-17 | H-REL | v2.4.0 / store v37 release gate passed; Phase 2 (HSA) complete on local main, not pushed. |
| 2026-10-18 | T-1 | TIPS schema (optional, nested in portfolio) and plan-level validation helper. Phase 3 started. |
| 2026-10-18 | T-2 | tipsLadder.ts pure functions with 29 unit tests; not wired into runProjection yet. |
| 2026-10-18 | T-3 | TIPS integrated into runProjection with 13 row fields, neutral when absent (bit-exact green). |
| 2026-10-18 | T-4 | TIPS invariants added and exercised on 10 plans with tamper tests. |
| 2026-10-18 | T-5 | R10 risk tests (16) incl. return independence, state exemption, survivor RMD base and deflation floor. |
| 2026-10-18 | T-6 | TIPS fuzz (5 properties, 3000/10000 runs, coverage measured), golden planS with .tips.csv, Sankey ledger, working-year tax gate. |
| 2026-10-18 | T-7 | TIPS opt-tier tests and the max-spending seed include the sleeve; full opt tier green (81). |
| 2026-10-18 | TU-1 | TIPS ladder card on Portfolio (rung table, CSV paste, totals, carve-out toggle, validation), store action and tests. |

---

## Appendix A: Engine insertion points (projection.ts at commit 869e998)

> **Line numbers below are for 869e998 and are now stale.** Phases 0-1 changed `projection.ts` (the growth-rate consts were hoisted above the RMD block, `sumExpenseStreams` returns `{ total, medical, charitable, charitableQcd }`, and the QCD block adds `rmdTaxable`, `trdForced` and `forcedA`). Find each site by its code, not its line number.

### A1 QCD
- **Compute** after L453, once per person:
  - available = `max(0,(tradP − inheritedInTradP)*(1+gRateTradYear) + cP.trad [+ tipsToTradP])`
  - limit = `QCD_LIMIT_2026*inflationFactor`
- **Aliases** (equal to `rmdAmt` when there is no QCD):
  - `rmdTaxable` = Σ max(0, rmdP − qcdP)
  - `trdForced` = Σ max(rmdP, qcdP)
  - `forcedA/B` = max(rmdP, qcdP)
- **Replacing `rmdAmt`:**

| Lines | Use | Replace with |
|---|---|---|
| 454-455, 1099 | lifetimeRMD, row `rmd` | gross `rmdAmt` (unchanged) |
| 474, 484, 532, 571, 666, 710, 716, 858, 973 | cash / trad-outflow uses | `trdForced` |
| 857 | per-person outflow | `forcedA` |
| 522, 523, 551, 553, 558, 636, 639, 733, 736, 932, 934 | income uses | `rmdTaxable` |
| 763, 948 | stateTax retirement arg | `rmdTaxable` |
| 836 | explain | `rmdTaxable` |
| 722, 993 | withdrawal `rmd:` arg | unchanged (unused) |

- **OBBBA:** compute `charDed`/`stdDEff` after L459. Replace `stdD` with `stdDEff` at L537, 543, 557, 599, 724, 745, 809, 819, 938, 995, 1114. Do not change `magi` or `seniorBonus`.

### A2 HSA
- **State** initialized at L288-293. Death merge after L432. Contributions near L377-394. Balance update after L861. `endTotal` at L1056.
- **Retired contribution:**
  - cash: + at L484, L716 and `residualOf` L975; − inside L710
  - deduction: − in L522, 523, 551, 553, 558, 636, 639, 733, 736, 932, 934
- **Qualified:** estimate at L484/L710; in-loop at L716 with `prevIRMAA`; final value into `cashIn` at L973.
- **Last resort:** replace the break at L1001 with `hsaDraw`, followed by `resolveYearTaxes` and `residualOf` (both extended with `hsaNonQual` and `hsaPenalty`).

### A3 TIPS
- **Carve-out** after L293. **Sleeve step** before L449. **RMD base** at L450-452 adds `tipsTradBegP`.
- **Taxable cash:** like `distributedCash` at L484, 710, 716, 973.
- **`tipsOrdInc`:** in the PI/ordIncome lines and the NIIT NII arg (L755, L944).
- **Trad inflow:** at L474, 532, 571, 666, 857, 858.
- **Roth inflow:** at L475, 667, 861.
- **Do not touch** the `ratioA` denominator (L856) or L1076.

### A4 Top regression risks, and the activity that tests each
| # | Risk | Caught by |
|---|---|---|
| R1 | FP drift when a feature is absent | P0-4 |
| R2 | Migration or defaults mark saved results stale | *-REL freshness tests |
| R3 | QCD both counted as cash and excluded from income | Q-5, Q-6 |
| R4 | QCD beyond RMD (ages 70½–73) overdraws trad | Q-5 |
| R5 | Per-person split still uses `rmdA` | Q-5 |
| R6 | OBBBA deduction misapplied | Q-5 |
| R7 | HSA/IRMAA loop convergence | H-9 |
| R8 | Retired-contribution deduction leaks into state tax, or ACA MAGI drops below FPL | H-8 |
| R9 | Last-resort order or penalty wrong | H-9 |
| R10 | TIPS double count, return leakage, state exemption, survivor RMD | T-5 |

---

## Appendix B: UI mockups M1–M5 (source for P0-6)
These are self-contained HTML fragments with inline styles in the app palette (cream `#faf7f2`, navy `#0d1b2e`, gold `#c9a84c`, gold-pale `#f5e9c8`, success `#1a8a5a`). P0-6 wraps them in one page. Their copy is final; their layout is the target.

<details><summary>M1: Expense rows with Category and the QCD sub-row</summary>

```html
<div style="background:#faf7f2;border-radius:12px;padding:14px;font-family:'DM Sans',system-ui,sans-serif;color:#0d1b2e">
<div style="background:#fff;border:1px solid rgba(13,27,46,0.08);border-radius:12px;overflow:hidden">
<div style="background:#f5e9c8;border-bottom:1px solid rgba(13,27,46,0.18);padding:7px;text-align:center;font-size:13px;font-weight:500;letter-spacing:.6px">CASH FLOW</div>
<div style="padding:12px 14px">
<div style="font-size:12px;font-weight:500;letter-spacing:.5px;border-left:3px solid #c9a84c;padding-left:8px;margin-bottom:6px">EXPENSES</div>
<div style="font-size:11px;color:#7a96b0;margin-bottom:8px">Do not include income taxes, IRMAA surcharges, or ACA premiums. The tool calculates these.</div>
<div style="display:grid;grid-template-columns:1.25fr .9fr .6fr .45fr .8fr .75fr .55fr .45fr 20px;gap:5px;font-size:11px;color:#4a6080;font-weight:500;border-bottom:2px solid rgba(13,27,46,0.08);padding-bottom:4px">
<div>Description</div><div style="background:#f5e9c8;border-radius:4px;padding:0 3px">Category <span style="color:#b8620a">new</span></div><div>Whose</div><div>Start</div><div>Until</div><div>Annual amt</div><div>Infl %</div><div>Surv %</div><div></div></div>
<div style="display:grid;grid-template-columns:1.25fr .9fr .6fr .45fr .8fr .75fr .55fr .45fr 20px;gap:5px;font-size:11px;align-items:center;padding:5px 0">
<div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Core spending</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">General ▾</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Household</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">60</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Life</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$110,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">CPI</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">70</div><div style="color:#7a96b0;text-align:center">×</div></div>
<div style="display:grid;grid-template-columns:1.25fr .9fr .6fr .45fr .8fr .75fr .55fr .45fr 20px;gap:5px;font-size:11px;align-items:center;padding:5px 0">
<div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Healthcare</div><div style="border:1.5px solid #1a8a5a;background:#e8f7f0;color:#0f5c3b;border-radius:5px;padding:3px 5px">Medical ▾</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Household</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">60</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Life</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$14,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">5.5%</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">60</div><div style="color:#7a96b0;text-align:center">×</div></div>
<div style="font-size:11px;color:#4a6080;padding:0 0 5px 4px">Your HSA can pay this tax-free (see Portfolio › HSA).</div>
<div style="display:grid;grid-template-columns:1.25fr .9fr .6fr .45fr .8fr .75fr .55fr .45fr 20px;gap:5px;font-size:11px;align-items:center;padding:5px 0">
<div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Church and charities</div><div style="border:1.5px solid #c9a84c;background:#f5e9c8;color:#6b5418;border-radius:5px;padding:3px 5px">Charitable ▾</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Household</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">60</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Life</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$25,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">CPI</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">100</div><div style="color:#7a96b0;text-align:center">×</div></div>
<div style="font-size:11px;color:#4a6080;padding:0 0 4px 4px;display:flex;gap:6px;align-items:flex-start"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#c9a84c;color:#fff;font-size:9px;line-height:12px;text-align:center;flex-shrink:0;margin-top:1px">✓</span><span>Paid directly to a public charity. From age 70½ this is paid straight from your IRA as a QCD: it counts toward your required withdrawal and isn't taxed. Untick for donor-advised funds or private foundations.</span></div>
<div style="font-size:12px;color:#c9a84c;padding:6px 0">+ Add expense category</div>
</div></div>
<div style="font-size:11px;color:#4a6080;margin-top:8px">Category options: General (default, no change in behavior) · Medical · Charitable. Rows saved before this release show General.</div>
</div>
```
</details>

<details><summary>M2: Portfolio HSA block, household policy, and HSA return field</summary>

```html
<div style="background:#faf7f2;border-radius:12px;padding:14px;font-family:'DM Sans',system-ui,sans-serif;color:#0d1b2e">
<div style="background:#fff;border:1px solid rgba(13,27,46,0.08);border-radius:12px;overflow:hidden">
<div style="background:#f5e9c8;border-bottom:1px solid rgba(13,27,46,0.18);padding:7px;text-align:center;font-size:13px;font-weight:500;letter-spacing:.6px">PORTFOLIO <span style="font-weight:400;font-size:11px;color:#7a96b0;letter-spacing:0">· balances as of Jan 1, 2026</span></div>
<div style="padding:12px 14px">
<div style="font-size:12px;font-weight:500;letter-spacing:.5px;border-left:3px solid #c9a84c;padding-left:8px;margin-bottom:8px">EXPECTED RETURNS</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:11px;margin-bottom:14px">
<div><div style="color:#4a6080;font-weight:500">Taxable</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">5.5 %</div></div>
<div><div style="color:#4a6080;font-weight:500">Pre-tax</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">5.5 %</div></div>
<div><div style="color:#4a6080;font-weight:500">Roth</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">5.5 %</div></div>
<div style="background:#f5e9c8;border-radius:5px;padding:0 3px 3px"><div style="color:#4a6080;font-weight:500">HSA <span style="color:#b8620a">new</span></div><div style="border:1.5px solid rgba(13,27,46,0.22);background:#fff;border-radius:5px;padding:4px 6px">5.5 %</div><div style="color:#7a96b0">Shown only when an HSA exists</div></div>
</div>
<div style="font-size:12px;font-weight:500;letter-spacing:.5px;border-left:3px solid #c9a84c;padding-left:8px;margin-bottom:8px">ALEX <span style="font-weight:400;font-size:11px;color:#7a96b0">· $1.32M</span></div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;margin-bottom:6px">
<div><div style="color:#4a6080;font-weight:500">Taxable</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$271,000</div></div>
<div><div style="color:#4a6080;font-weight:500">Pre-tax</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$779,000</div></div>
<div><div style="color:#4a6080;font-weight:500">Roth</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$441,000</div></div></div>
<div style="font-size:11px;color:#7a96b0;margin-bottom:10px">… annual contribution, contribution mix (unchanged) …</div>
<div style="border:1.5px solid #1a8a5a;border-radius:8px;padding:9px 10px;background:#fbfefc">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:10px;font-weight:500;letter-spacing:1px;color:#0f5c3b">▾ HEALTH SAVINGS ACCOUNT (HSA)</div><div style="font-size:10px;color:#7a96b0">Collapsed by default when the balance is $0</div></div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px">
<div><div style="color:#4a6080;font-weight:500">HSA balance</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$62,000</div></div>
<div><div style="color:#4a6080;font-weight:500">Annual contribution</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$9,750</div><div style="color:#7a96b0">Max $9,750 (family + 55+ catch-up)</div></div>
<div><div style="color:#4a6080;font-weight:500">Coverage</div><div style="display:flex;background:rgba(13,27,46,0.05);border-radius:6px;padding:2px;gap:2px"><div style="flex:1;text-align:center;padding:3px;color:#7a96b0">Self</div><div style="flex:1;text-align:center;padding:3px;background:#fff;border-radius:4px;font-weight:500">Family</div></div></div>
<div><div style="color:#4a6080;font-weight:500">Unreimbursed receipts</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$18,000</div><div style="color:#7a96b0">Past medical bills you paid out of pocket and can still claim tax-free</div></div>
<div style="grid-column:span 2;display:flex;gap:6px;align-items:flex-start;padding-top:14px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#c9a84c;color:#fff;font-size:9px;line-height:12px;text-align:center;flex-shrink:0;margin-top:1px">✓</span><span style="color:#4a6080">Keep contributing after I retire, on an HSA-eligible plan (for example ACA bronze), until 65. Lowers the income used for your ACA subsidy. <span style="color:#7a96b0">Shown only if retiring before 65.</span></span></div>
</div></div>
<div style="font-size:11px;color:#7a96b0;margin:10px 0">… Jordan: same layout …</div>
<div style="border-top:1px solid rgba(13,27,46,0.08);padding-top:10px;display:grid;grid-template-columns:1fr 1.4fr;gap:10px;font-size:11px;align-items:start">
<div><div style="color:#4a6080;font-weight:500">HSA pays medical expenses from age</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">65 ▾ <span style="color:#7a96b0">(Always · 55 … 75)</span></div></div>
<div style="color:#4a6080;padding-top:14px">Before that age, medical bills are paid from your other accounts and logged as receipts, so the HSA keeps growing tax-free. Receipts can be claimed later as tax-free cash.</div>
</div>
</div></div></div>
```
</details>

<details><summary>M3: TIPS ladder card</summary>

```html
<div style="background:#faf7f2;border-radius:12px;padding:14px;font-family:'DM Sans',system-ui,sans-serif;color:#0d1b2e">
<div style="background:#fff;border:1px solid rgba(13,27,46,0.08);border-radius:12px;padding:12px 14px">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
<div style="font-size:12px;font-weight:500;letter-spacing:.5px;border-left:3px solid #c9a84c;padding-left:8px">TIPS LADDER <span style="font-weight:400;font-size:11px;color:#7a96b0">· 5 rungs · $240,000</span></div>
<div style="display:flex;gap:6px;font-size:11px"><span style="border:1px solid rgba(13,27,46,0.18);border-radius:6px;padding:3px 8px;color:#4a6080">Paste from CSV</span><span style="border:1px solid #c9a84c;border-radius:6px;padding:3px 8px;color:#6b5418">Build a ladder… <span style="color:#7a96b0">(phase 4)</span></span></div></div>
<div style="font-size:11px;color:#7a96b0;margin-bottom:8px">Treasury inflation-protected bonds you'll hold to maturity. Each rung pays a fixed real amount in its year, whatever markets do.</div>
<div style="display:grid;grid-template-columns:.7fr 1fr .9fr .7fr 1fr .8fr 20px;gap:5px;font-size:11px;color:#4a6080;font-weight:500;border-bottom:2px solid rgba(13,27,46,0.08);padding-bottom:4px"><div>Matures</div><div>Adj. principal</div><div>Face (par)</div><div>Coupon</div><div>Account</div><div>Whose</div><div></div></div>
<div style="display:grid;grid-template-columns:.7fr 1fr .9fr .7fr 1fr .8fr 20px;gap:5px;font-size:11px;align-items:center;padding:4px 0"><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">2031</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$48,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$45,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">1.25%</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Pre-tax ▾</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Alex ▾</div><div style="color:#7a96b0;text-align:center">×</div></div>
<div style="display:grid;grid-template-columns:.7fr 1fr .9fr .7fr 1fr .8fr 20px;gap:5px;font-size:11px;align-items:center;padding:4px 0"><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">2032</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$48,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$46,500</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">0.625%</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Pre-tax ▾</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">Alex ▾</div><div style="color:#7a96b0;text-align:center">×</div></div>
<div style="display:grid;grid-template-columns:.7fr 1fr .9fr .7fr 1fr .8fr 20px;gap:5px;font-size:11px;align-items:center;padding:4px 0"><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">2033</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$48,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">$48,000</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px">1.75%</div><div style="border:1.5px solid #b8620a;border-radius:5px;padding:3px 5px">Taxable ▾</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:3px 5px;color:#7a96b0">Household</div><div style="color:#7a96b0;text-align:center">×</div></div>
<div style="font-size:11px;color:#7a5c10;background:rgba(201,168,76,0.12);border-radius:5px;padding:4px 7px;margin:2px 0 4px">Taxable rungs owe federal tax each year on the inflation increase even though you get no cash until maturity ("phantom income"). An IRA is often a better home. Exempt from state tax.</div>
<div style="font-size:11px;color:#7a96b0;padding:2px 0 6px">… 2034, 2035 …</div>
<div style="font-size:12px;color:#c9a84c;padding-bottom:8px">+ Add rung</div>
<div style="border-top:1px solid rgba(13,27,46,0.08);padding-top:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px">
<div style="background:#faf7f2;border-radius:6px;padding:6px 8px"><div style="color:#7a96b0">In pre-tax</div><div style="font-weight:500;font-size:13px">$144,000</div><div style="color:#7a96b0">of Alex's $779,000</div></div>
<div style="background:#faf7f2;border-radius:6px;padding:6px 8px"><div style="color:#7a96b0">In taxable</div><div style="font-weight:500;font-size:13px">$96,000</div><div style="color:#7a96b0">of $586,000</div></div>
<div style="background:#faf7f2;border-radius:6px;padding:6px 8px"><div style="color:#7a96b0">In Roth</div><div style="font-weight:500;font-size:13px">$0</div></div></div>
<div style="display:flex;gap:6px;align-items:flex-start;font-size:11px;color:#4a6080;margin-top:8px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#c9a84c;color:#fff;font-size:9px;line-height:12px;text-align:center;flex-shrink:0;margin-top:1px">✓</span><span>My account balances above already include these bonds. We'll set the ladder apart from them so nothing is counted twice.</span></div>
<div style="font-size:11px;color:#c0392b;background:rgba(192,57,43,0.1);border-radius:5px;padding:4px 7px;margin-top:6px">Example error: Roth rungs total $60,000 but the Roth balance is $40,000.</div>
</div></div>
```
</details>

<details><summary>M4: Results surfaces (Projections columns, Taxes cards, warnings, chart legend)</summary>

```html
<div style="background:#faf7f2;border-radius:12px;padding:14px;font-family:'DM Sans',system-ui,sans-serif;color:#0d1b2e;font-size:11px">
<div style="font-size:12px;font-weight:500;color:#4a6080;margin-bottom:6px">A. Projections table: new column groups (picked in the existing column chooser, off by default except QCD when used)</div>
<div style="background:#fff;border:1px solid rgba(13,27,46,0.08);border-radius:10px;overflow:hidden;margin-bottom:14px">
<div style="display:grid;grid-template-columns:.45fr .8fr .7fr .75fr .8fr .8fr .8fr .8fr;font-weight:500;color:#4a6080"><div style="padding:5px">Age</div><div style="padding:5px;background:#eef2f7">RMD</div><div style="padding:5px;background:#f5e9c8">QCD</div><div style="padding:5px;background:#f5e9c8">Charity ded.</div><div style="padding:5px;background:#e8f7f0">HSA paid</div><div style="padding:5px;background:#e8f7f0">HSA bal.</div><div style="padding:5px;background:#efeaf6">TIPS cash</div><div style="padding:5px;background:#efeaf6">TIPS accrual</div></div>
<div style="display:grid;grid-template-columns:.45fr .8fr .7fr .75fr .8fr .8fr .8fr .8fr;border-top:1px solid rgba(13,27,46,0.06)"><div style="padding:5px">72</div><div style="padding:5px">$38.2K ⓘ</div><div style="padding:5px">$25.0K</div><div style="padding:5px">$0</div><div style="padding:5px">$8.1K</div><div style="padding:5px">$91.4K</div><div style="padding:5px">$52.7K</div><div style="padding:5px">$1.2K</div></div>
<div style="display:grid;grid-template-columns:.45fr .8fr .7fr .75fr .8fr .8fr .8fr .8fr;border-top:1px solid rgba(13,27,46,0.06)"><div style="padding:5px">73</div><div style="padding:5px">$40.0K</div><div style="padding:5px">$25.6K</div><div style="padding:5px">$0</div><div style="padding:5px">$8.6K</div><div style="padding:5px">$88.9K</div><div style="padding:5px">$53.9K</div><div style="padding:5px">$1.2K</div></div>
<div style="padding:5px 7px;background:#faf7f2;color:#4a6080;border-top:1px solid rgba(13,27,46,0.06)">RMD tooltip: "Required $38.2K. $25.0K went straight to charity as a QCD (not taxed); $13.2K came to you as cash." More HSA columns: contribution, reimbursed, non-qualified, penalty, receipts left. More TIPS columns: maturity, ladder balance, RMD unmet.</div></div>
<div style="font-size:12px;font-weight:500;color:#4a6080;margin-bottom:6px">B. Taxes page: new insight cards (existing .insight-card style)</div>
<div style="background:rgba(201,168,76,0.08);border-left:4px solid #c9a84c;padding:10px 12px;display:flex;gap:10px;margin-bottom:6px"><div style="font-size:16px">◆</div><div><div style="font-weight:500;font-size:12px;margin-bottom:2px">QCDs save you $61,400 in lifetime taxes (today's $)</div><div style="color:#4a6080;line-height:1.5">From age 72, $25,000 a year of your giving goes straight from your IRA to charity. That covers 64% of your required withdrawals, lowers taxable Social Security, and keeps you out of IRMAA tier 1 in 9 years. Same withdrawal plan, compared with paying the same gifts in cash.</div></div></div>
<div style="background:#e8f7f0;border-left:4px solid #1a8a5a;padding:10px 12px;display:flex;gap:10px;margin-bottom:14px"><div style="font-size:16px">✚</div><div><div style="font-weight:500;font-size:12px;margin-bottom:2px">Your HSA covers Medicare premiums and medical bills from 65</div><div style="color:#4a6080;line-height:1.5">$184,000 of medical costs paid tax-free over the plan. Contributing $9,750 a year on a bronze plan before 65 lowers your ACA income by the same amount and raises your subsidy by about $3,100 a year.</div></div></div>
<div style="font-size:12px;font-weight:500;color:#4a6080;margin-bottom:6px">C. Inputs page warnings strip (existing .plan-warning style)</div>
<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px">
<div style="padding:5px 9px;border-radius:6px;background:rgba(201,168,76,0.12);color:#7a5c10">Charitable giving starts at 72 but Jordan's IRA is empty, so no QCD is possible. Gifts will be paid from other accounts.</div>
<div style="padding:5px 9px;border-radius:6px;background:rgba(201,168,76,0.12);color:#7a5c10">Alex's HSA contribution of $11,000 is above the 2026 limit of $9,750. Capped at the limit.</div>
<div style="padding:5px 9px;border-radius:6px;background:rgba(201,168,76,0.12);color:#7a5c10">California doesn't recognize HSAs: state tax on HSA growth isn't modeled.</div>
<div style="padding:5px 9px;border-radius:6px;background:rgba(192,57,43,0.1);color:#c0392b">TIPS rungs in Roth ($60,000) exceed the Roth balance ($40,000).</div></div>
<div style="font-size:12px;font-weight:500;color:#4a6080;margin-bottom:6px">D. Charts: legend after all three releases</div>
<div style="background:#fff;border:1px solid rgba(13,27,46,0.08);border-radius:10px;padding:10px 12px">
<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:8px"><span><span style="display:inline-block;width:10px;height:10px;background:#1a8a5a;border-radius:2px;margin-right:4px"></span>Taxable</span><span><span style="display:inline-block;width:10px;height:10px;background:#0d1b2e;border-radius:2px;margin-right:4px"></span>Pre-tax</span><span><span style="display:inline-block;width:10px;height:10px;background:#c9a84c;border-radius:2px;margin-right:4px"></span>Roth</span><span><span style="display:inline-block;width:10px;height:10px;background:#7b5ea7;border-radius:2px;margin-right:4px"></span>Inherited</span><span><span style="display:inline-block;width:10px;height:10px;background:#2a9d9a;border-radius:2px;margin-right:4px"></span>HSA (new)</span><span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;background:repeating-linear-gradient(45deg,#0d1b2e 0 2px,#fff 2px 4px);border:1px solid #0d1b2e"></span>TIPS, hatched in its account color (new)</span></div>
<div style="display:flex;height:22px;border-radius:4px;overflow:hidden"><div style="flex:20;background:#1a8a5a"></div><div style="flex:6;background:repeating-linear-gradient(45deg,#1a8a5a 0 3px,#fff 3px 6px)"></div><div style="flex:34;background:#0d1b2e"></div><div style="flex:9;background:repeating-linear-gradient(45deg,#0d1b2e 0 3px,#fff 3px 6px)"></div><div style="flex:22;background:#c9a84c"></div><div style="flex:6;background:#2a9d9a"></div></div>
<div style="color:#4a6080;margin-top:8px">Sankey gets new links: Pre-tax → Charity (QCD), HSA → Medical, TIPS → Cash. A new series appears only when its value is non-zero, so existing plans look unchanged. The HSA teal is a placeholder until it's checked with the dataviz palette validator.</div></div>
</div>
```
</details>

<details><summary>M5: TIPS ladder builder modal (phase 4)</summary>

```html
<div style="min-height:420px;background:rgba(13,27,46,0.45);border-radius:12px;display:flex;align-items:center;justify-content:center;padding:18px;font-family:'DM Sans',system-ui,sans-serif;color:#0d1b2e;font-size:11px">
<div style="background:#fff;border-radius:14px;width:100%;max-width:560px;overflow:hidden">
<div style="background:#f5e9c8;padding:8px 14px;display:flex;justify-content:space-between;font-size:13px;font-weight:500;letter-spacing:.6px"><span>BUILD A TIPS LADDER</span><span style="color:#7a96b0">×</span></div>
<div style="padding:12px 14px">
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
<div><div style="color:#4a6080;font-weight:500">Income per year (today's $)</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">$40,000</div></div>
<div><div style="color:#4a6080;font-weight:500">From age</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">62</div></div>
<div><div style="color:#4a6080;font-weight:500">Through age</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">69</div><div style="color:#7a96b0">Bridge to Social Security at 70</div></div>
<div><div style="color:#4a6080;font-weight:500">Real yield</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">1.9 %</div><div style="color:#7a96b0">From TreasuryDirect or your broker</div></div>
<div><div style="color:#4a6080;font-weight:500">Buy with money from</div><div style="border:1.5px solid rgba(13,27,46,0.22);border-radius:5px;padding:4px 6px">Pre-tax · Alex ▾</div></div></div>
<div style="font-size:10px;font-weight:500;letter-spacing:1px;color:#7a96b0;margin:10px 0 4px">PREVIEW</div>
<div style="display:grid;grid-template-columns:.6fr .7fr 1fr 1fr;font-weight:500;color:#4a6080;border-bottom:2px solid rgba(13,27,46,0.08);padding-bottom:3px"><div>Year</div><div>Age</div><div>Rung principal</div><div>Pays (today's $)</div></div>
<div style="display:grid;grid-template-columns:.6fr .7fr 1fr 1fr;padding:3px 0"><div>2038</div><div>62</div><div>$34,600</div><div>$40,000</div></div>
<div style="display:grid;grid-template-columns:.6fr .7fr 1fr 1fr;padding:3px 0"><div>2039</div><div>63</div><div>$35,300</div><div>$40,000</div></div>
<div style="color:#7a96b0;padding:2px 0">… 6 more rungs …</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
<div style="background:#faf7f2;border-radius:6px;padding:6px 8px"><div style="color:#7a96b0">Cost today</div><div style="font-weight:500;font-size:14px">$271,800</div></div>
<div style="background:#faf7f2;border-radius:6px;padding:6px 8px"><div style="color:#7a96b0">Comes out of</div><div style="font-weight:500;font-size:14px">Alex pre-tax: $779K → $507K</div></div></div>
<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><span style="border:1px solid rgba(13,27,46,0.18);border-radius:6px;padding:5px 12px;color:#4a6080">Cancel</span><span style="background:#0d1b2e;color:#fff;border-radius:6px;padding:5px 12px">Add 8 rungs to ladder</span></div>
</div></div></div>
```
</details>
