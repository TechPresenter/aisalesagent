import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { LoginResponse, Role } from "@appsgain/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hashInvitationToken } from "../users/invitation-token";
import { AuthService, type SessionContext } from "./auth.service";

export interface InvitationPreview {
  email: string;
  name: string | null;
  role: Role;
  workspace: { name: string; subdomain: string };
  invitedBy: string | null;
  expiresAt: string;
}

/**
 * The invitee's half of Feature List §12 "Team invites": reading an invitation from its
 * link, and turning it into an account.
 *
 * Unscoped, like sign-in, because the person holding the link belongs to no workspace
 * yet — the token is the only thing that says which one. Every path that rejects a link
 * gives the same answer, so an expired, revoked or made-up token cannot be told apart.
 */
@Injectable()
export class InvitationAcceptService {
  private readonly logger = new Logger(InvitationAcceptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.live(token);
    const inviter = invitation.invitedById
      ? await this.prisma.user.findUnique({
          where: { id: invitation.invitedById },
          select: { name: true },
        })
      : null;

    return {
      email: invitation.email,
      name: invitation.name,
      role: invitation.role as Role,
      workspace: { name: invitation.tenant.name, subdomain: invitation.tenant.subdomain },
      invitedBy: inviter?.name ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Creates the account and signs it in. The email is marked verified: arriving with a
   * token that was only ever sent to that address is the verification.
   */
  async accept(
    input: { token: string; name: string; password: string },
    context: SessionContext,
  ): Promise<LoginResponse> {
    const invitation = await this.live(input.token);
    const passwordHash = await AuthService.hashPassword(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: two tabs accepting the same link must not both win.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: "PENDING", revokedAt: null, expiresAt: { gt: new Date() } },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw this.invalid();

      const existing = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: invitation.tenantId, email: invitation.email } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          "An account with this email already exists in the workspace. Sign in instead.",
        );
      }

      return tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name: input.name.trim(),
          passwordHash,
          role: invitation.role,
          customRoleId: invitation.customRoleId,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
    });

    this.logger.log(`Invitation accepted: user=${user.id} tenant=${user.tenantId} role=${user.role}`);
    return this.auth.completeSignIn(user, invitation.tenant.name, context);
  }

  private async live(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { tenant: { select: { name: true, subdomain: true, status: true } } },
    });
    if (
      !invitation ||
      invitation.status !== "PENDING" ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.tenant.status === "CANCELLED" ||
      invitation.tenant.status === "SUSPENDED"
    ) {
      throw this.invalid();
    }
    return invitation;
  }

  private invalid(): NotFoundException {
    return new NotFoundException("This invitation is no longer valid. Ask the person who invited you for a new one.");
  }
}
