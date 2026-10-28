const pieces = {
    "king": {
        white: "/pieces/white-king.svg",
        black: "/pieces/black-king.svg"
    },
    "queen": {
        white: "/pieces/white-queen.svg",
        black: "/pieces/black-queen.svg"
    },
    "knight": {
        white: "/pieces/white-knight.svg",
        black: "/pieces/black-knight.svg"
    },
    "bishop": {
        white: "/pieces/white-bishop.svg",
        black: "/pieces/black-bishop.svg"
    },
    "rook": {
        white: "/pieces/white-rook.svg",
        black: "/pieces/black-rook.svg"
    },
    "diagonalrook": {
        white: "/pieces/white-rook-diagonal.svg",
        black: "/pieces/black-rook-diagonal.svg"
    },
    "pawn": {
        white: "/pieces/white-pawn.svg",
        black: "/pieces/black-pawn.svg"
    }
}

export default function Piece(
    type: keyof typeof pieces,
    color: "white" | "black"
) {

    const src = pieces[type][color];

    return(
        <img src={src} alt={`${color} ${type === "diagonalrook" ? "diagonal rook" : type}`} draggable={false} className="w-full h-full object-contain z-10" />
    )
}
