import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import ui from './golden/ui.json' with { type: 'json' };
import { buildBracket } from '../public/js/bracket.js?v=0.5.0';
import { foldCompact } from '../public/js/fold.js';
import { formatDate, formatMinute, tournamentTitle } from '../public/js/format.js?v=0.5.0';
import { parseRuby } from '../public/js/ruby.js';
import { AWARD_LABELS, STAGE_LABELS, STAGE_LABELS_BY_YEAR, STRINGS } from '../public/js/strings.js?v=0.5.0';
import { VERSION } from '../public/js/version.js?v=0.5.0';
import { applySquadChanges } from '../tools/lib/phase4.mjs';
import { awardTier } from '../public/js/views.js?v=0.5.0';

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

function decodePng(path) {
  // A tiny decoder for the one shape of PNG this project writes itself:
  // 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA). Uses only
  // node:zlib (a Node builtin, not an installed dependency) to inflate the
  // IDAT stream, then reverses the PNG per-scanline filters by hand.
  const buf = readFileSync(path);
  deepPngSignature(buf, path);
  let offset = 8; // past the 8-byte PNG signature
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idatChunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buf.subarray(dataStart, dataStart + length);
    const expectedCrc = buf.readUInt32BE(dataStart + length);
    const actualCrc = crc32(buf.subarray(offset + 4, dataStart + length)) >>> 0;
    if (actualCrc !== expectedCrc) throw new Error(`decodePng: invalid ${type} CRC in ${path}`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // skip the trailing CRC
  }
  if (bitDepth !== 8) throw new Error(`decodePng: unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('decodePng: interlaced PNG not supported');
  if (colorType !== 2 && colorType !== 6) throw new Error(`decodePng: unsupported colour type ${colorType}`);
  const channels = colorType === 2 ? 3 : 4;

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rawOffset + x];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[rowStart - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[rowStart - stride + x - channels] : 0;
      let value;
      if (filterType === 0) value = rawByte;
      else if (filterType === 1) value = rawByte + a;
      else if (filterType === 2) value = rawByte + b;
      else if (filterType === 3) value = rawByte + Math.floor((a + b) / 2);
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`decodePng: unsupported filter type ${filterType}`);
      pixels[rowStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, channels, pixels };
}

function deepPngSignature(buffer, path) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) throw new Error(`invalid PNG signature: ${path}`);
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

function contrastRatio(left, right) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(left), b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function pixelAt(png, x, y) {
  const idx = (y * png.width + x) * png.channels;
  return [png.pixels[idx], png.pixels[idx + 1], png.pixels[idx + 2]];
}

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsIntersect(a, b, c, d) {
  // Signed orientations, with collinear cases handled explicitly. A boolean
  // `>`-only orientation test treats collinear triples as "clockwise" on both
  // sides and reports far-apart segments as crossing: measured 2026-09-11, the
  // classic-ball geometry has vertices in exact alignment and outer[1]/outer[3]
  // (226px apart) were reported 0px apart.
  const orient = (p, q, r) => {
    const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(v) < 1e-9 ? 0 : Math.sign(v);
  };
  const onSegment = (p, q, r) => Math.min(p[0], r[0]) - 1e-9 <= q[0] && q[0] <= Math.max(p[0], r[0]) + 1e-9
    && Math.min(p[1], r[1]) - 1e-9 <= q[1] && q[1] <= Math.max(p[1], r[1]) + 1e-9;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function segmentDistance(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonDistance(polyA, polyB) {
  // Overlapping (a vertex of one inside the other) counts as distance 0.
  for (const p of polyA) if (pointInPolygon(p, polyB)) return 0;
  for (const p of polyB) if (pointInPolygon(p, polyA)) return 0;
  let best = Infinity;
  for (let i = 0; i < polyA.length; i += 1) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j += 1) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      best = Math.min(best, segmentDistance(a1, a2, b1, b2));
    }
  }
  return best;
}

function iconPatternGeometry(diameter) {
  // Ask scripts/generate_icon.py for the exact polygons it draws (not a
  // hand-copied reconstruction of its geometry), via the --print-polygons
  // dev flag it exposes for this purpose.
  const output = execFileSync('python3', [join(ROOT, 'scripts/generate_icon.py'), '--print-polygons', String(diameter)], { encoding: 'utf8' });
  return JSON.parse(output);
}

function pngHeader(path) {
  // The IHDR chunk is always the first chunk, right after the 8-byte PNG
  // signature: 4-byte length, 4-byte type, then width/height/bit depth/colour
  // type/compression/filter/interlace. No PNG library needed to read it.
  const buf = readFileSync(path);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
  };
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
    const changes = JSON.parse(readFileSync(join(ROOT, 'curated/squad-changes-2026.json'), 'utf8')).changes;
    const flattened = source.flatMap((sourceTeam) => sourceTeam.players.map((player) => ({
      ...player, team: Object.keys(teams).find((key) => teams[key].sourceNames.includes(sourceTeam.name)),
    })));
    const adjusted = applySquadChanges(flattened, changes);
    const detail = details.get(2026);
    for (const [teamKey, squad] of Object.entries(detail.squads)) {
      const sourceTeam = adjusted.filter((item) => item.team === teamKey);
      equal(sourceTeam.length > 0, true, teamKey);
      for (const member of squad.filter((item) => item.player.startsWith('P26-'))) {
        const candidates = sourceTeam.filter((item) => item.number === member.no);
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
    equal(VERSION, '0.5.0');
    const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1];
      if (/^(?:https?:|#)/.test(url)) continue;
      equal(url.endsWith(`?v=${VERSION}`), true, url);
      equal(existsSync(join(PUBLIC, url.split('?')[0])), true, `${url} exists`);
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
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons) {
      equal(icon.src.endsWith(`?v=${VERSION}`), true, `manifest ${icon.src}`);
      equal(existsSync(join(PUBLIC, icon.src.split('?')[0])), true, `${icon.src} exists`);
    }
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
      rejected = false;
      try { await data.loadSearch(); } catch { rejected = true; }
      equal(rejected, true, 'invalid search rejected');
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
    for (const route of ["route === '/'", "route === '/s'", "route === '/credits'", "route === '/credits/photos'", "route === '/c'", "route === '/r'", '/^\\/t\\/', '/^\\/m\\/', '/^\\/c\\/', '/^\\/p\\/', '/^\\/r\\/', '/^\\/z']) equal(app.includes(route), true, route);
    const playerBranch = app.slice(app.indexOf('} else if (playerMatch)'), app.indexOf('} else if (rankingMatch)'));
    equal(playerBranch.includes('loadTeams'), false, 'player route loads only players and its tournament files');
    equal(app.includes('window.scrollTo(0, 0)'), true, 'route scroll');
    const searchOptions = app.slice(app.indexOf('function searchOptions'), app.indexOf('async function renderRoute'));
    equal(searchOptions.includes('history.replaceState'), true, 'search query uses replaceState');
    equal(searchOptions.includes('location.hash'), false, 'search query does not assign location.hash');
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
    const expectedTiers = {
      'golden-ball': 'golden', 'golden-boot': 'golden', 'golden-glove': 'golden',
      'silver-ball': 'silver', 'silver-boot': 'silver', 'bronze-ball': 'bronze', 'bronze-boot': 'bronze',
      'best-young-player': 'young',
    };
    for (const [award, tier] of Object.entries(expectedTiers)) equal(awardTier(award), tier, award);
    const variables = (rule) => Object.fromEntries([...rule.body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));
    for (const themeRule of [rootRule, darkRule]) {
      const tokens = variables(themeRule);
      for (const tier of ['golden', 'silver', 'bronze', 'young', 'scorer']) {
        const rule = rules.find((entry) => entry.selector === `.honour-pill-${tier}`);
        const foregroundToken = /color:\s*var\((--[\w-]+)\)/.exec(rule.body)?.[1];
        const backgroundToken = /background:\s*var\((--[\w-]+)\)/.exec(rule.body)?.[1];
        equal(Boolean(backgroundToken && tokens[backgroundToken]), true, `${tier} non-transparent background token`);
        equal(contrastRatio(tokens[foregroundToken], tokens[backgroundToken]) >= 4.5, true,
          `${tier} contrast ${contrastRatio(tokens[foregroundToken], tokens[backgroundToken]).toFixed(2)}`);
      }
    }
  });

  test('credit links use the approved HTTPS hosts', () => {
    const sources = [readFileSync(join(PUBLIC, 'js/views.js'), 'utf8'), JSON.stringify(load('meta.json'))].join('\n');
    for (const match of sources.matchAll(/https:\/\/([^/'"`]+)/g)) {
      equal(['github.com', 'creativecommons.org', 'commons.wikimedia.org'].includes(match[1]), true, match[0]);
    }
  });

  test('icon PNGs have the required dimensions and colour type', () => {
    for (const name of ['apple-touch-icon.png', 'icon-512.png', 'ball-mark.png']) decodePng(join(PUBLIC, 'assets', name));
    deepEqual(pngHeader(join(PUBLIC, 'assets/apple-touch-icon.png')),
      { width: 180, height: 180, colorType: 2 }, 'apple-touch-icon.png (RGB, no alpha)');
    deepEqual(pngHeader(join(PUBLIC, 'assets/icon-512.png')),
      { width: 512, height: 512, colorType: 2 }, 'icon-512.png (RGB, no alpha)');
    deepEqual(pngHeader(join(PUBLIC, 'assets/ball-mark.png')),
      { width: 96, height: 96, colorType: 6 }, 'ball-mark.png (RGBA)');
  });

  test('icon-512.png silhouette stays inside the ball: nothing dark escapes the outline', () => {
    const png = decodePng(join(PUBLIC, 'assets/icon-512.png'));
    equal(png.channels, 3, 'icon-512.png sanity: no alpha channel');
    const size = png.width;
    const cx = size / 2;
    const cy = size / 2;
    const bg = [31, 122, 77]; // #1f7a4d
    const isBackground = (x, y) => {
      const [r, g, b] = pixelAt(png, x, y);
      return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) <= 6;
    };

    // The ball's outline outer radius is a rendering detail (its exact pixel
    // position depends on how the ring is constructed), so measure it from
    // the image itself: cast a ray outward from the centre every half a
    // degree and record the outermost non-background pixel it hits. In a
    // properly round ball every ray lands within a couple of pixels of the
    // same radius. A pentagon tip poking past the ring only along a few
    // rays - the exact "lumpy, not round" defect reported - shows up as a
    // handful of rays landing well past that common radius.
    const maxScanRadius = Math.floor(size / 2) - 1;
    const boundaryRadii = [];
    for (let deg = 0; deg < 360; deg += 0.5) {
      const rad = (deg * Math.PI) / 180;
      let boundary = 0;
      for (let r = maxScanRadius; r >= 0; r -= 1) {
        const x = Math.round(cx + r * Math.cos(rad));
        const y = Math.round(cy + r * Math.sin(rad));
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (!isBackground(x, y)) { boundary = r; break; }
      }
      boundaryRadii.push(boundary);
    }
    const sorted = [...boundaryRadii].sort((a, b) => a - b);
    const medianRadius = sorted[Math.floor(sorted.length / 2)];
    const maxRadius = sorted.at(-1);
    // Nothing dark may extend beyond the outline's own outer edge by more
    // than a couple of pixels of anti-aliasing - i.e. the outer boundary
    // must be circular, not lumpy.
    equal(maxRadius - medianRadius <= 2, true,
      `outline is not round: typical outer radius ${medianRadius}px, but some ray reaches ${maxRadius}px`);
    equal(medianRadius >= size * 0.35 && medianRadius <= size * 0.49, true, `plausible ball radius ${medianRadius}px`);
    let foregroundPixels = 0;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!isBackground(x, y)) foregroundPixels += 1;
    equal(foregroundPixels >= size * size * 0.2 && foregroundPixels <= size * size * 0.75, true,
      `plausible foreground pixel count ${foregroundPixels}`);

    // Independently, exhaustively confirm every pixel further out than that
    // clear radius is pure background - not just the single outermost pixel
    // per ray, so a lump that is wide as well as tall cannot slip through.
    const clearRadius = medianRadius + 2;
    let offenders = 0;
    let firstOffender = null;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dist <= clearRadius) continue;
        if (!isBackground(x, y)) {
          offenders += 1;
          if (!firstOffender) firstOffender = { x, y, dist: Math.round(dist * 10) / 10, rgb: pixelAt(png, x, y) };
        }
      }
    }
    equal(offenders, 0,
      `${offenders} pixel(s) beyond the outline's +2px margin (radius ${clearRadius}) are not background, e.g. ${JSON.stringify(firstOffender)}`);
  });

  test('ball pattern pentagons never touch or overlap (>= 4% of diameter gap)', () => {
    const geometry = iconPatternGeometry(512);
    const requiredGap = 0.04 * geometry.diameter; // owner's stated minimum
    const polygons = [
      { name: 'central', points: geometry.central },
      ...geometry.outer.map((points, i) => ({ name: `outer[${i}]`, points })),
    ];
    equal(geometry.outer.length, 5, 'five outer pentagons');
    const centre = geometry.diameter / 2;
    const centroidRadii = geometry.outer.map((points) => {
      equal(polygonArea(points) >= geometry.diameter ** 2 * 0.01, true, `non-degenerate outer pentagon area ${polygonArea(points)}`);
      const centroid = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
      return Math.hypot(centroid[0] - centre, centroid[1] - centre);
    });
    equal(Math.min(...centroidRadii) >= geometry.diameter * 0.3, true, `outer pentagon placement radii ${centroidRadii}`);
    equal(Math.max(...centroidRadii) - Math.min(...centroidRadii) <= geometry.diameter * 0.02, true, `outer pentagon ring ${centroidRadii}`);
    let worst = Infinity;
    let worstPair = null;
    for (let i = 0; i < polygons.length; i += 1) {
      for (let j = i + 1; j < polygons.length; j += 1) {
        const gap = polygonDistance(polygons[i].points, polygons[j].points);
        if (gap < worst) { worst = gap; worstPair = [polygons[i].name, polygons[j].name]; }
      }
    }
    equal(worst >= requiredGap, true,
      `pentagons ${worstPair?.join(' and ')} are only ${worst.toFixed(1)}px apart, need >= ${requiredGap.toFixed(1)}px (4% of ${geometry.diameter}px diameter)`);
  });

  test('index.html links the touch icon, favicon, manifest and web-app meta', () => {
    const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    const touchIcon = /<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)">/.exec(html);
    equal(Boolean(touchIcon), true, 'apple-touch-icon link present');
    equal(touchIcon[1], `assets/apple-touch-icon.png?v=${VERSION}`, 'apple-touch-icon version');
    const touchIconPath = join(PUBLIC, touchIcon[1].split('?')[0]);
    equal(existsSync(touchIconPath), true, 'linked touch icon exists');
    deepEqual(pngHeader(touchIconPath), { width: 180, height: 180, colorType: 2 }, 'linked touch icon dimensions');
    equal(html.includes(`<link rel="icon" type="image/png" href="assets/icon-512.png?v=${VERSION}">`), true, 'favicon link');
    equal(html.includes(`<link rel="manifest" href="manifest.webmanifest?v=${VERSION}">`), true, 'manifest link');
    equal(html.includes('name="apple-mobile-web-app-capable" CONTENT="yes"'), true, 'apple-mobile-web-app-capable meta');
    equal(html.includes('name="mobile-web-app-capable" CONTENT="yes"'), true, 'mobile-web-app-capable meta');
    equal(html.includes('name="apple-mobile-web-app-title" CONTENT="Wcupedia"'), true, 'apple-mobile-web-app-title meta');
  });

  test('manifest.webmanifest parses and its icons exist with matching dimensions', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
    equal(manifest.name, 'Wcupedia（Wカップ大図鑑）');
    equal(manifest.short_name, 'Wcupedia');
    equal(manifest.start_url, './', 'start_url');
    equal(manifest.scope, './', 'scope');
    equal(manifest.display, 'standalone', 'display');
    equal(manifest.lang, 'ja', 'lang');
    equal(manifest.background_color, '#fffdf7', 'background colour');
    equal(manifest.theme_color, '#17653a', 'theme colour');
    const manifestUrl = 'https://masarusz.github.io/wcupedia/manifest.webmanifest';
    for (const field of ['start_url', 'scope']) equal(new URL(manifest[field], manifestUrl).pathname.startsWith('/wcupedia/'), true, `${field} project prefix`);
    equal(Array.isArray(manifest.icons) && manifest.icons.length > 0, true, 'manifest has icons');
    for (const icon of manifest.icons) {
      const path = join(PUBLIC, icon.src.split('?')[0]);
      equal(existsSync(path), true, `${icon.src} exists`);
      const [width, height] = icon.sizes.split('x').map(Number);
      const header = pngHeader(path);
      deepEqual({ width: header.width, height: header.height }, { width, height }, `${icon.src} dimensions match manifest`);
    }
  });

  test('deploy.sh allowlist ships the manifest and PNG assets', () => {
    const script = readFileSync(join(ROOT, 'scripts/deploy.sh'), 'utf8');
    const block = /PATTERNS=\(([^]*?)\n\)/.exec(script)?.[1];
    const patterns = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    deepEqual(patterns, ['index.html', 'manifest.webmanifest', 'css/*.css', 'js/*.js', 'data/*.json', 'data/t/*.json',
      'assets/*.png', 'assets/players/*.webp', 'assets/flags/*.svg', 'assets/flags/LICENSE-flag-icons.txt'], 'active PATTERNS allowlist');
  });
}
