/**
 * The list of attributes an element owns, shown beside it while the pointer is
 * over it and the attributes are not drawn on the canvas.
 *
 * Built on React Flow's `NodeToolbar`, which is the one primitive that gets the
 * positioning right: it portals into the renderer and places itself from the
 * node's absolute rectangle times the viewport transform, translating without
 * scaling. So the list reads at the same size whatever the zoom, which nothing
 * rendered inside a node component can do.
 *
 * It is a tooltip and nothing more. `pointer-events: none` means it can never
 * take a click meant for the canvas, block the element behind it, or interrupt a
 * drag -- and it is mounted only while something is hovered, so the usual case
 * costs nothing.
 *
 * The reading of the graph and the drawing of the box are separate below, so the
 * first can be tested without a DOM and the second without a React Flow store.
 */

import { NodeToolbar, Position, useReactFlow } from "reactflow";
import {
  GraphEdge,
  buildAttributeParents,
  buildOwnerMap,
} from "../../util/erGraph";

/** What an attribute node carries that is worth drawing here. */
export type AttributeData = {
  label?: string;
  isKey?: boolean;
  entityIsWeak?: boolean;
};

/** An attribute and, when it is composite, the attributes hanging off it. */
export type ListedAttribute = {
  id: string;
  data: AttributeData;
  children: { id: string; data: AttributeData }[];
};

type LabelledNode = { id: string; type?: string; data?: AttributeData };

/**
 * What one element owns, in the order the ERdoc declares it.
 *
 * Ownership comes from `buildOwnerMap`, the same reading the visibility hook and
 * the layout use: it walks attribute-to-attribute edges, so a composite child
 * belongs to the entity rather than to the attribute above it, and an aggregation
 * re-parenting its contents cannot confuse it. `buildAttributeParents` then puts
 * the two levels back.
 *
 * Order comes from the node list rather than from the owner map, because
 * `erToReactflowElements` emits an element's attributes in declaration order and
 * that is the order they should be read in.
 */
export const attributesOf = (
  nodes: LabelledNode[],
  edges: GraphEdge[],
  ownerId: string,
): ListedAttribute[] => {
  const { owner } = buildOwnerMap(nodes, edges);
  const parentOf = buildAttributeParents(nodes, edges);
  const mine = nodes.filter((node) => owner.get(node.id) === ownerId);

  return mine
    .filter((node) => !parentOf.has(node.id))
    .map((node) => ({
      id: node.id,
      data: node.data ?? {},
      children: mine
        .filter((child) => parentOf.get(child.id) === node.id)
        .map((child) => ({ id: child.id, data: child.data ?? {} })),
    }));
};

/**
 * A key attribute is underlined, and dashed when its entity is weak -- the same
 * rule `DefaultAttribute.tsx` draws on the canvas, so the two readings of one
 * model agree.
 */
const nameClass = ({ isKey, entityIsWeak }: AttributeData) =>
  isKey
    ? `underline underline-offset-4 ${
        entityIsWeak ? "decoration-dashed" : ""
      }`.trim()
    : "";

export const AttributeList = ({
  title,
  attributes,
}: {
  title?: string;
  attributes: ListedAttribute[];
}) => (
  <div className="min-w-[140px] max-w-[280px] rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-md">
    {title !== undefined && (
      <p className="mb-1 border-b border-gray-200 pb-1 font-semibold text-gray-700">
        {title}
      </p>
    )}
    <ul>
      {attributes.map((attribute) => (
        <li key={attribute.id}>
          <span className={nameClass(attribute.data)}>
            {attribute.data.label}
          </span>
          {attribute.children.length > 0 && (
            <ul className="ml-3 border-l border-gray-200 pl-2 text-gray-600">
              {attribute.children.map((child) => (
                <li key={child.id}>{child.data.label}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  </div>
);

export const AttributeTooltip = ({ nodeId }: { nodeId: string }) => {
  const { getNodes, getEdges } = useReactFlow();
  const nodes = getNodes();
  const attributes = attributesOf(nodes, getEdges(), nodeId);

  if (attributes.length === 0) return null;

  return (
    <NodeToolbar
      nodeId={nodeId}
      isVisible
      position={Position.Right}
      align="start"
      offset={12}
      style={{ pointerEvents: "none" }}
    >
      <AttributeList
        title={
          (nodes.find((node) => node.id === nodeId)?.data as AttributeData)
            ?.label
        }
        attributes={attributes}
      />
    </NodeToolbar>
  );
};

export default AttributeTooltip;
