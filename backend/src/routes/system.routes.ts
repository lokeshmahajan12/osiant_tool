import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as admin from "../controllers/admin.controller";
import * as health from "../controllers/health.controller";
import { handleListAudit } from "../controllers/audit.controller";

const router = Router();

router.get("/ping", asyncHandler(health.handlePing));
router.get("/health", requireAuth, asyncHandler(health.handleHealth));
router.post("/log", requireAuth, asyncHandler(health.handleLogDrain));

const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));
adminRouter.get("/users", asyncHandler(admin.handleListUsers));
adminRouter.post("/users", asyncHandler(admin.handleCreateUser));
adminRouter.patch("/users/:id/active", asyncHandler(admin.handleSetActive));
adminRouter.get("/audit-logs", asyncHandler(handleListAudit));

router.use("/admin", adminRouter);

export default router;
