import { useTranslations } from "next-intl";
import { MdCleaningServices } from "react-icons/md";
import { ControlButton, Controls } from "reactflow";
import { colors } from "../../util/colors";
import { useApplyLayout } from "../../hooks/useLayoutedElements";

type ControlPanelProps = {
  onLayoutClick: () => void;
};

export const ControlPanel = ({ onLayoutClick }: ControlPanelProps) => {
  const t = useTranslations("home.erDiagram");
  const { applyLayout } = useApplyLayout({ onApplied: onLayoutClick });

  const handleLayoutClick = () => void applyLayout();

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
    </Controls>
  );
};
