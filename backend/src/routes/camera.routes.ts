import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { cameraRateLimiter } from "../middleware/security";
import { asyncHandler } from "../middleware/errorHandler";
import * as camera from "../controllers/camera.controller";

const router = Router();

// User-facing camera session endpoints (the USER's own device).
router.use(requireAuth);
router.get("/me", asyncHandler(camera.handleMyStatus));
router.get("/history", asyncHandler(camera.handleMyHistory));
router.post("/start", cameraRateLimiter, asyncHandler(camera.handleStart));
router.post("/:id/end", cameraRateLimiter, asyncHandler(camera.handleEnd));

// ADMIN camera oversight endpoints.
const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));
adminRouter.get("/camera-sessions", asyncHandler(camera.handleAdminListSessions));
adminRouter.get("/camera/:userId/status", asyncHandler(camera.handleAdminUserStatus));
adminRouter.post("/camera/:userId/:sessionId/end", cameraRateLimiter, asyncHandler(camera.handleAdminEnd));

router.use("/admin", adminRouter);

export default router;
