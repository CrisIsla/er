import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MdCleaningServices, MdVisibilityOff } from "react-icons/md";
import { ControlButton, Controls, useReactFlow } from "reactflow";
import { useApplyLayout } from "../../hooks/useLayoutedElements";
import { nodesOfOcclusion } from "../../hooks/useOcclusions";
import { colors } from "../../util/colors";
import { Occlusion } from "../../util/occlusion";
import { MARK_COLOR } from "./OcclusionOverlay";

type ControlPanelProps = {
  onLayoutClick: () => void;
  occlusions?: Occlusion[];
};

export const ControlPanel = ({
  onLayoutClick,
  occlusions = [],
}: ControlPanelProps) => {
  const t = useTranslations("home.erDiagram");
  const { applyLayout } = useApplyLayout({ onApplied: onLayoutClick });
  const { fitView } = useReactFlow();

  const handleLayoutClick = () => void applyLayout();

  // Which one the next click flies to. Keyed on the marks themselves rather
  // than on how many there are, so moving a shape out of one overlap and into
  // another starts the walk again instead of resuming it somewhere arbitrary.
  const marks = occlusions.map((occlusion) => occlusion.id).join("|");
  const [next, setNext] = useState(0);
  useEffect(() => setNext(0), [marks]);

  const showOcclusion = () => {
    const at = next % occlusions.length;
    fitView({
      nodes: nodesOfOcclusion(occlusions[at]),
      duration: 400,
      maxZoom: 1.2,
      padding: 0.4,
    });
    setNext(at + 1);
  };

  return (
    <Controls showInteractive={false}>
      <ControlButton
        style={{
          backgroundColor: "#fff",
        }}
        title={t("layoutButton")}
        onClick={handleLayoutClick}
      >
        <MdCleaningServices
          style={{
            color: colors.textEditorBackground,
          }}
        />
      </ControlButton>

      {/* nothing to say when nothing is hidden, so the button is not there */}
      {occlusions.length > 0 && (
        <ControlButton
          style={{
            backgroundColor: "#fff",
            // wide enough for the count beside the icon, which the fixed
            // square a control button is by default has no room for
            width: "auto",
            minWidth: 24,
            padding: "4px 5px",
          }}
          title={t("occlusionButton")}
          onClick={showOcclusion}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              color: MARK_COLOR,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            <MdVisibilityOff />
            {occlusions.length}
          </span>
        </ControlButton>
      )}
    </Controls>
  );
};
