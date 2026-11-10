import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as monitoring from "../controllers/monitoring.controller";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/live-users", asyncHandler(monitoring.handleLiveUsers));
router.get("/live-map", asyncHandler(monitoring.handleLiveMap));
router.post("/users/:id/monitor/start", asyncHandler(monitoring.handleMonitorStart));
router.post("/users/:id/monitor/stop", asyncHandler(monitoring.handleMonitorStop));
router.post("/users/:id/suspend", asyncHandler(monitoring.handleSuspend));
router.post("/users/:id/monitor/enable", asyncHandler(monitoring.handleReEnable));
router.post("/users/:id/logout", asyncHandler(monitoring.handleForceLogout));
router.post("/users/:id/revoke", asyncHandler(monitoring.handleRevokeAuthorization));
router.delete("/users/:id/location/history", asyncHandler(monitoring.handleDeleteLocationHistory));
router.delete("/users/:id/sessions", asyncHandler(monitoring.handleDeleteSessionData));

export default router;
