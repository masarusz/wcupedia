import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { addTournamentHostKeys, mergeSearchAliases } from '../tools/lib/search-data.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, 'public/data', name), 'utf8'));

export function register(test, equal, deepEqual) {
  test('search build copies every host team key to its tournament', () => {
    const entries = load('search.json');
    const tournaments = load('tournaments.json');
    const byTarget = new Map(entries.map((entry) => [`${entry.type}:${entry.id}`, entry]));
    for (const tournament of tournaments) {
      const tournamentKeys = new Set(byTarget.get(`tournament:${tournament.year}`).keys);
      for (const host of tournament.hosts) {
        for (const key of byTarget.get(`team:${host}`).keys) equal(tournamentKeys.has(key), true, `${tournament.year} ${host} ${key}`);
      }
    }
  });

  test('search build folds and merges curated aliases', () => {
    const entries = [{ type: 'team', id: 'AAA', label: 'A', keys: ['a'] }];
    deepEqual(mergeSearchAliases(entries, { _about: 'test', 'team:AAA': ['ＦＯＯ・Bar'] })[0].keys, ['a', 'foo bar']);
    const built = load('search.json');
    for (const [target, expected] of [['team:JPN', 'にっぽん'], ['player:P-70442', 'くりろな'], ['player:P-64077', 'えんばぺ']]) {
      const [type, id] = target.split(':');
      equal(built.find((entry) => entry.type === type && entry.id === id).keys.includes(expected), true, target);
    }
  });

  test('search build rejects unknown and malformed aliases', () => {
    const entries = [{ type: 'team', id: 'AAA', label: 'A', keys: ['a'] }];
    for (const aliases of [{ 'team:NOPE': ['x'] }, { 'bad': ['x'] }, { 'team:AAA': [] }, { 'team:AAA': [3] }]) {
      let message = '';
      try { mergeSearchAliases(entries, aliases); } catch (error) { message = error.message; }
      equal(Boolean(message), true, JSON.stringify(aliases));
    }
  });

  test('data build fails when the alias file names an unknown target', () => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'wcupedia-alias-build-'));
    try {
      const aliases = resolve(temporary, 'aliases.json');
      const output = resolve(temporary, 'out');
      writeFileSync(aliases, '{"team:NOPE":["x"]}\n');
      let message = '';
      try {
        execFileSync(process.execPath, [resolve(ROOT, 'tools/build-data.mjs'), '--src', resolve(ROOT, '.cache/sources'),
          '--out', output, '--search-aliases', aliases], { cwd: ROOT, stdio: 'pipe' });
      } catch (error) { message = `${error.stderr || ''}${error.stdout || ''}`; }
      equal(message.includes('unknown search alias target team:NOPE'), true, message);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('search build host-key helper rejects an unknown host', () => {
    let message = '';
    try {
      addTournamentHostKeys([
        { type: 'team', id: 'AAA', label: 'A', keys: ['a'] },
        { type: 'tournament', id: '2000', label: '2000', keys: ['2000'] },
      ], [{ year: 2000, hosts: ['NOPE'] }]);
    } catch (error) { message = error.message; }
    equal(message.includes('unknown tournament host'), true);
  });
}
