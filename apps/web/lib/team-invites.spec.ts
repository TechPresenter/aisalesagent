import { ApiError, type InvitationSent } from "./api-client";
import {
  ROLE_SUMMARY,
  assignableRoles,
  canAssign,
  defaultInviteRole,
  describeInviteOutcome,
  expiryLabel,
  inviteErrorText,
  looksLikeEmail,
  workspaceDeletionMailto,
} from "./team-invites";

/**
 * Settings → Team used to show a permanently disabled Invite Member button. These pin the
 * rules the replacement shows on screen — the API enforces each of them too — and the
 * one thing that is easy to get wrong in the copy: an invitation whose email did not go
 * out is still a working invitation.
 */

function sent(overrides: Partial<InvitationSent> = {}): InvitationSent {
  return {
    invitation: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "neha@example.com",
      name: null,
      role: "AGENT",
      status: "PENDING",
      invitedBy: { id: "owner", name: "Owner" },
      createdAt: "2026-10-14T10:00:00.000Z",
      expiresAt: "2026-10-21T10:00:00.000Z",
    },
    link: "https://app.example.com/accept-invite?token=inv_abc",
    emailSent: true,
    ...overrides,
  };
}

describe("assignableRoles", () => {
  it("offers the actor's own role and everything below it, highest first", () => {
    expect(assignableRoles("OWNER")).toEqual(["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"]);
    expect(assignableRoles("ADMIN")).toEqual(["ADMIN", "MANAGER", "AGENT", "VIEWER"]);
    expect(assignableRoles("MANAGER")).toEqual(["MANAGER", "AGENT", "VIEWER"]);
    expect(assignableRoles("VIEWER")).toEqual(["VIEWER"]);
  });

  it("never offers SUPER_ADMIN, even to a SUPER_ADMIN", () => {
    for (const actor of ["SUPER_ADMIN", "OWNER", "ADMIN"] as const) {
      expect(assignableRoles(actor)).not.toContain("SUPER_ADMIN");
    }
  });

  it("offers nothing while the role is unknown", () => {
    expect(assignableRoles(null)).toEqual([]);
  });

  it("has a summary for every role it can offer", () => {
    for (const role of assignableRoles("SUPER_ADMIN")) {
      expect(ROLE_SUMMARY[role as keyof typeof ROLE_SUMMARY]).toEqual(expect.any(String));
    }
  });
});

describe("defaultInviteRole", () => {
  it("starts on AGENT when it is on offer, else on the lowest role", () => {
    expect(defaultInviteRole(assignableRoles("OWNER"))).toBe("AGENT");
    expect(defaultInviteRole(["VIEWER"])).toBe("VIEWER");
    expect(defaultInviteRole([])).toBeNull();
  });
});

describe("canAssign", () => {
  it("allows equals and below, refuses above, as the API does", () => {
    expect(canAssign("ADMIN", "ADMIN")).toBe(true);
    expect(canAssign("ADMIN", "AGENT")).toBe(true);
    expect(canAssign("ADMIN", "OWNER")).toBe(false);
  });

  it("keeps a platform SUPER_ADMIN and unknown roles out of reach", () => {
    expect(canAssign("OWNER", "SUPER_ADMIN")).toBe(false);
    expect(canAssign("SUPER_ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(canAssign("OWNER", "CUSTOM_ROLE")).toBe(false);
    expect(canAssign(null, "AGENT")).toBe(false);
  });
});

describe("looksLikeEmail", () => {
  it.each(["neha@example.com", "  a.b+c@sub.example.co.in  "])("accepts %s", (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each(["", "neha", "neha@", "neha@example", "ne ha@example.com", "@example.com"])(
    "rejects %j",
    (value) => {
      expect(looksLikeEmail(value)).toBe(false);
    },
  );
});

describe("describeInviteOutcome", () => {
  it("says the invitation was emailed when it was", () => {
    expect(describeInviteOutcome(sent())).toEqual({
      tone: "ok",
      headline: expect.stringContaining("emailed to neha@example.com"),
    });
  });

  it("treats an email that did not go as a next step, not a failure, and keeps the reason", () => {
    const outcome = describeInviteOutcome(
      sent({ emailSent: false, emailError: "Email is not configured on this server." }),
    );
    expect(outcome.tone).toBe("notice");
    expect(outcome.headline).toMatch(/invitation is ready/i);
    expect(outcome.headline).toMatch(/send it to neha@example\.com yourself/);
    expect(outcome.headline).not.toMatch(/fail|error/i);
    expect(outcome.detail).toBe("Email is not configured on this server.");
  });
});

describe("inviteErrorText", () => {
  it("shows the API's own words for a refusal the person can act on", () => {
    expect(
      inviteErrorText(new ApiError("neha@example.com is already a member of this workspace.", 409)),
    ).toBe("neha@example.com is already a member of this workspace.");
    expect(
      inviteErrorText(new ApiError("You cannot invite someone to a role above your own.", 403)),
    ).toMatch(/above your own/);
    expect(inviteErrorText(new ApiError("email must be an email", 400))).toBe(
      "email must be an email",
    );
  });

  it("falls back to a retry message for server faults and network errors", () => {
    expect(inviteErrorText(new ApiError("Internal server error", 500))).toBe(
      "Could not reach the server. Try again.",
    );
    expect(inviteErrorText(new TypeError("Failed to fetch"))).toBe(
      "Could not reach the server. Try again.",
    );
  });
});

describe("expiryLabel", () => {
  const now = Date.parse("2026-10-14T10:00:00.000Z");
  const inDays = (days: number) => new Date(now + days * 86_400_000).toISOString();

  it("counts days left, rounded up, so a new invitation reads as the full week", () => {
    expect(expiryLabel(inDays(7), "PENDING", now)).toBe("Expires in 7 days");
    expect(expiryLabel(inDays(6.99), "PENDING", now)).toBe("Expires in 7 days");
    expect(expiryLabel(inDays(1.5), "PENDING", now)).toBe("Expires in 2 days");
    expect(expiryLabel(inDays(1), "PENDING", now)).toBe("Expires within a day");
    expect(expiryLabel(inDays(0.25), "PENDING", now)).toBe("Expires within a day");
  });

  it("says Expired once the time has passed, or when the server says so", () => {
    expect(expiryLabel(inDays(-1), "PENDING", now)).toBe("Expired");
    expect(expiryLabel(inDays(3), "EXPIRED", now)).toBe("Expired");
  });
});

describe("workspaceDeletionMailto", () => {
  const request = {
    workspaceName: "Acme & Sons",
    subdomain: "acme",
    requesterEmail: "owner@acme.test",
  };

  it("is null until a support address is configured, so no link goes nowhere", () => {
    expect(workspaceDeletionMailto(null, request)).toBeNull();
    expect(workspaceDeletionMailto(undefined, request)).toBeNull();
    expect(workspaceDeletionMailto("  ", request)).toBeNull();
    expect(workspaceDeletionMailto("not-an-address", request)).toBeNull();
  });

  it("addresses support with the workspace and requester filled in, safely encoded", () => {
    const link = workspaceDeletionMailto(" support@appsgain.example ", request);
    expect(link).not.toBeNull();
    const url = new URL(link as string);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("support@appsgain.example");
    expect(url.searchParams.get("subject")).toBe("Delete workspace: acme");

    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("Workspace name: Acme & Sons");
    expect(body).toContain("Workspace (sign-in name): acme");
    expect(body).toContain("Requested by: owner@acme.test");
    // CRLF line breaks (RFC 6068), and the ampersand did not split the query.
    expect(body).toContain("\r\n");
    expect(Array.from(url.searchParams.keys())).toEqual(["subject", "body"]);
  });

  it("still asks sensibly while the workspace details are loading", () => {
    const url = new URL(workspaceDeletionMailto("support@appsgain.example", {}) as string);
    expect(url.searchParams.get("subject")).toBe("Delete my workspace");
    expect(url.searchParams.get("body")).toContain("Workspace name: —");
  });
});
