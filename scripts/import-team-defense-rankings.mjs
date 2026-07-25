import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://www.teamrankings.com/nfl/stat/opponent-points-per-game';
const DEFAULT_OUTPUT = 'data/team-context.json';

const TEAM_NAME_TO_CODE = Object.freeze({
  Arizona: 'ARI', Atlanta: 'ATL', Baltimore: 'BAL', Buffalo: 'BUF', Carolina: 'CAR', Chicago: 'CHI', Cincinnati: 'CIN', Cleveland: 'CLE', Dallas: 'DAL', Denver: 'DEN', Detroit: 'DET', 'Green Bay': 'GB', Houston: 'HOU', Indianapolis: 'IND', Jacksonville: 'JAX', 'Kansas City': 'KC', 'LA Chargers': 'LAC', 'LA Rams': 'LAR', 'Las Vegas': 'LV', Miami: 'MIA', Minnesota: 'MIN', 'New England': 'NE', 'New Orleans': 'NO', 'NY Giants': 'NYG', 'NY Jets': 'NYJ', Philadelphia: 'PHI', Pittsburgh: 'PIT', Seattle: 'SEA', 'San Francisco': 'SF', 'Tampa Bay': 'TB', Tennessee: 'TEN', Washington: 'WAS',
});

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function cappedStandardScore(z) {
  return Math.max(-2, Math.min(2, z)) / 2;
}

function normalizeOpponentPoints(rows = []) {
  const values = rows.map((row) => row.pointsAllowedProjection).filter(Number.isFinite);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  return rows.map((row) => ({
    ...row,
    overallScore: standardDeviation ? Number(cappedStandardScore((mean - row.pointsAllowedProjection) / standardDeviation).toFixed(3)) : 0,
  }));
}

export function parseTeamRankingsDefenseHtml(html = '') {
  const tableMatch = String(html).match(/<table class="tr-table datatable scrollable">[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const rows = [...tableMatch[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((match) => match[0]);
  const parsed = rows.map((rowHtml) => {
    const rank = Number(rowHtml.match(/<td class="rank text-center" data-sort="([\d.]+)"/)?.[1]);
    const teamName = decodeHtml(rowHtml.match(/<td class="text-left nowrap" data-sort="([^"]+)"/)?.[1]);
    const dataSortValues = [...rowHtml.matchAll(/<td class="text-right(?: nowrap)?" data-sort="([\d.]+)"/g)].map((match) => Number(match[1]));
    const pointsAllowedProjection = dataSortValues[0];
    const team = TEAM_NAME_TO_CODE[teamName];
    return { team, teamName, rank, pointsAllowedProjection };
  }).filter((row) => row.team && Number.isFinite(row.rank) && Number.isFinite(row.pointsAllowedProjection));
  return normalizeOpponentPoints(parsed);
}

async function readSource(input = DEFAULT_URL) {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`${input} returned ${response.status}`);
    return response.text();
  }
  return fs.readFile(input, 'utf8');
}

export async function importTeamDefenseRankings({ input = DEFAULT_URL, output = DEFAULT_OUTPUT } = {}) {
  const html = await readSource(input);
  const defenseRows = parseTeamRankingsDefenseHtml(html);
  if (defenseRows.length !== 32) throw new Error(`Expected 32 defense rows, parsed ${defenseRows.length}; refusing to overwrite ${output}.`);

  const payload = JSON.parse(await fs.readFile(output, 'utf8'));
  const byTeam = new Map(defenseRows.map((row) => [row.team, row]));
  for (const [team, row] of Object.entries(payload.teams || {})) {
    const defense = byTeam.get(team);
    if (!defense) throw new Error(`No defense row found for ${team}`);
    row.defStrength = defense.rank;
    row.defense = {
      ...(row.defense || {}),
      overallScore: defense.overallScore,
      pointsAllowedProjection: defense.pointsAllowedProjection,
      sourceRank: defense.rank,
      source: 'TeamRankings opponent points per game',
    };
  }
  payload.generatedAt = new Date().toISOString();
  payload.defenseSource = {
    provider: 'TeamRankings',
    metric: 'Opponent points per game',
    url: input,
    note: 'Lower opponent points per game is treated as stronger defense, normalized with capped z-scores to the V3 -1..1 range.',
  };
  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
  return { ...payload.defenseSource, count: defenseRows.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv[2] || DEFAULT_URL;
  const output = process.argv[3] || DEFAULT_OUTPUT;
  const result = await importTeamDefenseRankings({ input, output });
  console.log(`Imported ${result.count} TeamRankings defense rows into ${output}`);
}