const DEFAULT_WEIGHTS = Object.freeze({
  projection: 0.40,
  vorp: 0.20,
  consensus: 0.15,
  adp: 0.10,
  risk: 0.07,
  history: 0.04,
  contextConfidence: 0.04,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentile(value, values, higherIsBetter = true) {
  const clean = values.map((v) => finite(v, null)).filter((v) => v !== null).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const rank = clean.findIndex((v) => v >= value);
  const index = rank === -1 ? clean.length - 1 : rank;
  const pct = clean.length === 1 ? 1 : index / (clean.length - 1);
  return higherIsBetter ? pct : 1 - pct;
}

export function normalizeWeights(weights = DEFAULT_WEIGHTS) {
  const merged = { ...DEFAULT_WEIGHTS, ...weights };
  const total = Object.values(merged).reduce((sum, value) => sum + Math.max(0, finite(value)), 0) || 1;
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, Math.max(0, finite(value)) / total]));
}

export function rankPlayers(players = [], weights = DEFAULT_WEIGHTS) {
  const normalizedWeights = normalizeWeights(weights);
  const projectionValues = players.map((p) => p.adjusted?.contextFantasyPoints);
  const vorpValues = players.map((p) => p.adjusted?.replacementValue);
  const consensusRanks = players.map((p) => p.consensus?.overallRank);
  const adpValues = players.map((p) => p.adp?.overall);
  const riskValues = players.map((p) => p.risk?.expertDisagreement || p.consensus?.rankStdDev || 0);

  const scored = players.map((player) => {
    const components = {
      projection: percentile(finite(player.adjusted?.contextFantasyPoints), projectionValues, true),
      vorp: percentile(finite(player.adjusted?.replacementValue), vorpValues, true),
      consensus: percentile(finite(player.consensus?.overallRank, 999), consensusRanks, false),
      adp: percentile(finite(player.adp?.overall, 999), adpValues, false),
      risk: percentile(finite(player.risk?.expertDisagreement || player.consensus?.rankStdDev), riskValues, false),
      history: finite(player.history?.reliabilityScore, 0.5),
      contextConfidence: finite(player.contextConfidence, 0.5),
    };
    const finalDraftScore = Object.entries(normalizedWeights)
      .reduce((sum, [key, weight]) => sum + finite(components[key]) * weight, 0);

    return {
      ...player,
      scoreComponents: components,
      adjusted: {
        ...(player.adjusted || {}),
        finalDraftScore,
      },
    };
  });

  scored.sort((a, b) => b.adjusted.finalDraftScore - a.adjusted.finalDraftScore);
  return scored.map((player, index) => ({ ...player, personalRank: index + 1 }));
}