import { ChevronDownIcon } from "@chakra-ui/icons";
import {
  Menu,
  MenuButton,
  MenuItemOption,
  MenuList,
  MenuOptionGroup,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { MdCleaningServices } from "react-icons/md";
import { useSaveFlow } from "../../hooks/useDiagramToLocalStorage";
import {
  LayoutAlgorithm,
  useDiagramSettings,
} from "../../hooks/useDiagramSettings";
import { useApplyLayout } from "../../hooks/useLayoutedElements";

/**
 * Arranges the diagram once, on click, and lets the user pick which algorithm
 * does it.
 *
 * This used to be a switch that turned on a mode re-running the layout after
 * every edit. Laying out on demand means an arrangement the user has adjusted by
 * hand is never thrown away by the next keystroke.
 */
const AutoLayoutButton = ({ title }: { title: string }) => {
  const t = useTranslations("home.header");
  const { settings, setSetting } = useDiagramSettings();
  const saveFlow = useSaveFlow();
  const { applyLayout } = useApplyLayout({ onApplied: saveFlow });

  return (
    <div className="flex items-center">
      <button
        type="button"
        className="flex cursor-pointer items-center hover:text-white"
        onClick={() => void applyLayout()}
        title={t("autoLayoutHint")}
      >
        <MdCleaningServices size={20} />
        <span className="pl-2">{title}</span>
      </button>

      <Menu placement="bottom-end">
        <MenuButton
          type="button"
          className="ml-1 cursor-pointer rounded px-1 hover:text-white"
          aria-label={t("layoutAlgorithm")}
          title={t("layoutAlgorithm")}
        >
          <ChevronDownIcon boxSize={5} />
        </MenuButton>

        <MenuList color="gray.800" minW="0" zIndex={20}>
          <MenuOptionGroup
            title={t("layoutAlgorithm")}
            type="radio"
            value={settings.layoutAlgorithm}
            onChange={(value) =>
              setSetting("layoutAlgorithm", value as LayoutAlgorithm)
            }
          >
            <MenuItemOption value="discrete-search">
              {t("layoutDiscrete")}
            </MenuItemOption>
            <MenuItemOption value="multi-layout">
              {t("layoutForce")}
            </MenuItemOption>
          </MenuOptionGroup>
        </MenuList>
      </Menu>
    </div>
  );
};

export default AutoLayoutButton;
