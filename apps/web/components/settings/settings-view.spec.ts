import type { FunctionComponent, ReactElement } from "react";
import type { TenantSummary } from "@appsgain/shared";
import type { PendingInvitation, SessionUser, WorkspaceMember } from "@/lib/api-client";
import { assignableRoles } from "@/lib/team-invites";

/**
 * Settings → Team and the Danger Zone, rendered to markup.
 *
 * Invite Member used to be a button that could never be pressed, and Delete Account one
 * that did nothing. These pin what replaced them: who is offered an invitation or a role
 * change (the API refuses the rest — invitations.e2e-spec.ts), and that deleting a
 * workspace is an email to support when a support address is configured. The address is
 * read from NEXT_PUBLIC_SUPPORT_EMAIL when config/app-brand.ts loads, so each render loads
 * a fresh copy of the page with the variable set as the case needs.
 */

// The logo imports its PNG artwork, which only Next.js knows how to load. Nothing here
// draws a logo (it is on the change-password dialog's import path), so it is left out.
jest.mock("@/components/brand/logo", () => ({}));

type SettingsModule = typeof import("./settings-view");

const SUPPORT_KEY = "NEXT_PUBLIC_SUPPORT_EMAIL";
const savedSupport = process.env[SUPPORT_KEY];

afterEach(() => {
  if (savedSupport === undefined) delete process.env[SUPPORT_KEY];
  else process.env[SUPPORT_KEY] = savedSupport;
});

function render(
  build: (module: SettingsModule) => ReactElement,
  supportEmail?: string,
): string {
  if (supportEmail === undefined) delete process.env[SUPPORT_KEY];
  else process.env[SUPPORT_KEY] = supportEmail;
  let html = "";
  // React and the renderer are loaded inside the same isolated registry as the page, so
  // the hooks in the page and the renderer share one copy of React.
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { renderToStaticMarkup } =
      require("react-dom/server") as typeof import("react-dom/server");
    const settings = require("./settings-view") as SettingsModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    html = renderToStaticMarkup(build(settings));
  });
  return html;
}

/**
 * createElement from the same isolated registry the page was loaded into: it is only ever
 * called from inside render's build callback, while that registry is the active one.
 */
function h<P extends object>(component: FunctionComponent<P>, props: P): ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react") as typeof import("react");
  return createElement(component, props);
}

const noop = () => undefined;

function member(role: string, overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    id: `user-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@acme.test`,
    name: `A ${role.toLowerCase()}`,
    role,
    phone: null,
    avatarUrl: null,
    language: "en",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function invitation(role: string, overrides: Partial<PendingInvitation> = {}): PendingInvitation {
  return {
    id: `invite-${role.toLowerCase()}`,
    email: `new-${role.toLowerCase()}@example.com`,
    name: null,
    role,
    status: "PENDING",
    invitedBy: { id: "user-owner", name: "The Owner" },
    createdAt: new Date().toISOString(),
    // Comfortably in the future whenever this runs.
    expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    ...overrides,
  };
}

/** The opening tag of the button whose label is `label`. */
function buttonTag(html: string, label: string): string {
  const match = html.match(new RegExp(`<button([^>]*)>(?:(?!</button>).)*${label}</button>`));
  if (!match) throw new Error(`No button labelled ${label} in:\n${html}`);
  return match[1];
}

function count(html: string, pattern: RegExp): number {
  return (html.match(new RegExp(pattern.source, "g")) ?? []).length;
}

describe("TeamCard", () => {
  const members = [member("OWNER"), member("ADMIN"), member("AGENT")];

  it("enables Invite Member for someone who can manage the team", () => {
    const html = render(({ TeamCard }) =>
      h(TeamCard, {
        members,
        selfId: "user-admin",
        canManage: true,
        roles: assignableRoles("ADMIN"),
        onInvite: noop,
        onChanged: noop,
        onError: noop,
      }),
    );
    const tag = buttonTag(html, "Invite Member");
    expect(tag).not.toMatch(/\sdisabled=""/);
    expect(html).not.toMatch(/does not have yet/);
  });

  it("disables it, with the reason, for a role without team.manage", () => {
    const html = render(({ TeamCard }) =>
      h(TeamCard, {
        members,
        selfId: "user-agent",
        canManage: false,
        roles: assignableRoles("AGENT"),
        onInvite: noop,
        onChanged: noop,
        onError: noop,
      }),
    );
    const tag = buttonTag(html, "Invite Member");
    expect(tag).toMatch(/\sdisabled=""/);
    expect(tag).toContain('title="Your role cannot invite teammates."');
    // Nothing to change either: no role pickers, no deactivate buttons.
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Deactivate");
  });

  it("offers an ADMIN only roles up to their own, and leaves the OWNER alone", () => {
    const html = render(({ TeamCard }) =>
      h(TeamCard, {
        members,
        selfId: "user-admin",
        canManage: true,
        roles: assignableRoles("ADMIN"),
        onInvite: noop,
        onChanged: noop,
        onError: noop,
      }),
    );
    // One picker: the AGENT's. Not the OWNER's (ranked above) and not the ADMIN's own.
    expect(count(html, /<select/)).toBe(1);
    expect(html).toContain('aria-label="Role for A agent"');
    expect(html).not.toContain('aria-label="Role for A owner"');
    expect(html).not.toMatch(/<option value="(OWNER|SUPER_ADMIN)"/);
    expect(html).toMatch(/<option value="ADMIN"/);
    expect(count(html, />Deactivate</)).toBe(1);
  });
});

describe("InvitationsCard", () => {
  const pending = [
    invitation("AGENT"),
    invitation("OWNER"),
    invitation("VIEWER", {
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    }),
  ];

  it("lists open invitations with Resend for roles the actor could hand out, and Revoke for all", () => {
    const html = render(({ InvitationsCard }) =>
      h(InvitationsCard, {
        invitations: pending,
        canManage: true,
        actorRole: "ADMIN",
        onResent: noop,
        onRevoked: noop,
        onError: noop,
      }),
    );
    expect(html).toContain("new-agent@example.com");
    expect(html).toContain("new-owner@example.com");
    expect(html).toContain("Expired");
    expect(html).toMatch(/Expires in \d days/);
    // The API refuses an ADMIN resending an OWNER invitation, so it is not offered.
    expect(count(html, />Resend</)).toBe(2);
    expect(count(html, />Revoke</)).toBe(3);
  });

  it("shows a read-only list to someone who can see the team but not manage it", () => {
    const html = render(({ InvitationsCard }) =>
      h(InvitationsCard, {
        invitations: pending,
        canManage: false,
        actorRole: "MANAGER",
        onResent: noop,
        onRevoked: noop,
        onError: noop,
      }),
    );
    expect(html).toContain("new-agent@example.com");
    expect(html).not.toContain("Resend");
    expect(html).not.toContain("Revoke");
  });

  it("stays out of the way for that person when there is nothing pending", () => {
    for (const invitations of [[], null]) {
      const html = render(({ InvitationsCard }) =>
        h(InvitationsCard, {
          invitations,
          canManage: false,
          actorRole: "AGENT",
          onResent: noop,
          onRevoked: noop,
          onError: noop,
        }),
      );
      expect(html).toBe("");
    }
  });

  it("tells a manager how to start when nothing is pending", () => {
    const html = render(({ InvitationsCard }) =>
      h(InvitationsCard, {
        invitations: [],
        canManage: true,
        actorRole: "OWNER",
        onResent: noop,
        onRevoked: noop,
        onError: noop,
      }),
    );
    expect(html).toContain("No pending invitations.");
  });
});

describe("DangerZone", () => {
  const workspace: TenantSummary = {
    id: "tenant-1",
    name: "Acme & Sons",
    industryVertical: null,
    subdomain: "acme",
    status: "ACTIVE",
    brandingConfig: null,
    createdAt: "2026-10-01T10:00:00.000Z",
  };
  const owner: SessionUser = {
    id: "user-owner",
    email: "owner@acme.test",
    name: "The Owner",
    role: "OWNER",
    tenantId: "tenant-1",
    tenantName: "Acme & Sons",
  };

  it("no longer shows a Delete Account button that does nothing", () => {
    for (const supportEmail of [undefined, "support@appsgain.example"]) {
      const html = render(
        ({ DangerZone }) => h(DangerZone, { workspace, user: owner, isOwner: true }),
        supportEmail,
      );
      expect(html).not.toContain("Delete Account");
      expect(html).not.toMatch(/<button[^>]*disabled/);
    }
  });

  it("gives the owner a mailto to the configured support address, with the workspace filled in", () => {
    const html = render(
      ({ DangerZone }) => h(DangerZone, { workspace, user: owner, isOwner: true }),
      "support@appsgain.example",
    );
    const href = html.match(/<a href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    expect(href).toBeDefined();
    const url = new URL(href as string);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("support@appsgain.example");
    expect(url.searchParams.get("subject")).toBe("Delete workspace: acme");
    expect(url.searchParams.get("body")).toContain("Requested by: owner@acme.test");
    expect(html).toContain("Contact support to delete this workspace");
  });

  it("names support without a link while no support address is configured", () => {
    const html = render(({ DangerZone }) =>
      h(DangerZone, { workspace, user: owner, isOwner: true }),
    );
    expect(html).not.toContain("mailto:");
    expect(html).toMatch(/contact .+ support/);
  });

  it("tells anyone but the owner that the owner has to ask", () => {
    const html = render(
      ({ DangerZone }) =>
        h(DangerZone, {
          workspace,
          user: { ...owner, id: "user-admin", role: "ADMIN" },
          isOwner: false,
        }),
      "support@appsgain.example",
    );
    expect(html).not.toContain("mailto:");
    expect(html).toContain("Only the workspace owner can ask for it to be deleted.");
  });
});
