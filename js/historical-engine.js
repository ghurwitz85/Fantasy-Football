import { createPlayerId, normalizeName, normalizePosition, normalizeTeam } from './player-normalizer.js';
import { calculateFantasyPoints, normalizeStats } from './scoring-engine.js';

function rows(payload = {}) {
  const source = payload?.players || payload;
  return Array.isArray(source) ? source : [];
}

function historicalKey(row = {}) {
  return createPlayerId({
    name: row.name || row.player || row.playerName,
    team: row.team || row.player_team_id,
    position: row.position || row.pos,
  });
}

function looseNameKey(row = {}) {
  return normalizeName(row.name || row.player || row.playerName || '');
}

function seasonWeight(row = {}, currentSeason = null) {
  if (!currentSeason || !row.season) return Number(row.weight ?? 1) || 1;
  const age = Math.max(0, Number(currentSeason) - Number(row.season));
  if (age <= 1) return 0.60;
  if (age === 2) return 0.25;
  return 0.15;
}

function pointsForHistoricalRow(row = {}, scoring) {
  if (Number.isFinite(Number(row.fantasyPoints))) return Number(row.fantasyPoints);
  if (Number.isFinite(Number(row.points))) return Number(row.points);
  return calculateFantasyPoints(normalizeStats(row.projections || row.stats || row), scoring);
}

export function buildHistoricalIndex(payload = {}, scoring, { currentSeason = null } = {}) {
  const byExact = new Map();
  const byName = new Map();

  rows(payload).forEach((row) => {
    if (!row?.name && !row?.player && !row?.playerName) return;
    const key = historicalKey(row);
    const nameKey = looseNameKey(row);
    const games = Number(row.games || row.gamesPlayed || row.gp || row.projections?.games || 0) || 0;
    const points = pointsForHistoricalRow(row, scoring);
    const ppg = Number(row.pointsPerGame || row.ppg || 0) || (games > 0 ? points / games : points / 17);
    const weight = seasonWeight(row, currentSeason);
    const signal = {
      ...row,
      team: normalizeTeam(row.team || row.player_team_id || ''),
      position: normalizePosition(row.position || row.pos || ''),
      games,
      fantasyPoints: points,
      pointsPerGame: ppg,
      weight,
    };
    if (!byExact.has(key)) byExact.set(key, []);
    byExact.get(key).push(signal);
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(signal);
  });

  return { byExact, byName };
}

export function summarizeHistoricalSignal(player = {}, historicalIndex = null) {
  if (!historicalIndex) return null;
  const exact = historicalIndex.byExact.get(historicalKey(player));
  const matches = exact?.length ? exact : historicalIndex.byName.get(looseNameKey(player));
  if (!matches?.length) return null;

  const totalWeight = matches.reduce((sum, row) => sum + row.weight, 0) || 1;
  const weightedPpg = matches.reduce((sum, row) => sum + row.pointsPerGame * row.weight, 0) / totalWeight;
  const weightedGames = matches.reduce((sum, row) => sum + row.games * row.weight, 0) / totalWeight;
  const reliabilityScore = Math.max(0, Math.min(1, weightedGames / 17));
  const currentProjection = Number(player.adjusted?.contextFantasyPoints || player.adjusted?.baseFantasyPoints || 0);
  const currentPpg = currentProjection / 17;
  const sanityDeltaPct = currentPpg ? Math.max(-0.15, Math.min(0.15, (weightedPpg - currentPpg) / currentPpg)) : 0;

  return {
    matched: true,
    seasons: matches.length,
    weightedPointsPerGame: weightedPpg,
    weightedGames,
    reliabilityScore,
    sanityDeltaPct,
    teamChanged: matches.some((row) => row.team && player.team && row.team !== player.team),
  };
}

export function applyHistoricalCalibration(players = [], historicalPayload = null, scoring, options = {}) {
  const historicalIndex = buildHistoricalIndex(historicalPayload || {}, scoring, options);
  return players.map((player) => {
    const signal = summarizeHistoricalSignal(player, historicalIndex);
    if (!signal) {
      return {
        ...player,
        history: { ...(player.history || {}), reliabilityScore: 0.5, matched: false },
        audit: {
          ...(player.audit || {}),
          warnings: [...(player.audit?.warnings || []), 'Historical calibration is neutral because no matching history row is loaded.'],
        },
      };
    }

    const base = Number(player.adjusted?.contextFantasyPoints || 0);
    const calibrationWeight = Math.max(0, Math.min(1, Number(options.weight ?? 0.04)));
    const historyCalibration = base * signal.sanityDeltaPct * calibrationWeight * signal.reliabilityScore;
    const finalProjection = base + historyCalibration;
    return {
      ...player,
      history: {
        ...(player.history || {}),
        reliabilityScore: signal.reliabilityScore,
        matched: true,
        weightedPointsPerGame: signal.weightedPointsPerGame,
        seasons: signal.seasons,
      },
      adjusted: {
        ...(player.adjusted || {}),
        contextFantasyPoints: finalProjection,
      },
      audit: {
        ...(player.audit || {}),
        adjustments: {
          ...(player.audit?.adjustments || {}),
          historyCalibration,
        },
        history: signal,
        finalProjection,
      },
    };
  });
}