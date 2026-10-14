/**
 * Creates the platform operator: a SUPER_ADMIN in the platform's own workspace, who can
 * then sign in and use the operator console (/api/admin).
 *
 * A one-off command run against a database by someone who already holds its credentials,
 * never an endpoint. An endpoint that makes super admins is a door that has to be guarded
 * by something stronger than a super admin; DATABASE_URL already is that something.
 *
 *   cd apps/api
 *   npx ts-node scripts/create-super-admin.ts --email ops@example.com --name "Platform Ops"
 *
 * The same line works in bash, PowerShell and cmd: apps/api/tsconfig.json already compiles
 * to CommonJS, so ts-node needs no inline compiler options (whose JSON quoting each shell
 * mangles differently).
 *
 * Options:
 *   --email <address>         required
 *   --name <full name>        required when creating the account
 *   --subdomain <sub>         the platform workspace, default "appsgain" — reserved, so no
 *                             customer can ever sign up with it; sign in with it as the workspace
 *   --workspace-name <name>   default "Appsgain Platform", used only when creating it
 *   --reset-password          set a new password on an existing operator account
 *
 * The password comes from SUPER_ADMIN_PASSWORD, or is asked for (without echo) when run in
 * a terminal. It is never taken as an argument, which would leave it in shell history.
 *
 * DATABASE_URL is read from the environment, falling back to the repository's .env — so
 * against production, set it explicitly. The script prints the host and database it is
 * about to write to, never the credentials.
 */
/* eslint-disable no-console -- a command-line tool reports to whoever is running it */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { join } from "node:path";

export const DEFAULT_PLATFORM_SUBDOMAIN = "appsgain";
const DEFAULT_PLATFORM_NAME = "Appsgain Platform";

/** Same floor as a workspace owner's password (CreateWorkspaceDto). */
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export interface SuperAdminInput {
  email: string;
  name?: string;
  password: string;
  subdomain?: string;
  workspaceName?: string;
  resetPassword?: boolean;
}

export interface SuperAdminResult {
  tenantId: string;
  subdomain: string;
  userId: string;
  email: string;
  createdWorkspace: boolean;
  createdUser: boolean;
}

/**
 * Creates the operator, or resets an existing operator's password when asked to.
 *
 * Refuses to turn a customer's workspace into the platform's: if the subdomain belongs to
 * a workspace with anyone in it who is not a SUPER_ADMIN, it stops. And it never promotes
 * an existing account — an address already in the platform workspace must already be an
 * operator, or the script stops rather than guess.
 *
 * The operator's address is marked confirmed. Whoever runs this with the database's
 * credentials vouches for it, and nothing else ever will: there is no sign-up to send a
 * confirmation from. It matters beyond the label. Google or Microsoft sign-in treats an
 * unconfirmed account as possibly set up by someone who did not own the address, and hands
 * it to whoever proves the address with its password replaced and its two-factor
 * enrolment removed (SsoService.takeOver). Left unconfirmed, the operator would be one
 * mailbox away from losing their second factor; confirmed, a Google or Microsoft sign-in
 * meets the same two-factor challenge a password does.
 */
export async function createSuperAdmin(
  prisma: PrismaClient,
  input: SuperAdminInput,
): Promise<SuperAdminResult> {
  const email = input.email.trim().toLowerCase();
  const subdomain = (input.subdomain ?? DEFAULT_PLATFORM_SUBDOMAIN).trim().toLowerCase();
  const name = input.name?.trim();

  if (!EMAIL.test(email) || email.length > 254) throw new Error(`"${input.email}" is not an email address.`);
  if (!SUBDOMAIN.test(subdomain)) throw new Error(`"${subdomain}" is not a valid workspace subdomain.`);
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`The password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`);
  }

  // Hashed before the transaction: Argon2id takes ~100ms on purpose, and a transaction
  // held open for it pins a connection for nothing.
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  return prisma.$transaction(async (tx) => {
    let tenant = await tx.tenant.findUnique({ where: { subdomain } });
    const createdWorkspace = !tenant;

    if (tenant) {
      const members = await tx.user.findMany({ where: { tenantId: tenant.id }, select: { role: true } });
      if (members.some((member) => member.role !== "SUPER_ADMIN")) {
        throw new Error(
          `"${subdomain}" is a customer workspace, not the platform's. Choose another --subdomain.`,
        );
      }
      if (tenant.status !== "ACTIVE") {
        tenant = await tx.tenant.update({ where: { id: tenant.id }, data: { status: "ACTIVE" } });
      }
    } else {
      tenant = await tx.tenant.create({
        data: {
          name: input.workspaceName?.trim() || DEFAULT_PLATFORM_NAME,
          subdomain,
          // Never TRIAL: the platform's own workspace must not expire or be read-only.
          status: "ACTIVE",
        },
      });
    }

    const existing = await tx.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });

    let userId: string;
    if (existing) {
      if (existing.role !== "SUPER_ADMIN") {
        throw new Error(`${email} is in the platform workspace but is not a SUPER_ADMIN. Not changing it.`);
      }
      if (!input.resetPassword) {
        throw new Error(
          `${email} is already an operator. Pass --reset-password to set a new password.`,
        );
      }
      await tx.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          hasPassword: true,
          status: "ACTIVE",
          failedLoginCount: 0,
          lockedUntil: null,
          // An operator created before addresses were marked confirmed gets it now. A date
          // already there is kept: it records when the address was first confirmed.
          ...(existing.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
        },
      });
      // A reset is usually because the old password is in doubt: end its sessions too.
      await tx.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      userId = existing.id;
    } else {
      if (!name || name.length < 2 || name.length > 120) {
        throw new Error("--name is required (2 to 120 characters) when creating an operator.");
      }
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name,
          passwordHash,
          hasPassword: true,
          // Confirmed by whoever is running this; see the comment on this function.
          emailVerifiedAt: new Date(),
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        },
      });
      userId = user.id;
    }

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorId: null,
        actorEmail: null,
        action: existing ? "platform.operator.password_reset" : "platform.operator.create",
        resourceType: "user",
        resourceId: userId,
        metadata: { email, via: "scripts/create-super-admin.ts" },
      },
    });

    return {
      tenantId: tenant.id,
      subdomain,
      userId,
      email,
      createdWorkspace,
      createdUser: !existing,
    };
  });
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const options: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}". Run with --help.`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function stringOption(options: Record<string, string | true>, key: string): string | undefined {
  const value = options[key];
  if (value === true) throw new Error(`--${key} needs a value.`);
  return value;
}

/** The password, typed without echo, so it lands in neither the terminal nor its scrollback. */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(
      new Error("Set SUPER_ADMIN_PASSWORD, or run this in a terminal to be asked for the password."),
    );
  }

  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SUPER_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;

  const first = await promptHidden("Password for the operator (12+ characters): ");
  const second = await promptHidden("Same password again: ");
  if (first !== second) throw new Error("The two passwords did not match.");
  return first;
}

/** "host:port/database", without the user or password. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: create-super-admin.ts --email <address> --name <name> " +
        "[--subdomain appsgain] [--workspace-name <name>] [--reset-password]\n" +
        "The password comes from SUPER_ADMIN_PASSWORD or is asked for.",
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    loadEnv({ path: join(__dirname, "../../../.env") });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

  const email = stringOption(options, "email");
  if (!email) throw new Error("--email is required. Run with --help.");

  console.log(`Database: ${describeDatabase(databaseUrl)}`);
  const password = await readPassword();

  const prisma = new PrismaClient();
  try {
    const result = await createSuperAdmin(prisma, {
      email,
      name: stringOption(options, "name"),
      password,
      subdomain: stringOption(options, "subdomain"),
      workspaceName: stringOption(options, "workspace-name"),
      resetPassword: options["reset-password"] === true,
    });
    console.log(
      `${result.createdUser ? "Created" : "Reset the password of"} operator ${result.email} ` +
        `in workspace "${result.subdomain}"${result.createdWorkspace ? " (new)" : ""}. ` +
        `Sign in with workspace "${result.subdomain}"; turn on two-factor authentication first.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
