import { applyReplacementValues } from './replacement-value-engine.js';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, min, max, fallback = min) {
  const number = Math.round(finite(value, fallback));
  return Math.max(min, Math.min(max, number));
}

function playerKey(player = {}) {
  return String(player.playerId || player.id || [player.name, player.team, player.position].filter(Boolean).join('|'));
}

export function createDraftState({ teams = 12, userDraftSlot = 1, currentPick = 1, picks = [] } = {}) {
  const teamCount = clampInteger(teams, 1, 32, 12);
  return {
    teams: teamCount,
    userDraftSlot: clampInteger(userDraftSlot, 1, teamCount, 1),
    currentPick: Math.max(1, Math.round(finite(currentPick, 1))),
    picks: Array.isArray(picks) ? picks.map((pick, index) => ({
      pickNumber: Math.max(1, Math.round(finite(pick.pickNumber, index + 1))),
      teamNumber: clampInteger(pick.teamNumber, 1, teamCount, draftTeamForPick(index + 1, teamCount)),
      playerId: String(pick.playerId || ''),
      name: pick.name || '',
      position: pick.position || '',
      fantasyTeam: pick.fantasyTeam || null,
      isUserPick: Boolean(pick.isUserPick),
      timestamp: pick.timestamp || null,
    })).filter((pick) => pick.playerId) : [],
  };
}

export function draftTeamForPick(pickNumber = 1, teams = 12) {
  const teamCount = Math.max(1, Math.round(finite(teams, 12)));
  const pick = Math.max(1, Math.round(finite(pickNumber, 1)));
  const round = Math.floor((pick - 1) / teamCount) + 1;
  const pickInRound = ((pick - 1) % teamCount) + 1;
  return round % 2 === 1 ? pickInRound : teamCount - pickInRound + 1;
}

export function isUserPick(pickNumber = 1, { teams = 12, userDraftSlot = 1 } = {}) {
  return draftTeamForPick(pickNumber, teams) === clampInteger(userDraftSlot, 1, Math.max(1, Math.round(finite(teams, 12))), 1);
}

export function draftedPlayerIds(state = {}) {
  return new Set((state.picks || []).map((pick) => String(pick.playerId)).filter(Boolean));
}

export function filterAvailablePlayers(players = [], state = {}) {
  const drafted = draftedPlayerIds(state);
  return players.filter((player) => !drafted.has(playerKey(player)));
}

export function draftPlayer(state = {}, player = {}, options = {}) {
  const normalized = createDraftState(state);
  const playerId = playerKey(player);
  if (!playerId) return normalized;
  if (draftedPlayerIds(normalized).has(playerId)) return normalized;

  const pickNumber = Math.max(1, Math.round(finite(options.pickNumber, normalized.currentPick || normalized.picks.length + 1)));
  const teamNumber = options.teamNumber
    ? clampInteger(options.teamNumber, 1, normalized.teams, 1)
    : draftTeamForPick(pickNumber, normalized.teams);
  const isUserSelection = options.isUserPick ?? teamNumber === normalized.userDraftSlot;
  const pick = {
    pickNumber,
    teamNumber,
    playerId,
    name: player.name || player.v3Row?.name || '',
    position: player.position || player.v3Row?.position || '',
    fantasyTeam: player.team || player.v3Row?.team || null,
    isUserPick: Boolean(isUserSelection),
    timestamp: options.timestamp || new Date().toISOString(),
  };

  return createDraftState({
    ...normalized,
    currentPick: Math.max(normalized.currentPick, pickNumber + 1),
    picks: [...normalized.picks, pick].sort((a, b) => a.pickNumber - b.pickNumber),
  });
}

export function undoLastPick(state = {}) {
  const normalized = createDraftState(state);
  const picks = normalized.picks.slice(0, -1);
  const currentPick = picks.length ? Math.max(...picks.map((pick) => pick.pickNumber)) + 1 : 1;
  return createDraftState({ ...normalized, picks, currentPick });
}

export function resetDraftState(state = {}) {
  const normalized = createDraftState(state);
  return createDraftState({ teams: normalized.teams, userDraftSlot: normalized.userDraftSlot, currentPick: 1, picks: [] });
}

export function rosterForTeam(state = {}, teamNumber = null) {
  const normalized = createDraftState(state);
  const targetTeam = teamNumber || normalized.userDraftSlot;
  return normalized.picks.filter((pick) => pick.teamNumber === targetTeam);
}

export function rosterCountsByPosition(state = {}, teamNumber = null) {
  return rosterForTeam(state, teamNumber).reduce((counts, pick) => {
    const position = pick.position || 'UNK';
    counts[position] = (counts[position] || 0) + 1;
    return counts;
  }, {});
}

function rowValue(player = {}, key, fallback = null) {
  const value = player.v3Row?.[key] ?? player[key];
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionOf(player = {}) {
  return String(player.position || player.v3Row?.position || '').replace(/[0-9]/g, '').toUpperCase();
}

function projectionValue(player = {}) {
  return rowValue(player, 'adjustedProjection', finite(player.adjusted?.contextFantasyPoints, finite(player.adjusted?.baseFantasyPoints, 0)));
}

function rosterNeedForPosition(state = {}, position = '', leagueSettings = {}) {
  const starters = leagueSettings.starters || {};
  const counts = rosterCountsByPosition(state);
  const current = counts[position] || 0;
  const starterTarget = Math.max(0, finite(starters[position], 0));
  const flexEligible = (leagueSettings.flexEligibility || ['RB', 'WR', 'TE']).includes(position);
  const flexTarget = flexEligible ? Math.max(0, finite(starters.FLEX, 0)) : 0;
  const totalTarget = starterTarget + flexTarget;

  if (starterTarget > 0 && current < starterTarget) {
    return { level: 'starter', label: `Starter need: ${position}`, score: 0.18 };
  }
  if (flexTarget > 0 && current < totalTarget) {
    return { level: 'flex', label: `Flex/depth need: ${position}`, score: 0.08 };
  }
  return { level: 'depth', label: `Depth only: ${position}`, score: 0 };
}

function annotateRosterNeed(players = [], state = {}, leagueSettings = null) {
  if (!leagueSettings?.starters) return players;
  return players.map((player) => {
    const position = positionOf(player);
    const rosterNeed = rosterNeedForPosition(state, position, leagueSettings);
    return {
      ...player,
      draft: { ...(player.draft || {}), rosterNeed },
      v3Row: player.v3Row ? { ...player.v3Row, rosterNeed: rosterNeed.label } : player.v3Row,
    };
  });
}

function annotatePositionTiers(players = []) {
  const sortedByPosition = new Map();
  players.forEach((player) => {
    const position = positionOf(player);
    if (!sortedByPosition.has(position)) sortedByPosition.set(position, []);
    sortedByPosition.get(position).push(player);
  });

  const annotations = new Map();
  sortedByPosition.forEach((positionPlayers) => {
    [...positionPlayers]
      .sort((a, b) => projectionValue(b) - projectionValue(a))
      .forEach((player, index, sorted) => {
        const next = sorted[index + 1];
        const dropToNext = next ? projectionValue(player) - projectionValue(next) : 0;
        const positionRankAvailable = index + 1;
        const bestAvailableAtPosition = positionRankAvailable === 1;
        const dropoffLabel = dropToNext >= 12
          ? `Tier drop: ${dropToNext.toFixed(1)} pts to next ${positionOf(player)}`
          : dropToNext >= 6
            ? `Small tier edge: ${dropToNext.toFixed(1)} pts`
            : '';
        annotations.set(playerKey(player), { positionRankAvailable, bestAvailableAtPosition, dropToNext, dropoffLabel });
      });
  });

  return players.map((player) => {
    const tier = annotations.get(playerKey(player)) || {};
    return {
      ...player,
      draft: { ...(player.draft || {}), tier },
      v3Row: player.v3Row ? {
        ...player.v3Row,
        positionRankAvailable: tier.positionRankAvailable,
        bestAvailableAtPosition: tier.bestAvailableAtPosition,
        dropoffLabel: tier.dropoffLabel,
      } : player.v3Row,
    };
  });
}

function recommendationLabel({ draftUrgency = 0, valueVsAdp = 0, availabilityProbability = 0.5, vorp = 0 } = {}) {
  if (draftUrgency >= 35 && availabilityProbability <= 0.35) return 'Draft now';
  if (valueVsAdp >= 18 && vorp > 0) return 'Strong value';
  if (availabilityProbability >= 0.60 && valueVsAdp >= 8) return 'Target if available next round';
  if (vorp > 0 || valueVsAdp >= 5) return 'Watchlist';
  return 'Depth option';
}

function annotatePointsMaximizingStrategy(players = []) {
  const bestByPosition = new Map();
  players.forEach((player) => {
    const position = positionOf(player);
    const currentBest = bestByPosition.get(position);
    if (!currentBest || projectionValue(player) > projectionValue(currentBest)) bestByPosition.set(position, player);
  });

  return players.map((player) => {
    const projection = projectionValue(player);
    const vorp = rowValue(player, 'vorp', rowValue(player, 'replacementValue', player.adjusted?.replacementValue || 0));
    const rosterNeedScore = finite(player.draft?.rosterNeed?.score, 0);
    const dropToNext = finite(player.draft?.tier?.dropToNext, 0);
    const goneBeforeNextPick = finite(player.draft?.goneBeforeNextPick, 0.5);
    const valueVsAdp = finite(player.draft?.valueVsAdp ?? (Number(player.adp?.overall) - rowValue(player, 'personalRank', 0)), 0);
    const tierUrgency = dropToNext * Math.max(0.35, goneBeforeNextPick);
    const availabilityRisk = Math.max(0, goneBeforeNextPick) * Math.max(0, vorp || projection * 0.25);
    const rosterFitBonus = Math.max(0, vorp) * rosterNeedScore;
    const valueBonus = Math.max(0, valueVsAdp) * 0.08;
    const pointsMaximizingScore = Math.max(0, vorp) + tierUrgency + availabilityRisk + rosterFitBonus + valueBonus;
    const position = positionOf(player);
    const positionAlternative = bestByPosition.get(position);
    const explanationParts = [
      `${projection.toFixed(1)} projected pts`,
      `${vorp >= 0 ? '+' : ''}${vorp.toFixed(1)} VORP`,
    ];
    if (dropToNext >= 6) explanationParts.push(`${dropToNext.toFixed(1)}-pt ${position} tier/dropoff edge`);
    if (goneBeforeNextPick >= 0.6) explanationParts.push(`${Math.round(goneBeforeNextPick * 100)}% risk gone by next pick`);
    if (player.draft?.rosterNeed?.level && player.draft.rosterNeed.level !== 'depth') explanationParts.push(player.draft.rosterNeed.label);

    return {
      ...player,
      draft: {
        ...(player.draft || {}),
        strategy: {
          projection,
          pointsMaximizingScore,
          tierUrgency,
          availabilityRisk,
          rosterFitBonus,
          valueBonus,
          isBestAtPosition: playerKey(positionAlternative) === playerKey(player),
          explanation: explanationParts.join(' · '),
        },
      },
      v3Row: player.v3Row ? {
        ...player.v3Row,
        pointsMaximizingScore,
        strategyExplanation: explanationParts.join(' · '),
      } : player.v3Row,
    };
  });
}

function rosterTargetSize(leagueSettings = {}, benchSpots = 6) {
  const starters = leagueSettings.starters || {};
  return ['QB', 'RB', 'WR', 'TE', 'FLEX']
    .reduce((total, position) => total + Math.max(0, finite(starters[position], 0)), 0) + benchSpots;
}

export function scoreStartingLineup(roster = [], leagueSettings = {}) {
  const starters = leagueSettings.starters || {};
  const flexEligibility = leagueSettings.flexEligibility || ['RB', 'WR', 'TE'];
  const remaining = [...roster].sort((a, b) => projectionValue(b) - projectionValue(a));
  const lineup = { QB: [], RB: [], WR: [], TE: [], FLEX: [] };

  ['QB', 'RB', 'WR', 'TE'].forEach((position) => {
    const needed = Math.max(0, finite(starters[position], 0));
    for (let index = 0; index < remaining.length && lineup[position].length < needed; index += 1) {
      if (positionOf(remaining[index]) === position) {
        lineup[position].push(remaining.splice(index, 1)[0]);
        index -= 1;
      }
    }
    lineup[position].sort((a, b) => projectionValue(b) - projectionValue(a));
  });

  const flexNeeded = Math.max(0, finite(starters.FLEX, 0));
  for (let index = 0; index < remaining.length && lineup.FLEX.length < flexNeeded; index += 1) {
    if (flexEligibility.includes(positionOf(remaining[index]))) {
      lineup.FLEX.push(remaining.splice(index, 1)[0]);
      index -= 1;
    }
  }

  const startersList = Object.values(lineup).flat();
  return {
    projectedStarterPoints: startersList.reduce((sum, player) => sum + projectionValue(player), 0),
    lineup,
    starters: startersList,
    bench: remaining,
  };
}

function otherTeamDraftScore(player = {}) {
  const adp = player.adp?.overall ?? rowValue(player, 'adp', null);
  const rank = rowValue(player, 'personalRank', 999);
  return Number.isFinite(Number(adp)) ? Number(adp) : rank;
}

function chooseUserSimulationPick(available = []) {
  return [...available].sort((a, b) => {
    const strategyDelta = finite(b.draft?.strategy?.pointsMaximizingScore, 0) - finite(a.draft?.strategy?.pointsMaximizingScore, 0);
    if (strategyDelta) return strategyDelta;
    return projectionValue(b) - projectionValue(a);
  })[0] || null;
}

export function simulateCandidatePickImpact(players = [], state = {}, candidate = {}, options = {}) {
  const draftState = createDraftState(state);
  const leagueSettings = options.leagueSettings || {};
  const candidateId = playerKey(candidate);
  const targetRosterSize = rosterTargetSize(leagueSettings, options.benchSpots ?? 6);
  const maxPick = draftState.currentPick + Math.max(1, finite(options.maxSimulationPicks, draftState.teams * 12));
  const roster = [candidate];
  const path = [`Pick ${draftState.currentPick}: ${candidate.name || candidate.v3Row?.name} (${positionOf(candidate)})`];
  let available = players.filter((player) => playerKey(player) !== candidateId);

  for (let pick = draftState.currentPick + 1; pick <= maxPick && roster.length < targetRosterSize && available.length; pick += 1) {
    const userIsPicking = isUserPick(pick, draftState);
    const selected = userIsPicking
      ? chooseUserSimulationPick(available)
      : [...available].sort((a, b) => otherTeamDraftScore(a) - otherTeamDraftScore(b))[0];
    if (!selected) break;
    available = available.filter((player) => playerKey(player) !== playerKey(selected));
    if (userIsPicking) {
      roster.push(selected);
      path.push(`Pick ${pick}: ${selected.name || selected.v3Row?.name} (${positionOf(selected)})`);
    }
  }

  const scored = scoreStartingLineup(roster, leagueSettings);
  return {
    projectedStarterPoints: scored.projectedStarterPoints,
    startingLineup: scored.lineup,
    roster,
    path,
    explanation: `${(candidate.name || candidate.v3Row?.name || 'This pick')} models to ${scored.projectedStarterPoints.toFixed(1)} starter points after ${path.length} user pick(s).`,
  };
}

export function annotatePickImpactSimulation(players = [], state = {}, options = {}) {
  if (!options.leagueSettings?.starters) return players;
  const candidateLimit = Math.max(1, finite(options.simulationCandidateLimit, 24));
  const candidateIds = new Set(players.slice(0, candidateLimit).map(playerKey));
  const simulations = players
    .filter((player) => candidateIds.has(playerKey(player)))
    .map((player) => [playerKey(player), simulateCandidatePickImpact(players, state, player, options)]);
  const bestPoints = simulations.reduce((best, [, simulation]) => Math.max(best, simulation.projectedStarterPoints), 0);
  const simulationById = new Map(simulations.map(([key, simulation]) => [key, {
    ...simulation,
    pointsVsBest: simulation.projectedStarterPoints - bestPoints,
  }]));

  return players.map((player) => {
    const simulation = simulationById.get(playerKey(player));
    if (!simulation) return player;
    return {
      ...player,
      draft: { ...(player.draft || {}), simulation },
      v3Row: player.v3Row ? {
        ...player.v3Row,
        modeledStarterPoints: simulation.projectedStarterPoints,
        modeledPointsVsBest: simulation.pointsVsBest,
        simulationExplanation: simulation.explanation,
      } : player.v3Row,
    };
  });
}

export function annotateDraftRecommendations(players = [], options = {}) {
  return players.map((player) => {
    const personalRank = rowValue(player, 'personalRank', null);
    const adp = player.adp?.overall ?? rowValue(player, 'adp', null);
    const consensusRank = player.consensus?.overallRank ?? rowValue(player, 'consensusRank', null);
    const finalDraftScore = rowValue(player, 'finalDraftScore', 0);
    const vorp = rowValue(player, 'vorp', rowValue(player, 'replacementValue', player.adjusted?.replacementValue || 0));
    const draftUrgency = player.draft?.draftUrgency ?? rowValue(player, 'draftUrgency', 0);
    const availabilityProbability = player.draft?.availabilityProbability ?? rowValue(player, 'availabilityProbability', 0.5);
    const valueVsAdp = Number.isFinite(personalRank) && Number.isFinite(Number(adp)) ? Number(adp) - personalRank : 0;
    const valueVsConsensus = Number.isFinite(personalRank) && Number.isFinite(Number(consensusRank)) ? Number(consensusRank) - personalRank : 0;
    const isOutlierValue = valueVsAdp >= Number(options.outlierRankGap ?? 12) && vorp > 0;
    const recommendation = recommendationLabel({ draftUrgency, valueVsAdp, availabilityProbability, vorp });

    return {
      ...player,
      draft: {
        ...(player.draft || {}),
        finalDraftScore,
        vorp,
        valueVsAdp,
        valueVsConsensus,
        isOutlierValue,
        recommendation,
      },
      v3Row: player.v3Row ? {
        ...player.v3Row,
        valueVsAdp,
        valueVsConsensus,
        recommendation,
        isOutlierValue,
      } : player.v3Row,
    };
  });
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

export function prepareLiveDraftBoard(players = [], state = {}, options = {}) {
  const draftState = createDraftState(state);
  const available = filterAvailablePlayers(players, draftState);
  const dynamicallyValued = options.leagueSettings
    ? applyReplacementValues(available, options.leagueSettings).map((player) => ({
      ...player,
      v3Row: player.v3Row ? {
        ...player.v3Row,
        replacementBaseline: player.adjusted?.replacementBaseline,
        vorp: player.adjusted?.replacementValue,
      } : player.v3Row,
    }))
    : available;
  const withAvailability = annotateAvailability(dynamicallyValued, {
    currentPick: draftState.currentPick,
    userDraftSlot: draftState.userDraftSlot,
    teams: draftState.teams,
    defaultAdpStdDev: options.defaultAdpStdDev,
  });
  const withRosterNeed = annotateRosterNeed(withAvailability, draftState, options.leagueSettings);
  const withTiers = annotatePositionTiers(withRosterNeed);
  const withRecommendations = annotateDraftRecommendations(withTiers, options);
  const withStrategy = annotatePointsMaximizingStrategy(withRecommendations);
  const withSimulation = options.simulatePickImpact === false
    ? withStrategy
    : annotatePickImpactSimulation(withStrategy, draftState, options);
  return withSimulation.sort((a, b) => {
    const ar = rowValue(a, 'personalRank', Infinity);
    const br = rowValue(b, 'personalRank', Infinity);
    return ar - br;
  });
}