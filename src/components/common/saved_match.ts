import { createGame, gameReducer, isGameOver } from "./game_state";
import type { GameState } from "./game_state";
import type { Color, Ruleset, StandardState } from "../utils/types";

export const MATCH_SAVE_MS = 3 * 60 * 60 * 1000;
export const matchStorageKey = (local: boolean) => `chaos-chess:match:${local ? "local" : "bot"}:v1`;
export type SavedMatch = { botId?: "rooke" | "kestrel" | "merlin"; game: GameState; orientation: Color; evaluationSeed: number; expiresAt: number };
const color = (value: unknown): value is Color => value === "white" || value === "black";
const square = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 64;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Store the real position before a pending promotion, then reconstruct its legal preview. */
export function encodeMatch(match: SavedMatch): string {
    const { game } = match;
    return JSON.stringify({ version: 1, botId: match.botId, orientation: match.orientation, evaluationSeed: match.evaluationSeed, expiresAt: match.expiresAt,
        board: game.pendingPromotion?.boardBefore ?? game.board, ruleset: game.ruleset, turn: game.turn,
        castling: game.castling, standard: game.standard, halfmoveClock: game.halfmoveClock,
        drawOffer: game.drawOffer, lastMove: game.lastMove,
        promotion: game.pendingPromotion ? { from: game.pendingPromotion.moves[0].from, to: game.pendingPromotion.moves[0].to } : null });
}

/** Browser storage is untrusted and may contain expired or older application data. */
export function decodeMatch(raw: string | null, now = Date.now()): SavedMatch | null {
    try {
        if (!raw) return null;
        const value: unknown = JSON.parse(raw);
        if (!record(value) || value.version !== 1 || !color(value.orientation) || !color(value.turn)
            || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= now || Number(value.expiresAt) > now + MATCH_SAVE_MS
            || !Number.isInteger(value.evaluationSeed) || Number(value.evaluationSeed) < 0 || Number(value.evaluationSeed) > 0xffffffff
            || !Number.isSafeInteger(value.halfmoveClock) || Number(value.halfmoveClock) < 0
            || !Array.isArray(value.board) || value.board.length !== 64
            || !value.board.every(piece => Number.isInteger(piece) && Math.abs(piece) <= 7)
            || value.board.filter(piece => piece === 7).length !== 1 || value.board.filter(piece => piece === -7).length !== 1
            || (value.ruleset !== "normal" && value.ruleset !== "chaos")
            || !record(value.castling) || typeof value.castling.white !== "boolean" || typeof value.castling.black !== "boolean"
            || (value.drawOffer !== null && !color(value.drawOffer))) return null;
        if (value.botId === "merlin" && value.ruleset !== "normal") return null;
        let standard: StandardState | undefined;
        if (value.ruleset === "normal") {
            const state = value.standard;
            if (!record(state) || !record(state.castlingRights) || (state.enPassantTarget !== null && !square(state.enPassantTarget))) return null;
            const { white, black } = state.castlingRights;
            if (!record(white) || !record(black) || typeof white.kingSide !== "boolean" || typeof white.queenSide !== "boolean"
                || typeof black.kingSide !== "boolean" || typeof black.queenSide !== "boolean" || value.board.some(piece => Math.abs(piece) === 5)) return null;
            standard = { castlingRights: { white: { kingSide: white.kingSide, queenSide: white.queenSide }, black: { kingSide: black.kingSide, queenSide: black.queenSide } }, enPassantTarget: state.enPassantTarget as number | null };
        }
        let game = createGame(value.board, value.turn, { white: value.castling.white, black: value.castling.black }, value.ruleset as Ruleset, standard, Number(value.halfmoveClock));
        if (isGameOver(game.status)) return null;
        game.drawOffer = value.drawOffer as Color | null;
        // Last-move highlights need only the two squares; never trust stored move mechanics.
        if (record(value.lastMove) && square(value.lastMove.from) && square(value.lastMove.to)) game.lastMove = { from: value.lastMove.from, to: value.lastMove.to, kind: "m" };
        if (value.promotion !== null) {
            if (!record(value.promotion) || !square(value.promotion.from) || !square(value.promotion.to)) return null;
            game = gameReducer(game, { type: "click", square: [Math.floor(value.promotion.from / 8), value.promotion.from % 8] });
            game = gameReducer(game, { type: "click", square: [Math.floor(value.promotion.to / 8), value.promotion.to % 8] });
            if (!game.pendingPromotion) return null;
        }
        return { botId: value.botId === "merlin" ? "merlin" : value.botId === "kestrel" ? "kestrel" : "rooke", game, orientation: value.orientation, evaluationSeed: Number(value.evaluationSeed), expiresAt: Number(value.expiresAt) };
    } catch { return null; }
}
