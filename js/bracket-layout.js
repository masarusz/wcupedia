const BOX_ROW_SPAN = 6;
const LEAF_ROW_STEP = 8;
const LEAF_CENTRE = 5;
const STACKED_SECTION_GAP_ROWS = 2;

export const BRACKET_STYLE_METRICS = Object.freeze({
  pagePaddingInlinePx: 24,
  nameFontPx: 14,
  shortNameCharacters: 7,
  flagWidthPx: 20,
  teamColumnGapPx: 2,
  boxBorderPx: 1,
  finalBoxBorderPx: 2,
  boxPaddingInlinePx: 1,
  teamPaddingInlinePx: 0,
  halfGapPx: Object.freeze({ 1: 0, 2: 12, 3: 10, 4: 10 }),
  sideGapPx: Object.freeze({ 3: 12, 5: 12, 7: 8 }),
  sideThresholdPx: Object.freeze({ 3: 0, 5: 640, 7: 900 }),
});

function rootOf(tree) {
  if (!tree) return null;
  return Object.hasOwn(tree, 'root') ? tree.root : tree;
}

function treeDepth(tie) {
  if (!tie) return -1;
  return 1 + Math.max(...tie.feeders.map((feeder) => treeDepth(feeder)));
}

function centreFor(firstSlot, lastSlot) {
  return LEAF_CENTRE + (LEAF_ROW_STEP * (firstSlot + lastSlot)) / 2;
}

function tieKey(tie) {
  return tie.matches.join('|');
}

function collectTies(root) {
  const ties = [];
  const seen = new Set();
  function visit(tie) {
    if (!tie || seen.has(tie)) return;
    seen.add(tie);
    ties.push(tie);
    tie.feeders.forEach(visit);
  }
  visit(root);
  return ties;
}

export function bracketLayout(tree) {
  const root = rootOf(tree);
  if (!root) {
    return { columnCount: 0, rowCount: 0, columns: [], boxes: [], connectors: [], emptySlots: [] };
  }

  const depth = treeDepth(root);
  const halfDepth = Math.max(0, depth - 1);
  const leafSlotsPerHalf = depth ? 2 ** halfDepth : 1;
  const columnCount = (depth * 2) + 1;
  const centreColumn = Math.ceil(columnCount / 2);
  const rowCount = leafSlotsPerHalf * LEAF_ROW_STEP;
  const boxes = [];
  const connectors = [];
  const emptySlots = [];

  function addBox(tie, side, column, firstSlot, lastSlot, parentBox = null) {
    const centreRow = centreFor(firstSlot, lastSlot);
    const box = {
      id: tieKey(tie), tie, round: tie.round, teams: tie.teams, matches: tie.matches,
      winner: tie.winner, side, column, rowStart: centreRow - (BOX_ROW_SPAN / 2),
      rowSpan: BOX_ROW_SPAN, centreRow,
    };
    boxes.push(box);
    if (parentBox) {
      const fromRow = centreRow;
      const toRow = parentBox.centreRow;
      connectors.push({
        id: `${box.id}->${parentBox.id}`, from: box.id, to: parentBox.id, side,
        direction: fromRow === toRow ? 'straight' : fromRow < toRow ? 'upper' : 'lower',
        gapColumn: Math.min(column, parentBox.column),
        rowStart: Math.min(fromRow, toRow), rowSpan: Math.max(1, Math.abs(fromRow - toRow)),
        fromRow, toRow,
      });
    }
    return box;
  }

  const finalBox = addBox(root, 'centre', centreColumn, 0, leafSlotsPerHalf - 1);

  function visit(tie, side, level, remainingDepth, firstSlot, lastSlot, parentBox, entryTeam, entryRound) {
    const column = side === 'left' ? centreColumn - level : centreColumn + level;
    if (!tie) {
      const centreRow = centreFor(firstSlot, lastSlot);
      emptySlots.push({
        side, column, rowStart: centreRow - (BOX_ROW_SPAN / 2), rowSpan: BOX_ROW_SPAN,
        centreRow, team: entryTeam || null, round: entryRound || null, parent: parentBox.id,
      });
      return;
    }

    const box = addBox(tie, side, column, firstSlot, lastSlot, parentBox);
    if (remainingDepth === 0) return;
    const slotCount = lastSlot - firstSlot + 1;
    const split = firstSlot + (slotCount / 2) - 1;
    const feederRound = tie.feeders.find(Boolean)?.round || null;
    visit(tie.feeders[0], side, level + 1, remainingDepth - 1, firstSlot, split, box, tie.teams[0], tie.feeders[0]?.round || feederRound);
    visit(tie.feeders[1], side, level + 1, remainingDepth - 1, split + 1, lastSlot, box, tie.teams[1], tie.feeders[1]?.round || feederRound);
  }

  if (depth > 0) {
    const feederRound = root.feeders.find(Boolean)?.round || null;
    visit(root.feeders[0], 'left', 1, halfDepth, 0, leafSlotsPerHalf - 1, finalBox, root.teams[0], root.feeders[0]?.round || feederRound);
    visit(root.feeders[1], 'right', 1, halfDepth, 0, leafSlotsPerHalf - 1, finalBox, root.teams[1], root.feeders[1]?.round || feederRound);
  }

  boxes.sort((a, b) => a.column - b.column || a.rowStart - b.rowStart);
  connectors.sort((a, b) => a.gapColumn - b.gapColumn || a.rowStart - b.rowStart);
  const columns = Array.from({ length: columnCount }, (_, offset) => {
    const column = offset + 1;
    const box = boxes.find((candidate) => candidate.column === column);
    return { column, side: column < centreColumn ? 'left' : column > centreColumn ? 'right' : 'centre', round: box?.round || null };
  });
  return { columnCount, rowCount, columns, boxes, connectors, emptySlots };
}

export function stackedBracketLayout(tree) {
  const wide = bracketLayout(tree);
  if (!wide.boxes.length) {
    return {
      columnCount: 0, halfColumnCount: 0, rowCount: 0, halves: [], final: null,
      boxes: [], connectors: [], finalConnectors: [], emptySlots: [],
    };
  }

  const centreColumn = Math.ceil(wide.columnCount / 2);
  const halfColumnCount = centreColumn - 1;
  const wideFinal = wide.boxes.find((box) => box.side === 'centre');
  const finalRowStart = wide.rowCount + 1 + STACKED_SECTION_GAP_ROWS;
  const bottomRowOffset = finalRowStart + BOX_ROW_SPAN + STACKED_SECTION_GAP_ROWS - 1;
  const final = {
    ...wideFinal,
    stackedColumn: halfColumnCount,
    stackedRowStart: finalRowStart,
  };
  const halves = ['left', 'right'].map((side) => {
    const toLocalColumn = (column) => side === 'left' ? column : column - centreColumn;
    const boxes = wide.boxes.filter((box) => box.side === side).map((box) => {
      const column = toLocalColumn(box.column);
      return {
        ...box,
        column,
        stackedColumn: side === 'left' ? column : halfColumnCount - column + 1,
        stackedRowStart: box.rowStart + (side === 'right' ? bottomRowOffset : 0),
      };
    });
    const boxIds = new Set(boxes.map((box) => box.id));
    const connectors = wide.connectors.filter((connector) => boxIds.has(connector.to)).map((connector) => {
      const from = boxes.find((box) => box.id === connector.from);
      const to = boxes.find((box) => box.id === connector.to);
      return { ...connector, gapColumn: Math.min(from.column, to.column) };
    });
    const emptySlots = wide.emptySlots.filter((slot) => slot.side === side).map((slot) => ({
      ...slot, column: toLocalColumn(slot.column),
    }));
    const columns = Array.from({ length: Math.max(0, halfColumnCount) }, (_, offset) => {
      const column = offset + 1;
      return { column, round: boxes.find((box) => box.column === column)?.round || null };
    });
    return { side, columns, boxes, connectors, emptySlots };
  });
  const halfBoxIds = new Set(halves.flatMap((half) => half.boxes.map((box) => box.id)));
  const stackedBoxes = halves.flatMap((half) => half.boxes);
  const finalConnectors = wide.connectors.filter((connector) => connector.to === final.id
    && halfBoxIds.has(connector.from)).map((connector) => {
    const fromBox = stackedBoxes.find((box) => box.id === connector.from);
    const fromEdge = {
      column: fromBox.stackedColumn,
      row: connector.side === 'left'
        ? fromBox.stackedRowStart + fromBox.rowSpan
        : fromBox.stackedRowStart,
    };
    const toEdge = {
      column: final.stackedColumn,
      row: connector.side === 'left'
        ? final.stackedRowStart
        : final.stackedRowStart + final.rowSpan,
    };
    return {
      ...connector,
      column: final.stackedColumn,
      fromEdge,
      toEdge,
      segments: [{
        column: final.stackedColumn,
        fromRow: fromEdge.row,
        toRow: toEdge.row,
      }],
    };
  });
  const boxes = [...halves.flatMap((half) => half.boxes), final];
  const connectors = [...halves.flatMap((half) => half.connectors), ...finalConnectors];
  const emptySlots = halves.flatMap((half) => half.emptySlots);

  return {
    columnCount: wide.columnCount,
    halfColumnCount,
    rowCount: wide.rowCount,
    halves,
    final,
    boxes,
    connectors,
    finalConnectors,
    emptySlots,
  };
}

export function bracketState(tree, stepIndex) {
  const root = rootOf(tree);
  if (!root) return { stepIndex: 0, rounds: [], boxes: [], champion: null };
  const ties = collectTies(root);
  const rounds = [...new Set(ties.map((tie) => tie.round))].sort((a, b) => {
    const distance = (round) => {
      const tie = ties.find((candidate) => candidate.round === round);
      return treeDepth(tie);
    };
    return distance(a) - distance(b);
  });
  const selectedStep = Math.max(0, Math.min(rounds.length, Number.isInteger(stepIndex) ? stepIndex : 0));
  const roundIndex = new Map(rounds.map((round, index) => [round, index]));
  const boxes = ties.map((tie) => {
    const index = roundIndex.get(tie.round);
    const showTeams = index <= selectedStep;
    const showScore = index < selectedStep;
    return {
      id: tieKey(tie), tie, round: tie.round,
      teams: showTeams ? tie.teams : ['？', '？'],
      showTeams, showScore, winner: showScore ? tie.winner : null,
    };
  });
  const finalState = selectedStep === rounds.length;
  return { stepIndex: selectedStep, rounds, boxes, champion: finalState ? root.winner : null };
}
