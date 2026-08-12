import { CSSProperties } from "react";
import { EdgeLabelRenderer } from "reactflow";
import { GuideLine } from "../../hooks/useAlignmentGuide";

const ALIGN_COLOR = "#e11d48";
const SPACING_COLOR = "#7c3aed";
const TICK = 5;

/**
 * Draws the drag-time guides.
 *
 * Rendered through EdgeLabelRenderer: that portal lands inside
 * `.react-flow__viewport`, so its contents inherit the pan/zoom transform and
 * we can position in flow coordinates. (This version of React Flow has no
 * ViewportPortal; the edge-label portal is the supported equivalent, and the
 * notation edges already use it for their cardinality labels.)
 *
 * Guides are plain absolutely-positioned divs rather than an SVG overlay.
 * Every guide is axis-aligned, so a 1px border does the job -- and a zero-sized
 * root <svg> refuses to paint outside its viewport even with
 * `overflow: visible`, which silently loses the lines.
 */
const AlignmentGuides = ({ guides }: { guides: GuideLine[] }) => {
  if (guides.length === 0) return null;

  const base: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    pointerEvents: "none",
    zIndex: 1001,
  };

  const at = (x: number, y: number) => `translate(${x}px, ${y}px)`;

  return (
    <EdgeLabelRenderer>
      {guides.map((guide) => {
        const color = guide.kind === "align" ? ALIGN_COLOR : SPACING_COLOR;
        const dashed = guide.kind === "align";
        const isVertical = guide.x1 === guide.x2;

        const line: CSSProperties = isVertical
          ? {
              ...base,
              transform: at(guide.x1, Math.min(guide.y1, guide.y2)),
              height: Math.abs(guide.y2 - guide.y1),
              borderLeft: `1px ${dashed ? "dashed" : "solid"} ${color}`,
            }
          : {
              ...base,
              transform: at(Math.min(guide.x1, guide.x2), guide.y1),
              width: Math.abs(guide.x2 - guide.x1),
              borderTop: `1px ${dashed ? "dashed" : "solid"} ${color}`,
            };

        // end caps turn a spacing run into something that reads as a measurement
        const tick = (x: number, y: number): CSSProperties =>
          isVertical
            ? {
                ...base,
                transform: at(x - TICK, y),
                width: TICK * 2,
                borderTop: `1px solid ${color}`,
              }
            : {
                ...base,
                transform: at(x, y - TICK),
                height: TICK * 2,
                borderLeft: `1px solid ${color}`,
              };

        return (
          <div key={guide.id}>
            <div style={line} className="nodrag nopan" />
            {guide.kind === "spacing" && (
              <>
                <div
                  style={tick(guide.x1, guide.y1)}
                  className="nodrag nopan"
                />
                <div
                  style={tick(guide.x2, guide.y2)}
                  className="nodrag nopan"
                />
              </>
            )}
            {guide.label !== undefined && (
              <div
                className="nodrag nopan"
                style={{
                  ...base,
                  transform: `translate(-50%, -50%) ${at(
                    guide.labelX ?? 0,
                    guide.labelY ?? 0,
                  )}`,
                  background: "#F8FAFC",
                  color,
                  padding: "0 3px",
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 600,
                  lineHeight: "14px",
                  userSelect: "none",
                }}
              >
                {guide.label}
              </div>
            )}
          </div>
        );
      })}
    </EdgeLabelRenderer>
  );
};

export default AlignmentGuides;
