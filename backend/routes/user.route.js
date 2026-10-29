import express from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import { getUserProfile, updateUser } from "../controllers/user.controller.js";

import { rateLimit } from "../security/rateLimit.js";

const router = express.Router();
const updateLimit = rateLimit({ limit: 10, windowMs: 15 * 60 * 1000, key: (req) => String(req.user._id) });

router.get("/profile/:username",protectRoute,getUserProfile);
router.post("/update",protectRoute,updateLimit,updateUser);

export default router;