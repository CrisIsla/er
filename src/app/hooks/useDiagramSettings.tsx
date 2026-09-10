"use client";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Which algorithm arranges the diagram. "discrete-search" is the placement by
 * discrete search, which treats alignment as a hard constraint; "multi-layout"
 * is the original force-directed pipeline, kept so the two can be compared.
 */
export type LayoutAlgorithm = "discrete-search" | "multi-layout";

/**
 * Where an edge stops at an entity, relationship or ISA shape. "side" uses the
 * handle on whichever side faces the other end; "centre" runs the line to the
 * shape's centre and lets the shape's own fill clip it, so it meets the outline
 * at the angle it travels. Attributes are always drawn to their centre.
 */
export type EdgeAnchor = "side" | "centre";

export type DiagramSettings = {
  /**
   * Whether attribute nodes are drawn on the canvas.
   *
   * Off, they are not drawn at all and hovering an element lists what it owns in
   * a box beside it (AttributeTooltip.tsx). This used to be two settings -- a
   * checkbox and an always/on-hover pair -- which between them could express a
   * state the panel could not reach, and whose on-hover mode revealed the drawn
   * ellipses into whatever room happened to be left around their owner.
   */
  showAttributes: boolean;
  // show guides when a third element matches the spacing of two others
  spacingGuidesEnabled: boolean;
  // pull dragged elements onto guide positions
  snapEnabled: boolean;
  // max distance, in px, at which an element snaps
  snapRadius: number;
  // stop a dragged element where it meets another instead of letting them overlap
  collisionEnabled: boolean;
  // which algorithm the auto layout and the layout button run
  layoutAlgorithm: LayoutAlgorithm;
  /**
   * Whether hiding the attributes lets the layout close the gaps left for them.
   *
   * On, a diagram read with the attributes off is as compact as one that never
   * had any. Off, every gap keeps the size the shown view uses, so toggling the
   * attributes reveals and conceals them without anything else moving.
   */
  closeHiddenAttributeGaps: boolean;
  // where edges stop at entities, relationships and ISA triangles
  edgeAnchor: EdgeAnchor;
};

export const DEFAULT_DIAGRAM_SETTINGS: DiagramSettings = {
  showAttributes: true,
  spacingGuidesEnabled: true,
  snapEnabled: false,
  snapRadius: 12,
  collisionEnabled: false,
  layoutAlgorithm: "discrete-search",
  closeHiddenAttributeGaps: true,
  edgeAnchor: "side",
};

export const SNAP_RADIUS_MIN = 2;
export const SNAP_RADIUS_MAX = 40;

const LOCAL_STORAGE_KEY = "er-diagram-settings";

type DiagramSettingsContextProps = {
  settings: DiagramSettings;
  setSetting: <K extends keyof DiagramSettings>(
    key: K,
    value: DiagramSettings[K],
  ) => void;
};

const DiagramSettingsContext = createContext<DiagramSettingsContextProps>({
  settings: DEFAULT_DIAGRAM_SETTINGS,
  setSetting: () => {},
});

/**
 * Reads stored settings, falling back to the defaults for anything missing or
 * malformed so an old or partial blob can't break the panel.
 *
 * `attributeMode` is the one field that needs translating rather than ignoring.
 * It used to hold `"hover"` for "draw them only around whatever the pointer is
 * over", and the nearest thing to that now is not drawing them at all -- so
 * somebody who was reading their diagram that way lands on the hover box instead
 * of suddenly having every attribute drawn.
 */
export const readStoredSettings = (stored: string | null): DiagramSettings => {
  if (stored === null) return DEFAULT_DIAGRAM_SETTINGS;
  try {
    const { attributeMode, ...rest } = JSON.parse(stored) as Partial<
      DiagramSettings & { attributeMode?: string }
    >;
    return {
      ...DEFAULT_DIAGRAM_SETTINGS,
      ...rest,
      ...(attributeMode === "hover" ? { showAttributes: false } : {}),
    };
  } catch {
    return DEFAULT_DIAGRAM_SETTINGS;
  }
};

const loadFromLocalStorage = (): DiagramSettings =>
  typeof window === "undefined"
    ? DEFAULT_DIAGRAM_SETTINGS
    : readStoredSettings(localStorage.getItem(LOCAL_STORAGE_KEY));

export const DiagramSettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [settings, setSettings] = useState<DiagramSettings>(
    DEFAULT_DIAGRAM_SETTINGS,
  );
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // localStorage isn't available while rendering on the server, so we start
  // from the defaults and load once on the client
  useEffect(() => {
    setSettings(loadFromLocalStorage());
    setIsLoaded(true);
  }, []);

  // guarded on isLoaded so the first render doesn't write the defaults
  // over whatever was stored
  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  }, [settings, isLoaded]);

  const setSetting = useCallback(
    <K extends keyof DiagramSettings>(key: K, value: DiagramSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // memoized: this is read from the drag handlers, so a new object
  // every render would rerender every consumer mid-drag
  const value = useMemo(
    () => ({ settings, setSetting }),
    [settings, setSetting],
  );

  return (
    <DiagramSettingsContext.Provider value={value}>
      {children}
    </DiagramSettingsContext.Provider>
  );
};

export const useDiagramSettings = () => useContext(DiagramSettingsContext);
