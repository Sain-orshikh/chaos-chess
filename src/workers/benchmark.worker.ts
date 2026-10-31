import { runBenchmark } from "../components/common/benchmark";
import type { BenchmarkRequest, BenchmarkMessage } from "../components/common/benchmark";

const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<BenchmarkRequest>) => void;
    postMessage: (message: BenchmarkMessage) => void;
};
scope.onmessage = event => {
    try { runBenchmark(event.data, message => scope.postMessage(message)); }
    catch (error) { scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "The benchmark could not finish." }); }
};
