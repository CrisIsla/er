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
   * Weak preference for drawing a subclass below its superclass. This is a cost
   * term, not a hierarchy phase -- set it to 0 for placement that treats ISA
   * triangles as completely ordinary connectors.
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
    compactness: 0.05,
    aspect: 25,
    unaligned: 20,
    isaDown: 15,
  },
  relax: {
    maxStepsCeiling: 16,
    minSeparationFloor: 10,
  },
  refine: {
    enabled: true,
    iterations: 600,
    timeBudgetMs: 250,
    seed: 1,
  },
};
