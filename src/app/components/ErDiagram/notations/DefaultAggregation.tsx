import { memo } from "react";
import { NodeResizer, useNodeId } from "reactflow";
import { useAggregationResize } from "../../../hooks/useAggregationResize";
import NodeHandles from "./NodeHandles";

const DefaultAggregation = ({
  data: { label },
}: {
  data: { label: string };
}) => {
  // The box is sized inline rather than with a Tailwind class because it is a
  // number that changes at runtime -- the layout derives it from the contents
  // and the handles below let the user override it. The outer node element is
  // sized by React Flow from the same value (see util/nodeSize.ts); this is the
  // dashed rectangle drawn inside it.
  const nodeId = useNodeId();
  const {
    width,
    height,
    minWidth,
    minHeight,
    onResizeStart,
    onResize,
    onResizeEnd,
  } = useAggregationResize(nodeId);

  return (
    <div className="relative">
      <NodeResizer
        // derived from the contents, so the box can never be dragged smaller
        // than what it holds
        minWidth={minWidth}
        minHeight={minHeight}
        onResizeStart={onResizeStart}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
        handleStyle={{
          width: "12px",
          height: "12px",
          backgroundColor: "blue",
          borderRadius: "50%",
        }}
      />

      <div
        style={{ width, height }}
        className={`z-10 flex border-2 border-dashed border-sky-700 bg-sky-200/[.26] p-2`}
      >
        <div>{label}</div>
      </div>
      <NodeHandles
        TopHandleStyle={[
          { top: "-1%" },
          { top: "-1%", left: "2%" },
          { top: "-1%", left: "25%" },
          { top: "-1%", left: "75%" },
          { top: "-1%", left: "98%" },
        ]}
        BottomHandleStyle={[
          { bottom: "-1%" },
          { bottom: "-1%", left: "2%" },
          { bottom: "-1%", left: "25%" },
          { bottom: "-1%", left: "75%" },
          { bottom: "-1%", left: "98%" },
        ]}
        LeftHandleStyle={[
          { left: "-1%" },
          { left: "-1%", top: "2%" },
          { left: "-1%", top: "25%" },
          { left: "-1%", top: "75%" },
          { left: "-1%", top: "98%" },
        ]}
        RightHandleStyle={[
          { right: "-1%" },
          { right: "-1%", top: "2%" },
          { right: "-1%", top: "25%" },
          { right: "-1%", top: "75%" },
          { right: "-1%", top: "98%" },
        ]}
        use5PerSide={true}
      />
    </div>
  );
};

export default memo(DefaultAggregation);
