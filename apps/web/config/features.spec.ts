import { isFlagOn } from "./features";

describe("isFlagOn", () => {
  it("turns on for the usual spellings of yes", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "On"]) {
      expect(isFlagOn(value)).toBe(true);
    }
  });

  it("stays off when unset, empty or anything else", () => {
    for (const value of [undefined, null, "", "0", "false", "off", "no", "enabled"]) {
      expect(isFlagOn(value)).toBe(false);
    }
  });
});

describe("Find Leads (AI) navigation", () => {
  const original = process.env.NEXT_PUBLIC_FEATURE_FIND_LEADS;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_FEATURE_FIND_LEADS;
    else process.env.NEXT_PUBLIC_FEATURE_FIND_LEADS = original;
  });

  // The flag is read when the module loads, as Next.js reads it at build time, so each
  // case loads a fresh copy of the navigation.
  function navHrefs(): string[] {
    let hrefs: string[] = [];
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { navItems } = require("./navigation") as typeof import("./navigation");
      hrefs = navItems.map((item) => item.href);
    });
    return hrefs;
  }

  it("is left out of the sidebar by default", () => {
    delete process.env.NEXT_PUBLIC_FEATURE_FIND_LEADS;
    const hrefs = navHrefs();
    expect(hrefs).not.toContain("/find-leads");
    expect(hrefs.slice(0, 3)).toEqual(["/", "/leads", "/campaigns"]);
  });

  it("sits under Leads when the switch is on", () => {
    process.env.NEXT_PUBLIC_FEATURE_FIND_LEADS = "true";
    expect(navHrefs().slice(0, 3)).toEqual(["/", "/leads", "/find-leads"]);
  });
});
