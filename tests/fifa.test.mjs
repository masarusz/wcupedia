import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import oracle from './golden/fifa.json' with { type: 'json' };
import japanOracle from './golden/japan-h2h.json' with { type: 'json' };
import { buildFifaRanking } from '../tools/lib/fifa-ranking.mjs';
import { buildJapanH2h } from '../tools/lib/japan-h2h.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const load = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const source = load('curated/fifa-ranking.json');
const teams = load('public/data/teams.json');
const built = load('public/data/fifa-ranking.json');
const japanSource = load('curated/japan-h2h.json');
const japanBuilt = load('public/data/japan-h2h.json');

export function register(test, equal, deepEqual) {
  const rejected = (change, label) => {
    const mutant = structuredClone(source);
    change(mutant);
    let message = '';
    try { buildFifaRanking(mutant, teams); } catch (error) { message = error.message; }
    equal(message.length > 0, true, label);
  };
  const japanRejected = (change, label) => {
    const mutant = structuredClone(japanSource);
    change(mutant);
    let message = '';
    try { buildJapanH2h(mutant, built); } catch (error) { message = error.message; }
    equal(message.length > 0, true, label);
  };

  test('FIFA ranking and Japan head-to-head data match independent oracles', () => {
    equal(built.releaseDate, oracle.releaseDate, 'release date');
    for (const expected of oracle.top55) {
      const actual = built.rows[expected.rank - 1];
      equal(actual.rank, expected.rank, `rank ${expected.rank}`);
      equal(actual.points, expected.points, `rank ${expected.rank} points`);
      if (Object.hasOwn(actual, 'team')) equal(actual.team, expected.code, `rank ${expected.rank} team`);
    }
    deepEqual(built, buildFifaRanking(source, teams), 'generated FIFA ranking');
    deepEqual(japanBuilt, buildJapanH2h(japanSource, built), 'generated Japan head-to-head data');
    equal(Object.keys(japanBuilt.rows).length, 111, 'Japan opponent rows');
    for (const [key, expected] of Object.entries(japanOracle.rows)) {
      for (const figure of ['p', 'w', 'd', 'l', 'gf', 'ga']) {
        equal(japanBuilt.rows[key][figure], expected[figure], `${key} ${figure}`);
      }
    }
  });

  test('FIFA build guards reject wrong row counts, ranks, and unknown Japan opponents', () => {
    rejected((mutant) => { mutant.rows.pop(); }, 'row count');
    rejected((mutant) => { mutant.rows[80].rank = 82; }, 'contiguous ranks');
    japanRejected((mutant) => { mutant.rows.UNKNOWN = mutant.rows.BRA; delete mutant.rows.BRA; }, 'unknown Japan opponent');
  });

  test('FIFA build guards reject increasing points and invalid Japan record arithmetic', () => {
    rejected((mutant) => { mutant.rows[80].points = mutant.rows[79].points + 1; }, 'points order');
    japanRejected((mutant) => { mutant.rows.BRA.w += 1; }, 'Japan win-draw-loss total');
  });

  test('FIFA build guards reject unknown team keys and wrong Japan match coverage', () => {
    rejected((mutant) => { mutant.rows[0].team = 'XXX'; }, 'unknown team');
    japanRejected((mutant) => { mutant.rows.BRA.p += 1; mutant.rows.BRA.w += 1; }, 'Japan covered-match total');
  });

  test('FIFA build guard rejects incomplete non-team rows', () => {
    rejected((mutant) => { mutant.rows.find((row) => row.name).name = ''; }, 'non-team name');
    rejected((mutant) => { mutant.rows.find((row) => row.name).flag = ''; }, 'non-team flag');
  });

  test('FIFA build guards reject invalid dates', () => {
    rejected((mutant) => { mutant.releaseDate = '2026-02-30'; }, 'release date');
    japanRejected((mutant) => { mutant.asOf = '2026-02-30'; }, 'Japan as-of date');
  });
}
