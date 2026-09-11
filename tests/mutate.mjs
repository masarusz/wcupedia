#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'wcupedia-mutations-'));
const rows = [];
const loadData = (name) => JSON.parse(readFileSync(join(ROOT, 'public/data', name), 'utf8'));

class MutationNode {}
class MutationText extends MutationNode {
  constructor(value) { super(); this.value = String(value); }
  get textContent() { return this.value; }
}
class MutationElement extends MutationNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this.value = '';
    this.classList = { toggle: () => {} };
  }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { for (const child of children) this.childNodes.push(child instanceof MutationNode ? child : new MutationText(child)); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  get textContent() { return this.childNodes.map((child) => child.textContent).join(''); }
}
const mutationDescendants = (node) => node instanceof MutationElement
  ? [node, ...node.childNodes.flatMap(mutationDescendants)] : [];
const mutationHasClass = (node, name) => (node.getAttribute('class') || '').split(/\s+/).includes(name);

async function withMutationDocument(run) {
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  globalThis.Node = MutationNode;
  globalThis.document = {
    createElement: (tagName) => new MutationElement(tagName),
    createTextNode: (value) => new MutationText(value),
  };
  try { return await run(); } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
  }
}

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

async function photoHelperMutant(name, before, after, probe) {
  const root = join(work, name.replaceAll(' ', '-'));
  mkdirSync(root, { recursive: true });
  const path = join(root, 'photos.mjs');
  const source = mutate(readFileSync(join(ROOT, 'tools/lib/photos.mjs'), 'utf8'), before, after, name);
  writeFileSync(path, source);
  return probe(await import(`${pathToFileURL(path).href}?mutation=${encodeURIComponent(name)}`));
}

async function playersJaMutant(name, before, after, probe) {
  const root = join(work, name.replaceAll(' ', '-'));
  mkdirSync(root, { recursive: true });
  const path = join(root, 'players-ja.mjs');
  let source = mutate(readFileSync(join(ROOT, 'tools/lib/players-ja.mjs'), 'utf8'), before, after, name);
  source = source.replace('../../public/js/fold.js', pathToFileURL(join(ROOT, 'public/js/fold.js')).href);
  writeFileSync(path, source);
  return probe(await import(`${pathToFileURL(path).href}?mutation=${encodeURIComponent(name)}`));
}

async function viewsMutant(name, before, after, probe) {
  const root = join(work, name.replaceAll(' ', '-'));
  cpSync(join(ROOT, 'public/js'), join(root, 'public/js'), { recursive: true });
  const path = join(root, 'public/js/views.js');
  writeFileSync(path, mutate(readFileSync(path, 'utf8'), before, after, name));
  const module = await import(`${pathToFileURL(path).href}?mutation=${encodeURIComponent(name)}`);
  return withMutationDocument(() => probe(module));
}

async function pythonPhotoMutant(name, before, after, probe) {
  const root = join(work, name.replaceAll(' ', '-'));
  const output = join(root, 'out');
  const baselineOutput = join(root, 'baseline');
  const originalRoot = join(root, 'orig');
  const fixtureId = 'P-00001';
  mkdirSync(originalRoot, { recursive: true });
  const path = join(root, 'build_photos.py');
  writeFileSync(path, mutate(readFileSync(join(ROOT, 'scripts/build_photos.py'), 'utf8'), before, after, name));
  const manifestPath = join(root, 'photos.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    [fixtureId]: {
      licence: 'CC0', licenceUrl: '', artist: 'Test', source: 'Test',
      size: [400, 400], face: [0.05, 0.1, 0.15, 0.15],
    },
  }, null, 2)}\n`);
  execFileSync('python3', ['-c', [
    'from PIL import Image, ImageDraw',
    'import sys',
    "image = Image.new('RGB', (400, 400), (245, 245, 245))",
    'draw = ImageDraw.Draw(image)',
    'for x in range(400):',
    '    draw.line((x, 0, x, 399), fill=((x * 7) % 256, (x * 11) % 256, (x * 17) % 256))',
    'draw.rectangle((20, 300, 80, 360), fill=(255, 224, 189), outline=(20, 20, 20), width=5)',
    'exif = Image.Exif()',
    "exif[0x010E] = 'wcupedia mutation fixture'",
    "image.save(sys.argv[1], format='JPEG', quality=95, subsampling=0, exif=exif)",
  ].join('\n'), join(originalRoot, `${fixtureId}.jpg`)]);
  const buildArgs = ['--manifest', manifestPath, '--orig', originalRoot];
  execFileSync('python3', [join(ROOT, 'scripts/build_photos.py'), ...buildArgs, '--out', baselineOutput]);
  execFileSync('python3', [path, ...buildArgs, '--out', output]);
  return probe(output, { baselineOutput, fixtureId });
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
  await run('tournament search results oldest first', () => searchMutant('tournament search results oldest first',
    'Number(right.entry.id) - Number(left.entry.id)', 'Number(left.entry.id) - Number(right.entry.id)', ({ prepareIndex, search }) =>
      search(prepareIndex([make('tournament', '1950', '1950', ['host']), make('tournament', '2014', '2014', ['host'])]), 'host')
        .map((item) => item.id).join(',') === '2014,1950'));
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
  await run('country tournaments ordered ascending', () => viewsMutant('country tournaments ordered ascending',
    'const tournamentRows = [...country.tournaments].sort((a, b) => b.year - a.year);',
    'const tournamentRows = [...country.tournaments].sort((a, b) => a.year - b.year);', ({ countryView }) => {
      const tree = countryView('JPN', loadData('teams.json'));
      const list = mutationDescendants(tree).find((node) => mutationHasClass(node, 'country-tournaments'));
      return list.childNodes.map((node) => node.getAttribute('data-year')).join(',') === '2026,2022,2018,2014,2010,2006,2002,1998';
    }));
  await run('opponent matches ordered oldest first', () => viewsMutant('opponent matches ordered oldest first',
    'compareText(b.date, a.date) || compareText(b.id, a.id)',
    'compareText(a.date, b.date) || compareText(a.id, b.id)', ({ countryView }) => {
      const tree = countryView('JPN', loadData('teams.json'));
      const list = mutationDescendants(tree).find((node) => mutationHasClass(node, 'opponent-matches')
        && mutationDescendants(node).some((child) => child.getAttribute('href') === '#/m/M-2022-53'));
      return list.childNodes.map((node) => node.getAttribute('data-year')).join(',') === '2022,2006,1998';
    }));
  await run('player tournaments ordered ascending', () => sourceMutant('player tournaments ordered ascending', 'public/js/views.js',
    '[...details].sort((a, b) => b.year - a.year)', '[...details].sort((a, b) => a.year - b.year)',
    (source) => source.includes('[...details].sort((a, b) => b.year - a.year)')));
  await run('player awards ordered ascending', () => viewsMutant('player awards ordered ascending',
    'const awardRows = [...player.awards].sort((a, b) => b[0] - a[0]);',
    'const awardRows = [...player.awards].sort((a, b) => a[0] - b[0]);', ({ playerView }) => {
      const player = loadData('players.json')['P-14758'];
      const details = player.years.map((year) => loadData(`t/${year}.json`));
      const tree = playerView('P-14758', player, details, loadData('teams.json'));
      const awards = mutationDescendants(tree).find((node) => mutationHasClass(node, 'player-awards'));
      return mutationDescendants(awards).filter((node) => node.tagName === 'LI')
        .map((node) => node.getAttribute('data-year')).join(',') === '2026,2026,2022,2022,2014';
    }));
  await run('player tournament heading hosts omitted', () => sourceMutant('player tournament heading hosts omitted', 'public/js/views.js',
    "el('h2', {}, [\n        el('a', { href: `#/t/${detail.year}` }, rubyNodes(tournamentTitle(detail, teams))),",
    "el('h2', {}, [\n        el('a', { href: `#/t/${detail.year}` }, `${detail.year}年大会`),",
    (source) => source.slice(source.indexOf('export function playerView'), source.indexOf('const COUNTRY_METRICS'))
      .includes('rubyNodes(tournamentTitle(detail, teams))')));
  await run('standings min-width restored', () => sourceMutant('standings min-width restored', 'public/css/app.css',
    '.standings { width: 100%;', '.standings { min-width: 820px; width: 100%;',
    (source) => !/\.standings\s*\{[^}]*min-width\s*:\s*(?:[6-9]\d\d|\d{4,})px/s.test(source)));
  await run('photo licence allowlist accepts NC', () => photoHelperMutant('photo licence allowlist accepts NC',
    '(?:-SA)?', '(?:-SA|-NC)?', ({ isAllowedPhotoLicence }) => !isAllowedPhotoLicence('CC BY-NC 4.0')));
  await run('photo face box may cross image edge', () => photoHelperMutant('photo face box may cross image edge',
    'x + width > 1 || y + height > 1', 'false', ({ validatePhotoManifest }) => {
      try {
        validatePhotoManifest({ 'P-00001': { licence: 'CC0', licenceUrl: '', artist: 'A', source: 'S', size: [10, 10], face: [0.9, 0.1, 0.2, 0.2] } });
        return false;
      } catch { return true; }
    }));
  await run('photo crop centred on image', () => pythonPhotoMutant('photo crop centred on image',
    'left = fx + fw / 2 - crop_width / 2', 'left = (image_width - crop_width) / 2', (output, { baselineOutput, fixtureId }) =>
      readFileSync(join(output, `${fixtureId}.webp`)).equals(readFileSync(join(baselineOutput, `${fixtureId}.webp`)))));
  await run('photo metadata preserved', () => pythonPhotoMutant('photo metadata preserved',
    'exif=b""', 'exif=image.info.get("exif", b"")', (output, { fixtureId }) =>
      !readFileSync(join(output, `${fixtureId}.webp`)).includes(Buffer.from('EXIF'))));
  await run('player photo modification note removed', () => viewsMutant('player photo modification note removed',
    "text('（切り抜き・縮小）')", "text('')", ({ playerView }) => {
      const [id] = Object.keys(JSON.parse(readFileSync(join(ROOT, 'curated/photos.json'), 'utf8')));
      const photo = loadData('photos.json')[id];
      const player = loadData('players.json')[id];
      const details = player.years.map((year) => loadData(`t/${year}.json`));
      const tree = playerView(id, player, details, loadData('teams.json'), photo);
      return tree.textContent.includes(`写真: ${photo.artist} / ${photo.licence}（切り抜き・縮小）`);
    }));
  await run('clubs dropped for Japanese multiline parameter', () => playersJaMutant('clubs dropped for Japanese multiline parameter',
    "parsed.named.club ?? parsed.named['クラブ']", 'parsed.named.club', ({ parseSquadWikitext }) => {
      const wiki = `=== {{TESTf}} ===\n{{サッカーナショナルチーム選手一覧 選手\n|背番号=9\n|ポジション=FW\n|名前=[[選手]]\n|原語表記=Player\n|生年月日={{生年月日と年齢2|2022|1|1|1990|1|1}}\n|クラブ=[[クラブ|表示クラブ]]\n}}`;
      return parseSquadWikitext(wiki, 2022, { TESTf: 'JPN' })[0].club === '表示クラブ';
    }));
  await run('matches shown for a pre-1970 player', () => sourceMutant('matches shown for a pre-1970 player', 'tools/build-data.mjs',
    "[...player.years].every((year) => year >= 1970)", "[...player.years].some((year) => year >= 1970)",
    (source) => source.includes("[...player.years].every((year) => year >= 1970)")));
  await run('Japan not first in player guide', () => viewsMutant('Japan not first in player guide',
    "if (left === 'JPN') return -1;", "if (left === 'JPN') return 1;", ({ meikanTeamKeys }) =>
      meikanTeamKeys({ squads: { ARG: [], JPN: [] } }, { ARG: { ja: 'アルゼンチン' }, JPN: { ja: '日本' } })[0] === 'JPN'));
  await run('player guide picker oldest first', () => viewsMutant('player guide picker oldest first',
    "const picker = el('select', { id: 'meikan-tournament', class: 'meikan-tournament-picker' },\n    [...tournaments].sort((a, b) => b.year - a.year)",
    "const picker = el('select', { id: 'meikan-tournament', class: 'meikan-tournament-picker' },\n    [...tournaments].sort((a, b) => a.year - b.year)",
    ({ meikanView }) => {
      const detail = loadData('t/2026.json');
      const tree = meikanView(detail, loadData('teams.json'), loadData('tournaments.json'), 'JPN');
      return mutationDescendants(tree).find((node) => node.tagName === 'OPTION').getAttribute('value') === '2026';
    }));
  await run('player guide loads players.json', () => sourceMutant('player guide loads players.json', 'public/js/app.js',
    "} else if (meikanMatch) {\n        const year", "} else if (meikanMatch) {\n        await loadPlayers();\n        const year",
    (source) => {
      const branch = source.slice(source.indexOf('} else if (meikanMatch)'), source.indexOf('} else {', source.indexOf('} else if (meikanMatch)')));
      return !branch.includes('loadPlayers');
    }));
  await run('player card nests a credit link', () => sourceMutant('player card nests a credit link', 'public/js/views.js',
    "    picture,\n    el('strong', { class: 'meikan-name person' }, label),",
    "    picture,\n    el('a', { href: 'https://commons.wikimedia.org/' }, '写真'),\n    el('strong', { class: 'meikan-name person' }, label),",
    (source) => {
      const card = source.slice(source.indexOf('function meikanCard'), source.indexOf('export function meikanView'));
      return (card.match(/el\('a'/g) || []).length === 1;
    }));
} finally {
  rmSync(work, { recursive: true, force: true });
}

const killed = rows.filter((row) => row.killed).length;
console.log(`mutations: ${killed}/${rows.length} killed`);
if (killed !== rows.length) process.exitCode = 1;
