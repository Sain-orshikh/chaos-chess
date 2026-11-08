import mongoose from 'mongoose';
// One durable ticket per account, across every mode, time control and browser tab.
const schema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    state: { type: String, enum: ['queued', 'matched'], required: true },
    ruleset: { type: String, enum: ['normal', 'chaos'], required: true },
    timeMs: { type: Number, required: true },
    rating: { type: Number, required: true },
    joinedAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true },
    gameId: { type: mongoose.Schema.Types.ObjectId, default: null },
    leases: { type: [{ connection: String, until: Number }], default: [] },
});
schema.index({ state: 1, ruleset: 1, timeMs: 1, joinedAt: 1 });
// Matched tickets must survive expiry so reloads recover the game. Expired queued tickets are reused.
export default mongoose.model('MatchTicket', schema);
