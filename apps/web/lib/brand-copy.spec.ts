import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * A guard on the screens every workspace sees, read as source. They used to greet each
 * customer as the demo company ("Northwind Solutions … every clinic."), and the dashboard
 * tagline pulled a font and a script from two third-party CDNs. These checks keep both
 * from coming back. Sample data the dashboard shows when the API is unreachable is
 * outside this list: that fallback has its own fix.
 */

const WEB_ROOT = join(__dirname, "..");

function sources(...paths: string[]): { path: string; text: string }[] {
  return paths.flatMap((path) => {
    const full = join(WEB_ROOT, path);
    if (path.endsWith("/")) {
      return readdirSync(full)
        .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".spec.ts"))
        .map((name) => ({ path: path + name, text: readFileSync(join(full, name), "utf8") }));
    }
    return [{ path, text: readFileSync(full, "utf8") }];
  });
}

const CUSTOMER_FACING = sources(
  "components/layout/",
  "components/dashboard/",
  "components/plans/",
  "components/discovery/",
  "components/ui/handwriting-text.tsx",
  "components/auth/onboarding-business-form.tsx",
  "app/page.tsx",
  "app/plans/page.tsx",
  "app/find-leads/page.tsx",
  "app/onboarding/business/page.tsx",
  "lib/mock-plans.ts",
  "lib/mock-discovery.ts",
);

describe("customer-facing brand and copy", () => {
  it.each(CUSTOMER_FACING.map((file) => [file.path, file.text]))(
    "%s names no demo tenant and no single vertical",
    (_path, text) => {
      expect(text).not.toMatch(/Northwind|Apex Dental|every clinic/i);
      // The workspace's name comes from the session. The sample branding object is the
      // style guide's alone.
      expect(text).not.toMatch(/tenantBranding|@\/config\/branding/);
    },
  );

  it.each(CUSTOMER_FACING.map((file) => [file.path, file.text]))(
    "%s loads nothing from a third-party CDN",
    (_path, text) => {
      expect(text).not.toMatch(/https?:\/\/(cdn\.21st\.dev|cdn\.jsdelivr\.net|unpkg\.com)/i);
      expect(text).not.toMatch(/createElement\(\s*["']script["']\s*\)/);
    },
  );

  it("has no role step in onboarding, and nothing links to one", () => {
    expect(existsSync(join(WEB_ROOT, "app/onboarding/role"))).toBe(false);
    for (const file of sources("app/onboarding/business/page.tsx", "components/auth/")) {
      expect(file.text).not.toContain("/onboarding/role");
    }
  });

  it("offers no Listen Live control until there is audio to listen to", () => {
    const [panel] = sources("components/dashboard/live-call-panel.tsx");
    expect(panel.text).not.toMatch(/>\s*Listen Live\s*</);
  });
});
