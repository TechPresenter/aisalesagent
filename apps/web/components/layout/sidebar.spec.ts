import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar, WorkspaceRow } from "./sidebar";

/**
 * The sidebar's workspace row, rendered to markup. It used to show the demo workspace's
 * name, tagline, monogram and colour to every customer; it now shows the signed-in
 * workspace's own name, and nothing in its place before the session is read.
 */

// The sidebar reads the current route for its active item. Rendered outside Next there is
// no router mounted.
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

// The product lockup is a pair of PNG imports, which only the Next bundler can load.
jest.mock("@/components/brand/logo", () => ({ Logo: () => null }));

function render(props: { resolved: boolean; tenantName?: string }): string {
  return renderToStaticMarkup(createElement(WorkspaceRow, props));
}

describe("WorkspaceRow", () => {
  it("is a neutral placeholder, naming no one, until the session is read", () => {
    const html = render({ resolved: false });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading workspace");
    expect(html).not.toMatch(/Northwind/i);
    expect(html).not.toContain(">Workspace<");
  });

  it("shows the signed-in workspace's own name and initials on the product green", () => {
    const html = render({ resolved: true, tenantName: "  Acme Traders Pvt Ltd " });
    expect(html).toContain(">Acme Traders Pvt Ltd<");
    expect(html).toContain(">AT<");
    expect(html).toContain("bg-brand-green");
    // No per-tenant colour is painted inline until branding is read from the API.
    expect(html).not.toContain("background-color");
    expect(html).not.toContain("aria-busy");
  });

  it("is left out, not left loading, when the session has no workspace name", () => {
    expect(render({ resolved: true })).toBe("");
    expect(render({ resolved: true, tenantName: "   " })).toBe("");
  });
});

describe("Sidebar", () => {
  it("draws its first frame with the placeholder, not a stand-in workspace", () => {
    // Server markup is the first frame: the session is only read after hydration.
    const html = renderToStaticMarkup(createElement(Sidebar, { open: true }));
    expect(html).toContain("Loading workspace");
    expect(html).not.toMatch(/Northwind|every clinic/i);
    expect(html).toContain('href="/leads"');
    expect(html).toContain('href="/plans"');
  });
});
