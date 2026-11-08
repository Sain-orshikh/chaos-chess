"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Icon from "./icon";
import Piece from "./piece";
import type { Color } from "./utils/types";
import type { FinishedStatus } from "./common/game_state";

type Props = {
    status: FinishedStatus;
    playerColor: Color;
    playerName: string;
    opponentName?: string;
    onPlayAgain: () => void;
    onViewBoard: () => void;
    ratingSummary?: ReactNode;
};

export default function GameResultModal({ status, playerColor, playerName, opponentName = "Player 2", onPlayAgain, onViewBoard, ratingSummary }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const draw = status.kind === "stalemate" || status.kind === "draw";
    const won = "winner" in status && status.winner === playerColor;
    const title = draw ? "Draw" : won ? "You won" : "You lost";
    const opponentColor = playerColor === "white" ? "black" : "white";
    const winnerColor = "winner" in status ? status.winner : playerColor;
    const reason = status.kind === "stalemate" ? "Stalemate" : status.kind === "draw" ? status.reason === "agreement" ? "Draw by agreement" : status.reason === "insufficient-material" ? "Insufficient material" : "75 moves by each side without a pawn move or capture"
        : `${winnerColor === "white" ? "White" : "Black"} wins by ${status.kind === "resigned" ? "resignation" : "checkmate"}`;

    useEffect(() => {
        const modal = dialog.current;
        modal?.showModal();
        return () => modal?.close();
    }, []);

    return <dialog ref={dialog} className={`result-modal ${draw ? "is-draw" : won ? "is-win" : "is-loss"}`}
        aria-labelledby="game-result-title" aria-describedby="game-result-reason"
        onCancel={onViewBoard}
        onClick={event => { if (event.target === event.currentTarget) onViewBoard(); }}>
        <div className="result-topline"><span>{opponentName === "Rooke" ? "vs Rooke" : "Local 1v1"}</span><button type="button" className="icon-button" aria-label="Close game result" onClick={onViewBoard}><Icon name="close" /></button></div>
        <div className={`result-emblem${draw ? " paired" : ""}`} aria-hidden="true">
            {Piece("king", winnerColor)}
            {draw && Piece("king", opponentColor)}
        </div>
        <h2 id="game-result-title">{title}</h2>
        <p id="game-result-reason" className="result-reason">{reason}</p>
        <div className="result-scoreboard" aria-label="Final score">
            <div className={won ? "winner" : ""}>
                <span className={`player-color ${playerColor}`} />
                <span className="result-player"><strong>{playerName}</strong><small>{playerColor === "white" ? "White" : "Black"}</small></span>
                <span className="result-score">{draw ? "½" : won ? "1" : "0"}</span>
            </div>
            <div className={!draw && !won ? "winner" : ""}>
                <span className={`player-color ${opponentColor}`} />
                <span className="result-player"><strong>{opponentName}</strong><small>{opponentColor === "white" ? "White" : "Black"}</small></span>
                <span className="result-score">{draw ? "½" : won ? "0" : "1"}</span>
            </div>
        </div>
        <div className="result-actions">
            <button type="button" autoFocus className="result-play-button" onClick={onPlayAgain}><Icon name="replay" />Play again</button>
            <button type="button" className="result-board-button" onClick={onViewBoard}>View board</button>
        </div>
        {ratingSummary ?? <p className="result-unrated">Unrated · No Elo or match count changes</p>}
    </dialog>;
}
