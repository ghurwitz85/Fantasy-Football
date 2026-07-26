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
  return annotateDraftRecommendations(withTiers, options).sort((a, b) => {
    const ar = rowValue(a, 'personalRank', Infinity);
    const br = rowValue(b, 'personalRank', Infinity);
    return ar - br;
  });
}