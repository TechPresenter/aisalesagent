import {
  ArgumentsHost,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpServer } from "@nestjs/common";
import { AllExceptionsFilter, logOnly } from "./all-exceptions.filter";
import { reportException } from "./error-reporting";

jest.mock("./error-reporting", () => ({
  ...jest.requireActual<typeof import("./error-reporting")>("./error-reporting"),
  reportException: jest.fn(),
}));

const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.secret-access-token.signature";

function setup(request: Record<string, unknown> = {}) {
  const adapter = {
    isHeadersSent: jest.fn(() => false),
    reply: jest.fn(),
    end: jest.fn(),
  };
  const req = {
    method: "PATCH",
    originalUrl: "/api/leads/2b4c?expires=1700000000&signature=abc123signature",
    url: "/api/leads/2b4c?expires=1700000000&signature=abc123signature",
    route: { path: "/api/leads/:id" },
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "x-vercel-id": "bom1::abcde-123" },
    body: { name: "Priya Sharma", phone: "+919876543210" },
    user: { sub: "user-1", tenantId: "tenant-1" },
    tenantContext: { tenantId: "tenant-1" },
    ...request,
  };
  const res = {};
  const host = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getArgByIndex: (index: number) => [req, res][index],
  } as unknown as ArgumentsHost;

  const filter = new AllExceptionsFilter(adapter as unknown as HttpServer);
  const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  return { filter, host, adapter, res, logged };
}

describe("AllExceptionsFilter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(reportException).mockReset();
  });

  it("answers an unexpected error with Nest's 500 body, logs one structured line and reports it", () => {
    const { filter, host, adapter, res, logged } = setup();
    const error = new TypeError("Cannot read properties of undefined (reading 'phone')");

    filter.catch(error, host);

    expect(adapter.reply).toHaveBeenCalledWith(
      res,
      { statusCode: 500, message: "Internal server error" },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0][0]);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      status: 500,
      method: "PATCH",
      route: "/api/leads/:id",
      tenantId: "tenant-1",
      userId: "user-1",
      requestId: "bom1::abcde-123",
      error: "TypeError",
      message: "Cannot read properties of undefined (reading 'phone')",
    });
    expect(JSON.parse(line).at).toEqual(expect.arrayContaining([expect.stringContaining("all-exceptions.filter.spec")]));

    expect(reportException).toHaveBeenCalledWith(error, {
      method: "PATCH",
      route: "/api/leads/:id",
      tenantId: "tenant-1",
      userId: "user-1",
      apiKeyId: undefined,
      requestId: "bom1::abcde-123",
    });
  });

  it("never writes the token, the body or the query string", () => {
    const { filter, host, logged } = setup({ route: undefined });

    filter.catch(new Error("boom"), host);

    const line = String(logged.mock.calls[0][0]);
    expect(JSON.parse(line).route).toBe("/api/leads/2b4c");
    expect(line).not.toContain(ACCESS_TOKEN);
    expect(line).not.toContain("signature");
    expect(line).not.toContain("Priya");
    expect(line).not.toContain("9876543210");
  });

  it("keeps only the first line of a message, which for Prisma is the query and not its arguments", () => {
    const { filter, host, logged } = setup();
    const error = new Error(
      "\nInvalid `prisma.lead.update()` invocation:\n\n{\n  data: {\n    phone: \"+919876543210\",\n    name: \"Priya Sharma\"\n  }\n}",
    );
    error.name = "PrismaClientValidationError";

    filter.catch(error, host);

    const line = String(logged.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      error: "PrismaClientValidationError",
      message: "Invalid `prisma.lead.update()` invocation:",
    });
    expect(line).not.toContain("9876543210");
  });

  it("describes an error from another realm by its shape, as a native module raises them", () => {
    const { filter, host, logged } = setup();
    const foreign = {
      name: "Error",
      message: "Memory allocation error",
      stack: "Error: Memory allocation error\n    at hash (node_modules/argon2/argon2.cjs:93:12)",
    };

    filter.catch(foreign, host);

    expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({
      status: 500,
      error: "Error",
      message: "Memory allocation error",
      at: ["hash (node_modules/argon2/argon2.cjs:93:12)"],
    });
  });

  it("names an API key caller by the key", () => {
    const { filter, host, logged } = setup({
      user: { sub: "user-1", tenantId: "tenant-1", apiKeyId: "key-9" },
    });

    filter.catch(new Error("boom"), host);

    expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({ apiKeyId: "key-9" });
    expect(reportException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ apiKeyId: "key-9" }));
  });

  it("leaves a client error alone: same answer as before, nothing logged or reported", () => {
    const { filter, host, adapter, res, logged } = setup();

    filter.catch(new NotFoundException("Lead not found"), host);

    expect(adapter.reply).toHaveBeenCalledWith(
      res,
      { statusCode: 404, message: "Lead not found", error: "Not Found" },
      404,
    );
    expect(logged).not.toHaveBeenCalled();
    expect(reportException).not.toHaveBeenCalled();
  });

  it("reports a deliberate 500", () => {
    const { filter, host } = setup();

    const failed = new InternalServerErrorException("Worker pass failed: timeout");
    filter.catch(failed, host);
    expect(reportException).toHaveBeenCalledWith(failed, expect.objectContaining({ tenantId: "tenant-1" }));
  });

  it("reports a 503 only an operator can fix, such as Clerk refusing the API's key", () => {
    const { filter, host, adapter, res, logged } = setup({
      method: "POST",
      originalUrl: "/api/auth/sso/clerk",
      url: "/api/auth/sso/clerk",
      route: { path: "/api/auth/sso/clerk" },
      user: undefined,
      tenantContext: undefined,
    });
    const unavailable = new ServiceUnavailableException(
      "Google and Microsoft sign-in is not available right now. Try again in a minute, or sign in with your email and password.",
    );

    filter.catch(unavailable, host);

    expect(adapter.reply).toHaveBeenCalledWith(res, expect.objectContaining({ statusCode: 503 }), 503);
    expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({ status: 503, route: "/api/auth/sso/clerk" });
    expect(reportException).toHaveBeenCalledWith(
      unavailable,
      expect.objectContaining({ method: "POST", route: "/api/auth/sso/clerk" }),
    );
  });

  it("logs readiness's 503 without reporting it, with the same answer", () => {
    const { filter, host, adapter, res, logged } = setup({
      method: "GET",
      originalUrl: "/api/health/ready",
      url: "/api/health/ready",
      route: { path: "/api/health/ready" },
      user: undefined,
      tenantContext: undefined,
    });

    filter.catch(logOnly(new ServiceUnavailableException({ status: "degraded", database: "down" })), host);

    expect(adapter.reply).toHaveBeenCalledWith(res, { status: "degraded", database: "down" }, 503);
    expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({ status: 503, route: "/api/health/ready" });
    expect(JSON.parse(String(logged.mock.calls[0][0]))).not.toHaveProperty("at");
    expect(reportException).not.toHaveBeenCalled();
  });

  it("decides by the exception, not its status: an unmarked 501 is reported, a marked one is not", () => {
    const { filter, host, logged } = setup();

    filter.catch(logOnly(new NotImplementedException("Recording audio is not stored by this app yet.")), host);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(reportException).not.toHaveBeenCalled();

    const unmarked = new NotImplementedException("Something else is not built.");
    filter.catch(unmarked, host);
    expect(reportException).toHaveBeenCalledWith(unmarked, expect.any(Object));
  });

  it("answers a body parser's 413 with a readable message instead of a 500", () => {
    const { filter, host, adapter, res, logged } = setup({ route: undefined, user: undefined, tenantContext: undefined });
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: "entity.too.large",
    });

    filter.catch(tooLarge, host);

    expect(adapter.reply).toHaveBeenCalledWith(
      res,
      expect.objectContaining({
        statusCode: 413,
        message: expect.stringMatching(/too large.*Send less data/),
      }),
      413,
    );
    expect(logged).not.toHaveBeenCalled();
    expect(reportException).not.toHaveBeenCalled();
  });

  it("passes another body parser client error through with its own status and message", () => {
    const { filter, host, adapter, res } = setup();
    const unsupported = Object.assign(new Error('unsupported charset "UTF-7"'), {
      status: 415,
      statusCode: 415,
      expose: true,
      type: "charset.unsupported",
    });

    filter.catch(unsupported, host);

    expect(adapter.reply).toHaveBeenCalledWith(res, { statusCode: 415, message: 'unsupported charset "UTF-7"' }, 415);
  });

  it("treats a server-side http-error as a fault rather than echoing its message", () => {
    const { filter, host, adapter, res } = setup();
    const internal = Object.assign(new Error("stream is not readable"), {
      status: 500,
      statusCode: 500,
      expose: false,
      type: "stream.not.readable",
    });

    filter.catch(internal, host);

    expect(adapter.reply).toHaveBeenCalledWith(res, { statusCode: 500, message: "Internal server error" }, 500);
    expect(reportException).toHaveBeenCalledWith(internal, expect.any(Object));
  });
});
