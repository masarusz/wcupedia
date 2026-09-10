import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ui from './golden/ui.json' with { type: 'json' };
import { buildBracket } from '../public/js/bracket.js?v=0.1.0';
import { bracketLayout, bracketState } from '../public/js/bracket-layout.js?v=0.1.0';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = join(ROOT, 'public/data');
const load = (path) => JSON.parse(readFileSync(join(DATA, path), 'utf8'));
const tournaments = load('tournaments.json');
const details = new Map(tournaments.map(({ year }) => [year, load(`t/${year}.json`)]));

function bracketFor(year) {
  return buildBracket(details.get(year));
}

function boxesForRound(layout, round) {
  return layout.boxes.filter((box) => box.round === round);
}

function stateRound(state, round) {
  return state.boxes.filter((box) => box.round === round);
}

function parseAtRules(css) {
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth) {
      if (css[close] === '{') depth += 1;
      if (css[close] === '}') depth -= 1;
      close += 1;
    }
    const headerStart = css.lastIndexOf('}', open - 1) + 1;
    const header = css.slice(Math.max(cursor, headerStart), open).trim();
    const body = css.slice(open + 1, close - 1);
    if (header.startsWith('@')) rules.push({ header, body });
    cursor = close;
  }
  return rules;
}

export function register(test, equal, deepEqual) {
  test('bracket layout counts and columns match every tournament golden', () => {
    for (const { year } of tournaments) {
      const bracket = bracketFor(year);
      const layout = bracketLayout(bracket);
      const expectedCounts = Object.fromEntries(Object.entries(bracket.rounds)
        .filter(([, ties]) => ties.length).map(([round, ties]) => [round, ties.length]));
      const goldenCounts = ui.bracket[String(year)]?.ties;
      if (goldenCounts) deepEqual(expectedCounts, goldenCounts, `${year} golden counts`);
      const totalExpected = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
      equal(layout.boxes.length, totalExpected, `${year} total boxes`);
      for (const [round, count] of Object.entries(expectedCounts)) {
        const boxes = boxesForRound(layout, round);
        equal(boxes.length, count, `${year} ${round} boxes`);
        const columns = new Set(boxes.map((box) => box.column));
        equal(columns.size, round === 'final' ? 1 : 2, `${year} ${round} columns`);
        if (round !== 'final' && count % 2 === 0) {
          equal(boxes.filter((box) => box.side === 'left').length, count / 2, `${year} ${round} left half`);
          equal(boxes.filter((box) => box.side === 'right').length, count / 2, `${year} ${round} right half`);
        }
      }
      equal(layout.boxes.some((box) => bracket.third?.matches.includes(box.matches[0])), false, `${year} third-place excluded`);
    }
  });

  test('bracket boxes never overlap within a column', () => {
    for (const { year } of tournaments) {
      const layout = bracketLayout(bracketFor(year));
      for (const column of layout.columns) {
        const boxes = layout.boxes.filter((box) => box.column === column.column).sort((a, b) => a.rowStart - b.rowStart);
        for (let index = 1; index < boxes.length; index += 1) {
          equal(boxes[index - 1].rowStart + boxes[index - 1].rowSpan <= boxes[index].rowStart, true,
            `${year} column ${column.column} overlap`);
        }
      }
    }
  });

  test('every feeder box has one correctly mirrored connector to its parent', () => {
    for (const { year } of tournaments) {
      const layout = bracketLayout(bracketFor(year));
      const final = layout.boxes.find((box) => box.round === 'final');
      for (const box of layout.boxes.filter((candidate) => candidate !== final)) {
        const connectors = layout.connectors.filter((connector) => connector.from === box.id);
        equal(connectors.length, 1, `${year} connector from ${box.id}`);
        equal(connectors[0].side, box.side, `${year} connector side ${box.id}`);
        const parent = layout.boxes.find((candidate) => candidate.id === connectors[0].to);
        equal(box.side === 'left' ? parent.column > box.column : parent.column < box.column, true,
          `${year} connector direction ${box.id}`);
      }
      equal(layout.connectors.some((connector) => connector.from === final?.id), false, `${year} final connector`);
    }
  });

  test('2022 bracket halves mirror their row positions', () => {
    const layout = bracketLayout(bracketFor(2022));
    for (const round of ['r16', 'qf', 'sf']) {
      const left = boxesForRound(layout, round).filter((box) => box.side === 'left').map((box) => [box.rowStart, box.rowSpan]);
      const right = boxesForRound(layout, round).filter((box) => box.side === 'right').map((box) => [box.rowStart, box.rowSpan]);
      deepEqual(left, right, round);
    }
  });

  test('2022 bracket states reveal only completed and next rounds', () => {
    const bracket = bracketFor(2022);
    const beginning = bracketState(bracket, 0);
    equal(stateRound(beginning, 'r16').filter((box) => box.showTeams).length, 8, 'beginning first-round teams');
    equal(beginning.boxes.filter((box) => box.showScore).length, 0, 'beginning scores');
    for (const box of beginning.boxes.filter((candidate) => candidate.round !== 'r16')) {
      deepEqual(box.teams, ['？', '？'], `beginning ${box.round} placeholders`);
    }

    const afterR16 = bracketState(bracket, 1);
    equal(stateRound(afterR16, 'r16').filter((box) => box.showScore).length, 8, 'round-of-16 scores');
    equal(stateRound(afterR16, 'qf').filter((box) => box.showTeams && !box.showScore).length, 4, 'quarter-final arrivals');

    const final = bracketState(bracket, 4);
    equal(final.boxes.filter((box) => box.showScore).length, 15, 'final scores');
    equal(final.champion, 'ARG', 'champion');
  });

  test('2026 final bracket state scores every tie', () => {
    const final = bracketState(bracketFor(2026), 5);
    equal(final.boxes.filter((box) => box.showScore).length, 31, 'scores');
    equal(final.champion, 'ESP', 'champion');
  });

  test('1938 walkover reserves an empty leaf slot without a connector', () => {
    const layout = bracketLayout(bracketFor(1938));
    const slot = layout.emptySlots.find((candidate) => candidate.team === 'SWE' && candidate.round === 'r16');
    equal(Boolean(slot), true, 'Sweden empty first-round slot');
    equal(layout.boxes.some((box) => box.column === slot.column && box.rowStart === slot.rowStart), false, 'empty slot has no box');
    equal(layout.connectors.some((connector) => connector.side === slot.side
      && connector.gapColumn === Math.min(slot.column, layout.boxes.find((box) => box.id === slot.parent).column)
      && connector.fromRow === slot.centreRow), false, 'empty slot has no connector');
  });

  test('compact outer-column rules are scoped to a width below iPad landscape', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    const compactRules = parseAtRules(css).filter(({ header, body }) =>
      body.includes('.bracket-columns-9 .box-col-1 .bracket-name') && body.includes('.box-col-9 .bracket-name'));
    equal(compactRules.length, 1, 'compact media rule count');
    const width = Number(/max-width\s*:\s*(\d+)px/.exec(compactRules[0].header)?.[1]);
    equal(width <= 800, true, 'compact applies by 800px');
    equal(width < 1024, true, 'compact does not apply at 1024px');
  });

  test('CSS defines every computed bracket grid placement class', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    for (const { year } of tournaments) {
      const layout = bracketLayout(bracketFor(year));
      for (const box of layout.boxes) {
        equal(css.includes(`.box-col-${box.column} {`), true, `${year} box column ${box.column}`);
        equal(css.includes(`.row-start-${box.rowStart} {`), true, `${year} box row ${box.rowStart}`);
        equal(css.includes(`.row-span-${box.rowSpan} {`), true, `${year} box span ${box.rowSpan}`);
      }
      for (const connector of layout.connectors) {
        equal(css.includes(`.gap-col-${connector.gapColumn} {`), true, `${year} connector column ${connector.gapColumn}`);
        equal(css.includes(`.row-start-${connector.rowStart} {`), true, `${year} connector row ${connector.rowStart}`);
        equal(css.includes(`.row-span-${connector.rowSpan} {`), true, `${year} connector span ${connector.rowSpan}`);
      }
    }
  });
}
