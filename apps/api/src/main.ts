import "reflect-metadata";
import { Logger, ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api");

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

  const origins = config
    .get<string>("API_CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({ origin: origins, credentials: true });

  // Nest's default is to leave the process running after a SIGTERM until in-flight work
  // finishes on its own; enabling shutdown hooks is what lets PrismaService disconnect.
  app.enableShutdownHooks();

  const port = Number(config.get("API_PORT", 4000));
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

void bootstrap();
