import type * as SentrySdk from "@sentry/nestjs";

jest.mock("@sentry/nestjs", () => {
  const integration = (name: string) => jest.fn((options?: unknown) => ({ name, options }));
  return {
    init: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    flush: jest.fn(() => Promise.resolve(true)),
    eventFiltersIntegration: integration("EventFilters"),
    functionToStringIntegration: integration("FunctionToString"),
    linkedErrorsIntegration: integration("LinkedErrors"),
    dedupeIntegration: integration("Dedupe"),
    nodeContextIntegration: integration("Context"),
    contextLinesIntegration: integration("ContextLines"),
    onUncaughtExceptionIntegration: integration("OnUncaughtException"),
    onUnhandledRejectionIntegration: integration("OnUnhandledRejection"),
  };
});

describe("error reporting", () => {
  // The SDK the module requires when it starts, which is this mock.
  const Sentry = jest.requireMock<jest.Mocked<typeof SentrySdk>>("@sentry/nestjs");

  // A fresh copy of the module for every test: it keeps the client it started, as it does
  // for the life of the process.
  let initErrorReporting: typeof import("./error-reporting").initErrorReporting;
  let reportException: typeof import("./error-reporting").reportException;
  let reportMessage: typeof import("./error-reporting").reportMessage;
  let keepFirstLines: typeof import("./error-reporting").keepFirstLines;

  beforeEach(() => {
    jest.isolateModules(() => {
      ({ initErrorReporting, reportException, reportMessage, keepFirstLines } = jest.requireActual<
        typeof import("./error-reporting")
      >("./error-reporting"));
    });
    jest.clearAllMocks();
  });

  it("stays off without SENTRY_DSN, and reporting is then a no-op", () => {
    expect(initErrorReporting({ NODE_ENV: "production" })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();

    reportException(new Error("boom"), { tenantId: "tenant-1" });
    reportMessage("Platform email failed", "error");

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.flush).not.toHaveBeenCalled();
  });

  it("starts a client that records errors and nothing about the request", () => {
    expect(
      initErrorReporting({
        SENTRY_DSN: " https://public@o0.ingest.sentry.io/1 ",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: "abc123",
      }),
    ).toBe(true);

    const options = jest.mocked(Sentry.init).mock.calls[0][0]!;
    expect(options).toMatchObject({
      dsn: "https://public@o0.ingest.sentry.io/1",
      environment: "production",
      release: "abc123",
      sendDefaultPii: false,
      defaultIntegrations: false,
      maxBreadcrumbs: 0,
      skipOpenTelemetrySetup: true,
    });
    // No request data, HTTP, console or local-variable integrations: those are what would
    // carry bodies, tokens, webhook URLs and reset links to Sentry.
    const names = (options.integrations as { name: string }[]).map((integration) => integration.name);
    expect(names).not.toEqual(expect.arrayContaining(["RequestData"]));
    expect(names).toEqual(
      expect.arrayContaining(["LinkedErrors", "OnUncaughtException", "OnUnhandledRejection"]),
    );
    expect(Sentry.onUnhandledRejectionIntegration).toHaveBeenCalledWith({ mode: "strict" });
  });

  it("cuts every exception message on an event to its first line, as the log does", () => {
    initErrorReporting({ SENTRY_DSN: "https://public@o0.ingest.sentry.io/1" });
    expect(jest.mocked(Sentry.init).mock.calls[0][0]).toMatchObject({ beforeSend: keepFirstLines });

    // Prisma's default format: the failed query, a short code frame, then its arguments.
    // All of it fits in 250 characters, so the length cap alone would send the lead.
    const prisma = [
      "",
      "Invalid `tx.lead.create()` invocation in",
      "/var/task/dist/leads.js:88:31",
      "",
      "  87 const lead = await",
      "-> 88   tx.lead.create({",
      "         data: {",
      '           name: "Priya Sharma",',
      '           phone: "+919876543210",',
      "           city: undefined",
      "         }",
      "       })",
      "Argument `city` must not be undefined.",
    ].join("\n");
    expect(prisma.indexOf("9876543210")).toBeLessThan(250);

    const event = {
      exception: {
        values: [
          { type: "PrismaClientValidationError", value: prisma },
          // A linked cause is an exception on the same event, and is cut the same way.
          { type: "Error", value: `  \r\nconnect ECONNREFUSED\r\nat ${"x".repeat(300)}` },
          { type: "Error" },
        ],
      },
    };
    const sent = keepFirstLines(event);

    expect(sent).toBe(event);
    expect(sent.exception.values).toEqual([
      { type: "PrismaClientValidationError", value: "Invalid `tx.lead.create()` invocation in" },
      { type: "Error", value: "connect ECONNREFUSED" },
      { type: "Error" },
    ]);
    expect(JSON.stringify(sent)).not.toContain("9876543210");
    expect(JSON.stringify(sent)).not.toContain("Priya");

    // An event with no exception, such as a reported message, passes untouched.
    expect(keepFirstLines({})).toEqual({});
  });

  it("keeps at most 200 characters of a single long line", () => {
    const event = keepFirstLines({ exception: { values: [{ value: "y".repeat(500) }] } });
    expect(event.exception.values[0].value).toHaveLength(200);
  });

  it("names the environment from SENTRY_ENVIRONMENT first, so DEV, QA and UAT differ", () => {
    initErrorReporting({
      SENTRY_DSN: "https://public@o0.ingest.sentry.io/1",
      SENTRY_ENVIRONMENT: "uat",
      VERCEL_ENV: "preview",
    });
    expect(jest.mocked(Sentry.init).mock.calls[0][0]).toMatchObject({ environment: "uat" });
  });

  it("reports with the request's identifiers as tags and the user by id only, then flushes", () => {
    initErrorReporting({ SENTRY_DSN: "https://public@o0.ingest.sentry.io/1" });
    const error = new Error("boom");

    reportException(error, {
      method: "POST",
      route: "/api/leads/import",
      tenantId: "tenant-1",
      userId: "user-1",
      apiKeyId: "key-9",
      requestId: "bom1::abc",
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      level: "error",
      tags: {
        method: "POST",
        route: "/api/leads/import",
        tenantId: "tenant-1",
        apiKeyId: "key-9",
        requestId: "bom1::abc",
      },
      user: { id: "user-1" },
      extra: undefined,
    });
    expect(Sentry.flush).toHaveBeenCalledWith(2_000);
  });

  it("reports a message at the level asked for", () => {
    initErrorReporting({ SENTRY_DSN: "https://public@o0.ingest.sentry.io/1" });

    reportMessage("Platform email failed", "warning", {
      tags: { mailKind: "reset" },
      extra: { reason: "Brevo refused the email (HTTP 401)" },
    });

    expect(Sentry.captureMessage).toHaveBeenCalledWith("Platform email failed", {
      level: "warning",
      tags: { mailKind: "reset" },
      user: undefined,
      extra: { reason: "Brevo refused the email (HTTP 401)" },
    });
  });
});
