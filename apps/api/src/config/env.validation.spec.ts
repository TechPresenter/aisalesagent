import { validateEnv } from "./env.validation";

/**
 * Every Vercel deployment — DEV, QA and UAT as well as LIVE — runs with NODE_ENV=production,
 * so these rules decide whether a misconfigured environment refuses to boot with a clear
 * message or boots and fails later on the first reset email or 2FA setup.
 */

const DEVELOPMENT = {
  DATABASE_URL: "postgresql://appsgain:appsgain@localhost:5432/appsgain",
  JWT_ACCESS_SECRET: "dev-access-secret-change-me",
  JWT_REFRESH_SECRET: "dev-refresh-secret-change-me",
};

const PRODUCTION = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@db.example.com/appsgain?sslmode=require",
  JWT_ACCESS_SECRET: "a".repeat(48),
  JWT_REFRESH_SECRET: "b".repeat(48),
  CREDENTIALS_ENCRYPTION_KEY: "c".repeat(48),
  API_CORS_ORIGINS: "https://app.appsgain.app",
  WEB_APP_URL: "https://app.appsgain.app",
};

describe("validateEnv", () => {
  it("lets development run on the example values", () => {
    expect(() => validateEnv(DEVELOPMENT)).not.toThrow();
  });

  it("accepts a complete production configuration", () => {
    expect(() => validateEnv(PRODUCTION)).not.toThrow();
    expect(() => validateEnv({ ...PRODUCTION, CRON_SECRET: "d".repeat(48) })).not.toThrow();
  });

  it.each(["CREDENTIALS_ENCRYPTION_KEY", "API_CORS_ORIGINS", "WEB_APP_URL"])(
    "names %s when production is missing it",
    (key) => {
      const config: Record<string, unknown> = { ...PRODUCTION };
      delete config[key];
      expect(() => validateEnv(config)).toThrow(key);
    },
  );

  it("refuses the example credentials key in production", () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, CREDENTIALS_ENCRYPTION_KEY: "dev-credentials-key-change-me-at-least-32-chars" }),
    ).toThrow("example CREDENTIALS_ENCRYPTION_KEY");
  });

  it("refuses a short credentials key in production", () => {
    expect(() => validateEnv({ ...PRODUCTION, CREDENTIALS_ENCRYPTION_KEY: "too-short" })).toThrow("at least 32");
  });

  it("refuses a guessable CRON_SECRET in production", () => {
    expect(() => validateEnv({ ...PRODUCTION, CRON_SECRET: "cron" })).toThrow("CRON_SECRET");
  });
});
