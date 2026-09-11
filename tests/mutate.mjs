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
} finally {
  rmSync(work, { recursive: true, force: true });
}

const killed = rows.filter((row) => row.killed).length;
console.log(`mutations: ${killed}/${rows.length} killed`);
if (killed !== rows.length) process.exitCode = 1;
