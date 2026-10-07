import { z } from 'zod';
import { FED_BRACKETS_MFJ } from '../engine/taxConstants';
import {
  PlanSchema, AssumptionsSchema, ConversionParamsSchema, BlendWindowSchema, ResultSettingsSchema,
  WithdrawalStrategySchema,
} from './plan';

const BRACKET_12_TOP_MFJ = FED_BRACKETS_MFJ[1][0];

/**
 * The plan as the app stores it: the household facts plus one `strategy` block. The engine works
 * on the flat `Plan` from ./plan; strategy/savedPlan.ts derives it from this shape.
 *
 * "Set it myself" and "Optimize for me" each keep their own settings. Switching tabs changes
 * `strategy.active` only, so neither tab's settings nor the optimizer result are lost.
 */

/** Conversion settings without the optimizer flag. Who owns conversions is said by the slot. */
export const ConversionSettingsSchema = ConversionParamsSchema.omit({ optimize: true });
export type ConversionSettings = z.infer<typeof ConversionSettingsSchema>;

export const UserGoalSchema = z.enum(['max-end-balance', 'max-sustainable-spending', 'min-retirement-age']);

export const ManualStrategySchema = z.object({
  /** Withdrawal order preset. Also the fallback for ages a custom blend does not cover. */
  preset: WithdrawalStrategySchema,
  /** Hand-built blend by age window. When present it replaces the preset. */
  customWindows: z.array(BlendWindowSchema).min(1).optional(),
  withdrawalBracketCeiling: z.number().nonnegative().default(BRACKET_12_TOP_MFJ),
  conversion: ConversionSettingsSchema,
  payTaxFromBrokerage: z.boolean().default(true),
});
export type ManualStrategy = z.infer<typeof ManualStrategySchema>;

export const OptimizerStrategySchema = z.object({
  /** The goal the next run optimizes for (the selected goal pill). */
  goal: UserGoalSchema.default('max-end-balance'),
  /** True: the optimizer searches conversion amounts and `conversion` is only remembered for
   *  when the user picks a mode again. False: conversions follow `conversion`. */
  optimizerDecidesConversions: z.boolean().default(true),
  conversion: ConversionSettingsSchema,
  payTaxFromBrokerage: z.boolean().default(true),
  /** Minimum after-tax legacy for Max Spending, in today's dollars. 0 = unconstrained. */
  legacyTargetTaxAdjReal: z.number().nonnegative().default(0),
});
export type OptimizerStrategy = z.infer<typeof OptimizerStrategySchema>;

export const PolicyWindowsSchema = z.object({ windows: z.array(BlendWindowSchema).min(1) });

export const OptimizerResultSchema = z.object({
  policy: PolicyWindowsSchema,
  goal: UserGoalSchema,
  /** optimizerKey of the plan the result was built for. Out of date when it differs. */
  inputKey: z.string(),
  /** Strategy settings the run used. Projection uses these while the result is active. */
  settings: ResultSettingsSchema,
  optimizedBy: z.enum(['optimizer', 'monte-carlo']).default('optimizer'),
  mcTuning: z.object({
    posture: z.enum(['floor', 'balanced', 'growth']),
    before: z.number(),
    after: z.number(),
    trials: z.number(),
    equityPct: z.number(),
  }).optional(),
  /** No-conversion counterfactual ordering for the Roth Conversion Benefit metric. */
  conversionBaseline: PolicyWindowsSchema.optional(),
  /** Spending multiplier solved by a Max Spending run (drives the what-if slider default). */
  solvedSpendingMultiplier: z.number().optional(),
});
export type OptimizerResult = z.infer<typeof OptimizerResultSchema>;

export const StrategySchema = z.object({
  active: z.enum(['manual', 'optimizer']),
  manual: ManualStrategySchema,
  optimizer: OptimizerStrategySchema,
  result: OptimizerResultSchema.optional(),
});
export type Strategy = z.infer<typeof StrategySchema>;

export const FactsAssumptionsSchema = AssumptionsSchema.omit({ legacyTargetTaxAdjReal: true });

export const SavedPlanSchema = PlanSchema.pick({
  personA: true, personB: true, portfolio: true, incomeStreams: true, lumpSumEvents: true,
  expenseStreams: true, state: true, customStateTaxRate: true, goals: true,
}).extend({
  assumptions: FactsAssumptionsSchema,
  strategy: StrategySchema,
});
export type SavedPlan = z.infer<typeof SavedPlanSchema>;
