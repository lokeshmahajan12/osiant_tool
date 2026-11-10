import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { investigationRateLimiter } from "../middleware/security";
import * as inv from "../controllers/investigation.controller";

const router = Router();

router.use(requireAuth);

router.post("/", investigationRateLimiter, asyncHandler(inv.handleCreate));
router.get("/", asyncHandler(inv.handleList));
router.get("/export", asyncHandler(inv.handleExportHistory));
router.delete("/", asyncHandler(inv.handleDeleteAll));
router.delete("/purge-expired", requireRole("ADMIN"), asyncHandler(inv.handlePurge));
router.get("/:id", asyncHandler(inv.handleGet));
router.delete("/:id", asyncHandler(inv.handleDelete));
router.get("/:id/export", asyncHandler(inv.handleExport));
router.get("/:id/report", asyncHandler(inv.handleReport));

export default router;
