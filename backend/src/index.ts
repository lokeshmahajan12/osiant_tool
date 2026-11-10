import net from "node:net";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { attachSocketServer } from "./lib/ws";
import { presenceManager } from "./services/location.presence";
import { startRetentionSweeper, stopRetentionSweeper } from "./services/data.retention";

function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection({ host, port });
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

async function main() {
  if (await probePort(env.HOST, env.PORT)) {
    logger.warn(
      { port: env.PORT, host: env.HOST },
      "Another SENTINEL backend instance is already running on this port. Stop the other 'npm run dev' instance before starting a new one."
    );
    process.exit(0);
  }

  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { port: env.PORT, host: env.HOST, env: env.NODE_ENV, mode: env.MOCK_MODE ? "mock" : "live" },
      "SENTINEL OSINT API started"
    );
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.warn(
        { port: env.PORT, host: env.HOST },
        "Port already in use by another process. Stop the other 'npm run dev' instance before starting a new one."
      );
      process.exit(0);
    }
    throw err;
  });

  attachSocketServer(server);
  void presenceManager.start();
  startRetentionSweeper();

  async function shutdown(signal: string) {
    logger.info({ signal }, "shutting down");
    presenceManager.stop();
    stopRetentionSweeper();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
