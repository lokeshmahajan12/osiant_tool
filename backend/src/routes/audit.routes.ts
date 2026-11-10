import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as audit from "../controllers/audit.controller";

const router = Router();

router.use(requireAuth);
router.get("/", asyncHandler(audit.handleListAudit));

export default router;
