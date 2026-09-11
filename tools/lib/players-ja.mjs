import { foldCompact } from '../../public/js/fold.js';

const PLAYER_TEMPLATE = 'サッカーナショナルチーム選手一覧 選手';

const NON_TEAM_HEADINGS = new Set([
  'クラブ別', '国別', '自国の国内クラブでプレーしている選手の数', '注釈', '出典',
  '年齢', '= 選手 =', '= 監督 =', '所属クラブ別選手数', '所属リーグの国別選手数', '国別の監督代表者数',
]);

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function balancedEnd(text, start, open, close) {
  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === open) { depth += 1; index += 1; }
    else if (pair === close) {
      depth -= 1;
      index += 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

export function splitTopLevel(value, separator = '|') {
  const parts = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);
    if (pair === '{{') { braces += 1; index += 1; continue; }
    if (pair === '}}') { braces -= 1; index += 1; continue; }
    if (pair === '[[') { brackets += 1; index += 1; continue; }
    if (pair === ']]') { brackets -= 1; index += 1; continue; }
    if (value[index] === separator && braces === 0 && brackets === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function templateParts(template) {
  const body = template.startsWith('{{') && template.endsWith('}}') ? template.slice(2, -2) : template;
  const parts = splitTopLevel(body);
  const positional = [];
  const named = {};
  for (const raw of parts.slice(1)) {
    const equal = raw.indexOf('=');
    if (equal > 0) named[raw.slice(0, equal).trim()] = raw.slice(equal + 1).trim();
    else positional.push(raw.trim());
  }
  return { name: parts[0].trim(), positional, named };
}

function headingKey(raw) {
  const value = raw.trim();
  const match = /^\{\{\s*([^|}]+).*\}\}$/.exec(value);
  return match ? match[1].trim() : value;
}

function birthDate(value) {
  if (!value) return null;
  const start = value.indexOf('{{生年月日と年齢2');
  if (start < 0) return null;
  const end = balancedEnd(value, start, '{{', '}}');
  if (end < 0) return null;
  const parts = splitTopLevel(value.slice(start + 2, end - 2)).slice(1);
  const numbers = [];
  for (const part of parts) {
    if (/^\s*df\s*=/.test(part)) continue;
    if (/^\s*\d+\s*$/.test(part)) numbers.push(Number(part.trim()));
  }
  if (numbers.length < 3) return null;
  const [year, month, day] = numbers.slice(-3);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeJapaneseName(value) {
  return String(value || '')
    .replace(/\s*[\(（][^\(（\)）]*[\)）]\s*$/u, '')
    .replace(/・/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function primaryTemplate(value) {
  const start = value.indexOf('{{');
  if (start < 0) return null;
  const end = balancedEnd(value, start, '{{', '}}');
  return end < 0 ? null : value.slice(start, end);
}

export function extractSquadName(rawName) {
  const raw = String(rawName || '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>|<ref\b[^>]*\/\s*>/giu, '').trim();
  let suffix = raw;
  if (raw.startsWith('[[')) {
    const end = raw.indexOf(']]');
    if (end >= 0) suffix = raw.slice(end + 2);
  } else if (raw.startsWith('{{')) {
    const end = balancedEnd(raw, 0, '{{', '}}');
    if (end >= 0) suffix = raw.slice(end);
  }
  const korean = /^\s*[\(（]\s*([ァ-ヺー＝・\s]+)\s*[\)）]/u.exec(suffix);
  if (korean) return { name: normalizeJapaneseName(korean[1]), source: 'korea-kana' };

  if (raw.startsWith('{{仮リンク')) {
    const template = primaryTemplate(raw);
    if (!template) return { name: '', source: 'squad-title' };
    const parsed = templateParts(template);
    if (parsed.named.label) return { name: normalizeJapaneseName(parsed.named.label), source: 'squad-label' };
    return { name: normalizeJapaneseName(parsed.positional[0]), source: 'squad-title' };
  }

  const link = /\[\[([\s\S]*?)\]\]/u.exec(raw);
  if (link) {
    const parts = splitTopLevel(link[1]);
    return {
      name: normalizeJapaneseName(parts.length > 1 ? parts.at(-1) : parts[0]),
      source: parts.length > 1 ? 'squad-label' : 'squad-title',
    };
  }
  return { name: normalizeJapaneseName(raw), source: 'squad-title' };
}

export function extractClub(rawClub) {
  let value = String(rawClub || '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>|<ref\b[^>]*\/\s*>/giu, '')
    .replace(/<!--[\s\S]*?-->/gu, '');
  while (value.includes('{{')) {
    const start = value.lastIndexOf('{{');
    const end = balancedEnd(value, start, '{{', '}}');
    if (end < 0) break;
    value = `${value.slice(0, start)}${value.slice(end)}`;
  }
  value = value.replace(/\[\[([^\]]+)\]\]/gu, (_match, body) => {
    const parts = splitTopLevel(body);
    return parts.at(-1).trim();
  });
  value = value.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/gu, '$1');
  return value.replace(/<[^>]*>/gu, '').replace(/'{2,}/gu, '').replace(/\s+/gu, ' ').trim() || null;
}

export function validateJapaneseName(name, team) {
  if (!name) return 'empty';
  if (team === 'JPN') return /\[\[|\]\]|\{\{|\}\}|[\[\]{}]/u.test(name) ? 'wiki syntax' : null;
  return /^[ァ-ヺー＝]+(?: [ァ-ヺー＝]+)*$/u.test(name) ? null : 'non-katakana';
}

export function articleJapaneseName(title, birthYear) {
  const raw = String(title || '').trim();
  const qualifier = /\s*[\(（]([^\(（\)）]*)[\)）]\s*$/u.exec(raw);
  if (qualifier) {
    const year = /(\d{4})年/u.exec(qualifier[1]);
    if (year && Number(year[1]) !== Number(birthYear)) {
      return { name: null, reason: `article qualifier year ${year[1]} != birth year ${birthYear}` };
    }
  }
  return { name: normalizeJapaneseName(raw), reason: null };
}

export function parseSquadWikitext(text, year, teamHeadings) {
  const headings = [...text.matchAll(/^===\s*(.*?)\s*===\s*$/gmu)]
    .map((match) => ({ start: match.index, end: match.index + match[0].length, raw: match[1] }));
  const entries = [];
  const unmapped = new Set();
  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const heading = headings[headingIndex];
    const key = headingKey(heading.raw);
    const team = teamHeadings[key];
    if (!team) {
      if (!NON_TEAM_HEADINGS.has(key)) unmapped.add(key);
      continue;
    }
    const end = headings[headingIndex + 1]?.start ?? text.length;
    const section = text.slice(heading.end, end);
    let cursor = 0;
    while (true) {
      const start = section.indexOf(`{{${PLAYER_TEMPLATE}`, cursor);
      if (start < 0) break;
      const templateEnd = balancedEnd(section, start, '{{', '}}');
      if (templateEnd < 0) throw new Error(`unclosed player template in ${year} ${key}`);
      const parsed = templateParts(section.slice(start, templateEnd));
      const rawName = parsed.named.name ?? parsed.named['名前'] ?? '';
      cursor = templateEnd;
      const originalName = String(parsed.named['原語表記'] || '').replace(/\s+/gu, ' ').trim() || null;
      if (!rawName.trim() && !originalName) continue;
      const noRaw = parsed.named.no ?? parsed.named['背番号'];
      const no = /^\d+$/.test(String(noRaw || '').trim()) ? Number(noRaw) : null;
      entries.push({
        year: Number(year), team, no,
        pos: parsed.named.pos ?? parsed.named['ポジション'] ?? null,
        club: extractClub(parsed.named.club ?? parsed.named['クラブ']),
        birthDate: birthDate(parsed.named.age ?? parsed.named['生年月日']),
        reading: originalName,
        rawName,
        ...extractSquadName(rawName),
      });
    }
  }
  if (unmapped.size) throw new Error(`unmapped team headings in ${year}: ${[...unmapped].sort(compare).join(', ')}`);
  return entries;
}

export function matchSquadEntry(entry, candidates) {
  const sameBirth = candidates.filter((candidate) => candidate.birthDate === entry.birthDate);
  if (sameBirth.length === 1) {
    const candidate = sameBirth[0];
    if (entry.no != null && candidate.no != null && entry.no !== candidate.no) {
      return { id: null, reason: `team+DOB shirt mismatch (entry ${entry.no}, ${candidate.id} ${candidate.no})` };
    }
    return { id: candidate.id, reason: null };
  }
  if (sameBirth.length > 1 && entry.no != null) {
    const byShirt = sameBirth.filter((candidate) => candidate.no != null && candidate.no === entry.no);
    if (byShirt.length === 1) return { id: byShirt[0].id, reason: null };
  }
  if (sameBirth.length > 1) return { id: null, reason: `ambiguous team+DOB (${sameBirth.map((item) => item.id).sort(compare).join(', ')})` };
  return { id: null, reason: entry.birthDate ? 'no team+DOB candidate' : 'missing birth date' };
}

function oneEditApart(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let edits = 0;
  for (let a = 0, b = 0; a < left.length || b < right.length;) {
    if (left[a] === right[b]) { a += 1; b += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) a += 1;
    else if (right.length > left.length) b += 1;
    else { a += 1; b += 1; }
  }
  return true;
}

export function matchSquadClubEntry(entry, candidates) {
  const strict = matchSquadEntry(entry, candidates);
  if (strict.id) return strict;
  const sourceName = foldCompact(entry.reading || '');
  if (sourceName) {
    const exact = candidates.filter((candidate) => foldCompact(candidate.name || '') === sourceName);
    if (exact.length === 1) return { id: exact[0].id, reason: null };
  }
  if (entry.no != null) {
    const byShirt = candidates.filter((candidate) => candidate.no === entry.no);
    if (byShirt.length === 1) return { id: byShirt[0].id, reason: null };
  }
  const sourceTokens = String(entry.reading || '').split(/\s+/u).map(foldCompact).filter(Boolean);
  if (sourceTokens.length >= 2) {
    const near = candidates.filter((candidate) => {
      const tokens = String(candidate.name || '').split(/\s+/u).map(foldCompact).filter(Boolean);
      return tokens.length >= 2 && sourceTokens.at(-1) === tokens.at(-1)
        && oneEditApart(sourceTokens[0], tokens[0]);
    });
    if (near.length === 1) return { id: near[0].id, reason: null };
  }
  return strict;
}

export function chooseJapaneseNames({ players, matches, articleTitles, overrides = {} }) {
  const chosen = new Map();
  const rejections = [];
  const sourceCounts = { override: 0, 'squad-label': 0, 'squad-title': 0, 'korea-kana': 0, 'article-title': 0 };
  const byPlayer = new Map();
  for (const match of matches) {
    if (!byPlayer.has(match.id)) byPlayer.set(match.id, []);
    byPlayer.get(match.id).push(match);
  }
  for (const player of [...players].sort((a, b) => compare(a.id, b.id))) {
    const override = overrides[player.id];
    const recent = (byPlayer.get(player.id) || []).slice().sort((a, b) => b.year - a.year)[0];
    const candidates = [];
    if (override != null) candidates.push({ name: normalizeJapaneseName(override), source: 'override', year: null });
    if (recent) candidates.push({ name: recent.name, source: recent.source, year: recent.year, reading: recent.reading });
    const article = articleTitles[player.id]?.ja;
    if (article) {
      const parsed = articleJapaneseName(article, String(player.birthDate || '').slice(0, 4));
      if (parsed.reason) rejections.push({ id: player.id, source: 'article-title', value: article, reason: parsed.reason });
      else candidates.push({ name: parsed.name, source: 'article-title', year: null });
    }
    for (const candidate of candidates) {
      if (candidate.source === 'article-title'
        && !/\s/u.test(String(player.name || '').trim())
        && candidate.name.includes(' ')) {
        rejections.push({
          id: player.id, source: candidate.source, value: candidate.name,
          reason: 'formal-name-for-one-name-player',
        });
        continue;
      }
      const reason = validateJapaneseName(candidate.name, player.team);
      if (reason) {
        rejections.push({ id: player.id, source: candidate.source, value: candidate.name, reason });
        continue;
      }
      chosen.set(player.id, {
        ja: candidate.name, source: candidate.source,
        reading: player.team === 'JPN' ? recent?.reading || null : null,
      });
      sourceCounts[candidate.source] += 1;
      break;
    }
  }
  return { chosen, rejections, sourceCounts };
}
