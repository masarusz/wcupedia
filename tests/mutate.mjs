#!/usr/bin/env node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'wcupedia-mutations-'));
const rows = [];

function mutate(source, before, after, name) {
  if (!source.includes(before)) throw new Error(`${name}: mutation target not found`);
  return source.replace(before, after);
}

async function searchMutant(name, before, after, probe, foldMutation = null) {
  const root = join(work, name.replaceAll(' ', '-'));
  cpSync(join(ROOT, 'public/js'), join(root, 'public/js'), { recursive: true });
  const searchPath = join(root, 'public/js/search.js');
  writeFileSync(searchPath, mutate(readFileSync(searchPath, 'utf8'), before, after, name));
  if (foldMutation) {
    const foldPath = join(root, 'public/js/fold.js');
    writeFileSync(foldPath, mutate(readFileSync(foldPath, 'utf8'), foldMutation[0], foldMutation[1], name));
  }
  const module = await import(`${pathToFileURL(searchPath).href}?mutation=${encodeURIComponent(name)}`);
  return probe(module);
}

async function helperMutant(name, before, after, probe) {
  const root = join(work, name.replaceAll(' ', '-'));
  cpSync(join(ROOT, 'tools/lib/search-data.mjs'), join(root, 'search-data.mjs'));
  let source = readFileSync(join(root, 'search-data.mjs'), 'utf8');
  source = source.replace("../../public/js/fold.js", pathToFileURL(join(ROOT, 'public/js/fold.js')).href);
  writeFileSync(join(root, 'search-data.mjs'), mutate(source, before, after, name));
  const module = await import(`${pathToFileURL(join(root, 'search-data.mjs')).href}?mutation=${encodeURIComponent(name)}`);
  return probe(module);
}

async function ageMutant(name, before, after, probe) {
  const root = join(work, name.replaceAll(' ', '-'));
  const path = join(root, 'ages.mjs');
  cpSync(join(ROOT, 'public/js/ages.js'), path);
  writeFileSync(path, mutate(readFileSync(path, 'utf8'), before, after, name));
  return probe(await import(`${pathToFileURL(path).href}?mutation=${encodeURIComponent(name)}`));
}

async function sourceMutant(name, relativePath, before, after, probe) {
  const source = readFileSync(join(ROOT, relativePath), 'utf8');
  return probe(mutate(source, before, after, name));
}

async function run(name, execute) {
  let killed = false;
  try { killed = !(await execute()); } catch { killed = true; }
  rows.push({ name, killed });
  console.log(`mutation: ${killed ? 'killed' : 'survived'} - ${name}`);
}

const make = (type, id, label, keys, fame) => ({ type, id, label, keys, ...(fame ? { fame } : {}) });

try {
  await run('loose tier ranked with strict', () => searchMutant('loose tier ranked with strict',
    'tier = looseTier + 10', 'tier = looseTier', ({ prepareIndex, search }) => {
      const index = prepareIndex([make('player', 'strict', 'Zulu', ['めし']), make('player', 'loose', 'Alpha', ['めっし'])]);
      return search(index, 'めし').map((item) => item.id).join(',') === 'strict,loose';
    }));
  await run('single-character substring allowed', () => searchMutant('single-character substring allowed',
    'if (characterCount(compactQuery) >= 2 && keys.some((key) => key[compactName].includes(compactQuery)))',
    'if (keys.some((key) => key[compactName].includes(compactQuery)))', ({ prepareIndex, search }) =>
      search(prepareIndex([make('team', 'inside', 'Inside', ['あいう'])]), 'い').length === 0));
  await run('type order player first', () => searchMutant('type order player first',
    "{ team: 0, tournament: 1, player: 2 }", "{ player: 0, tournament: 1, team: 2 }", ({ prepareIndex, search }) =>
      search(prepareIndex([make('player', 'p', 'P', ['x']), make('team', 't', 'T', ['x'])]), 'x')[0].type === 'team'));
  await run('fame order reversed', () => searchMutant('fame order reversed',
    'right.stats.goals - left.stats.goals', 'left.stats.goals - right.stats.goals', ({ prepareIndex, search }) =>
      search(prepareIndex([make('player', 'famous', 'Same', ['x'], [9, 0, 1]), make('player', 'other', 'Same', ['x'], [1, 0, 1])]), 'x')[0].id === 'famous'));
  await run('aliases not merged', () => helperMutant('aliases not merged',
    'const extra = additions.get(`${entry.type}:${entry.id}`);', 'const extra = null;', ({ mergeSearchAliases }) =>
      mergeSearchAliases([make('team', 'JPN', 'Japan', ['japan'])], { 'team:JPN': ['にっぽん'] })[0].keys.includes('にっぽん')));
  await run('host keys missing', () => helperMutant('host keys missing',
    'return { ...entry, keys: unique([...entry.keys, ...hostKeys]) };', 'return entry;', ({ addTournamentHostKeys }) => {
      const output = addTournamentHostKeys([make('team', 'QAT', 'Qatar', ['かたーる']), make('tournament', '2022', '2022', ['2022'])],
        [{ year: 2022, hosts: ['QAT'] }]);
      return output[1].keys.includes('かたーる');
    }));
  await run('input re-rendered on input', async () => {
    const source = readFileSync(join(ROOT, 'public/js/views.js'), 'utf8');
    const mutant = mutate(source, "input.addEventListener('input', () => {\n    updateUrl(input.value);",
      "input.addEventListener('input', () => {\n    input.replaceWith(input.cloneNode(true));\n    updateUrl(input.value);", 'input re-rendered on input');
    const inputHandler = mutant.slice(mutant.indexOf("input.addEventListener('input'"), mutant.indexOf('if (eager || initialQuery)'));
    return !/replaceWith|replaceChildren/.test(inputHandler);
  });
  await run('location.hash used for query', async () => {
    const source = readFileSync(join(ROOT, 'public/js/app.js'), 'utf8');
    const mutant = mutate(source, "history.replaceState(null, '', `#${path}${suffix}`);", "location.hash = `#${path}${suffix}`;", 'location.hash used for query');
    const options = mutant.slice(mutant.indexOf('function searchOptions'), mutant.indexOf('async function renderRoute'));
    return options.includes('history.replaceState') && !options.includes('location.hash');
  });
  await run('ぽ folded to ほ', () => searchMutant('ぽ folded to ほ',
    'const TYPE_ORDER', 'const TYPE_ORDER', ({ prepareIndex, search }) =>
      search(prepareIndex([make('team', 'PRT', 'Portugal', ['ぽるとがる'])]), 'ほ').length === 0,
    [".normalize('NFC')\n    .replace(/[øæœßłđðþı]/g", ".normalize('NFC')\n    .replace(/ぽ/g, 'ほ')\n    .replace(/[øæœßłđðþı]/g"]));
  await run('age computed from Jan 1', () => ageMutant('age computed from Jan 1',
    "return onYear - birthYear - (onMonth < birthMonth || (onMonth === birthMonth && onDay < birthDay) ? 1 : 0);",
    'return onYear - birthYear;', ({ ageInYears }) => ageInYears('1998-12-20', '2018-06-14') === 19));
  await run('birth-date corrections ignored', () => sourceMutant('birth-date corrections ignored', 'tools/build-data.mjs',
    'birthDates.set(id, correction.birthDate);', '// correction ignored', (source) => source.includes('birthDates.set(id, correction.birthDate);')));
  await run('squad age guard removed', () => sourceMutant('squad age guard removed', 'tools/build-data.mjs',
    "if (ageGuardOffenders.length) throw new Error(`squad age outside 15..46:\\n${ageGuardOffenders.sort(compare).join('\\n')}`);",
    '// age guard removed', (source) => source.includes('squad age outside 15..46')));
  await run('youngest ranked by whole years', () => sourceMutant('youngest ranked by whole years', 'tools/build-data.mjs',
    'values: (row) => [-row.ageDays]', 'values: (row) => [-row.age]', (source) => source.includes('values: (row) => [-row.ageDays]')));
  await run('age ranking emits one row per squad', () => sourceMutant('age ranking emits one row per squad', 'tools/build-data.mjs',
    ".map(([id]) => ageRankingRow(id, (value, best) => value < best))", ".flatMap(([id, player]) => player.years.map(() => ageRankingRow(id, (value, best) => value < best)))",
    (source) => source.includes(".map(([id]) => ageRankingRow(id, (value, best) => value < best))")));
  await run('もどる shown on home', () => sourceMutant('もどる shown on home', 'public/js/app.js',
    "backSlot.replaceChildren(...(route === '/' ? [] : [backButton]));", 'backSlot.replaceChildren(backButton);',
    (source) => source.includes("route === '/' ? [] : [backButton]")));
  await run('search replaceState null restored', () => sourceMutant('search replaceState null restored', 'public/js/app.js',
    "history.replaceState(history.state, '', `#${path}${suffix}`);", "history.replaceState(null, '', `#${path}${suffix}`);",
    (source) => source.includes("history.replaceState(history.state, '', `#${path}${suffix}`)")));
  await run('match header country link removed', () => sourceMutant('match header country link removed', 'public/js/views.js',
    "countryLink(teams, match.home, 'country-link score-team')", "team(teams, match.home, 'score-team')",
    (source) => source.slice(source.indexOf('export function matchView'), source.indexOf('const REGION_SECTIONS'))
      .includes("countryLink(teams, match.home, 'country-link score-team')")));
  await run('player tournaments ordered ascending', () => sourceMutant('player tournaments ordered ascending', 'public/js/views.js',
    '[...details].sort((a, b) => b.year - a.year)', '[...details].sort((a, b) => a.year - b.year)',
    (source) => source.includes('[...details].sort((a, b) => b.year - a.year)')));
  await run('player tournament heading hosts omitted', () => sourceMutant('player tournament heading hosts omitted', 'public/js/views.js',
    "el('h2', {}, [\n        el('a', { href: `#/t/${detail.year}` }, rubyNodes(tournamentTitle(detail, teams))),",
    "el('h2', {}, [\n        el('a', { href: `#/t/${detail.year}` }, `${detail.year}年大会`),",
    (source) => source.slice(source.indexOf('export function playerView'), source.indexOf('const COUNTRY_METRICS'))
      .includes('rubyNodes(tournamentTitle(detail, teams))')));
  await run('standings min-width restored', () => sourceMutant('standings min-width restored', 'public/css/app.css',
    '.standings { width: 100%;', '.standings { min-width: 820px; width: 100%;',
    (source) => !/\.standings\s*\{[^}]*min-width\s*:\s*(?:[6-9]\d\d|\d{4,})px/s.test(source)));
} finally {
  rmSync(work, { recursive: true, force: true });
}

const killed = rows.filter((row) => row.killed).length;
console.log(`mutations: ${killed}/${rows.length} killed`);
if (killed !== rows.length) process.exitCode = 1;
