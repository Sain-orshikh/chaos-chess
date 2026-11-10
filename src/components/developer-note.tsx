import Link from "next/link";
import { portfolioUrl } from "@/lib/site";

export default function DeveloperNote() {
  return <div className="developer-note-copy">
    <p className="note-byline">By <a href={portfolioUrl} rel="author">Sainorshikh</a> · Creator of Havoc Chess</p>
    <p className="note-lead">A familiar board. A different game.</p>
    <p>I built Havoc Chess to learn about chess programming. Sebastian Lague’s <a href="https://www.youtube.com/watch?v=U4ogK0MIzqk">Coding Adventure: Chess</a> was a huge inspiration, but I wanted to start with a twist: my own take on the rules.</p>
    <h3>Why Havoc?</h3>
    <p>Rooks switch between straight and diagonal movement. Queens combine the moves of a rook and a knight. Pawns move diagonally and capture straight ahead. Even familiar pieces ask you to think again.</p>
    <p>My hope is that it feels like a refreshing challenge, especially with friends whose chess ratings are far apart. Whether you’re rated 500 or 1500 in classic chess, you both have new moves to learn. Chess experience still helps, but Havoc gives you a chance to discover the game together.</p>
    <h3>Meet Rooke</h3>
    <p>For now, your opponent is Rooke, a chess bot I wrote in TypeScript. With its default settings, it gets three seconds to think per move. It’s beatable in Classic, but I’d be shocked if you managed to best it in Havoc. Consider that a challenge.</p>
    <h3>What’s next?</h3>
    <p>I plan to port the core engine to a language like C++ and compile it to WebAssembly, so it can search faster and become a stronger opponent.</p>
    <p>Until then, learn the moves, challenge your friends, climb the <Link href="/leaderboard">leaderboard</Link>, and claim some badges. Thanks for playing.</p>
    <p className="note-signature">— Sainorshikh</p>
  </div>;
}
