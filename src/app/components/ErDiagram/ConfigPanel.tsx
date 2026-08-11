import {
  Box,
  Checkbox,
  Heading,
  IconButton,
  Popover,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Radio,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stack,
  StackDivider,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AiFillSetting } from "react-icons/ai";
import {
  SNAP_RADIUS_MAX,
  SNAP_RADIUS_MIN,
  useDiagramSettings,
} from "../../hooks/useDiagramSettings";
import { NotationTypes } from "../../util/common";
import { NotationPicker } from "./NotationPicker";

type ConfigPanelProps = {
  notationType: NotationTypes;
  setEdgesOrthogonal: (isOrthogonal: boolean) => void;
  onNotationChange: (newNotationType: NotationTypes) => void;
};

export const ConfigPanel = ({
  notationType,
  setEdgesOrthogonal,
  onNotationChange,
}: ConfigPanelProps) => {
  const t = useTranslations("home.erDiagram.configPanel");
  const [isOrthogonal, setIsOrthogonal] = useState<boolean>(false);
  const { settings, setSetting } = useDiagramSettings();

  useEffect(() => {
    setEdgesOrthogonal(isOrthogonal);
  }, [isOrthogonal, setEdgesOrthogonal]);

  return (
    <>
      <Popover>
        <PopoverTrigger>
          <IconButton
            className="bg-[#fff]"
            aria-label="erConfig"
            size={"sm"}
            icon={<AiFillSetting size={23} />}
            title={t("title")}
          />
        </PopoverTrigger>
        <PopoverContent maxW={"max-content"}>
          <PopoverCloseButton />
          <PopoverBody>
            <Stack divider={<StackDivider />} spacing="4">
              <Box>
                <NotationPicker
                  initialNotation={notationType}
                  onNotationChange={(newNotation) => {
                    onNotationChange(newNotation);
                    if (newNotation !== "arrow") {
                      setEdgesOrthogonal(false);
                      setIsOrthogonal(false);
                    }
                  }}
                />
              </Box>

              <Box>
                <Heading size="xs" pb={2}>
                  {t("edgeRouting")}
                </Heading>

                <Stack direction="column">
                  <Radio
                    colorScheme="gray"
                    isChecked={!isOrthogonal}
                    onChange={() => setIsOrthogonal(false)}
                  >
                    {t("straight")}
                  </Radio>

                  <Radio
                    colorScheme="gray"
                    isChecked={isOrthogonal}
                    onChange={() => setIsOrthogonal(true)}
                    isDisabled={notationType !== "arrow"}
                  >
                    <Tooltip
                      label={
                        notationType !== "arrow"
                          ? t("orthogonalDisabled")
                          : undefined
                      }
                    >
                      {t("orthogonal")}
                    </Tooltip>
                  </Radio>
                </Stack>
              </Box>

              <Box>
                <Heading size="xs" pb={2}>
                  {t("attributes")}
                </Heading>

                <Stack direction="column">
                  <Checkbox
                    colorScheme="gray"
                    isChecked={settings.showAttributes}
                    onChange={(e) =>
                      setSetting("showAttributes", e.target.checked)
                    }
                  >
                    {t("showAttributes")}
                  </Checkbox>

                  <Radio
                    colorScheme="gray"
                    isChecked={settings.attributeMode === "always"}
                    isDisabled={!settings.showAttributes}
                    onChange={() => setSetting("attributeMode", "always")}
                  >
                    <Tooltip
                      label={
                        !settings.showAttributes
                          ? t("attributesModeDisabled")
                          : undefined
                      }
                    >
                      {t("attributesAlways")}
                    </Tooltip>
                  </Radio>

                  <Radio
                    colorScheme="gray"
                    isChecked={settings.attributeMode === "hover"}
                    isDisabled={!settings.showAttributes}
                    onChange={() => setSetting("attributeMode", "hover")}
                  >
                    <Tooltip
                      label={
                        !settings.showAttributes
                          ? t("attributesModeDisabled")
                          : undefined
                      }
                    >
                      {t("attributesHover")}
                    </Tooltip>
                  </Radio>
                </Stack>
              </Box>

              <Box>
                <Heading size="xs" pb={2}>
                  {t("alignment")}
                </Heading>

                <Stack direction="column">
                  <Checkbox
                    colorScheme="gray"
                    isChecked={settings.spacingGuidesEnabled}
                    onChange={(e) =>
                      setSetting("spacingGuidesEnabled", e.target.checked)
                    }
                  >
                    {t("spacingGuides")}
                  </Checkbox>

                  <Checkbox
                    colorScheme="gray"
                    isChecked={settings.snapEnabled}
                    onChange={(e) =>
                      setSetting("snapEnabled", e.target.checked)
                    }
                  >
                    {t("magneticSnap")}
                  </Checkbox>

                  <Box w="200px" pt={1}>
                    <Tooltip
                      label={
                        !settings.snapEnabled
                          ? t("snapRadiusDisabled")
                          : undefined
                      }
                    >
                      <Text
                        fontSize="sm"
                        pb={1}
                        color={settings.snapEnabled ? undefined : "gray.400"}
                      >
                        {t("snapRadius")}: {settings.snapRadius} px
                      </Text>
                    </Tooltip>

                    <Slider
                      colorScheme="gray"
                      min={SNAP_RADIUS_MIN}
                      max={SNAP_RADIUS_MAX}
                      value={settings.snapRadius}
                      isDisabled={!settings.snapEnabled}
                      onChange={(value) => setSetting("snapRadius", value)}
                      aria-label={t("snapRadius")}
                    >
                      <SliderTrack>
                        <SliderFilledTrack />
                      </SliderTrack>
                      <SliderThumb />
                    </Slider>
                  </Box>
                </Stack>
              </Box>
            </Stack>
          </PopoverBody>
        </PopoverContent>
      </Popover>
    </>
  );
};
