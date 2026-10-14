import "reflect-metadata";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { initErrorReporting } from "./common/error-reporting";
import { configureHttpPipeline } from "./common/http-pipeline";
import { runningOnVercel } from "./runtime/vercel";

async function bootstrap(): Promise<void> {
  // Before anything that can fail, so a boot that dies — a database that never answers —
  // reaches Sentry too. Does nothing unless SENTRY_DSN is set.
  initErrorReporting();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api");

  if (runningOnVercel()) {
    // Vercel replaces X-Forwarded-For with the caller's real address and drops any value the
    // client sent, so there the header is a fact rather than a claim, and request.ip should
    // read it instead of reporting Vercel's own proxy.
    app.set("trust proxy", true);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips properties no DTO declares. This is a security control, not tidiness: it
      // is what stops a caller smuggling `tenantId` or `role` into a create body and
      // having Prisma accept it.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Security headers, CORS and the lead import's larger body limit. Shared with the e2e
  // tests, and it has to come before listen(), which is when Nest adds its own parsers.
  configureHttpPipeline(app);

  // Nest's default is to leave the process running after a SIGTERM until in-flight work
  // finishes on its own; enabling shutdown hooks is what lets PrismaService disconnect.
  app.enableShutdownHooks();

  // Vercel tells the function which port to serve on. Everywhere else the API keeps its own
  // API_PORT, so a PORT meant for the web app's dev server never moves it.
  const port = Number((runningOnVercel() && process.env.PORT) || config.get("API_PORT", 4000));
  await listenWithRetry(app, port);

  new Logger("Bootstrap").log(`API listening on http://localhost:${port}/api`);
}

/**
 * Binds the port, waiting out a predecessor that has not let go of it yet.
 *
 * In watch mode the compiler starts the new process as soon as it has emitted, which on
 * Windows is regularly before the old one has finished closing its listener. Without this
 * the new process dies on EADDRINUSE and the watcher does not try again — leaving no API
 * running at all, and a developer debugging a "broken" endpoint that is simply not
 * served. Anything other than EADDRINUSE is a real failure and is rethrown at once.
 */
async function listenWithRetry(app: INestApplication, port: number, attempts = 10): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await app.listen(port);
      return;
    } catch (error) {
      const inUse = (error as NodeJS.ErrnoException)?.code === "EADDRINUSE";
      if (!inUse || attempt >= attempts) throw error;
      if (attempt === 1) {
        new Logger("Bootstrap").warn(`Port ${port} is still held; waiting for it to free up`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

void bootstrap().catch((error: unknown) => {
  // bufferLogs holds every line until listen() succeeds, and a boot that fails never gets
  // there — so without this the database retry warnings and the reason for giving up
  // vanish with the process. The error is rethrown to fail the boot exactly as before.
  Logger.flush();
  throw error;
});
