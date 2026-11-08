import mongoose from "mongoose";

const ratingChangeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    before: { type: Number, required: true },
    after: { type: Number, required: true },
    change: { type: Number, required: true },
}, { _id: false });

// Only trusted online-game code may create games or set their result.
// There is deliberately no client-facing endpoint for writing these fields.
const gameSchema = new mongoose.Schema({
    playerA: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    playerB: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    live: { type: mongoose.Schema.Types.Mixed, default: null },
    players: { type: mongoose.Schema.Types.Mixed, default: null },
    rated: { type: Boolean, default: false },
    status: { type: String, enum: ["playing", "finished"], default: "playing" },
    result: { type: String, enum: ["a", "b", "draw"], default: null },
    finalizedAt: { type: Date, default: null },
    achievements: { type: mongoose.Schema.Types.Mixed, default: null },
    ratings: {
        type: new mongoose.Schema({ a: ratingChangeSchema, b: ratingChangeSchema }, { _id: false }),
        default: null,
    },
// Empty presence maps are required live state, including before either player connects.
}, { timestamps: true, minimize: false });

gameSchema.index({ playerA: 1, status: 1 });
gameSchema.index({ playerB: 1, status: 1 });

export default mongoose.model("Game", gameSchema);
