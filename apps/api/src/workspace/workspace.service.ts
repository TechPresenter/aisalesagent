import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateWorkspaceResponse, Role, TenantSummary } from "@appsgain/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService, type SessionContext } from "../auth/auth.service";
import { SsoService } from "../auth/sso.service";
import { CreateWorkspaceDto, RESERVED_SUBDOMAINS } from "./dto/create-workspace.dto";

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sso: SsoService,
  ) {}

  /**
   * TRD §8 — self-serve signup. Tenant and OWNER user are created in one transaction so
   * there is no interleaving in which a workspace exists that nobody can log into: if
   * the user insert fails, the tenant is rolled back with it.
   *
   * Uses the unscoped client, which is correct here and nowhere else in feature code —
   * this is the request that brings the tenant being scoped to into existence.
   */
  async createWorkspace(
    dto: CreateWorkspaceDto,
    context: SessionContext = {},
  ): Promise<CreateWorkspaceResponse> {
    if (RESERVED_SUBDOMAINS.has(dto.subdomain)) {
      throw new ConflictException(`"${dto.subdomain}" is reserved`);
    }

    // Hashing is deliberately outside the transaction: Argon2id is designed to take
    // ~100ms, and holding a database transaction open for it would pin a connection for
    // the duration under a signup burst.
    const { passwordHash, hasPassword, emailVerifiedAt, viaSso } = await this.ownerCredentials(dto);

    try {
      const { tenant, owner } = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.name,
            subdomain: dto.subdomain,
            industryVertical: dto.industryVertical ?? null,
            status: "TRIAL",
            // TRD §12 — a workspace is renderable from the moment it exists; the owner
            // edits these later under /workspace/branding.
            brandingConfig: {
              tenantName: dto.name,
              tagline: "",
              monogram: monogramFor(dto.name),
              primaryColor: "#19B969",
              primaryDark: "#0F6941",
              subdomain: `${dto.subdomain}.appsgain.app`,
            } satisfies Prisma.InputJsonObject,
          },
        });

        const owner = await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: dto.ownerName,
            email: dto.ownerEmail,
            passwordHash,
            hasPassword,
            emailVerifiedAt,
            // The first user is the billing owner (TRD §4), never an ADMIN — somebody
            // has to be able to reach billing or the workspace is unmanageable.
            role: "OWNER",
            status: "ACTIVE",
          },
        });

        return { tenant, owner };
      });

      this.logger.log(
        `Workspace created: ${tenant.subdomain} (${tenant.id})${viaSso ? " through Google or Microsoft" : ""}`,
      );

      return {
        tenant: toTenantSummary(tenant),
        owner: {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          role: owner.role as Role,
        },
        ...(viaSso ? { session: await this.auth.completeSignIn(owner, tenant.name, context) } : {}),
      };
    } catch (error) {
      // P2002 is Prisma's unique-constraint violation. Catching it is not belt-and-braces
      // over a pre-check — a pre-check races, and under two concurrent signups for the
      // same subdomain the database constraint is the only thing that actually decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`Subdomain "${dto.subdomain}" is already taken`);
      }
      throw error;
    }
  }

  /**
   * The owner's password digest, from the password — or, for a signup through Google or
   * Microsoft, from nothing: the signup token proved the address, so the owner gets a
   * password nobody knows (and is marked as having none, so Settings lets them set one)
   * and an email that is already verified. The token stands in for the password, never
   * alongside it, and only for the address it was issued to.
   */
  private async ownerCredentials(dto: CreateWorkspaceDto): Promise<{
    passwordHash: string;
    hasPassword: boolean;
    emailVerifiedAt: Date | null;
    viaSso: boolean;
  }> {
    if (dto.ssoToken == null) {
      if (!dto.ownerPassword) {
        throw new BadRequestException("ownerPassword must be at least 12 characters");
      }
      return {
        passwordHash: await AuthService.hashPassword(dto.ownerPassword),
        hasPassword: true,
        emailVerifiedAt: null,
        viaSso: false,
      };
    }

    const signup = await this.sso.claimSignupToken(dto.ssoToken);
    if (dto.ownerPassword !== undefined) {
      throw new BadRequestException(
        "Sign up with a password or with Google or Microsoft, not both.",
      );
    }
    if (dto.ownerEmail !== signup.email) {
      throw new BadRequestException(
        `The owner's email must be ${signup.email}, the address you continued with.`,
      );
    }
    return {
      passwordHash: await AuthService.unusablePasswordHash(),
      hasPassword: false,
      emailVerifiedAt: new Date(),
      viaSso: true,
    };
  }

  /**
   * Renames a workspace or changes its industry. The tenant id comes from the caller's
   * token, so there is no id in the request for anyone to substitute.
   *
   * The branding config carries its own copy of the name for the sidebar mark, so a
   * rename updates both — letting them drift is how a workspace ends up called two things.
   */
  async updateWorkspace(
    tenantId: string,
    dto: { name?: string; industryVertical?: string | null },
  ): Promise<TenantSummary> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const data: Prisma.TenantUpdateInput = {};

    if (dto.name !== undefined && dto.name !== tenant.name) {
      const branding = (tenant.brandingConfig ?? {}) as Prisma.JsonObject;
      data.name = dto.name;
      data.brandingConfig = {
        ...branding,
        tenantName: dto.name,
        monogram: monogramFor(dto.name),
      } as Prisma.InputJsonObject;
    }

    if (dto.industryVertical !== undefined) {
      data.industryVertical = dto.industryVertical;
    }

    // Nothing changed: hand back what is stored rather than writing an identical row.
    if (Object.keys(data).length === 0) return toTenantSummary(tenant);

    return toTenantSummary(await this.prisma.tenant.update({ where: { id: tenantId }, data }));
  }
}

/** "NorthWind" -> "NW"; "Apex" -> "AP". Matches the sidebar mark the web app renders. */
export function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const single = words[0] ?? "";
  // A camel-cased single word carries its own second initial: NorthWind -> NW.
  const capitals = single.match(/[A-Z]/g);
  if (capitals && capitals.length >= 2) {
    return (capitals[0] + capitals[1]).toUpperCase();
  }

  return single.slice(0, 2).toUpperCase();
}

type TenantRow = {
  id: string;
  name: string;
  industryVertical: string | null;
  subdomain: string;
  status: string;
  brandingConfig: Prisma.JsonValue;
  createdAt: Date;
};

export function toTenantSummary(tenant: TenantRow): TenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    industryVertical: tenant.industryVertical,
    subdomain: tenant.subdomain,
    status: tenant.status as TenantSummary["status"],
    brandingConfig: (tenant.brandingConfig as TenantSummary["brandingConfig"]) ?? null,
    createdAt: tenant.createdAt.toISOString(),
  };
}
