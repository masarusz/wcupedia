const BOX_ROW_SPAN = 6;
const LEAF_ROW_STEP = 8;
const LEAF_CENTRE = 5;

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

export function bracketLayout(tree, { compactOuter = false } = {}) {
  const root = rootOf(tree);
  if (!root) {
    return { columnCount: 0, rowCount: 0, columns: [], boxes: [], connectors: [], emptySlots: [], compactOuter };
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
  return { columnCount, rowCount, columns, boxes, connectors, emptySlots, compactOuter };
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
