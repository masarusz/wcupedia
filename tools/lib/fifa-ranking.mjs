const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function buildFifaRanking(source, teams) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.rows)) {
    throw new Error('FIFA ranking must contain rows');
  }
  if (source.rows.length !== 211) {
    throw new Error(`FIFA ranking must contain exactly 211 rows; got ${source.rows.length}`);
  }
  if (!validDate(source.releaseDate)) {
    throw new Error(`FIFA ranking releaseDate is invalid: ${source.releaseDate}`);
  }

  let previousPoints = Infinity;
  const rows = source.rows.map((row, index) => {
    const expectedRank = index + 1;
    if (row.rank !== expectedRank) {
      throw new Error(`FIFA ranking ranks must be contiguous 1..211; expected ${expectedRank}, got ${row.rank}`);
    }
    if (typeof row.points !== 'number' || !Number.isFinite(row.points) || row.points > previousPoints) {
      throw new Error(`FIFA ranking points must be non-increasing at rank ${row.rank}`);
    }
    previousPoints = row.points;

    const hasTeam = hasText(row.team);
    if (hasTeam && !Object.hasOwn(teams, row.team)) {
      throw new Error(`FIFA ranking team does not exist in teams.json: ${row.team}`);
    }
    if (!hasTeam && (!hasText(row.name) || !hasText(row.flag))) {
      throw new Error(`FIFA ranking non-team row ${row.rank} must have a non-empty name and flag`);
    }
    if (!['up', 'down', 'same'].includes(row.move)) {
      throw new Error(`FIFA ranking row ${row.rank} has invalid movement`);
    }
    if (row.move !== 'same' && (!Number.isInteger(row.moveBy) || row.moveBy < 1)) {
      throw new Error(`FIFA ranking row ${row.rank} must have a positive moveBy`);
    }

    return {
      rank: row.rank,
      points: row.points,
      move: row.move,
      ...(row.move === 'same' ? {} : { moveBy: row.moveBy }),
      ...(hasTeam ? { team: row.team } : { name: row.name, flag: row.flag }),
    };
  });

  return {
    releaseDate: source.releaseDate,
    previousDate: source.previousDate,
    nextUpdate: source.nextUpdate,
    source: source.source,
    sourceLicence: source.sourceLicence,
    publisher: source.publisher,
    rows,
  };
}
