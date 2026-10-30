import mongoose from "mongoose";

const rateLimitSchema = new mongoose.Schema({
    _id: String,
    count: { type: Number, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
}, { versionKey: false });

export default mongoose.models.RateLimit || mongoose.model("RateLimit", rateLimitSchema);
