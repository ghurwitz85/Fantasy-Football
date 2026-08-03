import { applyReplacementValues } from './replacement-value-engine.js';
import { projectionInputValue } from './projection-engine.js';
import { estimatePositionRunRisk, leaguePositionDemandScore } from './league-intelligence-engine.js';
import { analyzeRosterSimulationContext } from './simulation-context-engine.js';

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
      adjustedProjection: finite(pick.adjustedProjection, null),
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
    adjustedProjection: projectionValue(player),
    fantasyTeam: options.fantasyTeam ?? player.fantasyTeam ?? null,
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
  return rowValue(player, 'adjustedProjection', projectionInputValue(player));
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
    const opportunity = estimateNextTurnOpportunityCost(player, players);
    const opportunityCostBonus = opportunity.opportunityCost * 0.40;
    const pointsMaximizingScore = Math.max(0, vorp) + tierUrgency + availabilityRisk + rosterFitBonus + valueBonus + opportunityCostBonus;
    const position = positionOf(player);
    const positionAlternative = bestByPosition.get(position);
    const explanationParts = [
      `${projection.toFixed(1)} projected pts`,
      `${vorp >= 0 ? '+' : ''}${vorp.toFixed(1)} VORP`,
    ];
    if (dropToNext >= 6) explanationParts.push(`${dropToNext.toFixed(1)}-pt ${position} tier/dropoff edge`);
    if (goneBeforeNextPick >= 0.6) explanationParts.push(`${Math.round(goneBeforeNextPick * 100)}% risk gone by next pick`);
    if (opportunity.nextTurnDropoff >= 6 && opportunity.nextTurnAlternativeName) explanationParts.push(`${opportunity.nextTurnDropoff.toFixed(1)}-pt next-turn drop to ${opportunity.nextTurnAlternativeName}`);
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
          opportunityCost: opportunity.opportunityCost,
          nextTurnDropoff: opportunity.nextTurnDropoff,
          nextTurnAlternativeName: opportunity.nextTurnAlternativeName,
          opportunityCostBonus,
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
  const lineupPositions = [...new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST', ...Object.keys(starters).filter((position) => position !== 'FLEX')])];
  const lineup = Object.fromEntries([...lineupPositions, 'FLEX'].map((position) => [position, []]));

  lineupPositions.forEach((position) => {
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
  const totalRosterPoints = roster.reduce((sum, player) => sum + projectionValue(player), 0);
  return {
    projectedStarterPoints: startersList.reduce((sum, player) => sum + projectionValue(player), 0),
    totalRosterPoints,
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

function seededRandom(seed = 1) {
  let state = Math.max(1, Math.round(finite(seed, 1))) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function weightedOpponentPick(available = [], pickNumber = 1, teams = 12, tendencies = null, random = Math.random) {
  const round = Math.floor((Math.max(1, pickNumber) - 1) / Math.max(1, teams)) + 1;
  const candidates = available
    .map((player) => {
      const market = otherTeamDraftScore(player);
      const demand = tendencies ? leaguePositionDemandScore(positionOf(player), round, tendencies) : 0;
      const noise = (random() - 0.5) * 18;
      return { player, score: market - demand * 24 + noise };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(14, available.length));
  if (!candidates.length) return null;
  const weights = candidates.map((_, index) => Math.exp(-index / 3));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let target = random() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    target -= weights[index];
    if (target <= 0) return candidates[index].player;
  }
  return candidates[0].player;
}

function hasUnfilledCoreStarter(roster = [], leagueSettings = {}) {
  const starters = leagueSettings.starters || {};
  const counts = roster.reduce((summary, player) => {
    const position = positionOf(player);
    summary[position] = (summary[position] || 0) + 1;
    return summary;
  }, {});
  const corePositions = ['QB', 'RB', 'WR', 'TE'];
  const missingCore = corePositions.some((position) => (counts[position] || 0) < Math.max(0, finite(starters[position], 0)));
  const flexEligibility = leagueSettings.flexEligibility || ['RB', 'WR', 'TE'];
  const flexEligibleCount = flexEligibility.reduce((total, position) => total + (counts[position] || 0), 0);
  const requiredFlexEligible = flexEligibility.reduce((total, position) => total + Math.max(0, finite(starters[position], 0)), 0)
    + Math.max(0, finite(starters.FLEX, 0));
  return missingCore || flexEligibleCount < requiredFlexEligible;
}

function isEarlySpecialTeamsPick(player = {}, roster = [], leagueSettings = {}) {
  return ['K', 'DST'].includes(positionOf(player)) && hasUnfilledCoreStarter(roster, leagueSettings);
}

export function estimateNextTurnOpportunityCost(player = {}, available = []) {
  const position = positionOf(player);
  const alternatives = available
    .filter((candidate) => playerKey(candidate) !== playerKey(player) && positionOf(candidate) === position)
    .filter((candidate) => finite(candidate.draft?.availabilityProbability, 0.5) >= 0.30)
    .sort((a, b) => projectionValue(b) - projectionValue(a));
  const alternative = alternatives[0] || null;
  const nextTurnDropoff = alternative ? Math.max(0, projectionValue(player) - projectionValue(alternative)) : 0;
  const goneBeforeNextPick = finite(player.draft?.goneBeforeNextPick, 0.5);
  return {
    opportunityCost: nextTurnDropoff * Math.max(0.25, goneBeforeNextPick),
    nextTurnDropoff,
    nextTurnAlternativeName: alternative?.name || alternative?.v3Row?.name || null,
  };
}

export function rosterConstructionPlanValue(player = {}, roster = [], leagueSettings = {}) {
  const position = positionOf(player);
  const starters = leagueSettings.starters || {};
  const flexEligibility = leagueSettings.flexEligibility || ['RB', 'WR', 'TE'];
  const counts = roster.reduce((summary, item) => {
    const itemPosition = positionOf(item);
    summary[itemPosition] = (summary[itemPosition] || 0) + 1;
    return summary;
  }, {});
  const current = counts[position] || 0;
  const starterTarget = Math.max(0, finite(starters[position], 0));
  const flexTarget = Math.max(0, finite(starters.FLEX, 0));
  const flexFilled = flexEligibility.reduce((total, itemPosition) => total + Math.min(counts[itemPosition] || 0, Math.max(0, finite(starters[itemPosition], 0))), 0);
  const starterPriority = position === 'TE' ? 38 : position === 'QB' ? 34 : 30;
  let starterValue = current < starterTarget ? starterPriority : 0;
  let flexValue = flexEligibility.includes(position) && current >= starterTarget && flexFilled < flexTarget ? 8 : 0;
  let benchValue = 0;
  if (['RB', 'WR', 'TE'].includes(position) && current >= starterTarget) benchValue = Math.max(0, 5 - Math.max(0, current - starterTarget) * 1.5);
  let redundancyPenalty = 0;
  if (position === 'QB' && current >= Math.max(1, starterTarget)) redundancyPenalty = 10 + Math.max(0, current - starterTarget) * 4;
  if (['K', 'DST'].includes(position) && current >= Math.max(1, starterTarget)) redundancyPenalty = 14;
  if (isEarlySpecialTeamsPick(player, roster, leagueSettings)) redundancyPenalty += 25;
  return {
    starterValue,
    flexValue,
    benchValue,
    redundancyPenalty,
    total: starterValue + flexValue + benchValue - redundancyPenalty,
  };
}

export function simulationPickUtility(player = {}, roster = [], available = [], leagueSettings = {}) {
  const projection = projectionValue(player);
  const vorp = rowValue(player, 'vorp', rowValue(player, 'replacementValue', player.adjusted?.replacementValue || 0));
  const rosterPlan = rosterConstructionPlanValue(player, roster, leagueSettings);
  const opportunity = estimateNextTurnOpportunityCost(player, available);
  const tierScarcity = finite(player.draft?.tier?.dropToNext, 0) * 0.45;
  const availability = finite(player.draft?.goneBeforeNextPick, 0.5) * Math.max(0, vorp) * 0.20;
  const strategy = finite(player.draft?.strategy?.pointsMaximizingScore, 0) * 0.18;
  const replaceabilityPenalty = Math.max(0, -vorp) * 0.35;
  const starter = Math.max(0, vorp) * 0.55;
  const flex = rosterPlan.flexValue;
  const bench = rosterPlan.benchValue;
  const total = starter + flex + bench + rosterPlan.starterValue + opportunity.opportunityCost + tierScarcity + availability + strategy - rosterPlan.redundancyPenalty - replaceabilityPenalty;
  return {
    starter,
    flex,
    bench,
    rosterPlan: rosterPlan.starterValue - rosterPlan.redundancyPenalty,
    opportunity: opportunity.opportunityCost,
    tierScarcity,
    availability,
    strategy,
    replaceabilityPenalty,
    total,
    projection,
    ...opportunity,
  };
}

function chooseUserSimulationPick(available = [], roster = [], leagueSettings = {}) {
  const eligible = hasUnfilledCoreStarter(roster, leagueSettings)
    ? available.filter((player) => !['K', 'DST'].includes(positionOf(player)))
    : available;
  const ranked = eligible
    .map((player) => ({ player, utility: simulationPickUtility(player, roster, eligible, leagueSettings) }))
    .sort((a, b) => b.utility.total - a.utility.total || projectionValue(b.player) - projectionValue(a.player));
  const best = ranked[0];
  return best && best.utility.total > 0 ? best.player : null;
}

export function simulateCandidatePickImpact(players = [], state = {}, candidate = {}, options = {}) {
  const draftState = createDraftState(state);
  const leagueSettings = options.leagueSettings || {};
  const candidateId = playerKey(candidate);
  const targetRosterSize = rosterTargetSize(leagueSettings, options.benchSpots ?? 6);
  const maxPick = draftState.currentPick + Math.max(1, finite(options.maxSimulationPicks, draftState.teams * 12));
  const existingRoster = rosterForTeam(draftState).map((pick) => ({
    playerId: pick.playerId,
    name: pick.name,
    position: pick.position,
    v3Row: { adjustedProjection: finite(pick.adjustedProjection, 0) },
  }));
  const roster = [...existingRoster, candidate];
  const path = [`Pick ${draftState.currentPick}: ${candidate.name || candidate.v3Row?.name} (${positionOf(candidate)})`];
  let available = players.filter((player) => playerKey(player) !== candidateId);

  for (let pick = draftState.currentPick + 1; pick <= maxPick && roster.length < targetRosterSize && available.length; pick += 1) {
    const userIsPicking = isUserPick(pick, draftState);
    const selected = userIsPicking
      ? chooseUserSimulationPick(available, roster, leagueSettings)
      : [...available].sort((a, b) => otherTeamDraftScore(a) - otherTeamDraftScore(b))[0];
    if (!selected) break;
    available = available.filter((player) => playerKey(player) !== playerKey(selected));
    if (userIsPicking) {
      roster.push(selected);
      path.push(`Pick ${pick}: ${selected.name || selected.v3Row?.name} (${positionOf(selected)})`);
    }
  }

  const scored = scoreStartingLineup(roster, leagueSettings);
  const modeledUtilityBreakdown = simulationPickUtility(candidate, existingRoster, players, leagueSettings);
  return {
    modeledDraftUtility: modeledUtilityBreakdown.total,
    modeledUtilityBreakdown,
    opportunityCost: modeledUtilityBreakdown.opportunityCost,
    nextTurnDropoff: modeledUtilityBreakdown.nextTurnDropoff,
    nextTurnAlternativeName: modeledUtilityBreakdown.nextTurnAlternativeName,
    projectedStarterPoints: scored.projectedStarterPoints,
    totalRosterPoints: scored.totalRosterPoints,
    startingLineup: scored.lineup,
    roster,
    path,
    explanation: `${(candidate.name || candidate.v3Row?.name || 'This pick')} models to ${scored.projectedStarterPoints.toFixed(1)} starter points and ${scored.totalRosterPoints.toFixed(1)} total roster points after ${path.length} user pick(s).`,
  };
}

function percentile(values = [], probability = 0.5) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * probability)));
  return sorted[index];
}

export function simulateCandidateMonteCarlo(players = [], state = {}, candidate = {}, options = {}) {
  const trials = Math.max(10, Math.min(1000, Math.round(finite(options.trials, 120))));
  const draftState = createDraftState(state);
  const leagueSettings = options.leagueSettings || {};
  const targetRosterSize = rosterTargetSize(leagueSettings, options.benchSpots ?? 6);
  const existingRoster = rosterForTeam(draftState).map((pick) => ({
    playerId: pick.playerId,
    name: pick.name,
    position: pick.position,
    v3Row: { adjustedProjection: finite(pick.adjustedProjection, 0) },
  }));
  const starterTotals = [];
  const rosterTotals = [];
  const outcomes = [];

  for (let trial = 0; trial < trials; trial += 1) {
    const random = seededRandom(finite(options.seed, 2026) + trial * 7919 + draftState.currentPick * 31);
    const roster = [...existingRoster, candidate];
    let available = players.filter((player) => playerKey(player) !== playerKey(candidate));
    const maxPick = draftState.currentPick + Math.max(1, finite(options.maxSimulationPicks, draftState.teams * 15));

    for (let pick = draftState.currentPick + 1; pick <= maxPick && roster.length < targetRosterSize && available.length; pick += 1) {
      const userIsPicking = isUserPick(pick, draftState);
      const selected = userIsPicking
        ? chooseUserSimulationPick(available, roster, leagueSettings)
        : weightedOpponentPick(available, pick, draftState.teams, options.leagueTendencies, random);
      if (!selected) break;
      available = available.filter((player) => playerKey(player) !== playerKey(selected));
      if (userIsPicking) roster.push(selected);
    }

    const scored = scoreStartingLineup(roster, leagueSettings);
    const context = analyzeRosterSimulationContext(roster, leagueSettings, options.simulationContext || {});
    const contextAdjustedStarterPoints = scored.projectedStarterPoints + context.totalAdjustment;
    starterTotals.push(contextAdjustedStarterPoints);
    rosterTotals.push(scored.totalRosterPoints);
    outcomes.push({ projectedStarterPoints: contextAdjustedStarterPoints, rawProjectedStarterPoints: scored.projectedStarterPoints, totalRosterPoints: scored.totalRosterPoints, roster, context });
  }

  const averageStarterPoints = starterTotals.reduce((sum, value) => sum + value, 0) / starterTotals.length;
  const averageRosterPoints = rosterTotals.reduce((sum, value) => sum + value, 0) / rosterTotals.length;
  const runRisk = estimatePositionRunRisk(positionOf(candidate), draftState.currentPick, picksUntilNextTurn(draftState), options.leagueTendencies || {});
  return {
    trials,
    averageStarterPoints,
    averageRosterPoints,
    starterFloor: percentile(starterTotals, 0.10),
    starterMedian: percentile(starterTotals, 0.50),
    starterCeiling: percentile(starterTotals, 0.90),
    rosterFloor: percentile(rosterTotals, 0.10),
    rosterMedian: percentile(rosterTotals, 0.50),
    rosterCeiling: percentile(rosterTotals, 0.90),
    positionRunRisk: runRisk,
    outcomes,
    averageContextAdjustment: outcomes.reduce((sum, outcome) => sum + finite(outcome.context?.totalAdjustment, 0), 0) / outcomes.length,
  };
}


export function annotateMonteCarloCandidates(players = [], state = {}, options = {}) {
  const limit = Math.max(1, Math.min(12, Math.round(finite(options.monteCarloCandidateLimit, 6))));
  const trials = Math.max(10, Math.min(500, Math.round(finite(options.monteCarloTrials, 80))));
  const candidates = players.slice(0, limit);
  const results = candidates.map((player) => [playerKey(player), simulateCandidateMonteCarlo(players, state, player, { ...options, trials })]);
  const bestAverage = results.reduce((best, [, result]) => Math.max(best, result.averageStarterPoints), 0);
  const map = new Map(results.map(([key, result]) => [key, {
    ...result,
    averageStarterPointsVsBest: result.averageStarterPoints - bestAverage,
  }]));
  return players.map((player) => {
    const monteCarlo = map.get(playerKey(player));
    if (!monteCarlo) return player;
    return {
      ...player,
      draft: { ...(player.draft || {}), monteCarlo },
      v3Row: player.v3Row ? {
        ...player.v3Row,
        monteCarloAverageStarterPoints: monteCarlo.averageStarterPoints,
        monteCarloStarterFloor: monteCarlo.starterFloor,
        monteCarloStarterCeiling: monteCarlo.starterCeiling,
        monteCarloRunRisk: monteCarlo.positionRunRisk?.probabilityAtLeastOne,
      } : player.v3Row,
    };
  });
}

function closestOutcome(outcomes = [], target = 0, field = 'projectedStarterPoints') {
  if (!outcomes.length) return null;
  return outcomes.reduce((best, outcome) => {
    if (!best) return outcome;
    return Math.abs(finite(outcome?.[field], 0) - target) < Math.abs(finite(best?.[field], 0) - target)
      ? outcome
      : best;
  }, null);
}

function rosterNames(outcome = {}) {
  return (outcome.roster || []).map((player) => player?.name).filter(Boolean);
}

export function runDecisionExplorer(players = [], state = {}, options = {}) {
  const candidateLimit = Math.max(2, Math.min(8, Math.round(finite(options.candidateLimit, 4))));
  const trials = Math.max(25, Math.min(1000, Math.round(finite(options.trials, 300))));
  const candidates = [...players]
    .sort((a, b) => {
      const utility = finite(b?.draft?.simulation?.modeledDraftUtility, 0) - finite(a?.draft?.simulation?.modeledDraftUtility, 0);
      if (utility) return utility;
      return finite(b?.v3Row?.finalDraftScore, 0) - finite(a?.v3Row?.finalDraftScore, 0);
    })
    .slice(0, candidateLimit);

  const simulations = candidates.map((candidate, index) => ({
    candidate,
    result: simulateCandidateMonteCarlo(players, state, candidate, {
      ...options,
      trials,
      seed: finite(options.seed, 2026) + index * 104729,
    }),
  }));

  const trialWins = new Map(candidates.map((candidate) => [playerKey(candidate), 0]));
  for (let trial = 0; trial < trials; trial += 1) {
    let winner = null;
    simulations.forEach((entry) => {
      const score = finite(entry.result.outcomes?.[trial]?.projectedStarterPoints, -Infinity);
      if (!winner || score > winner.score) winner = { key: playerKey(entry.candidate), score };
    });
    if (winner) trialWins.set(winner.key, (trialWins.get(winner.key) || 0) + 1);
  }

  const summaries = simulations.map(({ candidate, result }) => {
    const medianOutcome = closestOutcome(result.outcomes, result.starterMedian);
    const floorOutcome = closestOutcome(result.outcomes, result.starterFloor);
    const ceilingOutcome = closestOutcome(result.outcomes, result.starterCeiling);
    const winRate = (trialWins.get(playerKey(candidate)) || 0) / trials;
    return {
      playerId: candidate.playerId,
      name: candidate.name,
      position: positionOf(candidate),
      modeledDraftUtility: finite(candidate?.draft?.simulation?.modeledDraftUtility, 0),
      averageStarterPoints: result.averageStarterPoints,
      averageRosterPoints: result.averageRosterPoints,
      starterFloor: result.starterFloor,
      starterMedian: result.starterMedian,
      starterCeiling: result.starterCeiling,
      rosterFloor: result.rosterFloor,
      rosterMedian: result.rosterMedian,
      rosterCeiling: result.rosterCeiling,
      bestOutcomeRate: winRate,
      regretRisk: 1 - winRate,
      positionRunRisk: result.positionRunRisk,
      averageContextAdjustment: result.averageContextAdjustment,
      medianContext: medianOutcome?.context || null,
      floorRoster: rosterNames(floorOutcome),
      medianRoster: rosterNames(medianOutcome),
      ceilingRoster: rosterNames(ceilingOutcome),
    };
  }).sort((a, b) => {
    const medianDelta = b.starterMedian - a.starterMedian;
    if (medianDelta) return medianDelta;
    return b.bestOutcomeRate - a.bestOutcomeRate;
  });

  const recommended = summaries[0] || null;
  const runnerUp = summaries[1] || null;
  const medianEdge = recommended && runnerUp ? recommended.starterMedian - runnerUp.starterMedian : 0;
  const confidence = recommended
    ? Math.max(0, Math.min(1, recommended.bestOutcomeRate * 0.7 + Math.min(1, Math.max(0, medianEdge) / 25) * 0.3))
    : 0;

  return {
    trials,
    candidateCount: summaries.length,
    recommended,
    confidence,
    medianEdge,
    candidates: summaries,
  };
}

export function compareCandidateSimulations(recommended = {}, alternative = {}) {
  const primary = recommended.draft?.simulation || recommended.simulation || {};
  const other = alternative.draft?.simulation || alternative.simulation || {};
  const primaryBreakdown = primary.modeledUtilityBreakdown || {};
  const otherBreakdown = other.modeledUtilityBreakdown || {};
  const fields = ['starter', 'flex', 'bench', 'rosterPlan', 'opportunity', 'tierScarcity', 'availability', 'strategy'];
  const utilityDeltas = Object.fromEntries(fields.map((field) => [field, finite(primaryBreakdown[field], 0) - finite(otherBreakdown[field], 0)]));
  utilityDeltas.replaceabilityPenalty = finite(otherBreakdown.replaceabilityPenalty, 0) - finite(primaryBreakdown.replaceabilityPenalty, 0);
  return {
    recommendedName: recommended.name || recommended.v3Row?.name || '',
    alternativeName: alternative.name || alternative.v3Row?.name || '',
    alternativePosition: positionOf(alternative),
    utilityDelta: finite(primary.modeledDraftUtility, 0) - finite(other.modeledDraftUtility, 0),
    starterPointsDelta: finite(primary.projectedStarterPoints, 0) - finite(other.projectedStarterPoints, 0),
    totalRosterPointsDelta: finite(primary.totalRosterPoints, 0) - finite(other.totalRosterPoints, 0),
    opportunityCostDelta: finite(primary.opportunityCost, 0) - finite(other.opportunityCost, 0),
    nextTurnDropoffDelta: finite(primary.nextTurnDropoff, 0) - finite(other.nextTurnDropoff, 0),
    utilityDeltas,
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
        modeledTotalRosterPoints: simulation.totalRosterPoints,
        modeledPointsVsBest: simulation.pointsVsBest,
        modeledDraftUtility: simulation.modeledDraftUtility,
        modeledUtilityBreakdown: simulation.modeledUtilityBreakdown,
        opportunityCost: simulation.opportunityCost,
        nextTurnDropoff: simulation.nextTurnDropoff,
        nextTurnAlternativeName: simulation.nextTurnAlternativeName,
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
  const withMonteCarlo = options.monteCarloTrials > 0
    ? annotateMonteCarloCandidates(withSimulation, draftState, options)
    : withSimulation;
  return withMonteCarlo.sort((a, b) => {
    const ar = rowValue(a, 'personalRank', Infinity);
    const br = rowValue(b, 'personalRank', Infinity);
    return ar - br;
  });
}