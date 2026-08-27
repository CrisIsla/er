import { NodeChange } from "reactflow";
import { collectFinishedResizes } from "../../../src/app/hooks/useResizeCommit";
import { NodeSize } from "../../../src/app/util/nodeSize";

/** A drag tick, as NodeResizer emits one. */
const tick = (id: string, width: number, height: number): NodeChange => ({
  id,
  type: "dimensions",
  updateStyle: true,
  resizing: true,
  dimensions: { width, height },
});

/** The single change NodeResizer emits when the pointer is released. */
const release = (id: string): NodeChange => ({
  id,
  type: "dimensions",
  resizing: false,
});

/** What React Flow's ResizeObserver emits after measuring the DOM. */
const measured = (id: string, width: number, height: number): NodeChange => ({
  id,
  type: "dimensions",
  dimensions: { width, height },
});

const run = (batches: NodeChange[][]) => {
  const buffer = new Map<string, NodeSize>();
  const finished = batches.flatMap((changes) =>
    collectFinishedResizes(changes, buffer),
  );
  return { finished, buffer };
};

describe("collectFinishedResizes", () => {
  it("reports the size a gesture ended at", () => {
    const { finished } = run([
      [tick("0", 600, 400)],
      [tick("0", 620, 410)],
      [release("0")],
    ]);
    expect(finished).toEqual([{ id: "0", size: { width: 620, height: 410 } }]);
  });

  it("reports nothing while the drag is still going", () => {
    const { finished } = run([[tick("0", 600, 400)], [tick("0", 620, 410)]]);
    expect(finished).toEqual([]);
  });

  // otherwise every measurement pass would look like a resize, and save
  it("ignores a plain measurement", () => {
    const { finished } = run([[measured("0", 500, 500)]]);
    expect(finished).toEqual([]);
  });

  it("ignores a release with no drag behind it", () => {
    const { finished } = run([[release("0")]]);
    expect(finished).toEqual([]);
  });

  it("forgets the gesture once it has reported it", () => {
    const { buffer } = run([[tick("0", 600, 400)], [release("0")]]);
    expect(buffer.size).toBe(0);
  });

  it("does not confuse two containers", () => {
    const { finished } = run([
      [tick("0", 600, 400), tick("1", 300, 300)],
      [release("1")],
      [release("0")],
    ]);
    expect(finished).toEqual([
      { id: "1", size: { width: 300, height: 300 } },
      { id: "0", size: { width: 600, height: 400 } },
    ]);
  });

  it("handles a whole gesture arriving in one batch", () => {
    const { finished } = run([[tick("0", 600, 400), release("0")]]);
    expect(finished).toEqual([{ id: "0", size: { width: 600, height: 400 } }]);
  });
});
