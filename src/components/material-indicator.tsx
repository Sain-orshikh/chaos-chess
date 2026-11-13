import { BoardPiece } from "./piece";
import { materialForSide, type materialBalance } from "./common/material";
import type { Color, Ruleset } from "./utils/types";

export default function MaterialIndicator({ balance, color, ruleset, capturedPieces = [] }: { capturedPieces?: number[]; balance: ReturnType<typeof materialBalance>; color: Color; ruleset: Ruleset }) {
    const { advantage } = materialForSide(balance, color);
    const pieces = capturedPieces.filter(piece => color === "white" ? piece < 0 : piece > 0).toSorted((a, b) => Math.abs(a) - Math.abs(b));
    if (!pieces.length && advantage <= 0) return null;
    const values = ruleset === "normal" ? "Pawn 1 · Knight 3 · Bishop 3 · Rook 5 · Queen 9" : "Pawn 1 · Knight 4 · Bishop 2 · Rook 5 · Queen 8";
    return <div className="material-indicator" title={values} aria-label={`${color === "white" ? "White" : "Black"}: ${advantage > 0 ? `ahead by ${advantage} material points` : advantage < 0 ? `behind by ${-advantage} material points` : "equal material"}. ${values}`}>
        <span className="material-pieces" aria-hidden="true">{pieces.map((piece, index) => <span key={index}><BoardPiece code={piece} /></span>)}</span>
        {advantage > 0 && <strong>+{advantage}</strong>}
    </div>;
}
