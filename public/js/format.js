export function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return String(value);
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

export function formatMinute(value) {
  return `${String(value)}分`;
}

export function groupLabel(value) {
  return String(value).replace(/^Group\s+/, 'グループ');
}

export function tournamentTitle(tournament, teams) {
  const hosts = [...tournament.hosts];
  const japan = hosts.indexOf('JPN');
  if (japan > 0) hosts.unshift(...hosts.splice(japan, 1));
  return `${tournament.year}{年|ねん} ${hosts.map((key) => teams[key].ja).join('・')}{大会|たいかい}`;
}

export function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}
