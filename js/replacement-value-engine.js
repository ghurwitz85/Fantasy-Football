export const DEFAULT_LEAGUE_SETTINGS = Object.freeze({
  teams: 12,
  starters: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 },
  flexEligibility: ['RB', 'WR', 'TE'],
});

function positionOf(player) {
  return String(player.position || '').replace(/[0-9]/g, '').toUpperCase();
}

function projectionOf(player) {
  return Number(
    player.adjusted?.contextFantasyPoints ??
    player.adjusted?.baseFantasyPoints ??
    player.projectedPoints ??
    0,
  );
}

export function calculateReplacementLevels(players = [], settings = DEFAULT_LEAGUE_SETTINGS) {
  const teams = Number(settings.teams || DEFAULT_LEAGUE_SETTINGS.teams);
  const starters = { ...DEFAULT_LEAGUE_SETTINGS.starters, ...(settings.starters || {}) };
  const eligible = settings.flexEligibility || DEFAULT_LEAGUE_SETTINGS.flexEligibility;
  const baselines = {};
  const selectedFlexIds = new Set();

  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const demand = Math.max(1, Math.round((starters[position] || 0) * teams));
    const pool = players
      .filter((player) => positionOf(player) === position)
      .sort((a, b) => projectionOf(b) - projectionOf(a));
    baselines[position] = projectionOf(pool[Math.min(demand - 1, pool.length - 1)] || {});
  }

  const flexDemand = Math.max(0, Math.round((starters.FLEX || 0) * teams));
  if (flexDemand > 0) {
    const nonFlexDemandByPosition = Object.fromEntries(
      ['RB', 'WR', 'TE'].map((position) => [position, Math.round((starters[position] || 0) * teams)]),
    );
    const flexPool = players
      .filter((player) => eligible.includes(positionOf(player)))
      .sort((a, b) => projectionOf(b) - projectionOf(a))
      .filter((player) => {
        const position = positionOf(player);
        const samePositionBetter = players
          .filter((candidate) => positionOf(candidate) === position)
          .filter((candidate) => projectionOf(candidate) > projectionOf(player)).length;
        return samePositionBetter >= (nonFlexDemandByPosition[position] || 0);
      })
      .slice(0, flexDemand);

    flexPool.forEach((player) => selectedFlexIds.add(player.playerId || player.id || player.name));
  }

  for (const position of eligible) {
    const selectedAtPosition = players.filter((player) =>
      selectedFlexIds.has(player.playerId || player.id || player.name) && positionOf(player) === position,
    ).length;
    if (!selectedAtPosition) continue;
    const totalDemand = Math.round((starters[position] || 0) * teams) + selectedAtPosition;
    const pool = players
      .filter((player) => positionOf(player) === position)
      .sort((a, b) => projectionOf(b) - projectionOf(a));
    baselines[position] = projectionOf(pool[Math.min(totalDemand - 1, pool.length - 1)] || {});
  }

  return baselines;
}

export function applyReplacementValues(players = [], settings = DEFAULT_LEAGUE_SETTINGS) {
  const replacementLevels = calculateReplacementLevels(players, settings);
  return players.map((player) => {
    const position = positionOf(player);
    const replacementValue = projectionOf(player) - (replacementLevels[position] || 0);
    return {
      ...player,
      adjusted: {
        ...(player.adjusted || {}),
        replacementValue,
      },
    };
  });
}