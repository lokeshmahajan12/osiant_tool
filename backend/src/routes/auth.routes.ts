import { Router } from "express";
import { authRateLimiter } from "../middleware/security";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import * as auth from "../controllers/auth.controller";
import { registerRateLimiter } from "../middleware/security";

const router = Router();

router.post("/login", authRateLimiter, asyncHandler(auth.handleLogin));
router.post("/register", registerRateLimiter, asyncHandler(auth.handleRegister));

router.use(requireAuth);
router.post("/logout", asyncHandler(auth.handleLogout));
router.get("/me", asyncHandler(auth.handleMe));
router.patch("/me/password", asyncHandler(auth.handleChangePassword));

export default router;
