import { memo } from "react";
import { ATTRIBUTE_SHAPE_CLASS } from "../../../util/attributeShape";
import NodeHandles from "./NodeHandles";

/**
 * An attribute. The layout measures this shape off-screen to know how big an
 * attribute is drawn, hidden or not (util/attributeShape.ts), so a change to
 * what sits inside the box -- anything that can change its size -- belongs in
 * the probe there as well.
 */
const DefaultAttribute = ({
  data,
}: {
  data: { label: string; isKey: boolean; entityIsWeak: boolean };
}) => (
  <>
    <div className={ATTRIBUTE_SHAPE_CLASS}>
      <p
        className={`${data.isKey && "underline underline-offset-4"} ${
          data.entityIsWeak && "decoration-dashed"
        }`}
      >
        {data.label}
      </p>
      <p className={data.isKey ? "underline underline-offset-auto" : ""}></p>
    </div>
    <NodeHandles
      TopHandleStyle={[{ top: "1%" }]}
      BottomHandleStyle={[{ bottom: "1%" }]}
      RightHandleStyle={[{ right: "1%" }]}
      LeftHandleStyle={[{ left: "1%" }]}
    />
  </>
);

export default memo(DefaultAttribute);
