import { gapCentre } from "../../../../src/app/util/layout/connectors";

const participant = (x: number, y: number, width = 90, height = 44) => ({
  centre: { x, y },
  width,
  height,
});

const DIAMOND = { width: 134, height: 134 };

/** Edge-to-edge gap between the connector at `v` and a participant. */
const gapTo = (
  v: { x: number; y: number },
  p: ReturnType<typeof participant>,
  connector = DIAMOND,
) =>
  Math.max(
    Math.abs(v.x - p.centre.x) - (connector.width + p.width) / 2,
    Math.abs(v.y - p.centre.y) - (connector.height + p.height) / 2,
  );

describe("gapCentre", () => {
  /**
   * The common case must not move: a binary relationship between two
   * same-sized entities has always sat at their midpoint, and re-laying every
   * existing diagram out differently would be a poor trade for a rule aimed at
   * the ternary case.
   */
  it("is the midpoint for two equal participants", () => {
    expect(
      gapCentre([participant(0, 0), participant(400, 0)], DIAMOND),
    ).toEqual({ x: 200, y: 0 });
  });

  /**
   * The search works hard for axis alignment and the ratchet measures it, so a
   * connector must never lose one to a rounding artefact.
   */
  it("keeps a coordinate every participant shares, exactly", () => {
    const centre = gapCentre(
      [participant(0, 300), participant(240, 300), participant(700, 300)],
      DIAMOND,
    );
    expect(centre.y).toBe(300);
  });

  it("keeps a shared coordinate even when the participants differ in size", () => {
    const centre = gapCentre(
      [participant(0, 120, 90, 44), participant(500, 120, 300, 200)],
      DIAMOND,
    );
    expect(centre.y).toBe(120);
  });

  /**
   * The point of the rule. A centroid balances the distances between centres;
   * with three participants that leaves the connector nearly touching the
   * middle one and a long way from the far one.
   */
  it("beats the centroid at its worst on a ternary", () => {
    const three = [
      participant(138, 0),
      participant(378, 0),
      participant(798, 0),
    ];
    const centroid = {
      x: (138 + 378 + 798) / 3,
      y: 0,
    };
    const balanced = gapCentre(three, DIAMOND);

    const worst = (v: { x: number; y: number }) =>
      Math.max(...three.map((p) => gapTo(v, p)));

    expect(worst(balanced)).toBeLessThan(worst(centroid));
    // and the two extreme participants end up equally far away
    expect(gapTo(balanced, three[0])).toBeCloseTo(gapTo(balanced, three[2]), 6);
  });

  it("balances gaps rather than centre distances when sizes differ", () => {
    const small = participant(0, 0, 90, 44);
    const large = participant(600, 0, 300, 44);
    const balanced = gapCentre([small, large], DIAMOND);

    expect(gapTo(balanced, small)).toBeCloseTo(gapTo(balanced, large), 6);
    // the centroid would sit at 300 and leave the wide one 105px closer
    expect(balanced.x).toBeLessThan(300);
  });

  it("returns the participant's own centre when there is only one", () => {
    expect(gapCentre([participant(70, 30)], DIAMOND)).toEqual({ x: 70, y: 30 });
  });
});
