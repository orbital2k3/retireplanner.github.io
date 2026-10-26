import type { Plan } from '../../schemas/plan';
import { runProjection, type ProjectionRow } from '../projection';
import { assertProjectionInvariants } from '../__invariants__/assertions';
import fs from 'node:fs';
import path from 'node:path';

export interface GoldenRow {
  age: number;
  netSpend: number;
  totalWD: number;
  fedTax: number;
  rmd: number;
  rothConv: number;
  endTaxable: number;
  endTraditional: number;
  endRoth: number;
  endTotal: number;
}

export function projectionToGolden(rows: ProjectionRow[]): GoldenRow[] {
  return rows.map((r) => ({
    age: r.ageA,
    netSpend: Math.round(r.netSpend),
    totalWD: Math.round(r.totalWD),
    fedTax: Math.round(r.fedTax),
    rmd: Math.round(r.rmd),
    rothConv: Math.round(r.rothConv),
    endTaxable: Math.round(r.endTaxable),
    endTraditional: Math.round(r.endTraditional),
    endRoth: Math.round(r.endRoth),
    endTotal: Math.round(r.endTotal),
  }));
}

export function rowsToCSV(rows: GoldenRow[]): string {
  const header = 'age,netSpend,totalWD,fedTax,rmd,rothConv,endTaxable,endTraditional,endRoth,endTotal\n';
  const body = rows.map((r) =>
    [r.age, r.netSpend, r.totalWD, r.fedTax, r.rmd, r.rothConv, r.endTaxable, r.endTraditional, r.endRoth, r.endTotal].join(',')
  ).join('\n');
  return header + body + '\n';
}

export function csvToRows(csv: string): GoldenRow[] {
  const lines = csv.trim().split('\n');
  return lines.slice(1).map((line) => {
    const [age, netSpend, totalWD, fedTax, rmd, rothConv, endTaxable, endTraditional, endRoth, endTotal] = line.split(',').map(Number);
    return { age, netSpend, totalWD, fedTax, rmd, rothConv, endTaxable, endTraditional, endRoth, endTotal };
  });
}

/** Compare two GoldenRow arrays. Returns first mismatch description or null if equal within tolerance. */
export function diffGolden(actual: GoldenRow[], expected: GoldenRow[], tolerance = 2): string | null {
  if (actual.length !== expected.length) return `Length mismatch: actual ${actual.length} vs expected ${expected.length}`;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i], e = expected[i];
    const cols: (keyof GoldenRow)[] = ['age', 'netSpend', 'totalWD', 'fedTax', 'rmd', 'rothConv', 'endTaxable', 'endTraditional', 'endRoth', 'endTotal'];
    for (const c of cols) {
      if (Math.abs(a[c] - e[c]) > tolerance) {
        return `Row ${i} (age ${a.age}): ${c}=${a[c]} but expected ${e[c]} (Δ=${a[c] - e[c]})`;
      }
    }
  }
  return null;
}

const goldenDir = path.dirname(new URL(import.meta.url).pathname);

export function loadGolden(name: string): GoldenRow[] | null {
  const file = path.join(goldenDir, `${name}.csv`);
  if (!fs.existsSync(file)) return null;
  return csvToRows(fs.readFileSync(file, 'utf8'));
}

export function saveGolden(name: string, rows: GoldenRow[]): void {
  const file = path.join(goldenDir, `${name}.csv`);
  fs.writeFileSync(file, rowsToCSV(rows));
}

/** A missing CSV fails the test instead of being written silently (a renamed or deleted file would
 *  otherwise pass and re-baseline itself). Write a new plan's files once with `CREATE_GOLDENS=1`, which
 *  writes only files that don't exist yet; `UPDATE_GOLDENS=1` regenerates every file. */
const CREATE = process.env.CREATE_GOLDENS === '1';
const UPDATE = process.env.UPDATE_GOLDENS === '1';
const missing = (file: string) => ({ ok: false, message: `missing ${path.basename(file)}: run once with CREATE_GOLDENS=1 to create it` });

export function runAndCompare(name: string, plan: Plan, opts: { regenerate?: boolean; tolerance?: number } = {}): { ok: boolean; message?: string } {
  const proj = runProjection(plan);

  // Invariants run before CSV comparison so a math violation surfaces with its own pointed
  // error message instead of being summarized as a generic "value drift" diff.
  try {
    assertProjectionInvariants(proj, plan);
  } catch (e) {
    return { ok: false, message: `Invariant violation in ${name}: ${(e as Error).message}` };
  }

  const actual = projectionToGolden(proj.rows);

  if (opts.regenerate || UPDATE) {
    saveGolden(name, actual);
    return { ok: true, message: `(regenerated ${name}.csv)` };
  }

  const expected = loadGolden(name);
  if (!expected) {
    if (!CREATE) return missing(path.join(goldenDir, `${name}.csv`));
    saveGolden(name, actual);
    return { ok: true, message: `(created baseline ${name}.csv)` };
  }
  const diff = diffGolden(actual, expected, opts.tolerance ?? 2);
  return diff ? { ok: false, message: diff } : { ok: true };
}

type NumericRowKey = { [K in keyof ProjectionRow]: ProjectionRow[K] extends number ? K : never }[keyof ProjectionRow];

/** Extra per-year columns for a plan whose key numbers the 10-column golden CSV leaves out, stored beside it
 *  as `<name>.<suffix>.csv` with the same ±$2 tolerance. */
function runAndCompareCols(name: string, suffix: string, label: string, cols: readonly NumericRowKey[], plan: Plan, tolerance = 2): { ok: boolean; message?: string } {
  const rows = runProjection(plan).rows;
  const header = 'age,' + cols.join(',') + '\n';
  const table = rows.map((r) => [r.ageA, ...cols.map((c) => Math.round(r[c]))]);
  const csv = header + table.map((t) => t.join(',')).join('\n') + '\n';
  const file = path.join(goldenDir, `${name}.${suffix}.csv`);
  const exists = fs.existsSync(file);
  if (UPDATE || (CREATE && !exists)) {
    fs.writeFileSync(file, csv);
    return { ok: true, message: `(wrote ${name}.${suffix}.csv)` };
  }
  if (!exists) return missing(file);
  const expected = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
  if (expected.length !== table.length) return { ok: false, message: `${label} CSV length mismatch: ${table.length} vs ${expected.length}` };
  for (let i = 0; i < table.length; i++) {
    for (let c = 0; c < table[i].length; c++) {
      if (Math.abs(table[i][c] - expected[i][c]) > tolerance) {
        const col = c === 0 ? 'age' : cols[c - 1];
        return { ok: false, message: `${label} row ${i} (age ${table[i][0]}): ${col}=${table[i][c]} but expected ${expected[i][c]}` };
      }
    }
  }
  return { ok: true };
}

const HSA_COLS = ['hsaContrib', 'hsaQualifiedWD', 'hsaReimbursed', 'hsaNonQualWD', 'hsaPenalty', 'endHSA', 'hsaReceiptsBal', 'acaMagi', 'acaPremium', 'irmaa'] as const;
export const runAndCompareHsa = (name: string, plan: Plan, opts: { tolerance?: number } = {}) =>
  runAndCompareCols(name, 'hsa', 'HSA', HSA_COLS, plan, opts.tolerance);

const TIPS_COLS = ['begTips', 'endTipsTaxable', 'endTipsTrad', 'endTipsRoth', 'tipsCoupon', 'tipsAccrual', 'tipsMaturity', 'tipsFloorBonus',
  'tipsCash', 'tipsToTrad', 'tipsToRoth', 'tipsOrdInc', 'rmdUnmet', 'stateTaxAmt', 'niit', 'acaMagi', 'acaPremium'] as const;
export const runAndCompareTips = (name: string, plan: Plan, opts: { tolerance?: number } = {}) =>
  runAndCompareCols(name, 'tips', 'TIPS', TIPS_COLS, plan, opts.tolerance);

const QCD_COLS = ['charitableSpend', 'qcd', 'qcdBeyondRmd', 'qcdB', 'charityDeduction', 'stdDeduction', 'magi', 'fedTax', 'stateTaxAmt', 'irmaa'] as const;
export const runAndCompareQcd = (name: string, plan: Plan, opts: { tolerance?: number } = {}) =>
  runAndCompareCols(name, 'qcd', 'QCD', QCD_COLS, plan, opts.tolerance);
