export interface HelpSection {
  heading: string;
  paras: string[];
}

export interface HelpTopic {
  eyebrow: string;
  title: string;
  sections: HelpSection[];
}

export const MC_SIMULATE_HELP: HelpTopic = {
  eyebrow: 'Learn more',
  title: 'What the simulation does',
  sections: [
    {
      heading: 'The idea behind it',
      paras: [
        'How well your plan works depends on what the markets do over the next few decades. Nobody can know that in advance.',
        'This tool runs your entire plan thousands of times over. Each run uses a different sequence of market ups and downs, drawn from real market history going back to 1928.',
        'Every run is one possible future for you. In some of them the markets are generous in your early years and your savings build up. In others a crash lands right after you retire, which is the hardest kind of timing to recover from.',
      ],
    },
    {
      heading: 'How the market histories are built',
      paras: [
        'Each future is stitched together from three-year blocks of real S&P 500 and Treasury returns, drawn at random from 1928 through 2023 and mixed to your stock and bond split.',
        'Keeping whole three-year blocks holds on to the way good and bad years cluster together. Long stretches such as the sixteen lean years from 1966 to 1982 get broken into pieces and spread around, so a slump that deep shows up rarely.',
        'That makes this page a little kind to very long retirements. The historical cohort chart further down the page runs the years in their real order and gives you the stricter read.',
      ],
    },
    {
      heading: 'Why this reads higher than the Dashboard',
      paras: [
        'The Dashboard grows your money by one fixed return every year, taken from your own assumptions, and gives you the same answer each time you open it. That figure is set on the cautious side.',
        'Real market history has averaged closer to 8% a year for a stock-heavy mix, so success rates here normally come out above the Dashboard number.',
        'Use the Dashboard as your planning baseline and this page for the range of luck around it.',
      ],
    },
    {
      heading: 'What the numbers tell you',
      paras: [
        'Probability of success is the share of runs in which your money lasted all the way to your plan-to age. A reading of 90% means your money held up in 9 out of every 10 futures that were tested.',
        'The fan chart shows the whole spread of results. The middle line is the typical outcome. The outer edges show the lucky and the unlucky ends of the range.',
        'The four historical cohort cards test something different. They run your plan through four specific bad stretches that really happened, such as retiring right before the 1929 crash.',
      ],
    },
    {
      heading: 'The two settings',
      paras: [
        'Equity % is how much of your portfolio sits in stocks. Stocks tend to grow more over long stretches of time. They also move up and down more from one year to the next. Whatever is left over goes into bonds.',
        'Trials is how many futures to test. 5,000 gives you a steady answer. A higher number settles the answer down a little further and takes slightly longer to finish.',
      ],
    },
    {
      heading: 'How to use it',
      paras: [
        'Run it once to see where your plan stands today. Then change one thing, such as your retirement age or your yearly spending, and run it again.',
        'Watching how far the success number moves each time tells you which decisions actually matter for your situation.',
      ],
    },
  ],
};

export const MC_OPTIMIZE_HELP: HelpTopic = {
  eyebrow: 'Learn more',
  title: 'What the optimizer does',
  sections: [
    {
      heading: 'What it is deciding for you',
      paras: [
        'Your plan makes two choices that you can tune. The first is which accounts you take money out of, and in what order. The second is how much you move from your traditional accounts into your Roth each year.',
        'Both choices change the taxes you pay over your lifetime, and your tax bill changes how long your money lasts.',
        'The optimizer searches through a very large number of combinations of those two choices. It keeps the combination that holds up best across all the market futures from your simulation.',
      ],
    },
    {
      heading: 'How it weighs a bad run of markets',
      paras: [
        'The optimizer scores a candidate strategy by running it through 32 simulated market histories. Half the score comes from the average across all of them, and half from the worst quarter alone.',
        'That second half is what makes it a robustness run. A strategy that does well on average and falls apart in the worst quarter scores badly.',
      ],
    },
    {
      heading: 'Why it sometimes finds nothing',
      paras: [
        'Withdrawal order and Roth conversions are tax levers. They change what you keep, and on many plans they change it by a few percent. Whether your money lasts is driven far more by your spending, your retirement age, and your stock and bond mix.',
        'So on a lot of plans the tuned strategy scores the same as the one you already have. When that happens this page says so and offers you nothing to apply, rather than dressing up a rounding error as an improvement.',
        'A result only counts as an improvement here when it beats your current strategy by more than a full percentage point, which is the simulation\u2019s own margin of error at 5,000 trials.',
      ],
    },
    {
      heading: 'Why it waits for a simulation',
      paras: [
        'The optimizer scores every candidate strategy against the exact same set of market futures your last simulation used. That keeps the before and after comparison fair.',
        'This is why it stays locked until you have run a simulation, and why changing a setting asks you to run the simulation once more.',
      ],
    },
    {
      heading: 'Applying the result',
      paras: [
        'The search takes about 20 seconds. When it finishes, a strip inside the Optimize section shows the outcome.',
        'A green strip means the tuned strategy beats your current one by more than a full percentage point. A gold bar appears at the bottom of the panel with two choices: Apply to Plan (saves the new strategy permanently, replacing your current withdrawal order and Roth conversions) or Discard (clears the preview and leaves your plan exactly as it was).',
        'A grey strip means the improvement was smaller than one percentage point, which is the margin of error for 5,000 trials. Nothing is offered to apply.',
        'Once applied, the Dashboard labels the plan "Monte Carlo tuned" so you can always see where the saved strategy came from.',
      ],
    },
  ],
};

export const QCD_HELP: HelpTopic = {
  eyebrow: 'Learn more',
  title: 'Giving from your IRA (QCDs)',
  sections: [
    {
      heading: 'What a QCD is',
      paras: [
        'A qualified charitable distribution, or QCD, sends money straight from your IRA to a charity. The money never passes through your hands, so it is not added to your income.',
        'Once you are 70½, a QCD also counts toward your required withdrawal for the year. That is the useful part: you meet the requirement without paying income tax on that money.',
      ],
    },
    {
      heading: 'The rules this tool follows',
      paras: [
        'You can start in the year you turn 70½. The limit in 2026 is $111,000 a year for each person, and it rises with inflation. A couple has two limits.',
        'The money has to come from an IRA. If your savings are in a 401(k), assume they have been rolled into an IRA. Money in an inherited IRA is left out.',
        'The gift has to go directly to a public charity. Donor-advised funds and private foundations do not qualify. Untick the box on a giving row to mark a gift like that. It is then taxed like General spending: paid from your other accounts, with no QCD and no charity deduction. It still shows as giving in the Sankey and the Giving column of the Projections table.',
      ],
    },
    {
      heading: 'What happens in your plan',
      paras: [
        'Mark an expense row as Charitable. Once you are eligible, the tool pays that giving from your IRA. It covers your required withdrawal first, then any extra up to the limit. Anything left over is paid from your other accounts the usual way.',
        'The part that goes to charity is left out of your taxable income. It counts toward your required withdrawal, but you do not receive it as cash.',
      ],
    },
    {
      heading: 'Why it can lower your taxes',
      paras: [
        'Lower taxable income can mean less of your Social Security is taxed, a lower Medicare surcharge two years later, and less state tax in states that tax IRA income.',
        'The Taxes page compares your plan with the same gifts paid in cash, using the same withdrawal plan, and shows the difference in today\u2019s dollars.',
      ],
    },
    {
      heading: 'Gifts that are not QCDs',
      paras: [
        'From 2026, cash gifts to public charities can be deducted even if you do not itemize, up to $1,000 for one person or $2,000 for a couple. The tool applies this to any giving a QCD did not cover. The limits are fixed by law and do not rise with inflation.',
      ],
    },
    {
      heading: 'What it leaves out',
      paras: [
        'It does not model leaving part of an IRA to charity when you die, itemized deductions, or bunching several years of gifts into one.',
      ],
    },
  ],
};

export const HSA_HELP: HelpTopic = {
  eyebrow: 'Learn more',
  title: 'Your health savings account (HSA)',
  sections: [
    {
      heading: 'Why an HSA is special',
      paras: [
        'Money goes in untaxed, grows untaxed, and comes out untaxed when it pays for qualified medical costs. No other account does all three.',
        'There is no required withdrawal, and you can reimburse yourself years later for a medical bill you paid out of pocket. That is why many people let the HSA grow and pay bills from other accounts first.',
      ],
    },
    {
      heading: 'What you can put in',
      paras: [
        'In 2026 the limit is $4,400 for self-only coverage and $8,750 for family coverage. The base limit rises with inflation. If you are 55 or older you can add $1,000, and that catch-up does not rise with inflation. If either spouse is on family coverage, you both share one family limit, and each has their own catch-up.',
        'You need an HSA-eligible health plan, and you cannot be on Medicare. The tool stops contributions at 65, or when you claim Social Security if that is later, because claiming enrolls you in Medicare Part A.',
        'You do not need a job to contribute. From 2026, bronze and catastrophic marketplace plans count as HSA-eligible, so an early retiree on one can keep contributing. Tick the box in the HSA section to model that.',
      ],
    },
    {
      heading: 'How the tool pays bills from it',
      paras: [
        'Mark expense rows as Medical. From the age you pick (65 by default, or Always), the HSA pays those bills first, before your other accounts, plus any Medicare income surcharge (IRMAA) once the HSA owner is 65 (Medicare premiums count as medical costs only from an owner 65 or over, even when they are a spouse\u2019s). None of that is income.',
        'Before that age, medical bills are paid from your other accounts and logged as receipts, added to any receipts you entered. Both people\'s receipts form one household pot. Receipts are what you can still claim tax-free later. The tool reimburses them only as a last resort, when your other accounts have run out. Otherwise they lower the tax counted on the HSA at the end of the plan (see below). They are a fixed dollar amount and do not grow with inflation.',
      ],
    },
    {
      heading: 'What it does for your ACA subsidy',
      paras: [
        'If you retire before 65 and keep contributing, the contribution is deducted from your income, including capital gains, and from your state income in every state the tool models except California. That lowers the income used for your marketplace subsidy, so the subsidy goes up. The catch is where the contribution money comes from: if it comes from withdrawals that count as income (pre-tax money, or brokerage gains), those cancel part or all of the deduction. Paying it from Roth money or cash gets the full effect. It also moves money you could spend before 65 into the HSA, so your brokerage money can run out sooner and the pre-tax withdrawals that replace it can raise your ACA income in a later year. The Taxes page shows what your plan actually gets over all the contribution years. If every other account is empty, the plan skips that year\u2019s contribution, since paying it from the HSA itself would only cost tax and penalty. Be careful near the bottom of the range: under 100% of the poverty level there is no subsidy at all, and the plan warns you if a contribution pushes you there.',
      ],
    },
    {
      heading: 'If your other money runs out',
      paras: [
        'As a last resort the HSA can pay for anything. Money used for something other than medical costs is taxed as ordinary income, and before 65 there is also a 20% penalty. The plan shows a warning when that happens.',
      ],
    },
    {
      heading: 'What it leaves out',
      paras: [
        'California and New Jersey do not follow the federal HSA rules and tax the growth each year. The tool does not model that and shows a note for California plans. It also does not model your regular Medicare premiums, long-term-care premiums paid from the HSA, or the optimizer choosing how much to put in the HSA.',
        'At the end of the plan, an HSA above your receipts is counted at the same tax rate as pre-tax money, because a non-spouse heir owes ordinary tax on it. A spouse can keep it as their own HSA.',
      ],
    },
  ],
};

export const TIPS_HELP: HelpTopic = {
  eyebrow: 'Learn more',
  title: 'Your TIPS ladder',
  sections: [
    {
      heading: 'What a ladder does',
      paras: [
        'TIPS are Treasury bonds whose principal rises with inflation. A ladder is a row of them, one maturing in each year you want covered. Each rung pays a fixed real amount in its year, whatever the stock market does. That is the point: those years no longer depend on returns.',
        'Enter each bond as a rung: the year it matures, the principal shown on your statement (the inflation-adjusted figure), its coupon, and which account holds it. Par value is optional and only sets a floor: at maturity a TIPS pays at least par. Left blank, the plan uses today\'s principal as par, which is right for a bond bought at issue but generous for one bought later (its par is usually lower); it only matters if prices fall.',
      ],
    },
    {
      heading: 'Do my balances already include it?',
      paras: [
        'Usually yes: your brokerage statement shows one total for the account, bonds included. Leave the box ticked and the tool takes the rungs out of that balance and invests only the rest, so nothing is counted twice. Pre-tax $500,000 with $100,000 of rungs becomes $400,000 invested plus the ladder. Untick it only if the bonds are in addition to the balances you entered. If the rungs add up to more than the account holds, the plan shows an error and caps them at the balance.',
      ],
    },
    {
      heading: 'Whose bonds are they?',
      paras: [
        'There is one ladder for the household, but each rung says which account holds it. Taxable and Roth balances are pooled for the household in this plan, so those rungs are Household. A pre-tax rung belongs to one person: it comes out of that person\'s pre-tax balance, counts toward their required withdrawal, and passes to the survivor.',
      ],
    },
    {
      heading: 'Where the bonds sit changes the tax',
      paras: [
        'In a taxable account you owe federal tax every year on the coupon and on the inflation increase of the principal, even though the increase is paid out only at maturity. That is "phantom income". It also counts toward Social Security taxation, Medicare surcharges and ACA income. Treasury interest is exempt from state income tax. The tool counts this income from the first year either of you has retired.',
        'In an IRA there is no tax while the bonds are held; the coupons and maturities are added to the IRA and taxed when you take the money out. In a Roth they are never taxed. An IRA or Roth is often the better home for a TIPS ladder.',
      ],
    },
    {
      heading: 'IRA bonds and required withdrawals',
      paras: [
        'Bonds in an IRA count when your required withdrawal is figured, but the tool can only pay that withdrawal from cash in the IRA. If most of the IRA is tied up in bonds, the plan shows the part it could not pay as "RMD unmet" and warns you. Taking the bonds out in kind is not modeled. The bonds themselves are not converted to Roth; cash the bonds pay into the IRA can be.',
      ],
    },
    {
      heading: 'How the tool models it',
      paras: [
        'The ladder follows inflation, not market returns: in Monte Carlo runs and historical stress tests the rungs pay the same real amounts in every scenario. Each bond is held to maturity. The plan never sells early, so a ladder cannot rescue a year that comes before its rung, and the plan warns you if you would run short while still holding bonds.',
        'Every flow in a year is figured at the year-end price level. If prices fall over the life of a bond, the principal falls too, but at maturity it is never worth less than par, and a deflation adjustment can only offset that year\'s coupons, never your other income.',
      ],
    },
    {
      heading: 'Seeing it',
      paras: [
        'Build a ladder\u2026 on the card plans new rungs for an income you choose. It opens with example values, so its table is a preview; nothing is added until you click Add.',
        'On the charts the ladder is the hatched band inside its account\'s color. The Projections table has a TIPS column group (balance, coupon, inflation accrual, maturity, taxable income and unmet RMD) that you can switch on in the column chooser.',
      ],
    },
    {
      heading: 'What it leaves out',
      paras: [
        'Selling bonds before maturity, price changes from interest rates, reinvesting coupons into new bonds, I bonds, CDs and ladders of ordinary bonds.',
      ],
    },
  ],
};
