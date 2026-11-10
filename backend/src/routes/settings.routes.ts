import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as settings from "../controllers/settings.controller";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(settings.handleGetSettings));
router.patch("/", asyncHandler(settings.handleUpdateSettings));

export default router;
