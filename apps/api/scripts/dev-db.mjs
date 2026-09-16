/**
 * A Postgres server for local development that needs nothing installed.
 *
 * `docker-compose up -d` remains the documented path and is what CI and production
 * resemble. This exists for the case that path does not cover: a machine with no Docker,
 * where the alternative is not "a slightly different database" but no database at all,
 * and therefore no migrations, no seed and no way to run the API.
 *
 * PGlite is real PostgreSQL compiled to WebAssembly, so the things a lesser stand-in
 * would break on — enums, text[] columns, transactions, foreign keys, `SELECT … FOR
 * UPDATE` — behave as they will in production. `@electric-sql/pglite-socket` puts it
 * behind the Postgres wire protocol on a TCP port, which means Prisma connects to it
 * with an ordinary DATABASE_URL and neither the schema nor a single line of application
 * code knows the difference.
 *
 * What it is not: a production database. It is single-connection and single-process, so
 * concurrency behaves differently under load, and the data lives in a local directory
 * that is not backed up. Never point a deployed environment at this.
 *
 * ── Why this file has two halves ────────────────────────────────────────────────────
 *
 * The socket layer in front of PGlite wedges. Not often, but reliably enough to matter:
 * kill the API mid-query — which `nest start --watch` effectively does on every file
 * change — and the server can be left holding connections it still counts as live while
 * refusing every new one. The process stays up and logs nothing. What you see is a
 * database that says "listening" and an API that cannot reach it.
 *
 * Recovering in-process does not work: `server.stop()` waits for those connections to
 * close, and the wedged ones never do, so the recovery hangs and leaves nothing
 * listening at all — strictly worse than the fault. A process, on the other hand, can
 * always be killed, and killing it always returns the port. So this script runs as a
 * supervisor that spawns itself as a child, watches the child over a real socket, and
 * replaces it when it stops answering. The data directory is on disk, so a fresh child
 * picks up exactly where the last one left off.
 *
 *   node scripts/dev-db.mjs            # persists to .pglite/
 *   node scripts/dev-db.mjs --memory   # throwaway, for tests
 */
import { fork } from "node:child_process";
import { connect } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(args);

const inMemory = flags.has("--memory");
const port = Number(process.env.DEV_DB_PORT ?? 5432);
const role = process.env.DEV_DB_ROLE ?? "appsgain";
const dataDir = resolve(join(here, "..", ".pglite"));

if (process.env.DEV_DB_CHILD === "1") {
  await runServer();
} else {
  await supervise();
}

// ── the child: the database itself ───────────────────────────────────────────────────

async function runServer() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

  if (!inMemory) mkdirSync(dataDir, { recursive: true });

  const db = await PGlite.create(inMemory ? undefined : dataDir);

  // Prisma connects as whatever user the URL names and expects that role to exist. PGlite
  // starts with only `postgres`, so the role from .env is created up front — otherwise the
  // first connection fails with an error that reads like a password problem and is not.
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} WITH LOGIN SUPERUSER PASSWORD '${role}';
      END IF;
    END
    $$;
  `);

  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
    // `maxConnections` defaults to 1, which is not enough for anything real: Prisma opens
    // a pool, and a migration followed by a seed is already two clients. PGlite still
    // executes one query at a time — the server queues them — so this raises the number of
    // sockets it will hold open, not the concurrency of the engine underneath.
    maxConnections: Number(process.env.DEV_DB_MAX_CONNECTIONS ?? 40),
    // Reap sockets the API left behind when the watcher restarted it. This helps, but it
    // is not sufficient on its own, which is what the supervisor above is for.
    idleTimeout: Number(process.env.DEV_DB_IDLE_TIMEOUT_MS ?? 20_000),
  });

  server.addEventListener("error", (event) => {
    console.warn("dev database error:", event?.detail?.message ?? event);
  });

  await server.start();

  console.log(`dev database listening on 127.0.0.1:${port}`);
  console.log(inMemory ? "storage: in-memory (discarded on exit)" : `storage: ${dataDir}`);
  console.log("this is a development convenience — never point a deployment at it");

  const shutdown = async () => {
    try {
      await server.stop();
      await db.close();
    } catch {
      /* going away regardless */
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("disconnect", () => void shutdown());
}

// ── the parent: keep one of those alive ──────────────────────────────────────────────

async function supervise() {
  let child = null;
  let stopping = false;
  let replacing = false;

  const spawnChild = () =>
    new Promise((resolveSpawn) => {
      const next = fork(fileURLToPath(import.meta.url), args, {
        env: { ...process.env, DEV_DB_CHILD: "1" },
        stdio: "inherit",
      });
      next.on("exit", (code, signal) => {
        if (stopping || replacing) return;
        console.warn(`dev database: the server exited (${signal ?? code}); starting a new one`);
        void replace("it exited");
      });
      resolveSpawn(next);
    });

  /**
   * Replaces the running server.
   *
   * SIGTERM first, so the child can close PGlite cleanly and flush to disk, then SIGKILL
   * if it has not gone within a couple of seconds — which is exactly the case this exists
   * for, because a wedged server is one that will not shut down when asked.
   */
  async function replace(reason) {
    if (replacing || stopping) return;
    replacing = true;
    console.warn(`dev database: ${reason} — restarting the server`);

    if (child) {
      const dying = child;
      dying.kill("SIGTERM");
      await Promise.race([
        new Promise((done) => dying.once("exit", done)),
        new Promise((done) => setTimeout(done, 2_000)),
      ]);
      if (!dying.killed || dying.exitCode === null) dying.kill("SIGKILL");
      // The OS does not always hand the port back on the same tick.
      await new Promise((done) => setTimeout(done, 500));
    }

    child = await spawnChild();
    replacing = false;
  }

  /**
   * Asks the listener, over a real socket, whether it will still talk Postgres.
   *
   * Deliberately not a query through PGlite: the WASM database is almost never the thing
   * that fails. What fails is the socket layer in front of it, and a query issued inside
   * the child would report perfect health while every client outside it has its
   * connection reset.
   *
   * The probe sends a real StartupMessage rather than the shorter SSLRequest. That is not
   * a detail — this server answers SSLRequest by closing the connection, so an
   * SSLRequest probe reports a *healthy* server as dead, and a supervisor acting on that
   * restarts the database in a loop. Ask the question the server actually answers.
   */
  function probe(timeoutMs = 4_000) {
    return new Promise((done) => {
      const socket = connect(port, "127.0.0.1");
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        done(ok);
      };

      socket.setTimeout(timeoutMs);
      socket.on("connect", () => {
        const params = Buffer.from(`user\0${role}\0database\0postgres\0\0`, "latin1");
        const packet = Buffer.alloc(8 + params.length);
        packet.writeInt32BE(8 + params.length, 0);
        // Protocol 3.0.
        packet.writeInt32BE(196608, 4);
        params.copy(packet, 8);
        socket.write(packet);
      });

      // 'R' is an authentication request, 'E' an error response. Either is the server
      // speaking Postgres, which is all this needs to establish.
      socket.on("data", (chunk) => {
        const first = String.fromCharCode(chunk[0]);
        finish(first === "R" || first === "E");
      });
      socket.on("timeout", () => finish(false));
      socket.on("error", () => finish(false));
      socket.on("close", () => finish(false));
    });
  }

  child = await spawnChild();

  // Three consecutive failures, not one. A probe can lose a race with an ordinary start-up,
  // and a supervisor that acts on a single bad reading does more damage than the fault it
  // is there to repair.
  let consecutiveFailures = 0;
  const watchdog = setInterval(async () => {
    if (replacing || stopping) return;
    if (await probe()) {
      consecutiveFailures = 0;
      return;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures < 3) return;
    consecutiveFailures = 0;
    await replace("connections are being refused");
  }, Number(process.env.DEV_DB_PROBE_MS ?? 15_000));

  const shutdown = (signal) => {
    stopping = true;
    clearInterval(watchdog);
    console.log(`\n${signal} — stopping dev database`);
    child?.kill("SIGTERM");
    setTimeout(() => {
      child?.kill("SIGKILL");
      process.exit(0);
    }, 1_500);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
