import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  Node,
  NodeChange,
  NodePositionChange,
  XYPosition,
  useReactFlow,
} from "reactflow";
import * as Y from "yjs";
import { DiagramChange } from "../types/CodeEditor";
import { ErNode } from "../types/ErDiagram";
import { historyShortcut, isMacPlatform } from "../util/historyShortcut";
import {
  GestureKind,
  Layout,
  LayoutHistory,
  LayoutSnapshot,
  LayoutStep,
  layoutKey,
  snapshotLayout,
  withLayouts,
} from "../util/layoutHistory";
import { publishLayout } from "../util/sharedNodes";
import { useSaveFlow } from "./useDiagramToLocalStorage";

/**
 * How long the arrow keys have to rest before a run of nudges becomes one
 * step. React Flow moves the selection on every keydown, auto-repeat
 * included, and has no start or end to bracket them with.
 */
const NUDGE_SETTLE_MS = 500;

/** A shared diagram's nodes, which is where its history writes. */
export type SharedNodes = { ydoc: Y.Doc; yNodesMap: Y.Map<ErNode> };

/** One thing the user is doing, from `begin` to its end. */
export type Gesture = {
  /** Ends it once the store holds where it left the nodes. */
  commit: () => void;
  /** Ends it now, at these nodes -- for a write that knows its own result. */
  commitAt: (nodes: Node[]) => void;
};

type DiagramHistoryContextProps = {
  /**
   * Starts recording what the user is about to do to these nodes -- all of
   * them when none are given. Ending the gesture returned ends that gesture
   * only: one begun since has already ended it.
   */
  begin: (kind: GestureKind, nodes?: { id: string }[]) => Gesture;
  /**
   * Watches the diagram's node changes for arrow-key nudges. `before` is the
   * diagram's own nodes as they were before these changes: React Flow moves
   * its store's node objects in place before it reports a nudge, so the store
   * can no longer say where they were.
   */
  noticeChanges: (changes: NodeChange[], before: Node[]) => void;
  /** Tells the history a code edit rebuilt the nodes, `before` into `after`. */
  noticeRebuild: (before: Node[], after: Node[]) => void;
};

const noop = () => {};
const NO_GESTURE: Gesture = { commit: noop, commitAt: noop };

// what a diagram without a provider gets: nothing is recorded
const DiagramHistoryContext = createContext<DiagramHistoryContextProps>({
  begin: () => NO_GESTURE,
  noticeChanges: noop,
  noticeRebuild: noop,
});

/**
 * The shape of React Flow's arrow-key move (updateNodePositions(nodes, true,
 * false)). A drag's moves say `dragging: true`, its last change has no
 * position, and a resize moving the members carries no `dragging` at all.
 */
export const isNudge = (
  change: NodeChange,
): change is NodePositionChange & { position: XYPosition } =>
  change.type === "position" &&
  change.dragging === false &&
  change.position !== undefined;

/** What the nodes with these ids are (see `layoutKey`). */
const keysOf = (nodes: Node[], ids: { id: string }[]) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const keys = new Set<string>();
  for (const { id } of ids) {
    const node = byId.get(id);
    if (node !== undefined) keys.add(layoutKey(node));
  }
  return keys;
};

/** Waits for React and then React Flow's store to take a change in. */
const afterFlush = (callback: () => void) =>
  setTimeout(() => window.requestAnimationFrame(callback), 0);

/**
 * Undo and redo for what the user does in the diagram (see layoutHistory.ts),
 * on Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z (see historyShortcut.ts).
 *
 * Sits above the header as well as the diagram, because the header's layout
 * button is one of the things it records. Both pages have one: the solo
 * editor, whose diagram lives in React Flow's store and in localStorage, and
 * the shared one (`shared`), whose diagram lives in yjs -- there, undo and redo
 * are published like any other edit, and the observer in ErDiagramColab
 * brings them back into the store.
 */
export const DiagramHistoryProvider = ({
  children,
  lastChange,
  shared = null,
}: {
  children: ReactNode;
  /**
   * A document arriving whole -- an example, a file, a shared diagram's
   * stored copy -- starts a new history.
   */
  lastChange: DiagramChange | null;
  shared?: SharedNodes | null;
}) => {
  const { getNodes, setNodes } = useReactFlow();
  const saveFlow = useSaveFlow();

  const historyRef = useRef<LayoutHistory | null>(null);
  if (historyRef.current === null) historyRef.current = new LayoutHistory();
  const history = historyRef.current;

  // read when a step is kept rather than when the callbacks are made, so a
  // shared diagram that is still connecting does not have to rebuild them
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>();

  /** Saves or publishes what the history moved the nodes to. */
  const write = useCallback(
    (layouts: Map<string, Layout>) => {
      const target = sharedRef.current;
      if (target !== null) {
        publishLayout(target.ydoc, target.yNodesMap, layouts);
        return;
      }
      setNodes((nodes) => withLayouts(nodes, layouts));
      afterFlush(saveFlow);
    },
    [setNodes, saveFlow],
  );

  /**
   * Keeps a step the user just took. It is in the store already, so this only
   * persists it. In a shared diagram a drop, a resize and a nudge have been
   * published as they landed, so this publishes what has not -- a layout --
   * and only where the map still has the node where the step began: anything
   * else there is newer than the step.
   */
  const keep = useCallback(
    (step: LayoutStep | null) => {
      if (step === null) return;
      const target = sharedRef.current;
      if (target === null) {
        afterFlush(saveFlow);
        return;
      }
      publishLayout(
        target.ydoc,
        target.yNodesMap,
        new Map(step.map((change) => [change.key, change.after])),
        new Map(step.map((change) => [change.key, change.before])),
      );
    },
    [saveFlow],
  );

  const commitAt = useCallback(
    (current: LayoutSnapshot, token: number) => {
      if (history.pendingToken === token) clearTimeout(nudgeTimer.current);
      keep(history.commit(current, token));
    },
    [history, keep],
  );

  /**
   * Where each node in a run of nudges was last moved to. The run's step ends
   * there rather than wherever the store has the node once the run settles: by
   * then a peer can have moved it on, and that move is not this editor's.
   */
  const nudgedTo = useRef(new Map<string, XYPosition>());

  /** Ends a run of nudges that is still settling. */
  const settleNudges = useCallback(() => {
    const token = history.pendingToken;
    if (history.pendingKind !== "nudge" || token === null) return;
    const after = snapshotLayout(getNodes());
    for (const [key, position] of nudgedTo.current) {
      const layout = after.get(key);
      if (layout !== undefined) after.set(key, { ...layout, position });
    }
    nudgedTo.current = new Map();
    commitAt(after, token);
  }, [history, getNodes, commitAt]);

  const beginFrom = useCallback(
    (nodes: Node[], kind: GestureKind, touched?: { id: string }[]) => {
      settleNudges();
      clearTimeout(nudgeTimer.current);
      const scope = touched === undefined ? "all" : keysOf(nodes, touched);
      const { token, committed } = history.begin(
        kind,
        scope,
        snapshotLayout(nodes),
      );
      keep(committed);
      return token;
    },
    [history, keep, settleNudges],
  );

  const begin = useCallback(
    (kind: GestureKind, touched?: { id: string }[]): Gesture => {
      const token = beginFrom(getNodes(), kind, touched);
      return {
        commit: () =>
          afterFlush(() => commitAt(snapshotLayout(getNodes()), token)),
        commitAt: (nodes) => commitAt(snapshotLayout(nodes), token),
      };
    },
    [beginFrom, getNodes, commitAt],
  );

  const noticeChanges = useCallback(
    (changes: NodeChange[], before: Node[]) => {
      const nudged = changes.filter(isNudge);
      if (nudged.length === 0) return;
      const pending = history.pendingKind;
      // arrow keys pressed in the middle of a drag are part of the drag
      if (pending === "pointer" || pending === "layout") return;
      if (pending === "nudge") history.include(keysOf(before, nudged));
      else beginFrom(before, "nudge", nudged);
      const byId = new Map(before.map((node) => [node.id, node]));
      for (const change of nudged) {
        const node = byId.get(change.id);
        if (node !== undefined)
          nudgedTo.current.set(layoutKey(node), change.position);
      }
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(settleNudges, NUDGE_SETTLE_MS);
    },
    [history, beginFrom, settleNudges],
  );

  /**
   * Follows elements a code edit renamed, so their steps carry on under the
   * new name. An id is a position in the generated list, so a rename shows as
   * an id whose key changed to one nobody had while its old key is gone --
   * the same pairing the rebuild makes when it keeps a renamed node where it
   * was (mergeRebuiltNodes).
   */
  const noticeRebuild = useCallback(
    (before: Node[], after: Node[]) => {
      if (before.length !== after.length) return;
      const beforeKeys = new Set(before.map(layoutKey));
      const afterKeys = new Set(after.map(layoutKey));
      const afterById = new Map(after.map((node) => [node.id, node]));
      const renames = new Map<string, string>();
      for (const was of before) {
        const now = afterById.get(was.id);
        if (now === undefined || now.type !== was.type) continue;
        const from = layoutKey(was);
        const to = layoutKey(now);
        if (from !== to && !afterKeys.has(from) && !beforeKeys.has(to))
          renames.set(from, to);
      }
      history.rekey(renames);
    },
    [history],
  );

  /**
   * Where the nodes are now, as far as undo is concerned. In a shared diagram
   * that is the map: the store takes a peer's move in a later render, and
   * undoing against the store in between would overwrite the move.
   */
  const current = useCallback(() => {
    const target = sharedRef.current;
    return snapshotLayout(
      target === null ? getNodes() : Array.from(target.yNodesMap.values()),
    );
  }, [getNodes]);

  const travel = useCallback(
    (direction: "undo" | "redo") => {
      // a run of nudges still settling is a step like any other
      settleNudges();
      const layouts =
        direction === "undo"
          ? history.undo(current())
          : history.redo(current());
      if (layouts !== null) write(layouts);
    },
    [history, settleNudges, current, write],
  );

  useEffect(() => {
    const isMac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      const action = historyShortcut(event, isMac);
      if (action === null) return;
      // even with nothing to undo: left alone, the browser runs its own undo on
      // the code editor's hidden textarea and moves the focus into it
      event.preventDefault();
      travel(action);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [travel]);

  // A drag or a resize ends on React Flow's word, which a gesture can lose: a
  // touch drag whose node unmounts mid-gesture never hears its touchend. Left
  // pending, it would block undo for good, so a release ends it regardless --
  // two frames on, after the gesture's own end has had its chance.
  useEffect(() => {
    const onRelease = (event: PointerEvent) => {
      if (!event.isPrimary || history.pendingKind !== "pointer") return;
      const token = history.pendingToken!;
      afterFlush(() =>
        window.requestAnimationFrame(() =>
          commitAt(snapshotLayout(getNodes()), token),
        ),
      );
    };
    window.addEventListener("pointerup", onRelease, true);
    window.addEventListener("pointercancel", onRelease, true);
    return () => {
      window.removeEventListener("pointerup", onRelease, true);
      window.removeEventListener("pointercancel", onRelease, true);
    };
  }, [history, commitAt, getNodes]);

  useEffect(() => {
    if (lastChange?.type !== "json") return;
    clearTimeout(nudgeTimer.current);
    nudgedTo.current = new Map();
    history.clear();
  }, [lastChange, history]);

  useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  const value = useMemo(
    () => ({ begin, noticeChanges, noticeRebuild }),
    [begin, noticeChanges, noticeRebuild],
  );

  return (
    <DiagramHistoryContext.Provider value={value}>
      {children}
    </DiagramHistoryContext.Provider>
  );
};

export const useDiagramHistory = () => useContext(DiagramHistoryContext);
