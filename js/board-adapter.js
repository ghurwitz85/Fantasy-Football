import { createEmptyPlayer, normalizeName, normalizePosition, normalizeTeam } from './player-normalizer.js';
import { buildProjectedPlayers } from './projection-engine.js';
import { applyReplacementValues } from './replacement-value-engine.js';
import { rankPlayers } from './ranking-engine.js';

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

export function buildV3BoardRows({ rankings = [], projections = [], adp = [] } = {}, scoring, leagueSettings) {
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

  const projected = buildProjectedPlayers(players, scoring);
  const withVorp = applyReplacementValues(projected, leagueSettings);
  return rankPlayers(withVorp).map((player) => ({
    ...player,
    v3Row: {
      personalRank: player.personalRank,
      name: player.name,
      team: player.team,
      position: player.position,
      consensusRank: player.consensus.overallRank,
      adp: player.adp.overall,
      adjustedProjection: player.adjusted.contextFantasyPoints,
      vorp: player.adjusted.replacementValue,
      finalDraftScore: player.adjusted.finalDraftScore,
      warnings: player.v3Status?.warnings || [],
    },
  }));
}