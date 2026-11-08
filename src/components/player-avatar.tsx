"use client";

import Image from "next/image";
import { useState } from "react";

export default function PlayerAvatar({ name, src }: { name: string; src?: string }) {
    const [failed, setFailed] = useState<string>();
    return <span className="board-avatar">
        {src && failed !== src ? <Image src={src} alt={`${name}'s profile picture`} width={40} height={40} unoptimized onError={() => setFailed(src)} />
            : <span aria-label={`${name}'s profile`}>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}
    </span>;
}
