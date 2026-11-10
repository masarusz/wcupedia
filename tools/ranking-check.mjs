#!/usr/bin/env node
/**
 * Read-only monthly FIFA ranking publication check.
 *
 * Test-only environment overrides:
 * - WCUPEDIA_MODULE_FILE reads module text from a local file instead of fetching.
 * - WCUPEDIA_CURATED_FILE replaces curated/fifa-ranking.json.
 * - WCUPEDIA_TODAY replaces the local calendar date (YYYY-MM-DD).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_URL = 'https://en.wikipedia.org/w/index.php?title=Module:SportsRankings/data/FIFA_World_Rankings&action=raw';
const MONTHS = new Map([
  ['January', 1], ['February', 2], ['March', 3], ['April', 4],
  ['May', 5], ['June', 6], ['July', 7], ['August', 8],
  ['September', 9], ['October', 10], ['November', 11], ['December', 12],
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!DATE_PATTERN.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function moduleDate(text, key) {
  const match = text.match(new RegExp(`^\\s*data\\.${key}\\s*=\\s*\\{\\s*day\\s*=\\s*(\\d+)\\s*,\\s*month\\s*=\\s*(['\"])([A-Za-z]+)\\2\\s*,\\s*year\\s*=\\s*(\\d+)\\s*\\}`, 'm'));
  if (!match) return null;
  const month = MONTHS.get(match[3]);
  if (!month) return null;
  const value = `${match[4].padStart(4, '0')}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return validDate(value) ? value : null;
}

export function parseModuleDates(text) {
  return {
    updated: moduleDate(text, 'updated'),
    previous: moduleDate(text, 'previous'),
    next: moduleDate(text, 'next'),
  };
}

export function decide({ updated, next: _next, releaseDate, nextUpdate, today }) {
  if (!updated) return { outcome: 'BROKE', code: 1, reason: 'The module data.updated date could not be parsed.' };
  if (!validDate(releaseDate)) return { outcome: 'BROKE', code: 1, reason: 'The site releaseDate is missing or invalid.' };
  if (updated > releaseDate) return { outcome: 'NEW', code: 3, reason: 'FIFA has published a newer ranking than the site shows.' };
  if (updated < releaseDate) return { outcome: 'HOLD', code: 2, reason: 'The module ranking date is older than the site releaseDate.' };
  if (validDate(nextUpdate) && validDate(today)) {
    const overdueAfter = new Date(`${nextUpdate}T00:00:00Z`);
    overdueAfter.setUTCDate(overdueAfter.getUTCDate() + 10);
    if (today > overdueAfter.toISOString().slice(0, 10)) {
      return { outcome: 'HOLD', code: 2, reason: 'The expected next ranking is more than 10 days overdue.' };
    }
  }
  return { outcome: 'NOOP', code: 0, reason: 'The site already shows the latest published ranking.' };
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shown(value, fallback) {
  return value || fallback;
}

async function loadModuleText() {
  if (process.env.WCUPEDIA_MODULE_FILE) return readFile(process.env.WCUPEDIA_MODULE_FILE, 'utf8');
  const response = await fetch(MODULE_URL, {
    headers: { 'User-Agent': 'wcupedia-refresh/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`module fetch failed with HTTP ${response.status}`);
  return response.text();
}

function statusText({ outcome, today, updated, next, releaseDate, nextUpdate, reason }) {
  const nextStep = outcome === 'NOOP' ? 'nothing to do'
    : outcome === 'NEW' ? 'follow docs/ranking-refresh.md' : 'a person should look';
  return `# Wcupedia FIFA ranking check: ${outcome}\n\n` +
    `- Checked: ${today}\n` +
    `- Module data.updated: ${shown(updated, 'unparsed')}\n` +
    `- Module data.next: ${shown(next, 'unknown')}\n` +
    `- Site releaseDate: ${shown(releaseDate, 'unknown')}\n` +
    `- Site nextUpdate: ${shown(nextUpdate, 'unknown')}\n` +
    `- Reason: ${reason}\n` +
    `- Next step: ${nextStep}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv[0]) {
    console.error('Usage: node tools/ranking-check.mjs <notify-directory>');
    return 1;
  }

  const notifyDir = resolve(argv[0]);
  const statusPath = join(notifyDir, 'wcupedia-refresh-status.md');
  const today = process.env.WCUPEDIA_TODAY || localToday();
  let updated = null;
  let next = null;
  let releaseDate;
  let nextUpdate;
  let result;

  try {
    if (!validDate(today)) throw new Error('today is not a valid YYYY-MM-DD date');
    const repoRoot = resolve(import.meta.dirname, '..');
    const curatedPath = process.env.WCUPEDIA_CURATED_FILE || join(repoRoot, 'curated/fifa-ranking.json');
    const [moduleText, curatedText] = await Promise.all([loadModuleText(), readFile(curatedPath, 'utf8')]);
    const parsed = parseModuleDates(moduleText);
    updated = parsed.updated;
    next = parsed.next;
    const curated = JSON.parse(curatedText);
    releaseDate = curated.releaseDate;
    nextUpdate = curated.nextUpdate;
    result = decide({ updated, next, releaseDate, nextUpdate, today });
  } catch (error) {
    result = { outcome: 'BROKE', code: 1, reason: `The ranking check failed: ${error.message}.` };
  }

  try {
    await mkdir(notifyDir, { recursive: true });
    await writeFile(statusPath, statusText({
      outcome: result.outcome, today, updated, next, releaseDate, nextUpdate, reason: result.reason,
    }));
  } catch (error) {
    console.error(`Could not write status file ${statusPath}: ${error.message}`);
    return 1;
  }

  console.log(`${result.outcome}: ${result.reason} (module ${shown(updated, 'unparsed')}, site ${shown(releaseDate, 'unknown')})`);
  console.log(statusPath);
  return result.code;
}

const direct = import.meta.main ?? (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (direct) process.exitCode = await main();
