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

export type AttributeMode = "always" | "hover";

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
  // whether attribute nodes are drawn at all
  showAttributes: boolean;
  // how attributes are revealed when they are shown
  attributeMode: AttributeMode;
  // show guides when a third element matches the spacing of two others
  spacingGuidesEnabled: boolean;
  // pull dragged elements onto guide positions
  snapEnabled: boolean;
  // max distance, in px, at which an element snaps
  snapRadius: number;
  // which algorithm the auto layout and the layout button run
  layoutAlgorithm: LayoutAlgorithm;
  // where edges stop at entities, relationships and ISA triangles
  edgeAnchor: EdgeAnchor;
};

export const DEFAULT_DIAGRAM_SETTINGS: DiagramSettings = {
  showAttributes: true,
  attributeMode: "always",
  spacingGuidesEnabled: true,
  snapEnabled: false,
  snapRadius: 12,
  layoutAlgorithm: "discrete-search",
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

// reads stored settings, falling back to the defaults for anything
// missing or malformed so an old/partial blob can't break the panel
const loadFromLocalStorage = (): DiagramSettings => {
  if (typeof window === "undefined") return DEFAULT_DIAGRAM_SETTINGS;
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored === null) return DEFAULT_DIAGRAM_SETTINGS;
    return { ...DEFAULT_DIAGRAM_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_DIAGRAM_SETTINGS;
  }
};

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
