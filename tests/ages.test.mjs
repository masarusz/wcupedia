import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import golden from './golden/ages.json' with { type: 'json' };
import { ageInYears } from '../public/js/ages.js?v=0.5.1';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = join(ROOT, 'public/data');
const load = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

function buildError(corrections) {
  const work = mkdtempSync(join(tmpdir(), 'wcupedia-age-build-'));
  const correctionsPath = join(work, 'corrections.json');
  writeFileSync(correctionsPath, JSON.stringify(corrections));
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools/build-data.mjs'),
      '--src', join(ROOT, '.cache/sources'), '--out', join(work, 'out'),
      '--birth-date-corrections', correctionsPath], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return '';
  } catch (error) {
    return `${error.stderr || ''}${error.stdout || ''}`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function register(test, equal, deepEqual) {
  test('golden opening days, birth dates, ages and age rankings', () => {
    const tournaments = load('tournaments.json');
    const players = load('players.json');
    const rankings = load('rankings.json').players;
    const details = new Map(tournaments.map((tournament) => [tournament.year, load(`t/${tournament.year}.json`)]));
    deepEqual(Object.fromEntries(tournaments.map((tournament) => [tournament.year, tournament.start])), golden.openingDay, 'opening days');

    for (const [id, expected] of Object.entries(golden.samples)) {
      equal(players[id].birthDate, expected.birthDate, `${id} birth date`);
      for (const [year, age] of Object.entries(expected.ageByYear)) {
        equal(ageInYears(players[id].birthDate, golden.openingDay[year]), age, `${id} ${year} age`);
      }
    }

    const rankingRows = (key) => rankings[key].slice(0, 10).map((row) => ({
      player: row.player.startsWith('P26-') ? `2026:${row.team}:${row.name}` : row.player,
      name: row.name, team: row.team, year: row.year, birthDate: players[row.player].birthDate,
      age: row.age, ageDays: row.ageDays,
    }));
    deepEqual(rankingRows('youngest'), golden.youngestTop10, 'youngest top 10');
    deepEqual(rankingRows('oldest'), golden.oldestTop10, 'oldest top 10');

    let missing = 0;
    for (const detail of details.values()) for (const member of Object.values(detail.squads).flat()) {
      if (!players[member.player].birthDate) missing += 1;
    }
    equal(missing, golden.squadRowsWithoutBirthDate, 'squad rows without birth date');
  });

  test('birth-date correction is applied and invalid corrections fail', () => {
    const players = load('players.json');
    equal(players['P-76869'].birthDate, '1936-11-22', 'Alex Scott correction');
    const cases = [
      [{ 'P-00000': { birthDate: '2000-01-01', source: 'test' } }, 'birth-date correction has unknown player P-00000'],
      [{ 'P-14758': { birthDate: '1987-02-30', source: 'test' } }, 'invalid birth-date correction P-14758'],
      [{ 'P-14758': { birthDate: '1987-06-24', source: 'test' } }, 'birth-date correction equals source value for P-14758'],
    ];
    for (const [corrections, message] of cases) equal(buildError(corrections).includes(message), true, message);
  });

  test('squad age guard rejects synthetic young and old players', () => {
    const corrections = JSON.parse(readFileSync(join(ROOT, 'curated/birth-date-corrections.json'), 'utf8'));
    for (const [birthDate, age] of [['1994-06-09', 12], ['1956-06-09', 50]]) {
      const mutant = { ...corrections, 'P-14758': { birthDate, source: 'synthetic test' } };
      const error = buildError(mutant);
      equal(error.includes('squad age outside 15..46'), true, `${age} guard message`);
      equal(error.includes(`2006 ARG P-14758 ${birthDate}: ${age}`), true, `${age} offender listed`);
    }
  });
}
