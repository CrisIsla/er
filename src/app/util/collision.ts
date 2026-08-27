/**
 * Keeping dragged shapes out of each other.
 *
 * The rule is the one a box on a desk follows: a shape stops where it meets
 * another, but it can still slide along it. That falls out of resolving one
 * axis at a time -- the shape is pushed back out of the overlap on whichever
 * axis it came in on, leaving the other free -- which is also why it never gets
 * stuck: moving away from an obstacle is never blocked by it.
 *
 * Shapes are compared by what they cover on screen rather than by the box React
 * Flow measured, so a relationship diamond -- which reaches past its box, being
 * a square rotated inside it -- collides where it is drawn.
 *
 * Pure and free of React Flow types, so the whole rule can be tested without a
 * DOM.
 */

import { PositionedNode, Rect, toAbsoluteRects } from "./alignmentCandidates";
import { rectsOverlap, visualRectOf } from "./layout/geometry";

type Vec = { x: number; y: number };

const at = (rect: Rect, position: Vec): Rect => ({ ...rect, ...position });

/**
 * The shapes a node may never collide with: itself, whatever contains it, and
 * whatever it contains.
 *
 * An attribute belongs to its entity and a member sits inside its aggregation,
 * so those overlap by design -- treating them as obstacles would pin a node
 * against its own family before it had moved at all.
 */
export const relatedIds = (
  nodes: PositionedNode[],
  id: string,
): Set<string> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const related = new Set<string>([id]);

  const walkUp = (from: string, onStep: (ancestorId: string) => void) => {
    const seen = new Set<string>([from]);
    let parentId = byId.get(from)?.parentNode;
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId);
      onStep(parentId);
      parentId = byId.get(parentId)?.parentNode;
    }
  };

  walkUp(id, (ancestorId) => related.add(ancestorId));
  for (const node of nodes)
    walkUp(node.id, (ancestorId) => {
      if (ancestorId === id) related.add(node.id);
    });

  return related;
};

/** What a node covers on screen, in absolute coordinates. */
export const visualRects = (nodes: PositionedNode[]): Rect[] => {
  const typeOf = new Map(nodes.map((node) => [node.id, node.type ?? ""]));
  return toAbsoluteRects(nodes, { structuralOnly: false }).map((rect) =>
    visualRectOf(
      rect.id,
      typeOf.get(rect.id) ?? "",
      { x: rect.x, y: rect.y },
      rect.width,
      rect.height,
    ),
  );
};

/** Everything the node with `id` could bump into, as absolute visual rectangles. */
export const obstaclesFor = (nodes: PositionedNode[], id: string): Rect[] => {
  const related = relatedIds(nodes, id);
  return visualRects(nodes).filter((rect) => !related.has(rect.id));
};

/**
 * Pushes the shape back out along one axis, then the other.
 *
 * The first axis is tested at the position the shape came *from* on the second,
 * which is what separates "I ran into this side of it" from "I slid past it".
 */
const resolveInOrder = (
  dragged: Rect,
  from: Vec,
  obstacles: Rect[],
  xFirst: boolean,
): Vec => {
  let { x, y } = dragged;

  const pushX = (alongY: number) => {
    for (const obstacle of obstacles) {
      if (!rectsOverlap(at(dragged, { x, y: alongY }), obstacle)) continue;
      x = x > from.x ? obstacle.x - dragged.width : obstacle.x + obstacle.width;
    }
  };

  const pushY = (alongX: number) => {
    for (const obstacle of obstacles) {
      if (!rectsOverlap(at(dragged, { x: alongX, y }), obstacle)) continue;
      y =
        y > from.y ? obstacle.y - dragged.height : obstacle.y + obstacle.height;
    }
  };

  if (xFirst) {
    pushX(from.y);
    pushY(x);
  } else {
    pushY(from.x);
    pushX(y);
  }

  return { x, y };
};

/**
 * Where a shape dragged from `from` to `dragged` ends up once it is kept out of
 * `obstacles`.
 *
 * Anything the shape was already inside is ignored: a diagram can be laid out
 * with shapes overlapping, and a node that started on top of another would
 * otherwise be unable to move at all. Wedged into a corner where neither order
 * of axes finds a free spot, the shape stays where it was rather than being
 * squeezed out somewhere unexpected.
 */
export const slideOutOfCollisions = (
  dragged: Rect,
  from: Vec,
  obstacles: Rect[],
): Vec => {
  const blocking = obstacles.filter(
    (obstacle) => !rectsOverlap(at(dragged, from), obstacle),
  );
  if (blocking.length === 0) return { x: dragged.x, y: dragged.y };

  for (const xFirst of [true, false]) {
    const candidate = resolveInOrder(dragged, from, blocking, xFirst);
    const free = blocking.every(
      (obstacle) => !rectsOverlap(at(dragged, candidate), obstacle),
    );
    if (free) return candidate;
  }

  return { ...from };
};
