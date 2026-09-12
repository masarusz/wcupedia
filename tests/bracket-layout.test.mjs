import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ui from './golden/ui.json' with { type: 'json' };
import { buildBracket } from '../public/js/bracket.js?v=0.5.4';
import { BRACKET_STYLE_METRICS, bracketLayout, bracketState, stackedBracketLayout } from '../public/js/bracket-layout.js?v=0.5.4';

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

function cssCustomNumber(css, name, unit = 'px') {
  const suffix = unit ? unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const match = css.match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)${suffix}\\s*;`));
  return match ? Number(match[1]) : null;
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

  test('stacked layout has two narrow halves and one connected final for every tournament', () => {
    for (const { year } of tournaments) {
      const bracket = bracketFor(year);
      const layout = stackedBracketLayout(bracket);
      equal(layout.halfColumnCount <= 5, true, `${year} half column count`);
      const finalBoxes = layout.boxes.filter((box) => box.round === 'final');
      equal(finalBoxes.length, bracket.root ? 1 : 0, `${year} final count`);
      for (const half of layout.halves) {
        for (const column of half.columns) {
          const boxes = half.boxes.filter((box) => box.column === column.column)
            .sort((a, b) => a.rowStart - b.rowStart);
          for (let index = 1; index < boxes.length; index += 1) {
            equal(boxes[index - 1].rowStart + boxes[index - 1].rowSpan <= boxes[index].rowStart, true,
              `${year} stacked ${half.side} column ${column.column} overlap`);
          }
        }
      }
      const semiFinals = layout.boxes.filter((box) => box.round === 'sf');
      for (const semiFinal of semiFinals) {
        equal(layout.finalConnectors.filter((connector) => connector.from === semiFinal.id).length, 1,
          `${year} semi-final connector ${semiFinal.id}`);
      }
      equal(layout.finalConnectors.length, semiFinals.length, `${year} final connector count`);
    }
  });

  test('stacked semi-final connectors run edge-to-edge without crossing a box', () => {
    for (const { year } of tournaments) {
      const layout = stackedBracketLayout(bracketFor(year));
      const semiFinals = layout.boxes.filter((box) => box.round === 'sf');
      if (!semiFinals.length) continue;

      for (const semiFinal of semiFinals) {
        const connectors = layout.finalConnectors.filter((connector) => connector.from === semiFinal.id);
        equal(connectors.length, 1, `${year} connector count from ${semiFinal.id}`);
        const connector = connectors[0];
        const expectedSemiRow = connector.side === 'left'
          ? semiFinal.stackedRowStart + semiFinal.rowSpan
          : semiFinal.stackedRowStart;
        const expectedFinalRow = connector.side === 'left'
          ? layout.final.stackedRowStart
          : layout.final.stackedRowStart + layout.final.rowSpan;
        deepEqual(connector.fromEdge, { column: semiFinal.stackedColumn, row: expectedSemiRow },
          `${year} ${connector.side} semi-final edge`);
        deepEqual(connector.toEdge, { column: layout.final.stackedColumn, row: expectedFinalRow },
          `${year} ${connector.side} final edge`);
        equal(connector.segments.length > 0, true, `${year} ${connector.side} connector segments`);

        let point = connector.fromEdge;
        for (const segment of connector.segments) {
          deepEqual({ column: segment.column, row: segment.fromRow }, point,
            `${year} ${connector.side} continuous connector`);
          equal(segment.column, layout.final.stackedColumn, `${year} ${connector.side} final column`);
          const segmentTop = Math.min(segment.fromRow, segment.toRow);
          const segmentBottom = Math.max(segment.fromRow, segment.toRow);
          for (const box of layout.boxes.filter((candidate) => candidate.stackedColumn === segment.column)) {
            const boxTop = box.stackedRowStart;
            const boxBottom = box.stackedRowStart + box.rowSpan;
            equal(Math.max(segmentTop, boxTop) < Math.min(segmentBottom, boxBottom), false,
              `${year} ${connector.side} crosses ${box.id}`);
          }
          point = { column: segment.column, row: segment.toRow };
        }
        deepEqual(point, connector.toEdge, `${year} ${connector.side} reaches final`);
      }
      equal(layout.finalConnectors.every((connector) => connector.column === layout.final.stackedColumn), true,
        `${year} semi-final connectors share final column`);
    }
  });

  test('stacked 1938 walkover slot has no connector', () => {
    const layout = stackedBracketLayout(bracketFor(1938));
    const slot = layout.emptySlots.find((candidate) => candidate.team === 'SWE' && candidate.round === 'r16');
    equal(Boolean(slot), true, 'Sweden stacked empty first-round slot');
    equal(layout.connectors.some((connector) => connector.side === slot.side
      && connector.fromRow === slot.centreRow), false, 'stacked empty slot has no connector');
  });

  test('CSS chart names stay readable in every nested rule', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    const nameRules = parseCssRules(css).filter(({ selector, body }) =>
      selector.includes('.bracket-name') && /font-size\s*:/.test(body));
    equal(nameRules.length > 0, true, 'chart-name font rule exists');
    for (const rule of nameRules) {
      const sizes = [...rule.body.matchAll(/font-size\s*:\s*(\d+)px/g)].map((match) => Number(match[1]));
      const variables = [...rule.body.matchAll(/font-size\s*:\s*var\((--[\w-]+)\)/g)]
        .map((match) => cssCustomNumber(css, match[1]));
      const resolvedSizes = [...sizes, ...variables];
      equal(resolvedSizes.length > 0, true, `${rule.selector} font size parsed`);
      equal(resolvedSizes.every((size) => size >= 14), true,
        `${[...rule.atRules, rule.selector].join(' > ')} chart-name font below 14px`);
    }
    equal(/\.bracket-name-short\s*\{[^}]*white-space:\s*nowrap/s.test(css), true, 'short chart names do not wrap');
  });

  test('CSS never clips a chart name inside its box', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    const relevantRules = parseCssRules(css).filter(({ selector }) =>
      selector.includes('.bracket-name') || selector.includes('.bracket-box'));
    const noWrap = relevantRules.some(({ selector, body }) =>
      selector.includes('.bracket-name') && /white-space\s*:\s*nowrap\b/.test(body));
    equal(noWrap, true, 'short names retain one-line treatment');
    for (const rule of relevantRules) {
      const path = [...rule.atRules, rule.selector].join(' > ');
      equal(/text-overflow\s*:/.test(rule.body), false, `${path} uses text-overflow`);
      if (noWrap) {
        equal(/overflow(?:-[a-z]+)?\s*:[^;}]*\b(?:hidden|clip)\b/.test(rule.body), false,
          `${path} clips a nowrap chart name`);
      }
    }
  });

  test('CSS bracket metrics match layout arithmetic and fit seven 14px characters', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    const cssMetrics = {
      pagePaddingInlinePx: cssCustomNumber(css, '--page-padding-inline'),
      nameFontPx: cssCustomNumber(css, '--bracket-name-font-size'),
      shortNameCharacters: cssCustomNumber(css, '--bracket-short-name-characters', ''),
      flagWidthPx: cssCustomNumber(css, '--bracket-flag-width'),
      teamColumnGapPx: cssCustomNumber(css, '--bracket-team-column-gap'),
      boxBorderPx: cssCustomNumber(css, '--bracket-box-border-width'),
      finalBoxBorderPx: cssCustomNumber(css, '--bracket-final-box-border-width'),
      boxPaddingInlinePx: cssCustomNumber(css, '--bracket-box-padding-inline'),
      teamPaddingInlinePx: cssCustomNumber(css, '--bracket-team-padding-inline'),
      halfGapPx: {
        1: cssCustomNumber(css, '--bracket-half-gap-1'),
        2: cssCustomNumber(css, '--bracket-half-gap-2'),
        3: cssCustomNumber(css, '--bracket-half-gap-3'),
        4: cssCustomNumber(css, '--bracket-half-gap-4'),
      },
      sideGapPx: {
        3: cssCustomNumber(css, '--bracket-side-gap-3'),
        5: cssCustomNumber(css, '--bracket-side-gap-5'),
        7: cssCustomNumber(css, '--bracket-side-gap-7'),
      },
      sideThresholdPx: {
        3: cssCustomNumber(css, '--bracket-side-threshold-3'),
        5: cssCustomNumber(css, '--bracket-side-threshold-5'),
        7: cssCustomNumber(css, '--bracket-side-threshold-7'),
      },
    };
    deepEqual(cssMetrics, BRACKET_STYLE_METRICS, 'CSS and JS bracket metrics');

    const requiredInnerWidth = cssMetrics.shortNameCharacters * cssMetrics.nameFontPx
      + cssMetrics.flagWidthPx + cssMetrics.teamColumnGapPx;
    const chartWidths = new Map([768, 1024].map((viewport) =>
      [viewport, viewport - (2 * cssMetrics.pagePaddingInlinePx)]));
    const halfBoxWidth = (chartWidth, halfColumns) =>
      (chartWidth - ((halfColumns - 1) * cssMetrics.halfGapPx[halfColumns])) / halfColumns;
    const sideBoxWidths = (chartWidth, columns) => {
      const halfColumns = (columns - 1) / 2;
      const unit = (chartWidth - (2 * cssMetrics.sideGapPx[columns])) / columns;
      const halfBox = ((halfColumns * unit)
        - ((halfColumns - 1) * cssMetrics.halfGapPx[halfColumns])) / halfColumns;
      return { halfBox, finalBox: unit };
    };
    const usableInnerWidth = (borderBoxWidth, borderWidth) => borderBoxWidth
      - (2 * borderWidth)
      - (2 * cssMetrics.boxPaddingInlinePx)
      - (2 * cssMetrics.teamPaddingInlinePx);

    for (const [viewport, chartWidth] of chartWidths) {
      for (const columns of [1, 3, 5, 7, 9]) {
        const threshold = cssMetrics.sideThresholdPx[columns];
        const mode = columns === 1 ? 'single'
          : columns === 9 || chartWidth < threshold ? 'stacked' : 'side-by-side';
        let boxWidths;
        if (columns === 1) boxWidths = { finalBox: Math.min(240, chartWidth) };
        else if (mode === 'stacked') {
          const width = halfBoxWidth(chartWidth, (columns - 1) / 2);
          boxWidths = { halfBox: width, finalBox: width };
        } else boxWidths = sideBoxWidths(chartWidth, columns);
        const innerWidth = Math.min(
          boxWidths.halfBox === undefined ? Infinity
            : usableInnerWidth(boxWidths.halfBox, cssMetrics.boxBorderPx),
          usableInnerWidth(boxWidths.finalBox, cssMetrics.finalBoxBorderPx),
        );
        equal(innerWidth + 1e-9 >= requiredInnerWidth, true,
          `${viewport}px ${columns} columns ${mode}: ${innerWidth.toFixed(2)}px inner, ${requiredInnerWidth}px required`);
      }
    }
  });

  test('CSS selects stacked and side-by-side modes at the required container widths', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    const rules = parseCssRules(css);
    equal(rules.some(({ selector, body, atRules }) => selector.includes('.chart-cols-9')
      && /display\s*:\s*flex/.test(body) && atRules.length === 0), true, '9 columns stack unconditionally');
    equal(rules.some(({ selector, body, atRules }) => selector.includes('.chart-cols-9')
      && /display\s*:\s*grid/.test(body) && atRules.length > 0), false, '9 columns never switch side-by-side');

    const sevenSideRules = rules.filter(({ selector, body }) =>
      selector.includes('.chart-cols-7') && /display\s*:\s*grid/.test(body));
    equal(sevenSideRules.length, 1, '7-column side-by-side rule count');
    equal(sevenSideRules[0].atRules.some((header) => new RegExp(`@container\\s+bracket-chart\\s*\\(min-width:\\s*${BRACKET_STYLE_METRICS.sideThresholdPx[7]}px\\)`).test(header)), true,
      '7 columns switch at 900px');
    const fiveSideRules = rules.filter(({ selector, body }) =>
      selector.includes('.chart-cols-5') && /display\s*:\s*grid/.test(body));
    equal(fiveSideRules.length, 1, '5-column side-by-side rule count');
    equal(fiveSideRules[0].atRules.some((header) => new RegExp(`@container\\s+bracket-chart\\s*\\(min-width:\\s*${BRACKET_STYLE_METRICS.sideThresholdPx[5]}px\\)`).test(header)), true,
      '5 columns switch at 640px');
  });

  test('side-by-side final stage has no full-height frame', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    const rules = parseCssRules(css);
    for (const columns of [3, 5, 7]) {
      const finalStageRules = rules.filter(({ selector, atRules }) =>
        selector.split(',').map((part) => part.trim()).includes(`.chart-cols-${columns} .bracket-final-stage`)
        && (columns === 3
          ? atRules.length === 0
          : atRules.some((header) => new RegExp(`@container\\s+bracket-chart\\s*\\(min-width:\\s*${BRACKET_STYLE_METRICS.sideThresholdPx[columns]}px\\)`).test(header))));
      equal(finalStageRules.some(({ body }) => /border\s*:\s*0\s*;/.test(body)
        && /background\s*:\s*none\s*;/.test(body)), true, `${columns}-column final-stage frame reset`);
    }
    equal(rules.some(({ selector, body }) => selector.includes('.bracket-final-grid .bracket-box')
      && /align-self\s*:\s*center\s*;/.test(body)), true, 'final box does not stretch to chart height');
  });

  test('CSS defines every computed stacked bracket grid placement class', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    for (const { year } of tournaments) {
      const layout = stackedBracketLayout(bracketFor(year));
      for (const box of layout.boxes.filter((candidate) => candidate.side !== 'centre')) {
        equal(css.includes(`.half-box-col-${box.column} {`), true, `${year} box column ${box.column}`);
        equal(css.includes(`.row-start-${box.rowStart} {`), true, `${year} box row ${box.rowStart}`);
        equal(css.includes(`.row-span-${box.rowSpan} {`), true, `${year} box span ${box.rowSpan}`);
      }
      for (const connector of layout.halves.flatMap((half) => half.connectors)) {
        equal(css.includes(`.half-gap-col-${connector.gapColumn} {`), true, `${year} connector column ${connector.gapColumn}`);
        equal(css.includes(`.row-start-${connector.rowStart} {`), true, `${year} connector row ${connector.rowStart}`);
        equal(css.includes(`.row-span-${connector.rowSpan} {`), true, `${year} connector span ${connector.rowSpan}`);
      }
    }
  });
}
