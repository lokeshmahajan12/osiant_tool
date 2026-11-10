import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { enrollmentRateLimiter, locationAdminRateLimiter } from "../middleware/security";
import * as ctrl from "../controllers/enrollment.controller";

const router = Router();

// Dashboard (JWT) management of enrollment links.
router.use(requireAuth);
router.post("/", requireRole("INVESTIGATOR", "ADMIN"), locationAdminRateLimiter, asyncHandler(ctrl.handleCreate));
router.get("/", asyncHandler(ctrl.handleList));
router.post("/:id/revoke", locationAdminRateLimiter, asyncHandler(ctrl.handleRevoke));

export default router;

/** Public, rate-limited enrollment-link endpoints (mounted under /api/enroll). */
export const enrollPublicRouter = Router();
enrollPublicRouter.get("/:token", enrollmentRateLimiter, asyncHandler(ctrl.handleGetInfo));
enrollPublicRouter.post("/:token", enrollmentRateLimiter, asyncHandler(ctrl.handleRedeem));
