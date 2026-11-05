import { gameReducer } from "./game_state";
import type { GameAction, GameState } from "./game_state";

export type AnalysisSession = { game: GameState; history: GameState[] };
export type AnalysisAction = { type: "load"; game: GameState } | { type: "undo" } | { type: "game"; action: GameAction };

/** Snapshots include castling rights, en passant, promotions, and side to move. */
export function analysisReducer(session: AnalysisSession, action: AnalysisAction): AnalysisSession {
    if (action.type === "load") return { game: action.game, history: [] };
    if (action.type === "undo") {
        const previous = session.history.at(-1);
        return previous ? { game: previous, history: session.history.slice(0, -1) } : session;
    }
    const next = gameReducer(session.game, action.action);
    if (next === session.game) return session;
    // A human promotion preview and its choice belong to a single move.
    const moved = next.board !== session.game.board && !session.game.pendingPromotion;
    return { game: next, history: moved ? [...session.history, { ...session.game, selectedSquare: null }] : session.history };
}
