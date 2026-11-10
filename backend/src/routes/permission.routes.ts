import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as permission from "../controllers/permission.controller";

const router = Router();

router.use(requireAuth);
router.get("/", asyncHandler(permission.handleGetMyPermissions));
router.post("/:type", asyncHandler(permission.handleUpdatePermission));

export default router;
