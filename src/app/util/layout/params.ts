/**
 * Tunable parameters for the discrete-search layout.
 *
 * These are deliberately gathered in one object rather than scattered as
 * constants: calibrating them against the example diagrams is an explicit part
 * of the work, and every phase takes the whole object so a variant can be tried
 * by passing a different one.
 */

export type CostWeights = {
  /** a skeleton edge crossing another one */
  crossings: number;
  /** per pixel of edge length added */
  length: number;
  /** per pixel the diagram's bounding box grows */
  compactness: number;
  /**
   * Per unit of bounding-box aspect ratio (long side over short side).
   *
   * Without this the layout degenerates into a single column: entities are wider
   * than they are tall, so growing the box downwards is always the cheaper of
   * the two, and each element stacks under the last one. Alignment and crossings
   * both look perfect in that layout -- it is only unusable.
   */
  aspect: number;
  /** an incident edge that ends up neither horizontal nor vertical */
  unaligned: number;
  /**
   * An edge that disappears into an element it does not join.
   *
   * Priced above `unaligned` and below `crossings`: a slanted edge is merely
   * untidy, and a crossing is at least legible, but an edge that vanishes inside
   * a box reads as joining whatever that box joins.
   */
  throughNode: number;
  /**
   * Drawing a subclass below its superclass. A cost term, not a hierarchy phase
   * -- set it to 0 for placement that treats ISA triangles as completely
   * ordinary connectors.
   *
   * Priced above `throughNode`, because an upside-down subclass is a semantic
   * error in an ER diagram while an edge through a box is an untidy one. Only
   * hierarchies too small for the tree pass are steered by it, so it can be firm
   * without the column collapse a high value used to cause.
   */
  isaDown: number;
};

export type LayoutParams = {
  /** S: candidate positions sit at whole multiples of this from an anchor */
  gridStep: number;
  /** Kmax: how many grid steps out from an anchor candidates are generated */
  maxSteps: number;
  /** D_min: smallest empty gap allowed between two elements */
  minSeparation: number;
  /** gap between an element's edge and the attributes fanned around it */
  attributeGap: number;
  /**
   * Space kept between an aggregation container's edge and the contents
   * arranged inside it -- and, therefore, the floor a manual resize is held to.
   * One value for both, so a layout run leaves the box at exactly its own
   * minimum and the two writers of a container's size cannot disagree.
   *
   * Sized to clear the label row the container draws inside itself
   * (DefaultAggregation.tsx: `p-2` plus one line of text).
   */
  aggregationPadding: number;
  /**
   * How much of an element's attribute halo is reserved as hard clearance while
   * placing the skeleton. Attributes are steered into the sectors their owner's
   * edges leave free, so reserving the full ring in every direction would spread
   * the diagram out far more than it needs.
   */
  haloFactor: number;
  /** perpendicular offset between connectors joining the same elements */
  parallelGap: number;
  /** empty space kept around the diagram once it is moved to the positive quadrant */
  margin: number;
  weights: CostWeights;
  /**
   * Applied in order when no candidate survives the filters: first look further
   * out, then allow elements closer together, then (in placement.ts) give up on
   * the alignment constraint itself.
   */
  relax: {
    maxStepsCeiling: number;
    minSeparationFloor: number;
  };
  /**
   * Whether the search places relationship diamonds itself.
   *
   * A diamond is a node of the drawn graph, not decoration on an edge. Dropped
   * at a centroid after every entity is fixed it can only take the room that was
   * left over, however many things it joins -- and the search, which contracts
   * each relationship into a clique over its participants, is meanwhile
   * optimising a graph nobody draws: three entities joined pairwise by three
   * diamonds appear to it as a triangle, which draws perfectly as three
   * collinear points and leaves the three diamonds with one space between them.
   *
   * `asSkeleton: false` restores exactly that.
   */
  relationships: {
    asSkeleton: boolean;
  };
  /**
   * Drawing ISA hierarchies as trees rather than leaving them to the search.
   *
   * The discrete search cannot reach a fan: candidates sit on eight rays from an
   * anchor, and a subclass beside its siblings needs a different offset on each
   * axis, which a diagonal ray -- moving both by the same k*S -- cannot express.
   * So each hierarchy is arranged on its own and handed to the search as one
   * rigid shape carried by its root.
   *
   * `enabled: false` restores exactly the behaviour of the search alone.
   */
  hierarchy: {
    enabled: boolean;
    /** a hierarchy smaller than this is left to the search as ordinary elements */
    minMembers: number;
  };
  /**
   * Opening the gaps between the rows and columns once the arrangement is
   * settled, so that *where* a thing goes and *how far away* it goes stop being
   * one decision (spacing.ts).
   *
   * `enabled: false` leaves the search's own distances exactly as they are.
   */
  spacing: {
    enabled: boolean;
  };
  /**
   * The alignment-preserving refinement pass. `seed` is what keeps the result
   * reproducible: the same diagram must lay out the same way every time, because
   * the layout re-runs on every edit that changes the node or edge count.
   */
  refine: {
    enabled: boolean;
    iterations: number;
    /** wall-clock ceiling, so a big diagram cannot freeze the browser */
    timeBudgetMs: number;
    seed: number;
  };
};

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  gridStep: 60,
  maxSteps: 8,
  minSeparation: 45,
  attributeGap: 30,
  aggregationPadding: 40,
  haloFactor: 0.55,
  parallelGap: 70,
  margin: 50,
  weights: {
    crossings: 100,
    length: 0.02,
    compactness: 0.3,
    aspect: 25,
    unaligned: 20,
    throughNode: 150,
    isaDown: 80,
  },
  relax: {
    maxStepsCeiling: 16,
    minSeparationFloor: 10,
  },
  relationships: {
    asSkeleton: true,
  },
  hierarchy: {
    // two, now that the diamonds are placed. It was three: arranging a lone
    // subclass as a tree used to cost the search the freedom to interleave, and
    // on `company` took crossings from 0 to 6. With relationships in the
    // skeleton that freedom is spent on the diamonds instead, and holding the
    // pair rigid is what keeps `company`'s subclass below its superclass --
    // measured, at three it inverts and no weight recovers it.
    enabled: true,
    minMembers: 2,
  },
  spacing: {
    enabled: true,
  },
  refine: {
    enabled: true,
    iterations: 600,
    timeBudgetMs: 250,
    seed: 1,
  },
};
