import {
  LayoutHistory,
  LayoutNode,
  diffLayouts,
  layoutKey,
  snapshotLayout,
  withLayouts,
} from "../../../src/app/util/layoutHistory";

type Extra = Partial<LayoutNode>;

const node = (
  id: string,
  erId: string,
  x: number,
  y: number,
  extra: Extra = {},
): LayoutNode => ({
  id,
  type: "entity",
  position: { x, y },
  data: { erId },
  ...extra,
});

/** An aggregation, the one kind of node whose size is authored. */
const box = (id: string, erId: string, width: number, height: number) =>
  node(id, erId, 0, 0, {
    type: "aggregation",
    width,
    height,
    style: { width, height },
  });

const moved = (nodes: LayoutNode[], id: string, x: number, y: number) =>
  nodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n));

const snap = snapshotLayout;
const key = (erId: string, type = "entity") => `${type}|${erId}`;

/** Runs one gesture from `before` to `after` through a history. */
const record = (
  history: LayoutHistory,
  before: LayoutNode[],
  after: LayoutNode[],
  scope: Set<string> | "all" = "all",
) => {
  history.begin("pointer", scope, snap(before));
  return history.commit(snap(after));
};

describe("layoutKey", () => {
  it("is the type and the element the node draws, not its index id", () => {
    expect(layoutKey(node("3", "entity: A", 0, 0))).toBe("entity|entity: A");
  });

  it("tells an aggregation from an entity of the same name", () => {
    expect(layoutKey(box("9", "entity: A", 10, 10))).not.toBe(
      layoutKey(node("0", "entity: A", 0, 0)),
    );
  });

  it("falls back to the id for a node without an erId", () => {
    expect(layoutKey({ id: "7", position: { x: 0, y: 0 } })).toBe("|7");
  });
});

describe("snapshotLayout", () => {
  it("records the parent by what it is, not by its id", () => {
    const nodes = [
      node("0", "entity: A", 0, 0),
      node("1", "entity-attr: A|a", 5, 6, {
        type: "entity-attribute",
        parentNode: "0",
      }),
    ];
    expect(
      snap(nodes).get(key("entity-attr: A|a", "entity-attribute")),
    ).toEqual({
      position: { x: 5, y: 6 },
      size: null,
      parent: key("entity: A"),
    });
  });

  it("keeps an authored size and ignores a measured one", () => {
    const measured = node("0", "entity: A", 0, 0, { width: 90, height: 40 });
    expect(snap([measured]).get(key("entity: A"))!.size).toBeNull();
    expect(
      snap([box("1", "entity: G", 300, 200)]).get(
        key("entity: G", "aggregation"),
      )!.size,
    ).toEqual({
      width: 300,
      height: 200,
    });
  });
});

describe("diffLayouts", () => {
  const before = [
    node("0", "entity: A", 0, 0),
    node("1", "entity: B", 100, 0),
    box("2", "entity: G", 300, 200),
  ];

  it("lists the nodes in scope that moved or changed size", () => {
    const after = moved(before, "0", 10, 10).map((n) =>
      n.id === "2" ? { ...n, style: { width: 400, height: 200 } } : n,
    );
    const changes = diffLayouts(snap(before), snap(after), "all");
    expect(changes.map((c) => c.key)).toEqual([
      key("entity: A"),
      key("entity: G", "aggregation"),
    ]);
  });

  it("ignores nodes outside the scope", () => {
    const after = moved(moved(before, "0", 10, 10), "1", 1, 1);
    const changes = diffLayouts(
      snap(before),
      snap(after),
      new Set([key("entity: A")]),
    );
    expect(changes.map((c) => c.key)).toEqual([key("entity: A")]);
  });

  it("has nothing to say about added, removed or re-parented nodes", () => {
    const after = [
      node("0", "entity: A", 50, 50, { parentNode: "2" }), // moved into G
      box("2", "entity: G", 300, 200),
      node("3", "entity: C", 7, 7), // added; B removed
    ];
    expect(diffLayouts(snap(before), snap(after), "all")).toEqual([]);
  });
});

describe("withLayouts", () => {
  it("puts the position back, and an authored size in both channels", () => {
    const nodes = [
      node("0", "entity: A", 10, 10),
      box("1", "entity: G", 400, 200),
    ];
    const layouts = new Map([
      [
        key("entity: A"),
        { position: { x: 0, y: 0 }, size: null, parent: null },
      ],
      [
        key("entity: G", "aggregation"),
        {
          position: { x: 5, y: 5 },
          size: { width: 300, height: 200 },
          parent: null,
        },
      ],
    ]);
    const [a, g] = withLayouts(nodes, layouts);
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(g).toMatchObject({
      position: { x: 5, y: 5 },
      width: 300,
      height: 200,
      style: { width: 300, height: 200 },
    });
  });

  it("finds a node by what it is even after its id changed", () => {
    const shifted = [node("4", "entity: A", 10, 10)];
    const [a] = withLayouts(
      shifted,
      new Map([
        [
          key("entity: A"),
          { position: { x: 0, y: 0 }, size: null, parent: null },
        ],
      ]),
    );
    expect(a).toMatchObject({ id: "4", position: { x: 0, y: 0 } });
  });

  it("leaves every other node as it was", () => {
    const nodes = [node("0", "entity: A", 10, 10)];
    expect(withLayouts(nodes, new Map())[0]).toBe(nodes[0]);
  });
});

describe("LayoutHistory", () => {
  const start = [node("0", "entity: A", 0, 0), node("1", "entity: B", 100, 0)];

  it("undoes and redoes a gesture", () => {
    const history = new LayoutHistory();
    const after = moved(start, "0", 10, 20);
    record(history, start, after);

    expect(history.undo(snap(after))).toEqual(
      new Map([
        [
          key("entity: A"),
          { position: { x: 0, y: 0 }, size: null, parent: null },
        ],
      ]),
    );
    expect(history.redo(snap(start))!.get(key("entity: A"))!.position).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("records nothing for a gesture that changed nothing, like a click", () => {
    const history = new LayoutHistory();
    expect(record(history, start, start)).toBeNull();
    expect(history.undo(snap(start))).toBeNull();
  });

  it("undoes the newest step first", () => {
    const history = new LayoutHistory();
    const first = moved(start, "0", 10, 0);
    const second = moved(first, "1", 200, 0);
    record(history, start, first);
    record(history, first, second);

    const undone = history.undo(snap(second))!;
    expect([...undone.keys()]).toEqual([key("entity: B")]);
  });

  it("leaves a node that something else moved since, and undoes the rest", () => {
    const history = new LayoutHistory();
    const after = moved(moved(start, "0", 10, 0), "1", 110, 0);
    record(history, start, after);
    const peerMovedB = moved(after, "1", 500, 500);

    const undone = history.undo(snap(peerMovedB))!;
    expect([...undone.keys()]).toEqual([key("entity: A")]);
    // redo brings back only what undo actually did -- B too would qualify
    // now that it is back where the step started
    const peerPutBBack = moved(withLayouts(peerMovedB, undone), "1", 100, 0);
    const redone = history.redo(snap(peerPutBBack))!;
    expect([...redone.keys()]).toEqual([key("entity: A")]);
  });

  it("skips a step with nothing left to undo and undoes the one before", () => {
    const history = new LayoutHistory();
    const first = moved(start, "1", 100, 50);
    const second = moved(first, "0", 10, 0);
    record(history, start, first);
    record(history, first, second);
    const elsewhere = moved(second, "0", 999, 999);

    const undone = history.undo(snap(elsewhere))!;
    expect([...undone.keys()]).toEqual([key("entity: B")]);
    expect(history.undo(snap(withLayouts(elsewhere, undone)))).toBeNull();
  });

  it("does not put back a node that was moved into another frame", () => {
    const history = new LayoutHistory();
    const after = moved(start, "0", 10, 0);
    record(history, start, after);
    const reparented = after.map((n) =>
      n.id === "0" ? { ...n, parentNode: "1" } : n,
    );
    expect(history.undo(snap(reparented))).toBeNull();
  });

  it("follows a node across a code edit that shifted the ids", () => {
    const history = new LayoutHistory();
    const after = moved(start, "0", 10, 0);
    record(history, start, after);
    // an entity inserted at the top: A is now id 1, B id 2
    const shifted = [
      node("0", "entity: Z", 0, 0),
      { ...after[0], id: "1" },
      { ...after[1], id: "2" },
    ];
    const restored = withLayouts(shifted, history.undo(snap(shifted))!);
    expect(restored.map((n) => [n.id, n.position.x])).toEqual([
      ["0", 0],
      ["1", 0],
      ["2", 100],
    ]);
  });

  it("refuses while a gesture is under way", () => {
    const history = new LayoutHistory();
    const after = moved(start, "0", 10, 0);
    record(history, start, after);
    // undoable from here, but a drag has begun
    history.begin("pointer", "all", snap(after));
    expect(history.undo(snap(after))).toBeNull();

    history.commit(snap(after));
    const undone = withLayouts(after, history.undo(snap(after))!);
    // redoable from here, but a drag has begun
    history.begin("pointer", "all", snap(undone));
    expect(history.redo(snap(undone))).toBeNull();
  });

  it("commits a pending gesture when the next one begins, and returns it", () => {
    const history = new LayoutHistory();
    history.begin("nudge", new Set([key("entity: A")]), snap(start));
    const nudged = moved(start, "0", 5, 0);
    const { committed } = history.begin("pointer", "all", snap(nudged));
    expect(committed!.map((c) => c.key)).toEqual([key("entity: A")]);
    expect(history.pendingKind).toBe("pointer");
  });

  it("lets a late commit end only the gesture it was for", () => {
    const history = new LayoutHistory();
    const { token: layout } = history.begin("layout", "all", snap(start));
    // a drag begun before the layout's commit arrived ends the layout itself
    const laidOut = moved(start, "0", 50, 0);
    const { token: drag } = history.begin(
      "pointer",
      new Set([key("entity: B")]),
      snap(laidOut),
    );
    const midDrag = moved(laidOut, "1", 150, 0);

    expect(history.commit(snap(midDrag), layout)).toBeNull();
    expect(history.pendingToken).toBe(drag);

    const dropped = moved(laidOut, "1", 200, 0);
    expect(history.commit(snap(dropped), drag)!.map((c) => c.key)).toEqual([
      key("entity: B"),
    ]);
    // newest first: the drag, then the layout
    const undone = history.undo(snap(dropped))!;
    expect([...undone.keys()]).toEqual([key("entity: B")]);
    expect([
      ...history.undo(snap(withLayouts(dropped, undone)))!.keys(),
    ]).toEqual([key("entity: A")]);
  });

  it("widens a pending gesture to the nodes it reaches later", () => {
    const history = new LayoutHistory();
    history.begin("nudge", new Set([key("entity: A")]), snap(start));
    history.include([key("entity: B")]);
    const step = history.commit(
      snap(moved(moved(start, "0", 5, 0), "1", 105, 0)),
    );
    expect(step!.map((c) => c.key)).toEqual([
      key("entity: A"),
      key("entity: B"),
    ]);
  });

  it("forgets what could be redone once something new is done", () => {
    const history = new LayoutHistory();
    const first = moved(start, "0", 10, 0);
    record(history, start, first);
    const undone = withLayouts(first, history.undo(snap(first))!);
    record(history, undone, moved(undone, "1", 300, 0));
    expect(history.redo(snap(moved(undone, "1", 300, 0)))).toBeNull();
  });

  it("keeps only the newest steps", () => {
    const history = new LayoutHistory(2);
    let nodes = start;
    for (const x of [1, 2, 3]) {
      const next = moved(nodes, "0", x, 0);
      record(history, nodes, next);
      nodes = next;
    }
    nodes = withLayouts(nodes, history.undo(snap(nodes))!);
    nodes = withLayouts(nodes, history.undo(snap(nodes))!);
    expect(nodes[0].position.x).toBe(1);
    expect(history.undo(snap(nodes))).toBeNull();
  });

  it("follows an element the code renamed", () => {
    const history = new LayoutHistory();
    const nodes = [
      node("0", "entity: A", 0, 0),
      node("1", "entity-attr: A|a", 5, 5, {
        type: "entity-attribute",
        parentNode: "0",
      }),
    ];
    const after = moved(moved(nodes, "0", 40, 0), "1", 9, 9);
    record(history, nodes, after);
    history.rekey(
      new Map([
        [key("entity: A"), key("entity: Z")],
        [
          key("entity-attr: A|a", "entity-attribute"),
          key("entity-attr: Z|a", "entity-attribute"),
        ],
      ]),
    );
    const renamed = [
      { ...after[0], data: { erId: "entity: Z" } },
      { ...after[1], data: { erId: "entity-attr: Z|a" } },
    ];

    const restored = withLayouts(renamed, history.undo(snap(renamed))!);
    expect(restored.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it("follows a rename into a gesture under way", () => {
    const history = new LayoutHistory();
    history.begin("nudge", new Set([key("entity: A")]), snap(start));
    history.rekey(new Map([[key("entity: A"), key("entity: Z")]]));
    const renamed = moved(start, "0", 5, 0).map((n) =>
      n.id === "0" ? { ...n, data: { erId: "entity: Z" } } : n,
    );
    expect(history.commit(snap(renamed))!.map((c) => c.key)).toEqual([
      key("entity: Z"),
    ]);
  });

  describe("a box and the nodes in it", () => {
    const inBox = [
      box("0", "entity: G", 300, 200),
      node("1", "entity: M", 10, 10, { parentNode: "0" }),
      node("2", "entity: N", 50, 50, { parentNode: "0" }),
      node("3", "entity: Out", 900, 0),
    ];
    // a resize: the box grows, its members spread out, and a node outside is
    // moved in the same step (a layout does this)
    const resized = inBox.map((n) =>
      n.id === "0"
        ? { ...n, width: 600, height: 400, style: { width: 600, height: 400 } }
        : n.id === "1"
        ? { ...n, position: { x: 20, y: 20 } }
        : n.id === "2"
        ? { ...n, position: { x: 100, y: 100 } }
        : { ...n, position: { x: 950, y: 0 } },
    );

    it("go back together", () => {
      const history = new LayoutHistory();
      record(history, inBox, resized);
      const undone = history.undo(snap(resized))!;
      expect([...undone.keys()].sort()).toEqual(
        [
          key("entity: G", "aggregation"),
          key("entity: M"),
          key("entity: N"),
          key("entity: Out"),
        ].sort(),
      );
    });

    it("stay as they are if somebody moved a member since", () => {
      const history = new LayoutHistory();
      record(history, inBox, resized);
      // into the room the resize made: putting the box back would leave it out
      const peerMovedN = moved(resized, "2", 500, 300);
      const undone = history.undo(snap(peerMovedN))!;
      expect([...undone.keys()]).toEqual([key("entity: Out")]);
    });
  });

  it("forgets everything on clear, a pending gesture included", () => {
    const history = new LayoutHistory();
    const after = moved(start, "0", 10, 0);
    record(history, start, after);
    history.begin("pointer", "all", snap(after));
    history.clear();
    expect(history.pendingKind).toBeNull();
    expect(history.undo(snap(after))).toBeNull();
  });
});
