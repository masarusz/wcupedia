import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ui from './golden/ui.json' with { type: 'json' };
import { buildBracket } from '../public/js/bracket.js?v=0.2.10';
import { foldCompact } from '../public/js/fold.js';
import { formatDate, formatMinute, tournamentTitle } from '../public/js/format.js?v=0.2.10';
import { parseRuby } from '../public/js/ruby.js';
import { AWARD_LABELS, STAGE_LABELS, STAGE_LABELS_BY_YEAR, STRINGS } from '../public/js/strings.js?v=0.2.10';
import { VERSION } from '../public/js/version.js?v=0.2.10';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const DATA = join(PUBLIC, 'data');
const load = (path) => JSON.parse(readFileSync(join(DATA, path), 'utf8'));
const tournaments = load('tournaments.json');
const teams = load('teams.json');
const details = new Map(tournaments.map((item) => [item.year, load(`t/${item.year}.json`)]));
const pairKey = (pair) => [...pair].sort().join('|');

function files(root, at = root) {
  return readdirSync(at, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')).flatMap((entry) => {
    const path = join(at, entry.name);
    return entry.isDirectory() ? files(root, path) : [relative(root, path)];
  }).sort();
}

function allTies(bracket) {
  return Object.values(bracket.rounds).flat();
}

function findTie(bracket, pair) {
  const key = pairKey(pair);
  return allTies(bracket).find((tie) => pairKey(tie.teams) === key);
}

function parseCssRules(css, atRules = []) {
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    const header = css.slice(cursor, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth) {
      if (css[close] === '{') depth += 1;
      if (css[close] === '}') depth -= 1;
      close += 1;
    }
    const body = css.slice(open + 1, close - 1);
    if (header.startsWith('@')) rules.push(...parseCssRules(body, [...atRules, header]));
    else rules.push({ selector: header, body, atRules });
    cursor = close;
  }
  return rules;
}

function japaneseStrings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(japaneseStrings);
  return [];
}

export function register(test, equal, deepEqual) {
  test('golden tournament title labels', () => {
    for (const [year, expected] of Object.entries(ui.labels.tournamentTitle)) {
      deepEqual(tournamentTitle(details.get(Number(year)), teams), expected, year);
    }
  });

  test('published stage labels match curated labels', () => {
    const curated = JSON.parse(readFileSync(join(ROOT, 'curated/stages.json'), 'utf8'));
    const { _byYear, ...base } = curated;
    deepEqual(STAGE_LABELS, base);
    deepEqual(STAGE_LABELS_BY_YEAR, _byYear);
  });

  test('golden bracket structure', () => {
    for (const [yearText, expected] of Object.entries(ui.bracket)) {
      const year = Number(yearText);
      const bracket = buildBracket(details.get(year));
      const actualCounts = Object.fromEntries(Object.entries(bracket.rounds).filter(([, ties]) => ties.length).map(([round, ties]) => [round, ties.length]));
      deepEqual(actualCounts, expected.ties, `${year} tie counts`);
      deepEqual(bracket.third?.teams ? pairKey(bracket.third.teams) : null, expected.third ? pairKey(expected.third) : null, `${year} third`);
      for (const pair of expected.replayTies || []) {
        const tie = findTie(bracket, pair);
        equal(Boolean(tie), true, `${year} replay tie ${pair}`);
        equal(tie.matches.length, 2, `${year} replay merged ${pair}`);
      }
      for (const item of expected.winners || []) {
        equal(findTie(bracket, item.tie)?.winner, item.winner, `${year} winner ${item.tie}`);
      }
      for (const item of expected.feeders || []) {
        const tie = findTie(bracket, item.tie);
        equal(Boolean(tie), true, `${year} feeder tie ${item.tie}`);
        deepEqual(tie.feeders.map((feeder) => feeder && pairKey(feeder.teams)), item.from.map(pairKey), `${year} feeders ${item.tie}`);
      }
      for (const item of expected.entryWithoutFeeder || []) {
        const tie = bracket.rounds[item.round].find((candidate) => candidate.teams.includes(item.team));
        equal(Boolean(tie), true, `${year} entry ${item.team}`);
        equal(tie.feeders[tie.teams.indexOf(item.team)], null, `${year} no feeder ${item.team}`);
      }
      if (bracket.root) equal(bracket.root.round, 'final', `${year} tree root`);
    }
  });

  test('tournament files embed every referenced player', () => {
    for (const [year, detail] of details) {
      const referenced = new Set([
        ...detail.matches.flatMap((match) => match.goals.map((goal) => goal.player)),
        ...Object.values(detail.squads).flatMap((squad) => squad.map((member) => member.player)),
        ...detail.topScorers.map((row) => row.player), ...detail.awards.map((row) => row.player),
      ]);
      deepEqual(Object.keys(detail.people).sort(), [...referenced].sort(), `${year} people keys`);
      for (const id of referenced) equal(typeof detail.people[id].name, 'string', `${year} ${id} display name`);
    }
  });

  test('2026 generated player ids are stable hashes', () => {
    const source = JSON.parse(readFileSync(join(ROOT, '.cache/sources/openfootball/2026-squads.json'), 'utf8'));
    const detail = details.get(2026);
    for (const [teamKey, squad] of Object.entries(detail.squads)) {
      const sourceTeam = source.find((item) => teams[teamKey].sourceNames.includes(item.name));
      equal(Boolean(sourceTeam), true, teamKey);
      for (const member of squad.filter((item) => item.player.startsWith('P26-'))) {
        const candidates = sourceTeam.players.filter((item) => item.number === member.no);
        equal(candidates.length, 1, `${teamKey} shirt ${member.no}`);
        const player = candidates[0];
        const identity = `${teamKey}|${player.date_of_birth}|${foldCompact(player.name)}`;
        const expected = `P26-${createHash('sha256').update(identity).digest('hex').slice(0, 10)}`;
        equal(member.player, expected, `${teamKey} ${player.name}`);
      }
    }
    const ids = Object.keys(detail.people).filter((id) => id.startsWith('P26-'));
    equal(new Set(ids).size, ids.length, '2026 generated id collision');
  });

  test('every team flag asset exists', () => {
    for (const [key, team] of Object.entries(teams)) {
      equal(existsSync(join(PUBLIC, 'assets/flags', `${team.flag}.svg`)), true, `${key} ${team.flag}`);
    }
    equal(existsSync(join(PUBLIC, 'assets/flags/LICENSE-flag-icons.txt')), true);
  });

  test('all fixed labels are valid ruby markup', () => {
    const labels = japaneseStrings({ STRINGS, AWARD_LABELS, STAGE_LABELS, STAGE_LABELS_BY_YEAR });
    equal(labels.length > 0, true);
    for (const label of labels) parseRuby(label);
    equal(formatDate('2022-12-18'), '2022年12月18日');
    equal(formatMinute('90+3'), '90+3分');
  });

  test('public uses no unsafe HTML string sinks or inline handlers', () => {
    const forbidden = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|(?:^|\s)(?:style|on[a-z]+)\s*=/im;
    for (const file of files(PUBLIC)) {
      const content = readFileSync(join(PUBLIC, file), 'utf8');
      equal(forbidden.test(content), false, file);
    }
  });

  test('public has no persisted or hidden furigana state', () => {
    for (const file of files(PUBLIC)) {
      const content = readFileSync(join(PUBLIC, file), 'utf8');
      equal(content.includes('localStorage'), false, `${file}: localStorage`);
      equal(content.includes('furigana-off'), false, `${file}: furigana-off`);
    }
  });

  test('asset imports and footer share VERSION', () => {
    equal(VERSION, '0.2.10');
    const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:css|js)\//.test(match[1])) equal(match[1].endsWith(`?v=${VERSION}`), true, match[1]);
    }
    for (const file of files(join(PUBLIC, 'js')).filter((name) => name.endsWith('.js'))) {
      const source = readFileSync(join(PUBLIC, 'js', file), 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
        equal(match[1].endsWith(`?v=${VERSION}`), true, `${file}: ${match[1]}`);
      }
    }
    const app = readFileSync(join(PUBLIC, 'js/app.js'), 'utf8');
    equal(app.includes('`v${VERSION}`'), true, 'footer version');
    const data = readFileSync(join(PUBLIC, 'js/data.js'), 'utf8');
    equal(data.includes('?v=${VERSION}'), true, 'fetch version');
    const views = readFileSync(join(PUBLIC, 'js/views.js'), 'utf8');
    equal(views.includes('.svg?v=${VERSION}'), true, 'flag version');
  });

  test('data loader rejects invalid top-level shapes without throwing to the view', async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
      requested.push(url);
      return { ok: true, json: async () => [] };
    };
    try {
      const data = await import(`../public/js/data.js?shape-test=${Date.now()}`);
      let rejected = false;
      try { await data.loadTournaments(); } catch { rejected = true; }
      equal(rejected, true, 'invalid tournaments rejected');
      equal(requested[0], `data/tournaments.json?v=${VERSION}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('shell CSP routing and accessibility guards', () => {
    const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      equal(html.includes(directive), true, directive);
    }
    equal(html.includes('name="viewport"'), true, 'viewport');
    const app = readFileSync(join(PUBLIC, 'js/app.js'), 'utf8');
    for (const route of ["route === '/'", "route === '/credits'", '/^\\/t\\/', '/^\\/m\\/']) equal(app.includes(route), true, route);
    equal(app.includes('window.scrollTo(0, 0)'), true, 'route scroll');
  });

  test('CSS has iPad overflow tap and sticky guards', () => {
    const css = readFileSync(join(PUBLIC, 'css/app.css'), 'utf8');
    equal(/\.site-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s.test(css), true, 'sticky header');
    equal(/html, body\s*\{[^}]*overflow-x:\s*clip/s.test(css), true, 'body overflow');
    for (const selector of ['.table-scroll', '.bracket-scroll']) equal(css.includes(selector), true, selector);
    const fontSizes = [...css.matchAll(/(?:^|[;{])\s*font-size:\s*(\d+)px/gm)].map((match) => Number(match[1]));
    equal(fontSizes.filter((size) => size < 16).every((size) => size === 11 || size === 12 || size === 13 || size === 14 || size === 15), true);
    equal(/button\s*\{[^}]*font-size:\s*16px/s.test(css), true, 'controls font size');
    equal((css.match(/min-height:\s*44px/g) || []).length >= 3, true, '44px tap targets');
  });

  test('honour award/scorer pill tiers set a themed background', () => {
    const css = readFileSync(join(PUBLIC, 'css/app.css'), 'utf8');
    const rules = parseCssRules(css);
    for (const tier of ['golden', 'silver', 'bronze', 'young', 'scorer']) {
      const rule = rules.find((entry) => entry.selector === `.honour-pill-${tier}`);
      equal(Boolean(rule), true, `.honour-pill-${tier} rule exists`);
      equal(/background\s*:/.test(rule.body), true, `.honour-pill-${tier} sets background`);
    }
    const rootRule = rules.find((entry) => entry.selector === ':root' && entry.atRules.length === 0);
    const darkRule = rules.find((entry) => entry.selector === ':root'
      && entry.atRules.some((at) => at.includes('prefers-color-scheme: dark')));
    equal(Boolean(rootRule), true, ':root light theme rule');
    equal(Boolean(darkRule), true, ':root dark theme rule');
    for (const prop of ['--silver', '--silver-bg', '--bronze', '--bronze-bg', '--young', '--young-bg', '--teal', '--teal-bg']) {
      equal(rootRule.body.includes(`${prop}:`), true, `${prop} defined in light theme`);
      equal(darkRule.body.includes(`${prop}:`), true, `${prop} defined in dark theme`);
    }
  });

  test('credit links use the approved HTTPS hosts', () => {
    const sources = [readFileSync(join(PUBLIC, 'js/views.js'), 'utf8'), JSON.stringify(load('meta.json'))].join('\n');
    for (const match of sources.matchAll(/https:\/\/([^/'"`]+)/g)) {
      equal(['github.com', 'creativecommons.org', 'commons.wikimedia.org'].includes(match[1]), true, match[0]);
    }
  });
}
