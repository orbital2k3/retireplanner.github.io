import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name.startsWith('__') ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const rel = (p: string) => p.slice(SRC.length + 1);

describe('§3.3 one optimizer runner', () => {
  it('only strategyActions.ts calls the worker optimize method', () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => rel(p) !== 'store/strategyActions.ts')
      .filter((p) => /\.optimize\(/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the worker calls optimizeStrategy', () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => !['engine/worker.ts', 'engine/optimizer.ts'].includes(rel(p)))
      .filter((p) => /\boptimizeStrategy\(/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('results pages never send the user back to Inputs', () => {
    const RESULTS = ['pages/Dashboard.tsx', 'pages/Projections.tsx', 'pages/TaxPlanning.tsx', 'pages/MonteCarlo.tsx', 'components/StalePlanBanner.tsx'];
    const offenders = RESULTS.filter((f) => /navigate\(\s*['"`]\/(personal|inputs)/.test(readFileSync(join(SRC, f), 'utf8')) || /<Navigate\b/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('app code reads status from the saved plan, never the flat engine policyStatus', () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => /^(components|pages|hooks|store|storage)\//.test(rel(p)))
      .filter((p) => !['store/planMigrations.ts'].includes(rel(p)))
      .filter((p) => /\bpolicyStatus\(/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
