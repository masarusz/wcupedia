import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseModuleDates, decide } from '../tools/ranking-check.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES = join(import.meta.dirname, 'fixtures/ranking-check');

function runCli(moduleName, today, curated = null) {
  const dir = mkdtempSync(join(tmpdir(), 'wcupedia-ranking-check-'));
  const env = {
    ...process.env,
    WCUPEDIA_MODULE_FILE: join(FIXTURES, moduleName),
    WCUPEDIA_TODAY: today,
  };
  if (curated) {
    const curatedPath = join(dir, 'fifa-ranking.json');
    writeFileSync(curatedPath, `${JSON.stringify(curated)}\n`);
    env.WCUPEDIA_CURATED_FILE = curatedPath;
  }
  let code = 0;
  try {
    execFileSync('bash', ['scripts/monthly-ranking-check.sh', dir], { cwd: ROOT, env, stdio: 'pipe' });
  } catch (error) {
    code = error.status;
  }
  return { code, status: readFileSync(join(dir, 'wcupedia-refresh-status.md'), 'utf8') };
}

export function register(test, equal, deepEqual) {
  test('ranking-check parser accepts real spacing and English month names', () => {
    const text = readFileSync(join(FIXTURES, 'current.lua'), 'utf8');
    deepEqual(parseModuleDates(text), {
      updated: '2026-10-07', previous: '2026-07-20', next: '2026-11-18',
    });
  });

  test('ranking-check parser accepts double-quoted months and a missing next line', () => {
    const text = "data.updated = { day = 7, month = \"October\", year = 2026 }\n" +
      "data.previous = { day = 20, month = 'July', year = 2026 }\n";
    deepEqual(parseModuleDates(text), {
      updated: '2026-10-07', previous: '2026-07-20', next: null,
    });
  });

  test('ranking-check parser rejects garbage months and impossible calendar days', () => {
    const text = "data.updated = { day = 7, month = 'Octember', year = 2026 }\n" +
      "data.previous = { day = 30, month = 'February', year = 2026 }\n";
    deepEqual(parseModuleDates(text), { updated: null, previous: null, next: null });
  });

  test('ranking-check decision returns BROKE for an unparsed module date', () => {
    deepEqual(decide({ updated: null, releaseDate: '2026-10-07', today: '2026-10-08' }), {
      outcome: 'BROKE', code: 1, reason: 'The module data.updated date could not be parsed.',
    });
  });

  test('ranking-check decision returns NEW for a newer module date', () => {
    equal(decide({ updated: '2026-11-18', releaseDate: '2026-10-07', today: '2026-11-18' }).outcome, 'NEW');
  });

  test('ranking-check decision returns HOLD when the source goes backwards', () => {
    equal(decide({ updated: '2026-07-20', releaseDate: '2026-10-07', today: '2026-10-08' }).outcome, 'HOLD');
  });

  test('ranking-check decision returns NOOP for matching current dates', () => {
    equal(decide({ updated: '2026-10-07', releaseDate: '2026-10-07', nextUpdate: '2026-11-18', today: '2026-10-08' }).outcome, 'NOOP');
  });

  test('ranking-check overdue boundary holds only after ten full days', () => {
    equal(decide({ updated: '2026-10-07', releaseDate: '2026-10-07', nextUpdate: '2026-11-18', today: '2026-11-28' }).outcome, 'NOOP');
    equal(decide({ updated: '2026-10-07', releaseDate: '2026-10-07', nextUpdate: '2026-11-18', today: '2026-11-29' }).outcome, 'HOLD');
  });

  test('ranking-check CLI reports every outcome and leaves the worktree unchanged', () => {
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    const cases = [
      ['current.lua', '2026-11-28', null, 0, 'NOOP'],
      ['new.lua', '2026-11-18', null, 3, 'NEW'],
      ['current.lua', '2026-11-29', null, 2, 'HOLD'],
      ['older.lua', '2026-10-08', null, 2, 'HOLD'],
      ['unparseable.lua', '2026-10-08', null, 1, 'BROKE'],
    ];
    for (const [fixture, today, curated, expectedCode, outcome] of cases) {
      const result = runCli(fixture, today, curated);
      equal(result.code, expectedCode, `${outcome} exit code`);
      equal(result.status.split('\n')[0], `# Wcupedia FIFA ranking check: ${outcome}`, `${outcome} status`);
    }
    let missingCode = 0;
    try {
      execFileSync('bash', ['scripts/monthly-ranking-check.sh'], { cwd: ROOT, stdio: 'pipe' });
    } catch (error) {
      missingCode = error.status;
    }
    equal(missingCode, 1, 'missing argument exit code');
    equal(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }), before, 'git status');
    console.log('ranking-check cli cases=6');
  });
}
