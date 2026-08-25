import { BaseEdge, EdgeLabelRenderer, EdgeProps } from "reactflow";
import { useEdgePath } from "../useEdgePath";
import { getHandlePrefix } from "../../../../util/common";

const ONE_TO_ONE_SHORTEN_PATH_BY = 7.5;
const ZERO_TO_ONE_SHORTEN_PATH_BY = 3.035;

// total participation is drawn as a wide black stroke with a thinner one in the
// background colour laid over it, so the two rails left showing are the edges of
// the wide one
const DOUBLE_LINE_WIDTH = 5;
const DOUBLE_LINE_GAP = 3;

function ArrowNotationEdge({
  id,
  source,
  target,
  markerStart,
  data,
  markerEnd,
  label,
}: EdgeProps<{
  isOrthogonal: boolean;
  cardinality: string;
  isTotalParticipation: boolean;
}>) {
  const [edgePath, _labelX, _labelY, roleLabelX, roleLabelY, strokePath] =
    useEdgePath(
      source,
      target,
      data?.isOrthogonal!,
      data?.isTotalParticipation && data.cardinality === "1"
        ? ONE_TO_ONE_SHORTEN_PATH_BY
        : data?.cardinality === "1"
        ? ZERO_TO_ONE_SHORTEN_PATH_BY
        : 0,
      getHandlePrefix(id),
    );

  if (edgePath === null) return null;

  return (
    <>
      {data?.isTotalParticipation ? (
        <>
          {/* double line */}
          <path
            id={id}
            key={1}
            className="react-flow__edge-path"
            d={strokePath(DOUBLE_LINE_WIDTH)}
            // markerStart={markerStart}
            style={{
              fill: "none",
              stroke: "black",
              strokeWidth: DOUBLE_LINE_WIDTH,
            }}
          />

          <path
            id={id}
            key={2}
            className="react-flow__edge-path"
            markerStart={
              data.cardinality === "1" ? "url(#1to1-arrow)" : undefined
            }
            d={strokePath(DOUBLE_LINE_GAP)}
            style={{
              fill: "none",
              stroke: "#F8FAFC",
              strokeWidth: DOUBLE_LINE_GAP,
            }}
          />
        </>
      ) : (
        <BaseEdge
          path={edgePath}
          id={id}
          markerEnd={markerEnd}
          markerStart={markerStart}
          style={{
            strokeWidth: 1,
            stroke: "black",
          }}
        />
      )}
      {label !== undefined && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${roleLabelX}px,${roleLabelY}px)`,
              background: "#F8FAFC",
              padding: 1,
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 500,
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default ArrowNotationEdge;
