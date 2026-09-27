import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import oracle from './golden/fifa.json' with { type: 'json' };
import { buildFifaRanking } from '../tools/lib/fifa-ranking.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const load = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const source = load('curated/fifa-ranking.json');
const teams = load('public/data/teams.json');
const built = load('public/data/fifa-ranking.json');

export function register(test, equal, deepEqual) {
  const rejected = (change, label) => {
    const mutant = structuredClone(source);
    change(mutant);
    let message = '';
    try { buildFifaRanking(mutant, teams); } catch (error) { message = error.message; }
    equal(message.length > 0, true, label);
  };

  test('FIFA ranking matches the independent top-55 oracle', () => {
    equal(built.releaseDate, oracle.releaseDate, 'release date');
    for (const expected of oracle.top55) {
      const actual = built.rows[expected.rank - 1];
      equal(actual.rank, expected.rank, `rank ${expected.rank}`);
      equal(actual.points, expected.points, `rank ${expected.rank} points`);
      if (Object.hasOwn(actual, 'team')) equal(actual.team, expected.code, `rank ${expected.rank} team`);
    }
    deepEqual(built, buildFifaRanking(source, teams), 'generated FIFA ranking');
  });

  test('FIFA build guard rejects wrong row count or non-contiguous ranks', () => {
    rejected((mutant) => { mutant.rows.pop(); }, 'row count');
    rejected((mutant) => { mutant.rows[80].rank = 82; }, 'contiguous ranks');
  });

  test('FIFA build guard rejects increasing points', () => {
    rejected((mutant) => { mutant.rows[80].points = mutant.rows[79].points + 1; }, 'points order');
  });

  test('FIFA build guard rejects unknown team keys', () => {
    rejected((mutant) => { mutant.rows[0].team = 'XXX'; }, 'unknown team');
  });

  test('FIFA build guard rejects incomplete non-team rows', () => {
    rejected((mutant) => { mutant.rows.find((row) => row.name).name = ''; }, 'non-team name');
    rejected((mutant) => { mutant.rows.find((row) => row.name).flag = ''; }, 'non-team flag');
  });

  test('FIFA build guard rejects an invalid release date', () => {
    rejected((mutant) => { mutant.releaseDate = '2026-02-30'; }, 'release date');
  });
}
