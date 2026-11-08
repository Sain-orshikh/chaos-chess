// Keep the existing policy: K=40 below 1000, otherwise K=30.
export function calculateRatings(ratingA, ratingB, result) {
    if (![ratingA, ratingB].every(Number.isFinite) || !["a", "b", "draw"].includes(result)) {
        throw new TypeError("Invalid ratings or game result.");
    }
    const scoreA = result === "draw" ? 0.5 : result === "a" ? 1 : 0;
    const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
    return {
        a: Math.round(ratingA + (ratingA < 1000 ? 40 : 30) * (scoreA - expectedA)),
        b: Math.round(ratingB + (ratingB < 1000 ? 40 : 30) * (1 - scoreA - (1 - expectedA))),
    };
}
