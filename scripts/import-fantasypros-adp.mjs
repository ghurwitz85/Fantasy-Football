import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_INPUT = 'FantasyPros_2026_Draft_ALL_Rankings.csv';
const DEFAULT_OUTPUT = 'data/adp.json';

const TEAM_ALIASES = Object.freeze({ JAC: 'JAX', WSH: 'WAS', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB' });
const VALID_ROSTER_TEAMS = new Set(['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']);

function splitCsvLine(line = '') {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function canonicalFieldName(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lookupValue(row = {}, aliases = []) {
  const canonicalAliases = new Set(aliases.map(canonicalFieldName));
  const match = Object.entries(row).find(([key, value]) => canonicalAliases.has(canonicalFieldName(key)) && value !== undefined && value !== '');
  return match ? match[1] : undefined;
}

function numberValue(value, fallback = null) {
  const number = Number(String(value ?? '').replace(/[+,]/g, '').trim());
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTeam(team = '') {
  const value = String(team || '').trim().toUpperCase();
  return TEAM_ALIASES[value] || value;
}

function normalizePosition(position = '') {
  const match = String(position || '').toUpperCase().match(/QB|RB|WR|TE|K|DST|DEF/);
  if (!match) return '';
  return match[0] === 'DEF' ? 'DST' : match[0];
}

export function parseFantasyProsAdpText(text = '') {
  const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((field, index) => [field, cells[index] ?? '']));
  });

  return rows.map((row) => {
    const rank = numberValue(lookupValue(row, ['RK', 'rank', 'overall rank']));
    const ecrVsAdp = numberValue(lookupValue(row, ['ECR VS. ADP', 'ecr vs adp']), 0);
    const adp = rank && Number.isFinite(ecrVsAdp) ? Math.max(1, rank + ecrVsAdp) : null;
    const position = normalizePosition(lookupValue(row, ['POS', 'position', 'pos']) || '');
    const team = normalizeTeam(lookupValue(row, ['TEAM', 'team', 'tm']) || '');
    return {
      name: lookupValue(row, ['PLAYER NAME', 'Player Name', 'player', 'name']),
      team,
      position,
      adp,
      overall: adp,
      platform: 'FantasyPros ECR-vs-ADP derived',
      source: 'fantasypros-ecr-vs-adp-derived',
      sourceRank: rank,
      ecrVsAdp,
      note: 'Approximate ADP derived from FantasyPros rank plus ECR VS. ADP delta because no direct ADP column was present in the local export.',
    };
  }).filter((row) => row.name && VALID_ROSTER_TEAMS.has(row.team) && row.position && row.adp);
}

export async function importFantasyProsAdp({ input = DEFAULT_INPUT, output = DEFAULT_OUTPUT } = {}) {
  const text = await fs.readFile(input, 'utf8');
  const players = parseFantasyProsAdpText(text);
  if (players.length < 100) throw new Error(`Only parsed ${players.length} ADP rows; refusing to overwrite ${output}.`);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'FantasyPros 2026 rankings export with approximate ADP derived from ECR VS. ADP deltas.',
    input,
    players,
  };
  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv[2] || DEFAULT_INPUT;
  const output = process.argv[3] || DEFAULT_OUTPUT;
  const payload = await importFantasyProsAdp({ input, output });
  console.log(`Imported ${payload.players.length} derived FantasyPros ADP rows to ${output}`);
}