import type { Server as HttpServer } from "node:http";
import type { Socket } from "socket.io";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { hashToken } from "../middleware/auth";
import { isOriginAllowed } from "../middleware/security";
import { logger } from "./logger";

let io: Server | null = null;

interface WsUser {
  id: string;
  email: string;
  name: string;
  role: "ANALYST" | "INVESTIGATOR" | "ADMIN" | "USER";
}

/** Attach the Socket.IO server to the running HTTP server. */
export function attachSocketServer(server: HttpServer): Server {
  if (io) return io;

  io = new Server(server, {
    path: "/socket.io",
    serveClient: false,
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");
      if (typeof token !== "string" || !token) {
        next(new Error("unauthorized"));
        return;
      }
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
        next(new Error("unauthorized"));
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) {
        next(new Error("unauthorized"));
        return;
      }
      socket.data.user = { id: user.id, email: user.email, name: user.name, role: user.role } satisfies WsUser;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as WsUser;
    socket.join(`user:${user.id}`);
    if (user.role === "ADMIN") socket.join("admins");
    socket.emit("connection:ready", { userId: user.id, role: user.role });
    // Emit the documented USER_CONNECTED / USER_DISCONNECTED contract.
    if (user.role === "USER") {
      emitEvent(["admins"], "user:connected", { userId: user.id, timestamp: new Date().toISOString() });
    }
    logger.info({ userId: user.id }, "websocket connected");
    socket.on("disconnect", () => {
      if (user.role === "USER") {
        emitEvent(["admins"], "user:disconnected", { userId: user.id, timestamp: new Date().toISOString() });
      }
      logger.info({ userId: user.id }, "websocket disconnected");
    });
  });

  return io;
}

export function getSocketServer(): Server | null {
  return io;
}

/** Broadcast an event to an explicit set of rooms. No-op when WS is not attached. */
export function emitEvent(rooms: string[], event: string, payload: unknown): void {
  if (!io) return;
  for (const room of rooms) io.to(room).emit(event, payload);
}

/** Emit to the device owner's dashboard room plus the admin room. */
export function emitToOwner(ownerId: string, event: string, payload: unknown): void {
  emitEvent([`user:${ownerId}`, "admins"], event, payload);
}

/**
 * Emit an alias under the documented SENTINEL event contract so frontends can
 * subscribe to either naming. Maps the domain events to a single room set.
 */
export function emitContractEvent(ownerId: string, event: string, payload: unknown): void {
  const aliases: Record<string, string[]> = {
    LOCATION_UPDATE: ["location:update"],
    PERMISSION_UPDATED: ["permission:updated"],
    SESSION_STARTED: ["location:started", "session:started"],
    SESSION_ENDED: ["location:stopped", "session:ended"],
    ADMIN_MONITOR_STARTED: ["admin:monitor-started"],
    ADMIN_MONITOR_STOPPED: ["admin:monitor-stopped"],
    USER_SUSPENDED: ["admin:user-suspended"],
    USER_LOGGED_OUT: ["admin:user-logged-out"],
    CAMERA_SESSION_STARTED: ["camera:started"],
    CAMERA_SESSION_ENDED: ["camera:ended"],
  };
  for (const alias of aliases[event] ?? [event]) {
    emitToOwner(ownerId, alias, payload);
  }
}
