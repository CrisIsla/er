/**
 * Types for the discrete-search layout.
 *
 * Deliberately free of React Flow (and React) types, like alignmentCandidates.ts:
 * the algorithm reasons about ids, sizes and centres, so every phase can be unit
 * tested without a DOM. `buildLayoutGraph` is the only module that knows what a
 * React Flow node looks like.
 *
 * Two conventions hold throughout:
 *  - positions are absolute **centres**, not React Flow's top-left corners;
 *  - `visualWidth`/`visualHeight` are what the element covers on screen, which
 *    is not always what React Flow measured (see geometry.ts `visualSize`).
 */

export type Vec = { x: number; y: number };

export type Box = { x: number; y: number; width: number; height: number };

export type ElementRole = "skeleton" | "connector" | "satellite" | "frozen";

type ElementBase = {
  id: string;
  /** React Flow node type: entity, relationship, isA, ... */
  type: string;
  /**
   * Stable identity for tie-breaking. React Flow ids are array indices that
   * shift whenever the ERdoc is edited (erToReactflowElements.ts:453), so
   * ordering by them would reshuffle the diagram on every keystroke.
   */
  key: string;
  /** size as measured by React Flow (offsetWidth/offsetHeight) */
  width: number;
  height: number;
  /** size actually covered on screen */
  visualWidth: number;
  visualHeight: number;
  /** how far the attributes fanned around this element reach past its edge */
  haloRadius: number;
  /** currently not drawn, so it takes up no room on screen */
  hidden: boolean;
};

/** An entity or an aggregation box: what the discrete search actually places. */
export type SkeletonElement = ElementBase & {
  role: "skeleton";
  /** incident connectors + owned attributes; drives seeding and ordering */
  weight: number;
};

/**
 * A relationship diamond or an ISA triangle. Not placed by the search: it lands
 * at the centroid of the skeleton elements it joins.
 */
export type ConnectorElement = ElementBase & {
  role: "connector";
  /** distinct skeleton ids this connector joins */
  participants: string[];
  /** same key = joins the same elements, so the two must be offset apart */
  groupKey: string;
  /** a recursive relationship: every role points back at one entity */
  isSelfLoop: boolean;
  /** set for ISA triangles, so a subclass can be nudged below its superclass */
  hierarchy: { parentId: string; childId: string } | null;
};

/** An attribute ellipse, fanned out around its owner. */
export type SatelliteElement = ElementBase & {
  role: "satellite";
  /** the skeleton or connector element this attribute belongs to */
  ownerId: string;
  /** set when this is a composite child hanging off another attribute */
  parentAttributeId: string | null;
};

/**
 * Anything inside an aggregation. The aggregation is laid out as one opaque box,
 * so its contents keep the positions they already have.
 */
export type FrozenElement = ElementBase & {
  role: "frozen";
};

export type LayoutElement =
  | SkeletonElement
  | ConnectorElement
  | SatelliteElement
  | FrozenElement;

export type LayoutGraph = {
  elements: Map<string, LayoutElement>;
  skeleton: SkeletonElement[];
  connectors: ConnectorElement[];
  satellites: SatelliteElement[];
  frozen: FrozenElement[];
  /** skeleton adjacency induced by the connectors */
  neighbours: Map<string, string[]>;
};

/** Absolute centres, keyed by element id. */
export type Placement = Map<string, Vec>;
