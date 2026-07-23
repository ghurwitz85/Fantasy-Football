import fs from 'node:fs/promises';
import path from 'node:path';
import { createFallbackProjection } from '../js/projection-engine.js';

const root = path.resolve(import.meta.dirname, '..');
const rankingsPath = path.join(root, 'data', 'rankings.json');
const projectionsPath = path.join(root, 'data', 'projections.json');

const TARGET_COUNTS = Object.freeze({ QB: 40, RB: 90, WR: 110, TE: 45 });
const VALID_TEAMS = new Set(['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAC','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']);

function normalizePosition(position = '') {
  const match = String(position || '').toUpperCase().match(/QB|RB|WR|TE/);
  return match ? match[0] : '';
}

function positionRank(row = {}) {
  const explicit = Number(row.positionRank || 0);
  if (explicit > 0) return explicit;
  const match = String(row.position || row.pos || '').toUpperCase().match(/(QB|RB|WR|TE)(\d+)/);
  if (match) return Number(match[2]);
  return null;
}

function roleFromProjection(position, projections) {
  if (position === 'RB') {
    const attempts = Number(projections.rushing?.attempts || 0);
    const targets = Number(projections.receiving?.targets || 0);
    const totalBackfieldOpps = Math.max(1, attempts + targets);
    return {
      rushShare: Math.max(0.18, Math.min(0.78, attempts / 360)),
      targetShare: Math.max(0.03, Math.min(0.22, targets / 130)),
      goalLineShare: Math.max(0.15, Math.min(0.70, Number(projections.rushing?.touchdowns || 0) / 14)),
      thirdDownShare: Math.max(0.15, Math.min(0.85, targets / totalBackfieldOpps + 0.15)),
    };
  }
  if (position === 'WR' || position === 'TE') {
    const targets = Number(projections.receiving?.targets || 0);
    const receptions = Number(projections.receiving?.receptions || 0);
    const yards = Number(projections.receiving?.yards || 0);
    const touchdowns = Number(projections.receiving?.touchdowns || 0);
    const ypr = receptions ? yards / receptions : 0;
    return {
      routeParticipation: Math.max(0.25, Math.min(0.95, targets / (position === 'TE' ? 135 : 170))),
      targetShare: Math.max(0.05, Math.min(0.32, targets / 560)),
      deepTargetShare: Math.max(0.04, Math.min(0.45, (ypr - 8) / 18)),
      redZoneTargetShare: Math.max(0.04, Math.min(0.35, touchdowns / 30)),
    };
  }
  return {};
}

function riskFromRank(row, posRank) {
  const rankStdDev = Number(row.rankStdDev || row.ecrStdDev || 0) || null;
  return {
    gamesProjection: 17,
    roleUncertainty: posRank ? Math.max(0.05, Math.min(0.45, (posRank - 1) / 180)) : null,
    expertDisagreement: rankStdDev,
    rookie: Boolean(row.rookie || row.rookieFlag),
  };
}

const rankingsPayload = JSON.parse(await fs.readFile(rankingsPath, 'utf8'));
const rankings = rankingsPayload.players || rankingsPayload;
const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
const players = [];

for (const row of rankings) {
  const position = normalizePosition(row.position || row.pos);
  if (!VALID_TEAMS.has(String(row.team || '').toUpperCase())) continue;
  if (!position || !TARGET_COUNTS[position] || counts[position] >= TARGET_COUNTS[position]) continue;
  const posRank = positionRank(row) || counts[position] + 1;
  const projections = createFallbackProjection({
    name: row.name,
    team: row.team,
    position,
    consensus: {
      overallRank: Number(row.rank || row.overallRank || 0) || null,
      positionRank: posRank,
    },
  });
  players.push({
    name: row.name,
    team: row.team,
    position,
    byeWeek: Number(row.bye || row.byeWeek || 0) || null,
    projectionSource: 'consensus-derived-fixture',
    projections,
    role: roleFromProjection(position, projections),
    risk: riskFromRank(row, posRank),
  });
  counts[position] += 1;
}

if (players.length < 200) throw new Error(`Only generated ${players.length} projections; refusing to overwrite cache.`);

await fs.writeFile(projectionsPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'Consensus-derived interim projections generated from data/rankings.json. Replace with real stat projections when feed automation is available.',
  counts,
  players,
}, null, 2)}\n`);

console.log(`Generated ${players.length} consensus-derived projections (${Object.entries(counts).map(([pos, count]) => `${pos}:${count}`).join(', ')}).`);