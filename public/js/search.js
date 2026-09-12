import { fold, foldCompact } from './fold.js?v=0.5.3';

const TYPE_ORDER = Object.freeze({ team: 0, tournament: 1, player: 2 });
const SMALL_KANA = Object.freeze({
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ', 'ゔ': 'ぶ',
});

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const characterCount = (value) => [...value].length;
const containsKana = (value) => /[ぁ-ゖ]/u.test(value);

function loose(value) {
  return value.replace(/[っー]/gu, '').replace(/[ぁぃぅぇぉゃゅょゎゔ]/gu, (character) => SMALL_KANA[character]);
}

function preparedKey(value) {
  const folded = fold(value);
  const words = folded.split(' ').filter(Boolean);
  const compact = foldCompact(folded);
  const looseWords = words.map(loose).filter(Boolean);
  return { words, compact, looseWords, looseCompact: loose(compact) };
}

export function prepareIndex(entries) {
  if (!Array.isArray(entries)) throw new TypeError('search entries must be an array');
  return Object.freeze(entries.map((entry) => Object.freeze({
    entry,
    labelKey: foldCompact(entry.label),
    keys: entry.keys.map(preparedKey),
  })));
}

function tierFor(keys, foldedQuery, compactQuery, isLoose) {
  const compactName = isLoose ? 'looseCompact' : 'compact';
  const wordsName = isLoose ? 'looseWords' : 'words';
  if (keys.some((key) => key[compactName] === compactQuery)) return 0;
  if (keys.some((key) => key[wordsName].includes(foldedQuery))) return 1;
  if (keys.some((key) => key[compactName].startsWith(compactQuery)
    || key[wordsName].some((word) => word.startsWith(compactQuery)))) return 2;
  if (characterCount(compactQuery) >= 2 && keys.some((key) => key[compactName].includes(compactQuery))) return 3;
  return null;
}

function playerStats(players, entry) {
  const player = players?.[entry.id];
  return {
    goals: player?.goals ?? entry.fame?.[0] ?? 0,
    apps: player?.apps ?? entry.fame?.[1] ?? 0,
    squads: Array.isArray(player?.years) ? player.years.length : entry.fame?.[2] ?? 0,
  };
}

export function search(index, query, { limit = 30, players } = {}) {
  const foldedQuery = fold(query);
  const compactQuery = foldCompact(foldedQuery);
  if (!compactQuery || limit <= 0) return [];
  const allowLoose = containsKana(foldedQuery) && characterCount(loose(compactQuery)) >= 2;
  const looseFoldedQuery = loose(foldedQuery);
  const looseCompactQuery = loose(compactQuery);
  const matches = [];
  for (const item of index) {
    let tier = tierFor(item.keys, foldedQuery, compactQuery, false);
    if (tier === null && allowLoose) {
      const looseTier = tierFor(item.keys, looseFoldedQuery, looseCompactQuery, true);
      if (looseTier !== null) tier = looseTier + 10;
    }
    if (tier !== null) matches.push({ ...item, tier, stats: playerStats(players, item.entry) });
  }
  matches.sort((left, right) => left.tier - right.tier
    || TYPE_ORDER[left.entry.type] - TYPE_ORDER[right.entry.type]
    || (left.entry.type === 'tournament' ? Number(right.entry.id) - Number(left.entry.id) : 0)
    || (left.entry.type === 'player' ? right.stats.goals - left.stats.goals
      || right.stats.apps - left.stats.apps || right.stats.squads - left.stats.squads : 0)
    || compare(left.labelKey, right.labelKey)
    || compare(left.entry.id, right.entry.id));
  return matches.slice(0, limit).map(({ entry, tier }) => ({ ...entry, tier }));
}
