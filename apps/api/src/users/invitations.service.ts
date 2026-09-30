import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Invitation } from "@prisma/client";
import { hasAtLeastRole, type Role } from "@appsgain/shared";
import { appUrl } from "../config/app-url";
import { invitationMail } from "../mail/mail-templates";
import { MailService } from "../mail/mail.service";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import { INVITATION_TTL_DAYS, generateInvitationToken } from "./invitation-token";

export interface InvitationView {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: "PENDING" | "EXPIRED";
  invitedBy: { id: string; name: string } | null;
  createdAt: string;
  expiresAt: string;
}

export interface InvitationSent {
  invitation: InvitationView;
  /**
   * The acceptance link, returned to the person who created the invitation so they can
   * pass it on themselves when email is not configured, or did not arrive.
   */
  link: string;
  emailSent: boolean;
  emailError?: string;
}

const DAY_MS = 24 * 3_600_000;

/**
 * Feature List §12 — "Invite members by email with a pre-set role", the workspace side.
 *
 * An invitation is not a user. The account is created only when the link is accepted, by
 * the person holding it, with a password only they know — so an admin never chooses or
 * sees a teammate's password, and an address that never accepts leaves nothing behind
 * that could be signed into.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaFactory,
    private readonly mail: MailService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /** Invitations still waiting for an answer, expired ones included so they can be resent. */
  async list(): Promise<InvitationView[]> {
    const rows = await this.db.invitation.findMany({
      where: { status: { in: ["PENDING", "EXPIRED"] } },
      orderBy: { createdAt: "desc" },
    });
    const inviters = await this.inviters(rows);
    return rows.map((row) => toView(row, inviters));
  }

  async invite(
    input: { email: string; name?: string; role: Role },
    actor: { userId: string; role: Role },
  ): Promise<InvitationSent> {
    if (!hasAtLeastRole(actor.role, input.role)) {
      throw new ForbiddenException("You cannot invite someone to a role above your own.");
    }

    const email = input.email.trim().toLowerCase();
    const member = await this.db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { status: true },
    });
    if (member) {
      throw new ConflictException(
        member.status === "DISABLED"
          ? `${email} has a deactivated account in this workspace. Reactivate it from the team list instead.`
          : `${email} is already a member of this workspace.`,
      );
    }

    const { token, hash } = generateInvitationToken();
    const data = {
      name: input.name?.trim() || null,
      role: input.role,
      tokenHash: hash,
      status: "PENDING" as const,
      invitedById: actor.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * DAY_MS),
      acceptedAt: null,
      revokedAt: null,
    };

    // One invitation per address: inviting again replaces the old one, and its link with it.
    const existing = await this.db.invitation.findFirst({ where: { email } });
    const invitation = existing
      ? await this.db.invitation.update({ where: { id: existing.id }, data })
      : await this.db.invitation.create({
          data: scopedCreate<Prisma.InvitationUncheckedCreateInput>({ email, ...data }),
        });

    this.logger.log(`Invitation sent: ${invitation.id} role=${invitation.role} by=${actor.userId}`);
    return this.deliver(invitation, token, actor.userId);
  }

  /** A fresh link and a fresh week. The previous link stops working. */
  async resend(id: string, actor: { userId: string; role: Role }): Promise<InvitationSent> {
    const invitation = await this.find(id);
    if (!hasAtLeastRole(actor.role, invitation.role as Role)) {
      throw new ForbiddenException("You cannot resend an invitation to a role above your own.");
    }

    const { token, hash } = generateInvitationToken();
    const updated = await this.db.invitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash: hash,
        status: "PENDING",
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * DAY_MS),
      },
    });
    return this.deliver(updated, token, actor.userId);
  }

  async revoke(id: string): Promise<void> {
    const invitation = await this.find(id);
    await this.db.invitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }

  private async deliver(invitation: Invitation, token: string, inviterId: string): Promise<InvitationSent> {
    const [tenant, inviter] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: invitation.tenantId }, select: { name: true } }),
      this.db.user.findFirst({ where: { id: inviterId }, select: { id: true, name: true } }),
    ]);

    const link = appUrl(`/accept-invite?token=${encodeURIComponent(token)}`);
    const result = await this.mail.send({
      to: invitation.email,
      ...invitationMail({
        workspace: tenant?.name ?? "your workspace",
        inviter: inviter?.name ?? null,
        role: invitation.role,
        link,
        days: INVITATION_TTL_DAYS,
      }),
    });

    const inviters = new Map(inviter ? [[inviter.id, inviter]] : []);
    return {
      invitation: toView(invitation, inviters),
      link,
      emailSent: result.ok,
      ...(result.ok ? {} : { emailError: result.reason }),
    };
  }

  private async find(id: string): Promise<Invitation> {
    const invitation = await this.db.invitation.findFirst({ where: { id } });
    if (!invitation || invitation.status === "ACCEPTED" || invitation.status === "REVOKED") {
      throw new NotFoundException("That invitation is not open any more.");
    }
    return invitation;
  }

  private async inviters(rows: Invitation[]): Promise<Map<string, { id: string; name: string }>> {
    const ids = Array.from(new Set(rows.map((row) => row.invitedById).filter((id): id is string => Boolean(id))));
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user]));
  }
}

function toView(row: Invitation, inviters: Map<string, { id: string; name: string }>): InvitationView {
  const expired = row.status === "EXPIRED" || row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    status: expired ? "EXPIRED" : "PENDING",
    invitedBy: row.invitedById ? (inviters.get(row.invitedById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

