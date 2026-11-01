import { searchBot } from "../components/common/bot_search";
import type { BotMessage, BotRequest } from "../components/common/bot_search";

const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<BotRequest>) => void;
    postMessage: (message: BotMessage) => void;
};
scope.onmessage = event => {
    try {
        const result = searchBot(event.data, report => scope.postMessage({ type: "progress", report }));
        scope.postMessage({ type: "result", result });
    } catch (error) {
        scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Bot search failed." });
    }
};
