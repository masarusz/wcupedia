const FIGURES = ['p', 'w', 'd', 'l', 'gf', 'ga'];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function buildJapanH2h(source, fifaRanking) {
  if (!source || typeof source !== 'object' || !source.rows || typeof source.rows !== 'object'
    || Array.isArray(source.rows)) {
    throw new Error('Japan head-to-head data must contain rows');
  }
  if (!validDate(source.asOf)) {
    throw new Error(`Japan head-to-head asOf is invalid: ${source.asOf}`);
  }

  const rankingKeys = new Set(fifaRanking.rows.map((row) => row.team ?? row.name));
  let coveredMatches = 0;
  const rows = {};
  for (const [key, row] of Object.entries(source.rows)) {
    if (!rankingKeys.has(key)) {
      throw new Error(`Japan head-to-head key is not in the FIFA ranking: ${key}`);
    }
    if (!row || typeof row !== 'object' || FIGURES.some((figure) => !Number.isInteger(row[figure]) || row[figure] < 0)) {
      throw new Error(`Japan head-to-head row has invalid figures: ${key}`);
    }
    if (row.w + row.d + row.l !== row.p) {
      throw new Error(`Japan head-to-head wins, draws and losses do not total matches: ${key}`);
    }
    coveredMatches += row.p;
    rows[key] = {
      p: row.p, w: row.w, d: row.d, l: row.l, gf: row.gf, ga: row.ga,
      first: row.first, last: row.last,
    };
  }
  if (coveredMatches !== 793) {
    throw new Error(`Japan head-to-head rows must cover 793 matches; got ${coveredMatches}`);
  }

  return {
    asOf: source.asOf,
    totals: source.totals,
    source: source.source,
    sourceLicence: source.sourceLicence,
    rows,
  };
}
