import User from '../models/user.model.js';
import { publicUser } from '../controllers/auth.controller.js';
import { fields, ValidationError, validationResponse } from '../security/validation.js';
import { BADGE_IDS, badgeMap, eligibleMilestones, awardAssignments } from './rules.js';

const updated = async (id, update) => User.findOneAndUpdate({ _id: id }, update, {
    returnDocument: 'after', updatePipeline: Array.isArray(update),
}).select('-password');
function failure(error, req, res) {
    if (validationResponse(error, res)) return;
    req.log?.error({ err: error, event: 'badges_update_failed' }, 'Could not update badges');
    return res.status(503).json({ error: 'Could not save badges. Please try again.' });
}
function respond(user, res) {
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json(publicUser(user));
}

// Opening the collection lazily awards legacy Elo/win milestones from the auth
// lookup already performed for this request. Never scan historical matches.
export async function syncBadges(req, res) {
    try {
        fields(req.body, []);
        const owned = badgeMap(req.user);
        const missing = eligibleMilestones(req.user).filter(id => !owned[id]);
        if (!missing.length) return respond(req.user, res);
        return respond(await updated(req.user._id, [{ $set: awardAssignments(missing, new Date()) }]), res);
    } catch (error) { return failure(error, req, res); }
}

// Intentionally trusts a signed-in client's Rooke win. It changes no ratings,
// matches, multiplayer wins or streaks. Duplicate submissions preserve dates.
export async function reportRookeWin(req, res) {
    try {
        fields(req.body, []);
        const now = new Date();
        const assignments = awardAssignments(['rooke-awakening'], now);
        assignments['badges.three-musketiers'] = { $cond: [
            { $and: [
                { $gte: [{ $ifNull: ['$badgeProgress.classicWins', 0] }, 1] },
                { $gte: [{ $ifNull: ['$badgeProgress.chaosWins', 0] }, 1] },
            ] },
            { $ifNull: ['$badges.three-musketiers', now] },
            { $ifNull: ['$badges.three-musketiers', '$$REMOVE'] },
        ] };
        if (badgeMap(req.user)['rooke-awakening']) return respond(req.user, res);
        return respond(await updated(req.user._id, [{ $set: assignments }]), res);
    } catch (error) { return failure(error, req, res); }
}

export async function equipBadges(req, res) {
    try {
        fields(req.body, ['equippedBadges']);
        const ids = req.body.equippedBadges;
        const owned = badgeMap(req.user);
        if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length ||
            ids.some(id => typeof id !== 'string' || !BADGE_IDS.includes(id) || !owned[id])) {
            throw new ValidationError('Choose up to three different badges you have earned.');
        }
        if (JSON.stringify(ids) === JSON.stringify(req.user.equippedBadges || [])) return respond(req.user, res);
        // Only this field changes: concurrent match awards are never overwritten.
        return respond(await updated(req.user._id, { $set: { equippedBadges: ids } }), res);
    } catch (error) { return failure(error, req, res); }
}

// Same client-reported, unrated policy as Rooke; standalone award only.
export async function reportKestrelWin(req, res) {
    try {
        fields(req.body, []);
        if (badgeMap(req.user)['kestrel-conqueror']) return respond(req.user, res);
        return respond(await updated(req.user._id, [{ $set: awardAssignments(['kestrel-conqueror'], new Date()) }]), res);
    } catch (error) { return failure(error, req, res); }
}

// Same client-reported, unrated policy as Rooke; standalone award only.
export async function reportMerlinWin(req, res) {
    try {
        fields(req.body, []);
        if (badgeMap(req.user)['merlin-conqueror']) return respond(req.user, res);
        return respond(await updated(req.user._id, [{ $set: awardAssignments(['merlin-conqueror'], new Date()) }]), res);
    } catch (error) { return failure(error, req, res); }
}
