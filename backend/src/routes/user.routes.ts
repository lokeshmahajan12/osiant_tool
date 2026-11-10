import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as user from "../controllers/user.controller";

const router = Router();

router.use(requireAuth);

// Any authenticated user can view their own portal summary.
router.get("/me/summary", asyncHandler(user.handleSelfSummary));

// Directory + profiles are ADMIN-only (server-side RBAC).
router.get("/", requireRole("ADMIN"), asyncHandler(user.handleDirectory));
router.get("/:id", requireRole("ADMIN"), asyncHandler(user.handleUserProfile));
router.patch("/:id/status", requireRole("ADMIN"), asyncHandler(user.handleUpdateStatus));

export default router;
