function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function estimateAvailability(adp, adpStdDev = 12, pickNumber = 1) {
  const averageDraftPosition = finite(adp, null);
  const targetPick = finite(pickNumber, 1);
  if (!averageDraftPosition || averageDraftPosition <= 0) return 0.5;

  const spread = Math.max(4, finite(adpStdDev, 12));
  const z = (targetPick - averageDraftPosition) / spread;
  const probabilityGone = 1 / (1 + Math.exp(-z));
  return Math.max(0.01, Math.min(0.99, 1 - probabilityGone));
}

export function picksUntilNextTurn({ currentPick = 1, userDraftSlot = 1, teams = 12 } = {}) {
  const teamCount = Math.max(1, Math.round(finite(teams, 12)));
  const slot = Math.max(1, Math.min(teamCount, Math.round(finite(userDraftSlot, 1))));
  const pick = Math.max(1, Math.round(finite(currentPick, 1)));
  const round = Math.floor((pick - 1) / teamCount) + 1;
  const nextRound = round + 1;
  const nextPickInRound = nextRound % 2 === 1 ? slot : teamCount - slot + 1;
  const nextOverallPick = (nextRound - 1) * teamCount + nextPickInRound;
  return Math.max(1, nextOverallPick - pick);
}

export function annotateAvailability(players = [], {
  currentPick = 1,
  userDraftSlot = 1,
  teams = 12,
  defaultAdpStdDev = 12,
} = {}) {
  const untilNext = picksUntilNextTurn({ currentPick, userDraftSlot, teams });
  const nextPick = finite(currentPick, 1) + untilNext;
  return players.map((player) => {
    const availabilityProbability = estimateAvailability(
      player.adp?.overall,
      player.adp?.stdDev || player.adp?.adpStdDev || defaultAdpStdDev,
      nextPick,
    );
    const goneBeforeNextPick = 1 - availabilityProbability;
    const personalizedValue = finite(player.adjusted?.replacementValue, finite(player.adjusted?.contextFantasyPoints, 0));
    const draftUrgency = personalizedValue * goneBeforeNextPick;
    return {
      ...player,
      draft: {
        ...(player.draft || {}),
        currentPick,
        nextPick,
        picksUntilNext: untilNext,
        availabilityProbability,
        goneBeforeNextPick,
        draftUrgency,
      },
    };
  });
}