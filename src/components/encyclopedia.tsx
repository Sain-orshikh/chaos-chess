"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import Icon from "./icon";

type Offset = [number, number];
const straight: Offset[] = [-3, -2, -1, 1, 2, 3].flatMap(n => [[n, 0], [0, n]] as Offset[]);
const diagonals: Offset[] = [-3, -2, -1, 1, 2, 3].flatMap(n => [[n, n], [n, -n]] as Offset[]);
const horse: Offset[] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const adjacent: Offset[] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const pieces = {
  bishop: { title: "The bishop", rules: ["Move one square diagonally, forward or backward.", "Jump over one adjacent piece to an empty square beyond.", "Jump an enemy to capture it. Jump an ally and leave it in place.", "One jump per turn. Capturing is optional."], allowed: [[-1, -1], [1, -1], [1, 1], [-2, 2]] as Offset[], move: [-2, 2] as Offset },
  knight: { title: "The knight", rules: ["Move one or two squares horizontally, vertically, or diagonally.", "Other pieces block the path. This knight cannot jump.", "Capture an enemy by landing on its square."], allowed: [...adjacent, ...adjacent.map(([r, c]) => [r * 2, c * 2] as Offset)], move: [-2, -2] as Offset },
  rook: { title: "The rook", rules: ["In straight mode, slide horizontally or vertically.", "Switch to diagonal mode to move along diagonals instead.", "Switching uses your whole turn. Stay on the same square.", "Select the rook to choose Move or Switch. The + becomes × in diagonal mode."], allowed: straight, move: [0, 0] as Offset },
  pawn: { title: "The pawn", rules: ["Move one square diagonally forward into an empty square.", "Capture an enemy one square directly ahead.", "White advances toward rank 8. Black advances toward rank 1.", "Pawns cannot move backward."], allowed: [[-1, -1], [-1, 1]] as Offset[], move: [-1, 1] as Offset },
  queen: { title: "The queen", rules: ["Slide any distance horizontally or vertically.", "Or jump in an L shape: two squares, then one across.", "Horse jumps can pass over pieces. Sliding moves cannot."], allowed: [...straight, ...horse], move: [-2, 1] as Offset },
  king: { title: "The king", rules: ["Move one square horizontally, vertically, or diagonally.", "Never move into an enemy’s attack.", "Every piece’s move must leave your king safe.", "Checkmate ends the game. No legal moves without check is a draw."], allowed: adjacent, move: [1, -1] as Offset },
};
type PieceKey = keyof typeof pieces;

export default function Encyclopedia() {
  const [active, setActive] = useState<PieceKey>("bishop");
  const [replay, setReplay] = useState(0);
  const piece = pieces[active];
  return <section>
    <div className="page-heading"><h1>Encyclopedia</h1></div>
    <div className="piece-tabs" aria-label="Choose a piece">{(Object.keys(pieces) as PieceKey[]).map(name => <button key={name} aria-pressed={active === name} className={active === name ? "active" : ""} onClick={() => setActive(name)}><Image src={`/pieces/white-${name}.svg`} width={26} height={26} alt="" />{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
    <div className="encyclopedia-grid">
      <div className="demo-stage">
        <div className="demo-board" key={`${active}-${replay}`} style={{ "--move-x": `${piece.move[1] * 100}%`, "--move-y": `${piece.move[0] * 100}%` } as CSSProperties} role="img" aria-label={`${piece.title} movement demonstration${active === "bishop" ? ": jumps over an enemy pawn and captures it" : active === "rook" ? ": switches from straight to diagonal movement" : ""}`}>
          {Array.from({ length: 49 }, (_, index) => {
            const r = Math.floor(index / 7) - 3, c = index % 7 - 3;
            const allowed = piece.allowed.some(([dr, dc]) => dr === r && dc === c);
            const diagonal = diagonals.some(([dr, dc]) => dr === r && dc === c);
            return <div key={index} className={`demo-square ${(r + c) % 2 ? "dark" : "light"}`}>{allowed && <i className={active === "rook" ? "demo-dot straight-mode" : "demo-dot"} />}{active === "rook" && diagonal && <i className="demo-dot diagonal-mode" />}</div>;
          })}
          <div className={`demo-piece${active !== "rook" ? " moving" : ""}`}><Image src={`/pieces/white-${active}.svg`} width={100} height={100} alt="" className={active === "rook" ? "straight-mode" : ""} />{active === "rook" && <Image src="/pieces/white-rook-diagonal.svg" width={100} height={100} alt="" className="diagonal-mode" />}</div>
          {active === "bishop" && <div className="demo-enemy"><Image src="/pieces/black-pawn.svg" width={100} height={100} alt="" /></div>}
        </div>
        <div className="demo-controls"><span>{active === "rook" ? "Switch mode · one turn" : active === "bishop" ? "Jump capture" : "Movement example"}</span><button className="quiet-button" onClick={() => setReplay(replay + 1)}><Icon name="replay" />Replay move</button></div>
        <div className="demo-legend"><span><i />Possible destinations</span><span><i className="white" />Your piece</span></div>
      </div>
      <article className="piece-rules"><h2>{piece.title}</h2>{piece.rules.map(rule => <p key={rule}><Icon name="check" />{rule}</p>)}</article>
    </div>
  </section>;
}
