import Image from "next/image";
import { pieceColor, pieceDefinitions, pieceName } from "./utils/pieces";
import type { Color, PieceName } from "./utils/types";

export default function Piece(type: PieceName, color: Color) {
    const definition = pieceDefinitions[type];
    return <Image width={256} height={256} src={`/pieces/${color}-${definition.image}.svg`}
        alt={`${color} ${definition.label}`} draggable={false} className="piece-image" />;
}

export function BoardPiece({ code }: { code: number }) {
    const color = pieceColor(code);
    return color ? Piece(pieceName(code), color) : null;
}
