import express from "express";
import { startGoogle, googleCallback } from "../controllers/google.controller.js";
import { getMe, login, logout, signup } from "../controllers/auth.controller.js";
import { protectRoute } from "../middleware/protectRoute.js";

import { rateLimit } from "../security/rateLimit.js";

const router = express.Router();
const authLimit = rateLimit({ limit: 10, windowMs: 15 * 60 * 1000, namespace: "auth" });

router.get("/google", authLimit, startGoogle);
router.get("/google/callback", authLimit, googleCallback);
router.get("/me", protectRoute, getMe);
router.post("/signup", authLimit, signup);
router.post("/login", authLimit, login);
router.post("/logout", logout);

export default router;