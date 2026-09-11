import { fold } from '../../public/js/fold.js';

const TARGET_TYPES = new Set(['team', 'player', 'tournament']);

function unique(values) {
  return [...new Set(values)];
}

export function addTournamentHostKeys(entries, tournaments) {
  const teamEntries = new Map(entries.filter((entry) => entry.type === 'team').map((entry) => [entry.id, entry]));
  const hostsByYear = new Map(tournaments.map((tournament) => [String(tournament.year), tournament.hosts]));
  return entries.map((entry) => {
    if (entry.type !== 'tournament') return entry;
    const hosts = hostsByYear.get(entry.id);
    if (!Array.isArray(hosts) || hosts.length === 0) throw new Error(`missing hosts for tournament:${entry.id}`);
    const hostKeys = hosts.flatMap((host) => {
      const target = teamEntries.get(host);
      if (!target) throw new Error(`unknown tournament host team:${host}`);
      return target.keys;
    });
    return { ...entry, keys: unique([...entry.keys, ...hostKeys]) };
  });
}

export function mergeSearchAliases(entries, aliases) {
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) throw new Error('malformed search aliases: expected object');
  const targets = new Map(entries.map((entry) => [`${entry.type}:${entry.id}`, entry]));
  const additions = new Map();
  for (const [targetKey, values] of Object.entries(aliases)) {
    if (targetKey === '_about') {
      if (typeof values !== 'string') throw new Error('malformed search aliases: _about must be a string');
      continue;
    }
    const separator = targetKey.indexOf(':');
    const type = targetKey.slice(0, separator);
    const id = targetKey.slice(separator + 1);
    if (separator < 1 || !TARGET_TYPES.has(type) || !id) throw new Error(`malformed search alias target ${JSON.stringify(targetKey)}`);
    if (!targets.has(targetKey)) throw new Error(`unknown search alias target ${targetKey}`);
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'string' || !fold(value))) {
      throw new Error(`malformed search aliases for ${targetKey}`);
    }
    additions.set(targetKey, unique(values.map(fold)));
  }
  return entries.map((entry) => {
    const extra = additions.get(`${entry.type}:${entry.id}`);
    return extra ? { ...entry, keys: unique([...entry.keys, ...extra]) } : entry;
  });
}
