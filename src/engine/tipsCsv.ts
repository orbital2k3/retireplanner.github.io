import type { TipsRung } from '../schemas/plan';

/** Parse a pasted rung table (from a brokerage statement or a spreadsheet) into ladder rungs.
 *
 *  Columns, in order: maturity, adjusted principal, coupon, account, owner, par (the last two optional).
 *  A header row is detected and skipped. Cells split on tabs (spreadsheet paste), else semicolons, else
 *  commas, and a quoted cell may contain the delimiter ("$48,000"). Forgiving about formats:
 *   - maturity: any text holding a 4-digit year (2031, 2031-02-15, 02/15/2031, Feb 2031)
 *   - money: $ and thousands separators are ignored
 *   - coupon: "1.25%" or "1.25" mean 1.25%; a bare number under 0.05 is a decimal (0.0125)
 *   - account: taxable/brokerage, pre-tax/traditional/ira/401k, roth
 *   - owner: the person's name, A/B, or blank (pre-tax rungs default to Person A)
 *  Every bad row is reported with its line number and skipped; good rows are still returned. */
export interface TipsCsvError { line: number; message: string }
export interface TipsCsvResult { rungs: TipsRung[]; errors: TipsCsvError[] }

const splitCells = (line: string): string[] => {
  const delim = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === delim && !quoted) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const money = (s: string): number => {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

const coupon = (s: string): number => {
  const pct = s.includes('%');
  const n = Number(s.replace(/[%\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return NaN;
  return pct || n >= 0.05 ? n / 100 : n;
};

const account = (s: string): TipsRung['account'] | null => {
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^(taxable|brokerage|regular|nonqualified|taxed)/.test(t)) return 'taxable';
  if (/^(pretax|traditional|trad|ira|rollover|401k|403b|tira)/.test(t)) return 'traditional';
  if (/^roth/.test(t)) return 'roth';
  return null;
};

const isHeader = (cells: string[]): boolean => cells.length > 0 && !/\d/.test(cells[0]);

export function parseTipsCsv(
  text: string,
  names: { a: string; b?: string },
  makeId: (i: number) => string = (i) => `tips-${Date.now()}-${i}`,
): TipsCsvResult {
  const rungs: TipsRung[] = [];
  const errors: TipsCsvError[] = [];
  const lines = text.split(/\r?\n/);
  let seen = 0;
  lines.forEach((raw, idx) => {
    if (raw.trim() === '') return;
    const line = idx + 1;
    const cells = splitCells(raw);
    if (seen === 0 && isHeader(cells)) { seen++; return; }
    seen++;
    const year = Number((cells[0] ?? '').match(/\b(19|20|21)\d{2}\b/)?.[0]);
    if (!Number.isInteger(year)) { errors.push({ line, message: 'Maturity: no year found' }); return; }
    const principal = money(cells[1] ?? '');
    if (!(principal > 0)) { errors.push({ line, message: 'Adjusted principal must be a positive amount' }); return; }
    const rate = coupon(cells[2] ?? '');
    if (!Number.isFinite(rate) || rate > 0.2) { errors.push({ line, message: 'Coupon must be between 0% and 20%' }); return; }
    const acct = account(cells[3] ?? '');
    if (acct === null) { errors.push({ line, message: 'Account must be taxable, pre-tax or Roth' }); return; }
    const ownerText = (cells[4] ?? '').trim().toLowerCase();
    const isB = ownerText === 'b' || (!!names.b && ownerText !== '' && ownerText === names.b.toLowerCase());
    const whose: TipsRung['whose'] = acct === 'traditional' ? (isB && names.b ? 'B' : 'A') : 'Household';
    const faceText = cells[5] ?? '';
    const face = faceText === '' ? undefined : money(faceText);
    if (face !== undefined && !(face > 0)) { errors.push({ line, message: 'Par value must be a positive amount' }); return; }
    rungs.push({
      id: makeId(rungs.length),
      maturityYear: year,
      adjustedPrincipal: principal,
      couponRate: rate,
      account: acct,
      whose,
      ...(face !== undefined && face !== principal ? { faceValue: face } : {}),
    });
  });
  return { rungs, errors };
}
