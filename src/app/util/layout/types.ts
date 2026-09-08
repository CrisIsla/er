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
  /**
   * How far the attributes fanned around this element reach past its edge, as
   * far as the *arranging* stage is concerned.
   *
   * Zero when the arrangement is being made attribute-blind, which is the whole
   * point of that setting: what the search decides is then a property of the
   * entities and relationships alone, and the room the ring needs is opened up
   * afterwards by the spacing pass.
   */
  haloRadius: number;
  /**
   * ...and how far it really reaches, whatever the arrangement was told. This is
   * the one the spacing pass measures with, because it is the one that is drawn.
   */
  drawnHalo: number;
  /** currently not drawn, so it takes up no room on screen */
  hidden: boolean;
};

/** An entity or an aggregation box: what the discrete search actually places. */
export type SkeletonElement = ElementBase & {
  role: "skeleton";
  /** incident connectors + owned attributes; drives seeding and ordering */
  weight: number;
  /**
   * The room this element must be given, when that is not its own box.
   *
   * Set on the root of an ISA hierarchy: the tree is arranged before the search
   * runs and travels with its root, so the root has to reserve the whole tree.
   * `dx`/`dy` place the box's centre relative to the element's own, which a
   * plain width and height could not do -- a tidy tree hangs *below* its root,
   * and `rectAt` is symmetric about the centre.
   */
  footprint?: { dx: number; dy: number; width: number; height: number };
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
  /**
   * What is joined to what in the drawn diagram: each connector to each of its
   * participants, and back.
   *
   * `neighbours` is not that. It contracts every connector into a clique over
   * the elements it joins, because that is the graph the search places -- a
   * relationship between two entities makes them adjacent, and the diamond is
   * dropped between them afterwards. So a ternary appears there as a triangle
   * between three entities, which is not a shape anyone draws.
   *
   * Anything reasoning about the lines actually on screen -- where an element's
   * edges leave it, what an attribute must not be fanned across -- wants this
   * one instead.
   */
  wiring: Map<string, string[]>;
};

/** Absolute centres, keyed by element id. */
export type Placement = Map<string, Vec>;
