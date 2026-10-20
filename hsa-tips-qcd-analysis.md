# HSA, TIPS Ladder, and QCD: Gap Analysis and Build Options

Status: **superseded** by [`hsa-tips-qcd-plan.md`](hsa-tips-qcd-plan.md) (the build plan and tracker; shipped as 2.3.0 QCD, 2.4.0 HSA, 2.5.0 TIPS ladder, 2.6.0 TIPS builder). Kept as the original analysis (2026-10-05); where they differ, the plan and the code are authoritative.
Engine baseline: `PLAN_STORE_VERSION = 32`, three household buckets (taxable / traditional per person / roth),
standard deduction only (no itemized), one return series per year applied to all buckets (MC `returnOverrides`).

---

## 0. Executive summary

| Capability | Today | Size | Biggest risk | Recommended order |
|---|---|---|---|---|
| QCD | Not modeled. Charitable giving can only be an untagged expense with zero tax effect. | S-M (1-2 sessions) | RMD / conversion-cap interaction in the gross-up loop | **1st** |
| HSA | Only `inheritedHSA` lump sum (non-spouse beneficiary, full ordinary income in year received). No owned HSA. | M-L (3 sessions) | New 4th bucket touches every balance consumer (27 non-test files read `endRoth`/`endTraditional`) | **2nd** |
| TIPS ladder | Not modeled. Users must fake it as an income stream (phantom-money risk if principal also sits in `taxable`) or leave it inside a bucket earning `taxableReturn`. | L (4 sessions) | Separate return/inflation behavior in Monte Carlo; phantom-income tax; double-count of principal | **3rd** |

Shared prerequisite (do once, used by QCD and HSA): **expense-stream category tagging**
(`category?: 'general' | 'medical' | 'charitable'`). Medical tags let the HSA pay tax-free; charitable tags let QCDs pay.

All three must be **byte-identical when unused**: new fields optional/absent, golden CSVs in `src/engine/__golden/` unchanged.

---

## 1. Shared foundation

### 1.1 Expense category tag
- Schema: `ExpenseStreamSchema.category: z.enum(['general','medical','charitable']).optional()` (absent = general).
- Engine: `sumExpenseStreams` returns `{ total, medical, charitable }` instead of a single number. `netSpend` stays the total so all current consumers are unchanged.
- UI: category select on the expense row (InputsPage). Stream templates (`streamTemplates.ts`) get defaults ("Healthcare" → medical, "Giving" → charitable).
- Engine-computed costs that are also categorizable:
  - IRMAA surcharges and Medicare premiums are **HSA-qualified** (age 65+).
  - ACA marketplace premiums are **not HSA-qualified** (exceptions: COBRA, premiums while on unemployment). Treat `acaPremium` as non-qualified.

### 1.2 ProjectionRow / result additions (all default 0)
`qcd`, `charitableCash`, `begHSA`, `endHSA`, `hsaContrib`, `hsaQualifiedWD`, `hsaNonQualWD`, `begTips`, `endTips`, `tipsCoupon`, `tipsAccrual`, `tipsMaturity`.
`endTotal` includes HSA and TIPS (per the "gross balance everywhere" rule in memory). `endTaxAdjusted` gets haircut terms for each (see §3.6, §4.6).

### 1.3 Blast radius (files touched by any new bucket)
Engine: `projection.ts`, `taxAdjusted.ts`, `comparison.ts`, `recommender.ts`, `optimizer.ts` (objective only), `monteCarlo.ts`, `explain/decisionTrace.ts`, `explain/rules/legacy.ts`, `planWarnings.ts`, `__invariants__/assertions.ts`, `__golden/harness.ts`.
UI: `Projections.tsx`, `Dashboard.tsx`, `TaxAdjustedBreakdown.tsx`, `PortfolioTrajectory.tsx`, `BucketCompositionStacked.tsx`, `CashFlowSankey.tsx`/`sankeyFlows.ts`, `CashFlowsBalanced.tsx`, `InputsPage.tsx`, `HowToGuide.tsx`, `learnMoreTopics.ts`, `releases.ts`.
Store: `planStoreVersion.ts` bump, `planMigrations.ts` (no-op migration; fields are optional).

---

## 2. QCD (Qualified Charitable Distributions)

### 2.1 Rules that matter for the model (2026)
- Eligible from age **70½** on the distribution date. Per-person annual limit **$111,000** (2026; $108k in 2025; indexed). MFJ: each spouse from their own IRA.
- Source: traditional IRA (incl. inherited IRA if beneficiary is 70½; inactive SEP/SIMPLE). **Not** an active 401(k). Engine pools 401k+IRA as "traditional", so assume rollover to IRA (state in UI copy).
- Paid directly to a 501(c)(3) public charity. **Not** a DAF or private foundation.
- **Excluded from gross income** (better than a deduction): lowers AGI, so it lowers SS provisional income, IRMAA MAGI (2-yr lookback), NIIT, OBBBA senior bonus phase-out, and state tax in AGI-based states.
- **Counts toward the RMD.**
- One-time $55k QCD to a split-interest entity (CRT/CGA): out of scope.
- SECURE 2.0 anti-abuse: deductible IRA contributions after 70½ reduce the QCD exclusion. Out of scope (engine models no post-retirement deductible contributions).
- Comparison case: cash giving. The engine has no itemized deductions, so cash giving correctly has no tax benefit for standard-deduction filers. OBBBA adds a **non-itemizer charitable deduction from 2026: $1,000 single / $2,000 MFJ** (cash to public charities). Optional add (§2.4 option C).

### 2.2 Engine mechanics (recommended)
Per year, per eligible person p:
```
qcd_p = min(charitableRemaining, QCD_LIMIT × inflationFactor_limit, tradAvail_p)
rmdRemaining_p = max(0, rmd_p − qcd_p)
```
- Trad debit: `qcd` leaves traditional (pro-rata into tradA/tradB by eligibility, like RMD).
- Cash: charity is paid directly, so `netSpend` used for the gap = total − qcd. `rmdAmt` cash to the household = Σ rmdRemaining.
- Income: qcd is **never** added to `ordIncome`, provisional income, `magi`, `surchargeMAGI`, NII, or the `stateTax` retirement argument.
- Conversion cap: `maxConv` must subtract qcd as well as RMD (RMD must be satisfied before converting; QCD can satisfy it).
- Remaining charitable expense (above limit, or before 70½) is ordinary spending funded by the withdrawal strategy.
- Eligibility age: integer ages in engine. Use DOB month: eligible in the year the person turns 71, or turns 70 if born Jan-Jun (reaches 70½ by Dec 31). Helper `qcdEligible(dob, calYear)` in new `src/engine/qcd.ts`.
- Death: QCD only from the living person's IRA. After spousal rollover the survivor's age governs.
- Constants: `QCD_LIMIT_2026 = 111_000` in `taxConstants.ts`, indexed with `inflationFactor` (approximation of IRS $1k rounding).

### 2.3 Optimizer impact
No new search dimension. QCD is dominant whenever charitable intent exists, so it is rule-based. The optimizer will **see** the effect: future RMDs are partly tax-free, so optimal pre-70½ conversions shrink. That is correct behavior and worth an insight card.

### 2.4 Options
| Option | What | Verdict |
|---|---|---|
| A. Auto-QCD on charitable-tagged expenses | Above. Toggle `plan.useQCD` (default true when a charitable stream exists). | **Recommended** |
| B. Separate "Giving plan" section (amount, start/end age, QCD on/off) | Cleaner UX, duplicates stream machinery (growth, end rules, survivor %). | Fallback if tagging feels hidden |
| C. A + OBBBA non-itemizer deduction for the non-QCD cash portion | Small, accurate, cheap. | Add in same phase |
| D. Itemized deductions engine (SALT, mortgage, medical > 7.5% AGI, DAF bunching) | Big new subsystem. Enables "bunching into a DAF" comparisons. | Defer; separate project |
| E. Charitable beneficiary of IRA at death (0% haircut on trad left to charity) | Affects `endTaxAdjusted`. | Defer; ask user |

### 2.5 UI / reporting
- Expense row category = Charitable shows: "After age 70½ this can be paid straight from your IRA (a QCD). It counts toward your required withdrawal and is not taxed."
- Projections: `QCD` column; RMD column shows RMD with a "covered by QCD" breakdown in tooltip.
- Taxes page: lifetime tax saved by QCD (needs a counterfactual run with `useQCD=false`, computed once on the main thread, like `comparison.ts`).
- Sankey: Traditional → Charity link.
- Warning: charitable stream exists, person is past 70½, and traditional is empty.

### 2.6 Tests
Unit (`qcd.test.ts`): eligibility by DOB, limit cap, RMD offset, conversion cap. Projection: QCD reduces fedTax, IRMAA two years later, taxable SS. Invariant: conservation includes qcd as an outflow from trad and an expense paid. Fuzz property: enabling QCD never increases lifetime tax. New golden fixture `planQ_qcdGiver` (charitable couple, 72+, large trad).

---

## 3. HSA (owned account)

### 3.1 Rules that matter (2026)
- Contributions: **$4,400 self-only / $8,750 family**, **+$1,000 catch-up at 55+** per person (each spouse needs their own HSA for their catch-up). Family limit is shared by spouses.
- Must be covered by an HSA-eligible HDHP and **not enrolled in Medicare**. Contributions stop at Medicare enrollment; claiming SS at 65+ auto-enrolls Part A (retroactive up to 6 months).
- **No earned-income requirement** (unlike IRAs). A retiree on an HSA-eligible marketplace plan can contribute from savings.
- OBBBA (from 2026): ACA **bronze and catastrophic** plans are HSA-eligible. Contributions are above-the-line, so they **lower ACA MAGI** in pre-Medicare gap years. This is a real early-retiree lever and fits the roadmap's "pre-Medicare accuracy" focus. (Verify IRS guidance before coding.)
- Withdrawals: qualified medical = tax-free at any age. Non-qualified: ordinary income + 20% penalty before 65; ordinary income only at 65+ (behaves like traditional).
- Qualified includes Medicare Part B/D/Advantage premiums and IRMAA (65+), LTC premiums (age-capped), out-of-pocket care. **Not** Medigap, **not** ACA premiums.
- Reimbursement can be delayed indefinitely for past expenses (the "shoebox" strategy).
- No RMDs. Death: spouse beneficiary → becomes spouse's HSA. Non-spouse → full balance is ordinary income to the heir in the year of death (the existing `inheritedHSA` event already models the receiving side).
- State: **CA and NJ** do not recognize HSAs (contributions not deductible, earnings taxed annually). Of supported states only CA matters. IL/NY/TX/FL/WA follow federal.
- FICA savings on payroll HSA contributions: ignore (engine models no working-year taxes).

### 3.2 Schema (proposed)
Per person in `PersonPortfolioSchema` (HSAs are individual):
```ts
hsa?: number                 // balance
hsaContribution?: number     // annual, today's $, capped at limit
hsaCoverage?: 'self' | 'family'
hsaContribInRetirement?: boolean  // keep contributing on an HSA-eligible ACA plan until 65
hsaReceipts?: number         // unreimbursed past qualified expenses (optional, shoebox)
```
Assumption: `hsaReturn` (default = `tradReturn`). Plan-level `hsaPolicy` (see 3.4).
Note: today `annualContribution` + `contribSplit` covers 3 buckets. Keep HSA separate (has its own legal cap and stop rule) rather than adding a 4th split share.

### 3.3 Engine mechanics
1. **Contributions**: while working (or retired with `hsaContribInRetirement` and age < 65 and pre-Medicare), add `min(contrib, limit)`. During retired years the contribution is a cash need (adds to gap) and an **AGI deduction** (subtract from ordIncome, magi, surchargeMAGI, ACA MAGI). Stop at 65 or SS claim age if ≥ 65 (Part A).
2. **Growth**: `hsa × (1 + gRate)`; MC uses the same `returnOverrides` as other buckets.
3. **Qualified spending**: `medicalNeed = medicalExpenses + (age ≥ 65 ? irmaa : 0)`. HSA pays per policy (3.4). Paid amount reduces the gap; no income.
4. **Non-qualified draws**: only as last resort or by policy at 65+. Ordinary income; +20% penalty before 65 (new tax term in gross-up loop).
5. **Death**: spouse alive → merge into survivor's HSA. Both deceased (plan end) → handled in tax-adjusted value only.
6. **CA**: annual earnings added to state taxable income; contributions not deducted for state.

### 3.4 Withdrawal policy options
| Option | Behavior | Verdict |
|---|---|---|
| A. Pay-as-you-go | HSA pays qualified medical each year until empty. | Simple default for low balances |
| B. Invest-and-defer ("shoebox") | Pay medical from other buckets, log receipts, reimburse later (in high-tax years, or as last resort). | Best tax outcome; needs receipts tracking |
| C. Optimizer-chosen | 4th share in each blend window. Search grows from 2D/3D to 3D/4D Nelder-Mead; ~1.5-2× runtime. | Not recommended now |
| D. Rule-based with toggle A/B + "spend down by plan end" | Keep the optimizer at 3 buckets; HSA follows a rule; end-of-plan haircut steers away from hoarding. | **Recommended** |

Recommended default under D: **pay-as-you-go for medical from 65**, **preserve before 65** unless the user picks otherwise. Rationale: before 65, HSA dollars that would be spent on medical anyway get the same tax result either way, and growing them is free; after 65, unused HSA becomes a poor legacy asset for non-spouse heirs.

### 3.5 Withdrawal-order fit
The HSA is outside the blend policy. In the gross-up loop it is applied first: `gap -= hsaQualifiedPaid`. Non-qualified draws go after Roth exhaustion (last resort). The optimizer's three-bucket search is untouched.

### 3.6 Tax-adjusted end value (optimizer objective)
| Option | Haircut on ending HSA | Effect |
|---|---|---|
| A. Treat like Roth (0%) | Assumes future medical will absorb it | Optimizer hoards HSA; overstates value |
| B. `taxAdjOrdRate` (like traditional) | Non-spouse heir pays ordinary tax | **Recommended**; conservative, consistent |
| C. Blend by projected remaining medical | Accurate, complex | Defer |

### 3.7 UI
- Portfolio section: HSA row per person (balance, contribution, coverage, keep contributing on ACA plan toggle).
- Expense category = Medical.
- Projections: HSA balance, contributions, qualified/non-qualified draws.
- Bucket charts: 4th color (validate palette with dataviz skill).
- Insights: "HSA covers your Medicare premiums from 65"; "Contributing $X on a bronze plan lowers your ACA MAGI by $X and raises your subsidy by $Y".
- Warnings: contribution above limit; contribution after 65; non-qualified withdrawal before 65 (penalty).

### 3.8 Tests
Unit `hsa.test.ts`: limits, catch-up, family sharing, Medicare stop. Projection: qualified draws tax-free; non-qualified <65 has penalty; ACA MAGI lowered by contribution. Invariant: HSA conservation. Golden `planR_hsaEarlyRetiree` (age 55 retiree, ACA bronze, HSA $150k). MC: HSA follows the bucket return series.

---

## 4. TIPS ladder

### 4.1 Rules / mechanics that matter
- Each rung = TIPS held to maturity in a specific year. Principal is indexed to CPI-U (index ratio). Coupon = fixed real rate × adjusted principal. At maturity, pays max(adjusted principal, original par) (deflation floor).
- Purpose: fixed **real** income for chosen years, independent of market returns.
- Tax when held in **taxable**: coupon **and** the annual inflation accrual on principal ("phantom income", OID) are federal ordinary income each year. Both are **state tax-exempt** (Treasury). Both are net investment income (NIIT) and count in AGI (SS provisional income, IRMAA, ACA).
- Held in **traditional IRA**: no annual tax; maturity proceeds stay in the IRA and are taxed when withdrawn. Ladder value counts in the IRA balance for RMDs, and maturities can satisfy RMDs.
- Held in **Roth**: fully tax-free.
- Secondary-market sales, real-yield mark-to-market, and reinvestment risk: out of scope (hold-to-maturity accounting).

### 4.2 Why the current engine cannot represent it
- As a bucket asset: it would earn `taxableReturn`/`tradReturn` and, in MC, the stock/bond blended return. Wrong: a held ladder is immune to return draws and tracks **CPI**.
- As an income stream (Annuity/Other with CPI growth): fixes the cash flow but violates the external-principal rule (see memory `income-stream-vs-portfolio-yield`) if the face value is also in a bucket, and misses phantom income and state exemption, and makes the ladder invisible in balances.

### 4.3 Modeling options
| Option | What | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. New income stream type `TIPS` | CPI growth, state-exempt routing, user excludes principal from portfolio | Tiny change | No balance shown; no phantom income; double-count risk | Stopgap only |
| B. First-class ladder sleeve | List of rungs; engine tracks indexed principal per rung on the year's CPI path | Correct cash, tax, MC behavior; shows in balances | Largest build | **Recommended core** |
| C. B + ladder builder | User enters "real $X/yr from age A to B" + real yield; app generates rungs and their cost | Answers "should I build a ladder?" | Needs a yield input; cost debited from a chosen bucket | **Recommended as phase 2 of TIPS** |
| D. B + optimizer chooses ladder size | Ladder as a decision variable | Powerful | Very expensive search; mixed objective | Not now |

### 4.4 Schema (option B)
```ts
TipsRungSchema = {
  id, maturityYear: int,          // calendar year
  adjustedPrincipal: number,      // today's indexed principal (from brokerage statement)
  couponRate: number,             // real coupon, e.g. 0.0125
  account: 'taxable' | 'traditional' | 'roth',
  whose: 'A' | 'B' | 'Household', // for traditional, needed for per-person RMD
}
plan.tipsLadder?: { rungs: TipsRung[]; balancesIncludeLadder: boolean }
```
**Double-count handling**: brokerage statements show account totals that include the ladder. Recommend `balancesIncludeLadder = true` (default): the engine carves the rung value out of that account's entered balance (and pro-rata out of taxable basis, assuming basis ≈ adjusted principal). Validation error if rungs exceed the account balance.

### 4.5 Engine mechanics (per year i, CPI factor from deterministic inflation or `inflationOverrides`)
```
indexRatio_i = runningInflationFactor (relative to plan start)
principal_r  = max(par_r, adjustedPrincipal_r × indexRatio_i)    // floor only at maturity
coupon_r     = couponRate_r × adjustedPrincipal_r × indexRatio_i
accrual_r    = principal_r(i) − principal_r(i−1)                 // phantom income
maturity_r   = principal_r in maturityYear_r, then rung removed
```
By account:
- **Taxable**: coupon + maturity = cash in (like `distributedCash`, reduces the gap). Coupon + accrual = ordinary income, NII, state-exempt (excluded from `stateTax` nonExempt args). Accrual raises the rung's basis, so maturity has no gain.
- **Traditional**: coupons and maturities land as cash inside traditional (move from sleeve to `tradA/tradB`); no income until withdrawn. Rung value is included in the RMD base. Optional: treat maturity as a minimum traditional draw that year: `forcedTrad = max(RMD, maturity)` (the maturity can satisfy the RMD).
- **Roth**: coupons/maturities move to Roth cash; tax-free.
- Excluded from Roth-conversion cap (in-kind conversion of TIPS is legal but out of scope).
- MC: sleeve ignores `returnOverrides`; follows `inflationOverrides`. This is the main reason to build it: ladder-funded years show no sequence risk.

### 4.6 Tax-adjusted value
Rung value × account haircut (taxable: 0 since basis ≈ value; traditional: `taxAdjOrdRate`; roth: 0).

### 4.7 Interactions to call out in UI
- Remaining portfolio becomes more equity-heavy. Monte Carlo's equity slider is a UI pref, not plan data. Suggest the user raise it when the ladder replaces bonds.
- Deterministic projection: ladder income equals CPI-growth, so with fixed inflation it looks like an annuity. Its value shows only in MC/historical stress.

### 4.8 UI
- Portfolio: "TIPS ladder" card with rung table (maturity year, principal, coupon, account), CSV paste helper, total by account, the "my balances already include this" toggle.
- Builder (option C): target real income, years, real yield, funding account; preview cost and rungs.
- Projections: TIPS coupon, accrual (taxable income, no cash), maturity, sleeve balance.
- Charts: 5th bucket color or a hatched sleeve inside its account color (needs dataviz pass).
- Learn More topic explaining phantom income and why IRA is often the better home.

### 4.9 Tests
Unit `tipsLadder.test.ts`: index ratio, coupon, accrual, deflation floor at maturity, carve-out. Projection: taxable-held phantom income taxed federally, not in IL/CA/NY state tax; IRA-held no income until draw and RMD base includes it. MC: zero variance in ladder cash flows across return draws (given same CPI). Golden `planS_tipsLadder` (A-P already used in `__golden/plans.ts`).

---

## 5. Recommended delivery sequence

1. **Foundation**: expense `category` tag + `sumExpenseStreams` split + row fields scaffolding (0 when unused). Goldens unchanged.
2. **QCD** (option A + C). Schema v33.
3. **HSA** (policy option D, haircut B, ACA-MAGI contribution lever). Schema v34.
4. **TIPS core** (option B, carve-out). Schema v35.
5. **TIPS builder** (option C).
6. Deferred: itemized deductions / DAF bunching; charitable IRA beneficiary; HSA as optimizer dimension; TIPS sizing optimizer; I-bonds (same sleeve model, simpler tax).

Test tiers: every step `pnpm test:fast`; steps 2-4 also `pnpm test:opt` (optimizer objective changes). New goldens per feature. `tsc -b --force` before push.

---

## 6. Open questions (answer before planning)

> **Answered.** All questions below have been answered; the decisions are recorded in [hsa-tips-qcd-plan.md](hsa-tips-qcd-plan.md) (Decisions table, D1–D13), which also holds the phased build plan and tracker.

**General**
1. Delivery order QCD → HSA → TIPS OK, or is one of these urgent for you personally?
2. Expense category tagging as the shared mechanism, or a separate "Giving" section and "Healthcare" section?
3. Version per feature (v33/v34/v35, separate releases), or one bundled release?

**QCD**
4. Auto-apply QCD whenever eligible (default on), or user opts in?
5. Include the OBBBA non-itemizer $1,000/$2,000 charitable deduction for non-QCD cash gifts?
6. Model IRA left to charity at death (affects ending after-tax value and so the optimizer)? Recommend no for now.
7. Show "tax saved by QCD" (needs a second projection), or just show the QCD amounts?

**HSA**
8. Default policy: pay-as-you-go from 65 and preserve before 65? Or pay-as-you-go always?
9. Track shoebox receipts (unreimbursed past expenses) in v1, or defer?
10. Model contributions during retirement on HSA-eligible ACA bronze plans (lowers ACA MAGI)? Recommend yes.
11. Ending HSA haircut at `taxAdjOrdRate` (heir pays ordinary tax)? Recommend yes.
12. Model CA non-conformity, or ignore and warn?
13. Should engine-computed Medicare base premiums (Part B/D, not just IRMAA) be added? Today they are only in user expenses.

**TIPS**
14. Rung entry: manual rung table, builder, or both in v1? Recommend table first.
15. Account balances entered include the ladder (carve-out) or exclude it?
16. Treat IRA-held maturities as a required draw that also satisfies the RMD, or just return the cash to the IRA?
17. Is the deflation floor and coupon-on-indexed-principal precision needed, or is "real cash flow = rung amount × CPI" enough?
18. Also support I-bonds / nominal Treasury / CD ladders in the same sleeve later?

---

## 7. Constants to add (verify against IRS before coding)
- `QCD_LIMIT_2026 = 111_000` (2025: 108,000); split-interest one-time 55,000 (not used).
- `HSA_LIMIT_SELF_2026 = 4_400`, `HSA_LIMIT_FAMILY_2026 = 8_750`, `HSA_CATCHUP = 1_000` (age 55, not indexed).
- `HSA_NONQUAL_PENALTY = 0.20` (before 65).
- `OBBBA_NONITEMIZER_CHARITY = { single: 1_000, mfj: 2_000 }` (from 2026).
- OBBBA bronze/catastrophic HSA eligibility from 2026: confirm current IRS guidance (Notice 2026-5 or later).
