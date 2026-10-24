import { PayloadTooLargeException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { json, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";

/**
 * The request pipeline in front of every route: security headers, CORS, and the body
 * limits. main.ts and the e2e tests' createTestApp both call this, so the tests exercise
 * the pipeline that ships rather than a copy of it.
 *
 * Must run before the application is initialised — before `listen()` or `init()` — for
 * the reason given at leadImportBodyParser.
 */
export function configureHttpPipeline(app: NestExpressApplication): void {
  // Helmet removes the header too; disabling it at the source means no route can bring
  // it back. "X-Powered-By: Express" tells a scanner which exploits to try first.
  app.disable("x-powered-by");

  app.use(
    helmet({
      // Helmet's default policy is written for HTML pages. Nothing here is a page — every
      // answer is JSON, CSV or a redirect — so the right policy is "load nothing, and
      // never be framed": a response opened in a tab by mistake, or one an attacker
      // tricks a browser into rendering, can then run nothing at all.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      frameguard: { action: "deny" },
    }),
  );
  app.use(RECORDING_AUDIO_PATH, allowCrossOriginAudio);

  app.enableCors({
    origin: corsOrigins(app.get(ConfigService)),
    credentials: true,
    // The web app polls several endpoints, and every authenticated call is a non-simple
    // request that would otherwise be preceded by its own OPTIONS round trip. Two hours
    // is the most Chromium will cache a preflight for; Firefox allows more.
    maxAge: 7_200,
  });

  app.use(LEAD_IMPORT_PATH, leadImportBodyParser);
}

/** API_CORS_ORIGINS, comma-separated. Production refuses to boot without it (env.validation.ts). */
function corsOrigins(config: ConfigService): string[] {
  return config
    .get<string>("API_CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * The largest body a lead import may send. Every other route keeps Nest's 100 KB.
 *
 * A CSV of 10,000 leads (MAX_IMPORT_ROWS) is roughly 1 MB, and 5,000 rows about 430 KB
 * once wrapped in JSON — both far over 100 KB, which used to answer 413 to all but the
 * smallest files. 4 MB matches MAX_IMPORT_CSV_LENGTH, and stays under the 4.5 MB Vercel
 * accepts for a function's request body at all, so an over-large file gets this API's
 * message rather than Vercel's.
 */
export const LEAD_IMPORT_BODY_LIMIT = "4mb";

/** Includes the global prefix: middleware sees the URL before Nest's router strips it. */
export const LEAD_IMPORT_PATH = "/api/leads/import";

const leadImportJson = json({ limit: LEAD_IMPORT_BODY_LIMIT });

/**
 * Parses the import body with the larger limit, ahead of Nest's own parser.
 *
 * Nest registers its 100 KB parsers when the app initialises, after this one, and they
 * skip a body that has already been parsed — so this route gets 4 MB and every other
 * route keeps 100 KB.
 *
 * It must be a named function and never `json()` passed straight to `app.use`. Nest
 * decides whether to install its JSON parser by looking for any middleware whose
 * function is named `jsonParser`, which is what `json()` returns; finding one here, it
 * would skip its own, and every route but this one would receive an empty body.
 *
 * Middleware runs before the guards, so this would read and parse 4 MB for anyone at
 * all. A request that presents no credential is left to Nest's 100 KB parser instead:
 * a small one then gets JwtAuthGuard's 401, a large one a 413, and neither costs a 4 MB
 * parse. One with a credential is parsed here whether or not the credential is valid —
 * telling those apart is the guard's job, after the body is read.
 */
function leadImportBodyParser(request: Request, response: Response, next: NextFunction): void {
  if (!presentsCredential(request)) {
    next();
    return;
  }

  leadImportJson(request, response, (error?: unknown) => {
    if ((error as { type?: unknown } | undefined)?.type === "entity.too.large") {
      next(
        new PayloadTooLargeException(
          "The file is too large to import in one go. Split it into smaller files and import them one after another.",
        ),
      );
      return;
    }
    next(error);
  });
}

/**
 * Whether the request carries something JwtAuthGuard would check: a bearer token (an
 * access token or an `agk_` API key) or an `X-API-Key` header. Presence only.
 */
function presentsCredential(request: Request): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && /^Bearer\s+\S/i.test(authorization)) return true;
  const apiKey = request.headers["x-api-key"];
  return typeof apiKey === "string" && apiKey.trim() !== "";
}

/**
 * The signed recording link is played by an <audio> element on the web app, which is a
 * different site from the API (two *.vercel.app projects). That is a no-cors request, so
 * Helmet's same-origin Cross-Origin-Resource-Policy would stop the browser using the
 * response at all. The signature in the link is the credential there (see
 * RecordingsController.audio), so letting another site load it gives nothing away.
 */
const RECORDING_AUDIO_PATH = /^\/api\/recordings\/[^/]+\/audio$/;

function allowCrossOriginAudio(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
}
