import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requireDeviceToken, requireLocationControl } from "../middleware/deviceAuth";
import { locationPushRateLimiter, locationAdminRateLimiter } from "../middleware/security";
import { asyncHandler } from "../middleware/errorHandler";
import * as loc from "../controllers/location.controller";

const router = Router();

// ---- Device-token authenticated routes (mobile client, no JWT) -------------
router.get("/me", requireDeviceToken, asyncHandler(loc.handleDeviceMe));
router.get("/me/diagnostics", requireDeviceToken, asyncHandler(loc.handleDeviceDiagnostics));
router.post("/:deviceId/location", requireDeviceToken, locationPushRateLimiter, asyncHandler(loc.handlePushLocation));
router.put("/:deviceId/heartbeat", requireDeviceToken, locationPushRateLimiter, asyncHandler(loc.handleHeartbeat));
router.post("/:id/location/permission", requireLocationControl, locationAdminRateLimiter, asyncHandler(loc.handlePermission));
router.post("/:id/location/consent", requireLocationControl, locationAdminRateLimiter, asyncHandler(loc.handleRecordConsent));
router.post("/:id/location/start", requireLocationControl, locationAdminRateLimiter, asyncHandler(loc.handleStart));
router.post("/:id/location/stop", requireLocationControl, locationAdminRateLimiter, asyncHandler(loc.handleStop));
// Privacy control from the device itself (device-token authenticated).
router.delete("/:id/location/history", requireLocationControl, locationAdminRateLimiter, asyncHandler(loc.handleHistoryDeleteSelf));

// ---- Dashboard (JWT) routes --------------------------------------------------
router.use(requireAuth);

router.post("/", requireRole("INVESTIGATOR", "ADMIN"), locationAdminRateLimiter, asyncHandler(loc.handleEnroll));
router.get("/", asyncHandler(loc.handleList));
router.get("/:id", asyncHandler(loc.handleGet));
router.patch("/:id", asyncHandler(loc.handleUpdate));
router.delete("/:id", asyncHandler(loc.handleDelete));
router.get("/:id/location/status", asyncHandler(loc.handleStatus));
router.get("/:id/location/history", asyncHandler(loc.handleHistory));
router.get("/:id/location/history/export", asyncHandler(loc.handleHistoryExport));
router.delete("/:id/location/history", asyncHandler(loc.handleHistoryDelete));

export default router;
