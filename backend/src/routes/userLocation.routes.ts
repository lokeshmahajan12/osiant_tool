import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { locationPushRateLimiter, locationAdminRateLimiter } from "../middleware/security";
import { asyncHandler } from "../middleware/errorHandler";
import * as userLoc from "../controllers/userLocation.controller";

const router = Router();

router.use(requireAuth);

router.post("/session/start", locationAdminRateLimiter, asyncHandler(userLoc.handleSessionStart));
router.post("/session/stop", locationAdminRateLimiter, asyncHandler(userLoc.handleSessionStop));
router.post("/update", locationPushRateLimiter, asyncHandler(userLoc.handleLocationUpdate));
router.get("/:userId/history", locationAdminRateLimiter, asyncHandler(userLoc.handleUserHistory));

export default router;
