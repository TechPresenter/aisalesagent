/**
 * The plans page's contact actions, rendered to markup. The support contact is read from
 * NEXT_PUBLIC_ variables when config/app-brand.ts loads — at build time in the app — so
 * each case sets them and loads a fresh copy of the page.
 */

const KEYS = [
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_SUPPORT_PHONE",
  "NEXT_PUBLIC_PRICE_TAX_NOTE",
] as const;

const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function renderPlans(env: Partial<Record<(typeof KEYS)[number], string>>): string {
  for (const key of KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  let html = "";
  // React and the renderer are loaded inside the same isolated registry as the page, so
  // the hooks in the page and the renderer share one copy of React.
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { createElement } = require("react") as typeof import("react");
    const { renderToStaticMarkup } =
      require("react-dom/server") as typeof import("react-dom/server");
    const { PlansView } = require("./plans-view") as typeof import("./plans-view");
    /* eslint-enable @typescript-eslint/no-require-imports */
    html = renderToStaticMarkup(createElement(PlansView));
  });
  return html;
}

describe("PlansView", () => {
  it("makes no refund promise and names no demo workspace", () => {
    const html = renderPlans({});
    expect(html).not.toMatch(/money back|refund|risk-free/i);
    expect(html).not.toMatch(/Northwind|clinic/i);
  });

  it("leaves the contact cards out until a support contact is configured", () => {
    const html = renderPlans({});
    expect(html).not.toContain("Need Help Choosing?");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("tel:");
    // Enterprise's Talk to Sales stays visible, disabled, rather than linking nowhere.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Talk to Sales<\/button>/);
  });

  it("links Talk to Sales and Contact Us to the configured email and phone", () => {
    const html = renderPlans({
      NEXT_PUBLIC_SUPPORT_EMAIL: "sales@example.com",
      NEXT_PUBLIC_SUPPORT_PHONE: "+91 98765 43210",
    });
    expect(html).toContain("Need Help Choosing?");
    expect(html).toContain("Custom Requirements?");
    expect(html).toMatch(
      /<a[^>]*href="mailto:sales@example\.com\?subject=[^"]+"[^>]*>Talk to Sales<\/a>/,
    );
    expect(html).toMatch(
      /<a[^>]*href="mailto:sales@example\.com\?subject=[^"]+"[^>]*>Contact Us<\/a>/,
    );
    expect(html).toContain('href="tel:+919876543210"');
    expect(html).not.toMatch(/<button[^>]*>Talk to Sales<\/button>/);
  });

  it("dials the phone when it is the only contact", () => {
    const html = renderPlans({ NEXT_PUBLIC_SUPPORT_PHONE: "+91 98765 43210" });
    expect(html).toMatch(/<a[^>]*href="tel:\+919876543210"[^>]*>Talk to Sales<\/a>/);
    expect(html).not.toContain("mailto:");
  });

  it("shows the configured tax note under the prices, or a neutral default", () => {
    expect(renderPlans({})).toContain("All prices are in Indian rupees (₹). Taxes as applicable.");
    expect(renderPlans({ NEXT_PUBLIC_PRICE_TAX_NOTE: "Prices exclude 18% GST." })).toContain(
      "Prices exclude 18% GST.",
    );
  });
});

// A module, so the names above are not shared with the other spec files that typecheck
// alongside this one.
export {};
