import express from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import { finalizeGame } from "../controllers/user.controller.js";
import { rateLimit } from "../security/rateLimit.js";

const router = express.Router();
const finalizeLimit = rateLimit({ limit: 30, windowMs: 60_000, namespace: "game-finalize", key: req => String(req.user._id) });

router.post("/:gameId/finalize", protectRoute, finalizeLimit, finalizeGame);

export default router;
