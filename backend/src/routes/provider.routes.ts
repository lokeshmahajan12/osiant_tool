import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as provider from "../controllers/provider.controller";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(provider.handleList));
router.post("/:name/toggle", requireRole("INVESTIGATOR", "ADMIN"), asyncHandler(provider.handleToggle));
router.post("/:name/test", requireRole("INVESTIGATOR", "ADMIN"), asyncHandler(provider.handleTest));

export default router;
