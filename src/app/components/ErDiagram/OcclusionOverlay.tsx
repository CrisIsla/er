import { EdgeLabelRenderer, useStore } from "reactflow";
import { EXPORT_EXCLUDED_CLASS } from "../../util/common";
import { polygonBounds } from "../../util/nodeOutline";
import { Occlusion } from "../../util/occlusion";

/**
 * Draws where the diagram hides itself.
 *
 * The marks go on the *overlap*, never on the shapes: colour here already means
 * what kind of element something is -- blue entity, orange relationship, yellow
 * attribute -- and border style already means weak or key, so recolouring a
 * shape would read as a claim about the model rather than about the drawing.
 * Marking the contested region says which pixels are lost, which is the thing a
 * reader cannot work out for themselves when three shapes are piled up.
 *
 * Rendered through EdgeLabelRenderer, as AlignmentGuides is: the portal lands
 * inside `.react-flow__viewport`, so its contents inherit the pan and zoom and
 * can be positioned in flow coordinates. That div sets no z-index and so opens
 * no stacking context, which is what lets a child at 1001 paint over the nodes
 * -- and it has to, since React Flow draws every edge in a layer beneath them.
 */

/** Same as the alignment guides use, and for the same reason. */
const OVERLAY_Z_INDEX = 1001;

/**
 * Red, for a problem -- but the guides are already rose and violet, so the two
 * are told apart by form as much as by hue: a guide is a hairline, a mark is a
 * filled region or a dashed run of line.
 */
export const MARK_COLOR = "#dc2626";

const HATCH_ID = "er-occlusion-hatch";

/** Stroke weight and breathing room, in screen pixels at any zoom. */
const STROKE = 1.5;
const PADDING = 4;

const pointsOf = (polygon: { x: number; y: number }[]) =>
  polygon.map((point) => `${point.x},${point.y}`).join(" ");

export type OverlayFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** stroke width in flow units, so it lands at a constant weight on screen */
  stroke: number;
};

/**
 * Where the overlay sits, and how heavy it has to draw.
 *
 * Two things this has to get right, and both of them fail quietly.
 *
 * The box is taken from the marks themselves, not from the nodes' boxes: an ISA
 * triangle reaches below the box that measures it, so a mark under its apex
 * would be clipped away. And it can start anywhere, including well to the left
 * of the flow origin once anything has been dragged there -- so the svg is
 * placed at that corner rather than at 0,0, which is why the caller pairs this
 * with a viewBox starting at the same point.
 *
 * `vector-effect="non-scaling-stroke"` is no help with the weight: the scale
 * comes from a CSS transform on an ancestor, which it does not compensate for.
 * Dividing by the zoom does, and it matters most at the far end -- zoomed out
 * hunting for problems is exactly when a mark must not thin to nothing.
 */
export const frameOf = (
  occlusions: Occlusion[],
  zoom: number,
): OverlayFrame | null => {
  if (zoom <= 0) return null;

  const corners = occlusions.flatMap((occlusion) =>
    occlusion.kind === "shape"
      ? occlusion.polygon
      : occlusion.spans.flatMap((span) => span),
  );
  if (corners.length === 0) return null;

  const stroke = STROKE / zoom;
  // a stroke straddles the line it follows, so the box has to hold its outer
  // rail as well as the geometry
  const padding = PADDING / zoom + stroke;
  const bounds = polygonBounds(corners);

  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    stroke,
  };
};

const OcclusionOverlay = ({ occlusions }: { occlusions: Occlusion[] }) => {
  const zoom = useStore((state) => state.transform[2]);

  const box = frameOf(occlusions, zoom);
  if (box === null) return null;

  return (
    <EdgeLabelRenderer>
      <svg
        className={`nodrag nopan ${EXPORT_EXCLUDED_CLASS}`}
        width={box.width}
        height={box.height}
        // the viewBox maps flow coordinates onto the element, the transform puts
        // the element where those coordinates start. Anchoring at 0,0 instead
        // would break as soon as anything is dragged left of the flow origin
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${box.x}px, ${box.y}px)`,
          pointerEvents: "none",
          zIndex: OVERLAY_Z_INDEX,
          overflow: "visible",
        }}
      >
        <defs>
          <pattern
            id={HATCH_ID}
            width={8}
            height={8}
            patternUnits="userSpaceOnUse"
            // the whole overlay is scaled by the viewport, so the hatch is
            // scaled back to keep the same weight on screen at any zoom
            patternTransform={`scale(${1 / zoom})`}
          >
            <path
              d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4"
              stroke={MARK_COLOR}
              strokeWidth={1.25}
              strokeOpacity={0.85}
            />
          </pattern>
        </defs>

        {occlusions.map((occlusion) =>
          occlusion.kind === "shape" ? (
            <polygon
              key={occlusion.id}
              points={pointsOf(occlusion.polygon)}
              fill={`url(#${HATCH_ID})`}
              stroke={MARK_COLOR}
              strokeWidth={box.stroke}
              strokeLinejoin="round"
            />
          ) : (
            // the run of line the shape swallowed, drawn back over the top of
            // it -- the hidden-line convention from a technical drawing, so it
            // shows where the line goes rather than only that it is gone
            <g key={occlusion.id}>
              {occlusion.spans.map(([from, to], index) => (
                <line
                  key={index}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={MARK_COLOR}
                  strokeWidth={box.stroke * 1.5}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                  strokeLinecap="round"
                />
              ))}
            </g>
          ),
        )}
      </svg>
    </EdgeLabelRenderer>
  );
};

export default OcclusionOverlay;
