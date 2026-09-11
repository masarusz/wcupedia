const DAY_MS = 24 * 60 * 60 * 1000;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function ageInYears(birthDate, onDate) {
  if (!isIsoDate(birthDate) || !isIsoDate(onDate)) throw new Error(`invalid age date: ${birthDate} / ${onDate}`);
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  const [onYear, onMonth, onDay] = onDate.split('-').map(Number);
  return onYear - birthYear - (onMonth < birthMonth || (onMonth === birthMonth && onDay < birthDay) ? 1 : 0);
}

export function ageInDays(birthDate, onDate) {
  if (!isIsoDate(birthDate) || !isIsoDate(onDate)) throw new Error(`invalid age date: ${birthDate} / ${onDate}`);
  return Math.round((Date.parse(`${onDate}T00:00:00Z`) - Date.parse(`${birthDate}T00:00:00Z`)) / DAY_MS);
}
