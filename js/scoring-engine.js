export const DEFAULT_SCORING = Object.freeze({
  passYardsPerPoint: 25,
  passTd: 4,
  interception: -2,
  rushYardsPerPoint: 10,
  rushTd: 6,
  reception: 0.5,
  receivingYardsPerPoint: 10,
  receivingTd: 6,
  fumbleLost: -2,
  fortyYardPassBonus: 1,
  fortyYardRushBonus: 1,
  fortyYardReceptionBonus: 1,
});

export function emptyStatProjection() {
  return {
    games: 17,
    passing: {
      attempts: 0,
      completions: 0,
      yards: 0,
      touchdowns: 0,
      interceptions: 0,
      fortyYardCompletions: 0,
    },
    rushing: {
      attempts: 0,
      yards: 0,
      touchdowns: 0,
      fortyYardRuns: 0,
    },
    receiving: {
      targets: 0,
      receptions: 0,
      yards: 0,
      touchdowns: 0,
      fortyYardReceptions: 0,
    },
    fumblesLost: 0,
  };
}

export function mergeScoring(scoring = {}) {
  return { ...DEFAULT_SCORING, ...scoring };
}

export function normalizeStats(stats = {}) {
  const empty = emptyStatProjection();
  return {
    ...empty,
    ...stats,
    passing: { ...empty.passing, ...(stats.passing || {}) },
    rushing: { ...empty.rushing, ...(stats.rushing || {}) },
    receiving: { ...empty.receiving, ...(stats.receiving || {}) },
    fumblesLost: Number(stats.fumblesLost || 0),
  };
}

export function calculateFantasyPoints(rawStats = {}, rawScoring = {}) {
  const stats = normalizeStats(rawStats);
  const scoring = mergeScoring(rawScoring);

  return (
    stats.passing.yards / scoring.passYardsPerPoint +
    stats.passing.touchdowns * scoring.passTd +
    stats.passing.interceptions * scoring.interception +
    stats.passing.fortyYardCompletions * scoring.fortyYardPassBonus +

    stats.rushing.yards / scoring.rushYardsPerPoint +
    stats.rushing.touchdowns * scoring.rushTd +
    stats.rushing.fortyYardRuns * scoring.fortyYardRushBonus +

    stats.receiving.receptions * scoring.reception +
    stats.receiving.yards / scoring.receivingYardsPerPoint +
    stats.receiving.touchdowns * scoring.receivingTd +
    stats.receiving.fortyYardReceptions * scoring.fortyYardReceptionBonus +

    stats.fumblesLost * scoring.fumbleLost
  );
}

export function calculateBigPlayPoints(rawStats = {}, rawScoring = {}) {
  const stats = normalizeStats(rawStats);
  const scoring = mergeScoring(rawScoring);
  return (
    stats.passing.fortyYardCompletions * scoring.fortyYardPassBonus +
    stats.rushing.fortyYardRuns * scoring.fortyYardRushBonus +
    stats.receiving.fortyYardReceptions * scoring.fortyYardReceptionBonus
  );
}