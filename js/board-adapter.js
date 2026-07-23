import { createEmptyPlayer, normalizeName, normalizePosition, normalizeTeam } from './player-normalizer.js';
import { applyHistoricalCalibration } from './historical-engine.js';
import { annotateAvailability } from './draft-state-engine.js';
import {
  applyAggregateContextCaps,
  applyQbAndReceiverGameScriptAdjustments,
  applyQbPassProtectionAdjustments,
  applyReceiverQbEnvironmentAdjustments,
  applyReceiverPassProtectionAdjustments,
  applyRbGameScriptAdjustments,
  applyRunBlockingAdjustments,
  applyRiskAdjustedProjections,
  applyScheduleAdjustments,
  buildProjectedPlayers,
} from './projection-engine.js';
import { applyReplacementValues } from './replacement-value-engine.js';
import { rankPlayers } from './ranking-engine.js';
import { normalizeLegacyTeamContext } from './team-environment-engine.js';

function keyFor(row = {}) {
  return [
    normalizeName(row.name || row.player || row.playerName || ''),
    normalizeTeam(row.team || row.player_team_id || ''),
    normalizePosition(row.position || row.pos || ''),
  ].join('|');
}

function looseNameKey(row = {}) {
  return normalizeName(row.name || row.player || row.playerName || '');
}

function indexRows(rows = []) {
  const exact = new Map();
  const byName = new Map();
  rows.forEach((row) => {
    exact.set(keyFor(row), row);
    const nameKey = looseNameKey(row);
    if (!byName.has(nameKey)) byName.set(nameKey, row);
  });
  return { exact, byName };
}

function findMatch(index, row) {
  return index.exact.get(keyFor(row)) || index.byName.get(looseNameKey(row)) || null;
}

export function buildV3BoardRows({ rankings = [], projections = [], adp = [], teamContext = null, historical = null } = {}, scoring, leagueSettings, contextWeights = {}) {
  const projectionIndex = indexRows(projections);
  const adpIndex = indexRows(adp);

  const players = rankings.map((rankingRow) => {
    const projectionRow = findMatch(projectionIndex, rankingRow);
    const adpRow = findMatch(adpIndex, rankingRow);
    const player = createEmptyPlayer({ ...rankingRow, ...(adpRow || {}) });
    return {
      ...player,
      projections: projectionRow?.projections || null,
      adp: {
        overall: Number(adpRow?.adp || adpRow?.overall || player.adp.overall || 0) || null,
        platform: adpRow?.platform || player.adp.platform || null,
      },
      v3Status: {
        hasProjection: Boolean(projectionRow?.projections),
        hasAdp: Boolean(adpRow),
        warnings: [
          ...(projectionRow?.projections ? [] : ['Projection missing; V3 score falls back to market/context components.']),
          ...(adpRow ? [] : ['ADP missing; availability/cost component is neutral.']),
        ],
      },
    };
  });

  const projected = buildProjectedPlayers(players, scoring, {
    bigPlayConfidence: Number(contextWeights.bigPlayConfidence ?? 1),
  });
  const normalizedTeamContext = teamContext ? normalizeLegacyTeamContext(teamContext).teams : {};
  const contextAdjusted = applyRunBlockingAdjustments(
    projected,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.runBlocking || 0),
  );
  const passProtectionAdjusted = applyQbPassProtectionAdjustments(
    contextAdjusted,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.passProtection || 0),
  );
  const receiverProtectionAdjusted = applyReceiverPassProtectionAdjustments(
    passProtectionAdjusted,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.passProtection || 0),
  );
  const qbEnvironmentAdjusted = applyReceiverQbEnvironmentAdjustments(
    receiverProtectionAdjusted,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.qbSupport || 0),
  );
  const scheduleAdjusted = applyScheduleAdjustments(
    qbEnvironmentAdjusted,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.schedule || 0),
  );
  const gameScriptAdjusted = applyRbGameScriptAdjustments(
    scheduleAdjusted,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.gameScript || 0),
  );
  const qbAndReceiverGameScriptAdjusted = applyQbAndReceiverGameScriptAdjustments(
    gameScriptAdjusted,
    normalizedTeamContext,
    scoring,
    Number(contextWeights.gameScript || 0),
  );
  const aggregateContextCapped = applyAggregateContextCaps(qbAndReceiverGameScriptAdjusted, {
    defaultCapPct: Number(contextWeights.aggregateContextCapPct ?? 0.07),
    maxCapPct: 0.10,
  });
  const riskAdjusted = applyRiskAdjustedProjections(aggregateContextCapped, {
    riskTolerance: Number(contextWeights.riskTolerance ?? 0.5),
    injuryPenaltyWeight: Number(contextWeights.injuryPenaltyWeight ?? 0.5),
    rookiePreference: Number(contextWeights.rookiePreference ?? 0),
  });
  const historicallyCalibrated = applyHistoricalCalibration(riskAdjusted, historical, scoring, {
    weight: Number(contextWeights.historyWeight ?? 0.04),
    currentSeason: Number(contextWeights.currentSeason || 2026),
  });
  const withVorp = applyReplacementValues(historicallyCalibrated, leagueSettings);
  const withAvailability = annotateAvailability(withVorp, {
    currentPick: Number(contextWeights.currentPick || 1),
    userDraftSlot: Number(contextWeights.userDraftSlot || 1),
    teams: Number(leagueSettings?.teams || 12),
  });
  return rankPlayers(withAvailability).map((player) => ({
    ...player,
    v3Row: {
      personalRank: player.personalRank,
      name: player.name,
      team: player.team,
      position: player.position,
      consensusRank: player.consensus.overallRank,
      adp: player.adp.overall,
      adjustedProjection: player.adjusted.contextFantasyPoints,
      baseProjection: player.adjusted.baseFantasyPoints,
      replacementBaseline: player.adjusted.replacementBaseline,
      vorp: player.adjusted.replacementValue,
      finalDraftScore: player.adjusted.finalDraftScore,
      availabilityProbability: player.draft?.availabilityProbability,
      draftUrgency: player.draft?.draftUrgency,
      nextPick: player.draft?.nextPick,
      audit: player.audit || null,
      projectionSource: player.audit?.projectionSource || 'unknown',
      warnings: player.v3Status?.warnings || [],
    },
  }));
}