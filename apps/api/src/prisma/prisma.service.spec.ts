import { Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** connectWithRetry is private; the default attempt count is what is under test. */
type Retrying = { connectWithRetry(attempts?: number, delayMs?: number): Promise<void> };

describe("PrismaService connectWithRetry", () => {
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  function unreachable(): { service: Retrying; connect: jest.SpyInstance } {
    const prisma = new PrismaService();
    const connect = jest
      .spyOn(prisma, "$connect")
      .mockRejectedValue(new Error("Can't reach database server at `localhost:5432`"));
    return { service: prisma as unknown as Retrying, connect };
  }

  it("gives up after two attempts on Vercel, so a cold start fails fast", async () => {
    process.env.VERCEL = "1";
    const { service, connect } = unreachable();

    await expect(service.connectWithRetry(undefined, 0)).rejects.toThrow("Can't reach database server");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("keeps waiting for a database that starts after the API locally", async () => {
    delete process.env.VERCEL;
    const { service, connect } = unreachable();

    await expect(service.connectWithRetry(undefined, 0)).rejects.toThrow("Can't reach database server");
    expect(connect).toHaveBeenCalledTimes(12);
  });

  it("returns as soon as the database answers", async () => {
    process.env.VERCEL = "1";
    const { service, connect } = unreachable();
    connect.mockRejectedValueOnce(new Error("Connection reset")).mockResolvedValueOnce(undefined);

    await expect(service.connectWithRetry(undefined, 0)).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
