/**
 * The Find Leads (AI) route, rendered to markup with its feature switch off and on. The
 * switch is read when config/features.ts loads — at build time in the app — so each case
 * sets it and loads a fresh copy of the page.
 */

// The coming-soon page offers Add Lead, whose dialog asks for the app router. Rendered
// outside Next there is no router mounted, and nothing here navigates.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/find-leads",
}));

const KEY = "NEXT_PUBLIC_FEATURE_FIND_LEADS";
const saved = process.env[KEY];

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

function renderFindLeads(flag: string | undefined): string {
  if (flag === undefined) delete process.env[KEY];
  else process.env[KEY] = flag;
  let html = "";
  // React and the renderer are loaded inside the same isolated registry as the page, so
  // the hooks in the page and the renderer share one copy of React.
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { createElement } = require("react") as typeof import("react");
    const { renderToStaticMarkup } =
      require("react-dom/server") as typeof import("react-dom/server");
    const page = require("@/app/find-leads/page") as typeof import("@/app/find-leads/page");
    /* eslint-enable @typescript-eslint/no-require-imports */
    html = renderToStaticMarkup(createElement(page.default));
  });
  return html;
}

describe("Find Leads (AI) page", () => {
  it("is a coming-soon page with no figures and no sample rows by default", () => {
    const html = renderFindLeads(undefined);
    expect(html).toContain("Coming soon");
    expect(html).toContain("AI lead discovery is coming soon");
    expect(html).toContain('href="/leads"');
    expect(html).not.toMatch(/Clinics Found|Verified Leads|Contact Numbers|Lead Sources/);
    expect(html).not.toContain("Sample ");
    expect(html).not.toContain("<table");
  });

  it("with the switch on, previews sample rows that cannot be added or searched", () => {
    const html = renderFindLeads("true");
    expect(html).toContain("sample data");
    expect(html).toContain("<table");
    // No stat strip and no source totals over the samples.
    expect(html).not.toMatch(/Clinics Found|Verified Leads|Contact Numbers|Lead Sources/);
    // Every Add, and Search, is a disabled button.
    const adds = html.match(/<button[^>]*>(?:(?!<\/button>).)*Add<\/button>/g) ?? [];
    expect(adds.length).toBeGreaterThan(0);
    for (const button of adds) expect(button).toMatch(/\sdisabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Search<\/button>/);
    expect(html).not.toContain("Added");
    // Masked numbers only, and no named third-party sources.
    expect(html).not.toMatch(/\+91 \d{5} \d{5}/);
    expect(html).not.toMatch(/Google Maps|Justdial|Practo/);
  });
});

// A module, so the names above are not shared with the other spec files that typecheck
// alongside this one.
export {};
