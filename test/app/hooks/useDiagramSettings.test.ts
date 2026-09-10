/**
 * Reading the stored settings, which is the one place an old blob from a
 * previous version of the panel has to be understood rather than ignored.
 */

import {
  DEFAULT_DIAGRAM_SETTINGS,
  readStoredSettings,
} from "../../../src/app/hooks/useDiagramSettings";

describe("readStoredSettings", () => {
  it("falls back to the defaults when nothing is stored", () => {
    expect(readStoredSettings(null)).toEqual(DEFAULT_DIAGRAM_SETTINGS);
  });

  it("falls back to the defaults rather than throwing on a malformed blob", () => {
    expect(readStoredSettings("{not json")).toEqual(DEFAULT_DIAGRAM_SETTINGS);
  });

  it("fills in a setting the stored blob does not mention", () => {
    const settings = readStoredSettings(JSON.stringify({ snapEnabled: true }));
    expect(settings.snapEnabled).toBe(true);
    expect(settings.showAttributes).toBe(
      DEFAULT_DIAGRAM_SETTINGS.showAttributes,
    );
  });

  /**
   * `attributeMode: "hover"` used to mean "draw the attributes, but only around
   * whatever the pointer is over". The nearest thing to that now is not drawing
   * them at all -- so somebody reading their diagram that way lands on the hover
   * box, rather than suddenly having every attribute on the canvas.
   */
  it("turns the old hover mode into attributes off", () => {
    const settings = readStoredSettings(
      JSON.stringify({ showAttributes: true, attributeMode: "hover" }),
    );
    expect(settings.showAttributes).toBe(false);
  });

  it("leaves the old always mode showing them", () => {
    const settings = readStoredSettings(
      JSON.stringify({ showAttributes: true, attributeMode: "always" }),
    );
    expect(settings.showAttributes).toBe(true);
  });

  it("does not carry the retired setting through", () => {
    const settings = readStoredSettings(
      JSON.stringify({ attributeMode: "always" }),
    );
    expect(settings).not.toHaveProperty("attributeMode");
  });
});
