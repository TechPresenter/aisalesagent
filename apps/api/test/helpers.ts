import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

export interface TestWorkspace {
  tenantId: string;
  subdomain: string;
  ownerId: string;
  ownerEmail: string;
  accessToken: string;
  refreshToken: string;
}

export const TEST_PASSWORD = "correct-horse-battery-staple";

/** Boots the real application — same modules, same global guards, same pipes. */
export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  // Mirrors main.ts. If these drift, the tests stop testing what actually ships.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/**
 * Truncate rather than delete: it resets identity columns too, and CASCADE handles the
 * foreign keys without the test having to know the deletion order.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "refresh_tokens", "leads", "users", "tenants" RESTART IDENTITY CASCADE`,
  );
}

/**
 * Creates a workspace through the public signup endpoint and logs its owner in, so the
 * fixture exercises the same path a real customer would rather than seeding rows behind
 * the API's back.
 */
export async function createWorkspace(
  app: INestApplication,
  subdomain: string,
): Promise<TestWorkspace> {
  const ownerEmail = `owner@${subdomain}.test`;

  const created = await request(app.getHttpServer())
    .post("/api/workspace")
    .send({
      name: subdomain,
      subdomain,
      ownerName: `${subdomain} Owner`,
      ownerEmail,
      ownerPassword: TEST_PASSWORD,
    })
    .expect(201);

  const login = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ subdomain, email: ownerEmail, password: TEST_PASSWORD })
    .expect(200);

  return {
    tenantId: created.body.tenant.id,
    subdomain,
    ownerId: created.body.owner.id,
    ownerEmail,
    accessToken: login.body.accessToken,
    refreshToken: login.body.refreshToken,
  };
}

/** Creates a lead inside a workspace, authenticated as that workspace. */
export async function createLead(
  app: INestApplication,
  workspace: TestWorkspace,
  overrides: Partial<{ name: string; phone: string; city: string }> = {},
): Promise<{ id: string; phone: string; name: string }> {
  const response = await request(app.getHttpServer())
    .post("/api/leads")
    .set("Authorization", `Bearer ${workspace.accessToken}`)
    .send({
      name: overrides.name ?? `${workspace.subdomain} Clinic`,
      phone: overrides.phone ?? randomIndianMobile(),
      city: overrides.city ?? "Patna",
    })
    .expect(201);

  return response.body;
}

let phoneCounter = 0;

/** Deterministic-per-run mobile numbers, so two fixtures never collide by accident. */
export function randomIndianMobile(): string {
  phoneCounter += 1;
  return `9${String(800000000 + phoneCounter).padStart(9, "0")}`;
}
