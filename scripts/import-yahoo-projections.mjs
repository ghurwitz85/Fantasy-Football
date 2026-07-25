import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_INPUT = 'Yahoo 2026 Projections.rtfd/TXT.rtf';
const DEFAULT_OUTPUT = 'data/yahoo-projections-2026.json';

const TEAM_ALIASES = Object.freeze({
  Ari: 'ARI', Atl: 'ATL', Bal: 'BAL', Buf: 'BUF', Car: 'CAR', Chi: 'CHI', Cin: 'CIN', Cle: 'CLE', Dal: 'DAL', Den: 'DEN', Det: 'DET', GB: 'GB', Hou: 'HOU', Ind: 'IND', Jax: 'JAX', KC: 'KC', LAC: 'LAC', LAR: 'LAR', LV: 'LV', Mia: 'MIA', Min: 'MIN', NE: 'NE', NO: 'NO', NYG: 'NYG', NYJ: 'NYJ', Phi: 'PHI', Pit: 'PIT', Sea: 'SEA', SF: 'SF', TB: 'TB', Ten: 'TEN', Was: 'WAS', Wsh: 'WAS', FA: 'FA',
});

function normalizeTeam(team = '') {
  const trimmed = String(team || '').trim();
  return TEAM_ALIASES[trimmed] || TEAM_ALIASES[trimmed.toUpperCase()] || trimmed.toUpperCase();
}

function normalizePosition(position = '') {
  const match = String(position || '').toUpperCase().match(/QB|RB|WR|TE|K|DST|DEF/);
  if (!match) return '';
  return match[0] === 'DEF' ? 'DST' : match[0];
}

function numberValue(value, fallback = 0) {
  const cleaned = String(value ?? '').replace(/[% ,]/g, '').trim();
  if (!cleaned) return fallback;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : fallback;
}

function cleanName(value = '') {
  return String(value)
    .replace(/Video Forecast/g, '')
    .replace(/No new player Notes/g, '')
    .replace(/New Player Note/g, '')
    .replace(/Player Note/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlayerTeamLine(line = '') {
  return / - (QB|RB|WR|TE)(\b|,)/.test(line);
}

function isNoiseLine(line = '') {
  const trimmed = line.trim();
  return !trimmed
    || trimmed.includes('Add Player')
    || trimmed.includes('Drop Player')
    || trimmed.includes('All Free Agents')
    || trimmed.includes('Previous 25')
    || /^[\uE000-\uF8FF\s]+$/.test(trimmed);
}

function parsePlayerBlock(lines, startIndex) {
  const name = cleanName(lines[startIndex]);
  const teamPosition = lines[startIndex + 1] || '';
  const match = teamPosition.match(/^(.+?)\s+-\s+(.+)$/);
  if (!name || !match) return null;

  const team = normalizeTeam(match[1]);
  const position = normalizePosition(match[2]);
  if (!position || !['QB', 'RB', 'WR', 'TE'].includes(position)) return null;

  const rosterStatus = lines[startIndex + 3]?.trim() || '';
  const stats = lines.slice(startIndex + 4, startIndex + 27).map((value) => value.trim());
  if (stats.length < 23) return null;

  const [
    games, byeWeek, yahooFanPoints, preseasonRank, actualRank, rosteredPct,
    passYards, passTd, interceptions, fortyYardCompletions,
    rushAttempts, rushYards, rushTd, fortyYardRuns,
    targets, receptions, receivingYards, receivingTd, fortyYardReceptions,
    returnYards, returnTd, twoPointConversions, fumblesLost,
  ] = stats.map((value, index) => (index === 5 ? value : numberValue(value)));

  return {
    name,
    team,
    position,
    byeWeek,
    projectionSource: 'yahoo-2026-export',
    yahoo: {
      rosterStatus,
      fanPoints: yahooFanPoints,
      preseasonRank,
      actualRank,
      rosteredPct: numberValue(rosteredPct) / 100,
      returnYards,
      returnTd,
      twoPointConversions,
    },
    projections: {
      games,
      passing: {
        attempts: 0,
        completions: 0,
        yards: passYards,
        touchdowns: passTd,
        interceptions,
        fortyYardCompletions,
      },
      rushing: {
        attempts: rushAttempts,
        yards: rushYards,
        touchdowns: rushTd,
        fortyYardRuns,
      },
      receiving: {
        targets,
        receptions,
        yards: receivingYards,
        touchdowns: receivingTd,
        fortyYardReceptions,
      },
      fumblesLost,
    },
    role: {
      targetShare: position === 'WR' || position === 'TE' ? null : undefined,
      rushShare: position === 'RB' ? null : undefined,
    },
    risk: {
      gamesProjection: games || 17,
      roleUncertainty: null,
      expertDisagreement: null,
      rookie: false,
    },
  };
}

export function parseYahooProjectionText(text = '') {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => !isNoiseLine(line));
  const players = [];
  for (let i = 0; i <= lines.length - 27; i += 1) {
    if (!isPlayerTeamLine(lines[i + 1] || '')) continue;
    const player = parsePlayerBlock(lines, i);
    if (player) {
      players.push(player);
    }
  }
  return players;
}

async function readProjectionText(inputPath) {
  if (/\.rtf$/i.test(inputPath)) {
    return execFileSync('textutil', ['-convert', 'txt', '-stdout', inputPath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  }
  return fs.readFile(inputPath, 'utf8');
}

export async function importYahooProjections({ input = DEFAULT_INPUT, output = DEFAULT_OUTPUT } = {}) {
  const text = await readProjectionText(input);
  const players = parseYahooProjectionText(text);
  const counts = players.reduce((summary, player) => {
    summary[player.position] = (summary[player.position] || 0) + 1;
    return summary;
  }, {});
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'Yahoo 2026 projections exported from league player table RTFD and normalized into V3 stat projections.',
    input,
    counts,
    players,
  };
  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv[2] || DEFAULT_INPUT;
  const output = process.argv[3] || DEFAULT_OUTPUT;
  const payload = await importYahooProjections({ input, output });
  console.log(`Imported ${payload.players.length} Yahoo projections (${Object.entries(payload.counts).map(([pos, count]) => `${pos}:${count}`).join(', ')}) to ${output}`);
}