import { ReactNode } from "react";
import { EdgeLabelRenderer } from "reactflow";
import {
  ROLE_LABEL_EDGE_ATTRIBUTE,
  roleLabelStyle,
} from "../../../util/roleLabel";

type RoleLabelProps = {
  /** the edge this name belongs to, which is how the layout finds it again */
  edgeId: string;
  label: ReactNode;
  x: number;
  y: number;
  padding?: number;
};

/**
 * The name of one role of a relationship, drawn on its own line.
 *
 * One component for all three notations, because the layout measures these to
 * decide how far a recursive relationship's diamond sits from its entity (see
 * util/roleLabel.ts) -- so what they are marked with, and how they truncate,
 * has to be the same wherever they are drawn.
 */
export const RoleLabel = ({
  edgeId,
  label,
  x,
  y,
  padding = 3,
}: RoleLabelProps) => {
  if (label === undefined || label === null || label === "") return null;

  return (
    <EdgeLabelRenderer>
      <div
        {...{ [ROLE_LABEL_EDGE_ATTRIBUTE]: edgeId }}
        // the whole name, for the ones drawn too long to show
        title={typeof label === "string" ? label : undefined}
        style={roleLabelStyle(x, y, padding)}
        className="nodrag nopan"
      >
        {label}
      </div>
    </EdgeLabelRenderer>
  );
};

export default RoleLabel;
