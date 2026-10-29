import { NODE_HEIGHT, NODE_WIDTH, type Design } from './design.ts';
import type { Point } from './geometry.ts';

const COLUMN_WIDTH = NODE_WIDTH + 120;
const ROW_HEIGHT = NODE_HEIGHT + 48;
/** Back and forth passes that shuffle each column to untangle its cables. */
const SWEEPS = 4;

/**
 * Where each component should sit so traffic reads left to right and
 * cables cross as little as possible: columns by how far a component is
 * from the clients, then each column shuffled towards the average height of
 * its neighbours.
 */
export function layoutPositions(design: Design): Map<string, Point> {
  const ids = design.nodes.map((node) => node.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const { from, to } of design.cables) {
    out.get(from.nodeId)!.push(to.nodeId);
    neighbours.get(from.nodeId)!.push(to.nodeId);
    neighbours.get(to.nodeId)!.push(from.nodeId);
  }

  const forward = withoutBackEdges(design, ids, out);
  const rank = longestPathRanks(ids, forward);
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const column = columns.get(rank.get(id)!) ?? [];
    column.push(id);
    columns.set(rank.get(id)!, column);
  }
  const order = [...columns.keys()].sort((a, b) => a - b);

  const height = new Map<string, number>();
  const place = (column: string[]) =>
    column.forEach((id, index) => height.set(id, index));
  order.forEach((key) => place(columns.get(key)!));

  const average = (id: string) => {
    const heights = neighbours.get(id)!.map((other) => height.get(other)!);
    return heights.length === 0
      ? height.get(id)!
      : heights.reduce((sum, value) => sum + value, 0) / heights.length;
  };
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const keys = sweep % 2 === 0 ? order : [...order].reverse();
    for (const key of keys) {
      const column = columns.get(key)!;
      column.sort(
        (a, b) => average(a) - average(b) || height.get(a)! - height.get(b)!,
      );
      place(column);
    }
  }

  const positions = new Map<string, Point>();
  const arrange = () => {
    for (const key of order) {
      const column = columns.get(key)!;
      column.forEach((id, index) =>
        positions.set(id, {
          x: key * COLUMN_WIDTH,
          y: (index - (column.length - 1) / 2) * ROW_HEIGHT,
        }),
      );
    }
  };
  arrange();

  // Swapping neighbours is cheap, and keeps whatever lowers the crossings.
  const edges = design.cables.map(({ from, to }): [string, string] => [
    from.nodeId,
    to.nodeId,
  ]);
  let crossings = crossingsBetween(edges, (id) => positions.get(id)!);
  for (let improved = true; improved && crossings > 0;) {
    improved = false;
    for (const key of order) {
      const column = columns.get(key)!;
      for (let i = 0; i + 1 < column.length; i++) {
        [column[i], column[i + 1]] = [column[i + 1], column[i]];
        arrange();
        const swapped = crossingsBetween(edges, (id) => positions.get(id)!);
        if (swapped < crossings) {
          crossings = swapped;
          improved = true;
        } else {
          [column[i], column[i + 1]] = [column[i + 1], column[i]];
        }
      }
    }
    arrange();
  }
  return positions;
}

/**
 * Moves every component into its tidy place, keeping the board's centre
 * where it was, and plugs each cable into the sides that face its other end.
 */
export function tidyUp(design: Design): void {
  if (design.nodes.length === 0) return;
  const positions = layoutPositions(design);
  const centre = (points: Point[]) => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  });
  const before = centre(design.nodes);
  const after = centre([...positions.values()]);
  for (const node of design.nodes) {
    const { x, y } = positions.get(node.id)!;
    design.moveNode(node.id, {
      x: Math.round(x + before.x - after.x),
      y: Math.round(y + before.y - after.y),
    });
  }
  for (const cable of design.cables) {
    const from = design.getNode(cable.from.nodeId);
    const to = design.getNode(cable.to.nodeId);
    if (from.x === to.x) {
      const down = to.y > from.y;
      cable.from.side = down ? 'bottom' : 'top';
      cable.to.side = down ? 'top' : 'bottom';
    } else {
      const right = to.x > from.x;
      cable.from.side = right ? 'right' : 'left';
      cable.to.side = right ? 'left' : 'right';
    }
  }
}

/** How many pairs of cables cross, drawn as straight lines between centres. */
export function countCrossings(design: Design): number {
  return crossingsBetween(
    design.cables.map(({ from, to }) => [from.nodeId, to.nodeId]),
    (id) => design.getNode(id),
  );
}

function crossingsBetween(
  edges: [string, string][],
  at: (id: string) => Point,
): number {
  const side = (p: Point, q: Point, r: Point) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [one, two] = [edges[i], edges[j]];
      if (one.some((id) => two.includes(id))) continue;
      const [a, b, c, d] = [at(one[0]), at(one[1]), at(two[0]), at(two[1])];
      if (
        side(a, b, c) * side(a, b, d) < 0 &&
        side(c, d, a) * side(c, d, b) < 0
      ) {
        crossings++;
      }
    }
  }
  return crossings;
}

/** The cables that point the way traffic flows: loops are cut where they close. */
function withoutBackEdges(
  design: Design,
  ids: string[],
  out: Map<string, string[]>,
): Map<string, string[]> {
  const clients = design.nodes
    .filter((node) => node.kind === 'client')
    .map((node) => node.id);
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const visit = (id: string) => {
    visited.add(id);
    onPath.add(id);
    for (const to of out.get(id)!) {
      if (onPath.has(to)) continue;
      forward.get(id)!.push(to);
      if (!visited.has(to)) visit(to);
    }
    onPath.delete(id);
  };
  for (const id of [...clients, ...ids]) if (!visited.has(id)) visit(id);
  return forward;
}

function longestPathRanks(
  ids: string[],
  forward: Map<string, string[]>,
): Map<string, number> {
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  // Repeating as many times as there are components settles any chain.
  for (let pass = 0; pass < ids.length; pass++) {
    for (const [from, targets] of forward) {
      for (const to of targets) {
        rank.set(to, Math.max(rank.get(to)!, rank.get(from)! + 1));
      }
    }
  }
  return rank;
}
