/**
 * Fails the boot on a missing or malformed environment variable, rather than the first
 * request that happens to need it. A JWT secret that is absent in production is a
 * catastrophe discovered at 3am; the same secret absent at startup is a crash loop with
 * a clear message.
 */

const REQUIRED = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;

const DURATION = /^\d+\s*(ms|s|m|h|d)$/;

const INSECURE_DEFAULTS = new Set([
  "dev-access-secret-change-me",
  "dev-refresh-secret-change-me",
]);

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env at the repository root.`,
    );
  }

  const accessSecret = String(config.JWT_ACCESS_SECRET);
  const refreshSecret = String(config.JWT_REFRESH_SECRET);

  if (accessSecret === refreshSecret) {
    // Separate secrets are the reason a leaked access-token secret cannot be used to
    // mint refresh tokens. Sharing one quietly removes that property.
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values");
  }

  if (config.NODE_ENV === "production") {
    const insecure = [accessSecret, refreshSecret].filter((secret) =>
      INSECURE_DEFAULTS.has(secret),
    );
    if (insecure.length > 0) {
      throw new Error("Refusing to start in production with the example JWT secrets");
    }
    if (accessSecret.length < 32 || refreshSecret.length < 32) {
      throw new Error("JWT secrets must be at least 32 characters in production");
    }
  }

  for (const key of ["JWT_ACCESS_TTL", "JWT_REFRESH_TTL"] as const) {
    const value = config[key];
    if (value !== undefined && !DURATION.test(String(value))) {
      throw new Error(`${key} must look like "15m", "24h" or "7d" — got "${String(value)}"`);
    }
  }

  return config;
}
