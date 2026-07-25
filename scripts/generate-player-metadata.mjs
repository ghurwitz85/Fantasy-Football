import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPlayerId, normalizeName, normalizePosition, normalizeTeam } from '../js/player-normalizer.js';

const DEFAULT_OUTPUT = 'data/players.json';
const DEFAULT_INPUTS = Object.freeze({
  rankings: 'data/rankings.json',
  yahooProjections: 'data/yahoo-projections-2026.json',
  adp: 'data/adp.json',
});
const VALID_ROSTER_TEAMS = new Set(['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']);

function rows(payload) {
  return payload?.players || payload || [];
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

function identityKey(row = {}) {
  const name = row.name || row.player || row.playerName || '';
  const team = normalizeTeam(row.team || row.player_team_id || '');
  const position = normalizePosition(row.position || row.pos || '');
  if (!name || !VALID_ROSTER_TEAMS.has(team) || !position) return null;
  return createPlayerId({ name, team, position });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildPlayerMetadata({ rankings = [], yahooProjections = [], adp = [] } = {}) {
  const byId = new Map();

  function ensure(row = {}) {
    const playerId = identityKey(row);
    if (!playerId) return null;
    if (!byId.has(playerId)) {
      const name = String(row.name || row.player || row.playerName || '').trim();
      const team = normalizeTeam(row.team || row.player_team_id || '');
      const position = normalizePosition(row.position || row.pos || '');
      byId.set(playerId, {
        playerId,
        sourceIds: {
          fantasyPros: row.fantasyProsId || null,
          sleeper: row.sleeperId || null,
          yahoo: row.yahooId || null,
          nflverse: row.nflverseId || null,
        },
        name,
        normalizedName: normalizeName(name),
        team,
        position,
        byeWeek: null,
        consensus: {
          overallRank: null,
          positionRank: null,
          tier: null,
        },
        adp: {
          overall: null,
          platform: null,
        },
        metadataSource: [],
      });
    }
    return byId.get(playerId);
  }

  rankings.forEach((row) => {
    const player = ensure(row);
    if (!player) return;
    player.byeWeek = player.byeWeek ?? numberOrNull(row.byeWeek || row.bye);
    player.consensus.overallRank = player.consensus.overallRank ?? numberOrNull(row.rank || row.overallRank);
    player.consensus.positionRank = player.consensus.positionRank ?? numberOrNull(row.positionRank);
    player.consensus.tier = player.consensus.tier ?? numberOrNull(row.tier);
    player.metadataSource.push('rankings');
  });

  yahooProjections.forEach((row) => {
    const player = ensure(row);
    if (!player) return;
    player.byeWeek = player.byeWeek ?? numberOrNull(row.byeWeek);
    player.sourceIds.yahoo = player.sourceIds.yahoo || row.yahooId || null;
    player.metadataSource.push('yahoo-projections');
  });

  adp.forEach((row) => {
    const player = ensure(row);
    if (!player) return;
    player.adp.overall = player.adp.overall ?? numberOrNull(row.adp || row.overall);
    player.adp.platform = player.adp.platform || row.platform || null;
    player.metadataSource.push('adp');
  });

  return [...byId.values()]
    .map((player) => ({
      ...player,
      metadataSource: [...new Set(player.metadataSource)],
    }))
    .sort((a, b) => (a.consensus.overallRank || a.adp.overall || 9999) - (b.consensus.overallRank || b.adp.overall || 9999));
}

export async function generatePlayerMetadata({ inputs = DEFAULT_INPUTS, output = DEFAULT_OUTPUT } = {}) {
  const [rankingsPayload, yahooPayload, adpPayload] = await Promise.all([
    readJson(inputs.rankings),
    readJson(inputs.yahooProjections),
    readJson(inputs.adp),
  ]);
  const players = buildPlayerMetadata({
    rankings: rows(rankingsPayload),
    yahooProjections: rows(yahooPayload),
    adp: rows(adpPayload),
  });
  if (players.length < 500) throw new Error(`Only generated ${players.length} player metadata rows; refusing to overwrite ${output}.`);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'Generated from bundled rankings, Yahoo 2026 projections, and derived FantasyPros ADP.',
    counts: players.reduce((counts, player) => {
      counts[player.position] = (counts[player.position] || 0) + 1;
      return counts;
    }, {}),
    players,
  };
  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output = process.argv[2] || DEFAULT_OUTPUT;
  const payload = await generatePlayerMetadata({ output });
  console.log(`Generated ${payload.players.length} player metadata rows (${Object.entries(payload.counts).map(([pos, count]) => `${pos}:${count}`).join(', ')}) to ${output}`);
}