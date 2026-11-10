import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { securityMiddleware, globalRateLimiter } from "./middleware/security";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import investigationRoutes from "./routes/investigation.routes";
import providerRoutes from "./routes/provider.routes";
import settingsRoutes from "./routes/settings.routes";
import auditRoutes from "./routes/audit.routes";
import systemRoutes from "./routes/system.routes";
import deviceRoutes from "./routes/device.routes";
import enrollmentRoutes, { enrollPublicRouter } from "./routes/enrollment.routes";
import permissionRoutes from "./routes/permission.routes";
import cameraRoutes from "./routes/camera.routes";
import userRoutes from "./routes/user.routes";
import monitoringRoutes from "./routes/monitoring.routes";
import userLocationRoutes from "./routes/userLocation.routes";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.startsWith("/api/health") ?? false } }));
  app.use(securityMiddleware);
  app.use(globalRateLimiter);
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (_req, res) => {
    res.json({ name: "SENTINEL OSINT API", docs: "/api/health", mode: process.env.NODE_ENV });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/investigations", investigationRoutes);
  app.use("/api/providers", providerRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/devices", deviceRoutes);
  app.use("/api/enrollments", enrollmentRoutes);
  app.use("/api/enroll", enrollPublicRouter);
  app.use("/api/permissions", permissionRoutes);
  app.use("/api/camera", cameraRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/admin", monitoringRoutes);
  app.use("/api/location", userLocationRoutes);
  app.use("/api", systemRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
