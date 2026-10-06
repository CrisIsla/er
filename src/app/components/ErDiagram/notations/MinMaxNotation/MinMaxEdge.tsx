import { BaseEdge, EdgeProps } from "reactflow";
import { RoleLabel } from "../RoleLabel";
import { useEdgePath } from "../useEdgePath";
import { getHandlePrefix } from "../../../../util/common";

function MinMaxEdge({
  id,
  label,
  source,
  target,
  data,
}: EdgeProps<{
  isOrthogonal: boolean;
  cardinality: string;
  isTotalParticipation: boolean;
  isInAggregation: boolean;
}>) {
  const [edgePath, labelX, labelY, roleLabelX, roleLabelY] = useEdgePath(
    source,
    target,
    data?.isOrthogonal!,
    0,
    getHandlePrefix(id),
  );
  if (edgePath === null) return null;

  return (
    <>
      <BaseEdge
        path={edgePath}
        id={id}
        label={
          data?.cardinality === undefined
            ? undefined
            : `(${
                data?.isTotalParticipation ? "1" : "0"
              }, ${data?.cardinality})`
        }
        labelX={labelX}
        labelY={labelY}
        labelBgStyle={{
          fill: data?.isInAggregation === true ? "#F8F5FC" : "#F8FAFC",
        }}
        labelStyle={{
          fontSize: "0.675rem",
        }}
        style={{
          strokeWidth: 1,
          stroke: "black",
        }}
      />
      <RoleLabel edgeId={id} label={label} x={roleLabelX} y={roleLabelY} />
    </>
  );
}

export default MinMaxEdge;
