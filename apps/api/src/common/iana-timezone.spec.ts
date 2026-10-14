import { isIanaTimezone } from "./iana-timezone";

describe("isIanaTimezone", () => {
  it("accepts the zones people pick, including the ones ICU lists under an older name", () => {
    // Node's own list has "Asia/Calcutta" and not "Asia/Kolkata", which is why a plain
    // membership test against Intl.supportedValuesOf is not enough.
    for (const zone of [
      "Asia/Kolkata",
      "Asia/Calcutta",
      "Asia/Dubai",
      "Europe/London",
      "Europe/Kyiv",
      "America/New_York",
      "America/Argentina/Buenos_Aires",
      "America/Port-au-Prince",
      "Australia/Sydney",
      "Etc/UTC",
      "UTC",
    ]) {
      expect(isIanaTimezone(zone)).toBe(true);
    }
  });

  it("accepts every zone the runtime lists, so a picker built from that list always saves", () => {
    const refused = Intl.supportedValuesOf("timeZone").filter((zone) => !isIanaTimezone(zone));
    expect(refused).toEqual([]);
  });

  it("refuses invented zones, abbreviations, offsets and other casings", () => {
    for (const value of [
      "Mars/Base",
      // A real IANA name, but a fixed offset with the sign inverted (it is UTC-5). The
      // runtime does not list it, so no picker offers it.
      "Etc/GMT+5",
      "Asia/Atlantis",
      "IST",
      "EST",
      "GMT",
      "+05:30",
      "UTC+5:30",
      "US/Eastern",
      "asia/kolkata",
      "Asia/Kolkata ",
      "",
    ]) {
      expect(isIanaTimezone(value)).toBe(false);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 330, {}, ["Asia/Kolkata"]]) {
      expect(isIanaTimezone(value)).toBe(false);
    }
  });
});
