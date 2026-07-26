import { createPlayerId, normalizeName, normalizePosition, normalizeTeam } from './player-normalizer.js';

function canonicalFieldName(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function cleanCsvText(text = '') {
  return String(text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u00A0/g, ' ');
}

export function splitCsvLine(line = '') {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function lookup(row = {}, aliases = []) {
  for (const alias of aliases) {
    const value = row[canonicalFieldName(alias)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function numberFrom(row = {}, aliases = [], fallback = null) {
  const value = lookup(row, aliases);
  const number = Number(String(value).replace(/[$,%]/g, '').trim());
  return Number.isFinite(number) ? number : fallback;
}

export function yahooDraftCsvTextToRows(text = '') {
  const lines = cleanCsvText(text).split('\n').filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map(canonicalFieldName);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((field, index) => [field, cells[index] ?? '']));
  });
}

export function normalizeYahooDraftResults(rows = [], { season = 2025, source = 'yahoo-draft-results-import' } = {}) {
  return rows.map((row, index) => {
    const name = lookup(row, ['Player', 'Player Name', 'Name']);
    const team = normalizeTeam(lookup(row, ['Team', 'NFL Team', 'Player Team']));
    const position = normalizePosition(lookup(row, ['Pos', 'Position']));
    const pickNumber = numberFrom(row, ['Pick', 'Overall Pick', 'Pick Number'], index + 1);
    const round = numberFrom(row, ['Round', 'Rnd'], Math.ceil(pickNumber / 12));
    const fantasyTeam = lookup(row, ['Drafted By', 'Fantasy Team', 'Manager', 'Team Name', 'Owner']);
    const cost = numberFrom(row, ['Cost', 'Price', 'Auction Value'], null);
    if (!name) return null;
    return {
      playerId: createPlayerId({ name, team, position }),
      name,
      normalizedName: normalizeName(name),
      team,
      position,
      season,
      pickNumber,
      round,
      fantasyTeam: fantasyTeam || null,
      cost,
      source,
    };
  }).filter(Boolean);
}

export function yahooDraftCsvTextToV3(text = '', options = {}) {
  return normalizeYahooDraftResults(yahooDraftCsvTextToRows(text), options);
}

export function summarizeDraftTendencies(draftRows = []) {
  const summary = {
    totalPicks: draftRows.length,
    byPosition: {},
    earlyRoundsByPosition: {},
    teams: {},
  };
  draftRows.forEach((pick) => {
    const position = pick.position || 'UNK';
    summary.byPosition[position] = (summary.byPosition[position] || 0) + 1;
    if (Number(pick.round) <= 5) summary.earlyRoundsByPosition[position] = (summary.earlyRoundsByPosition[position] || 0) + 1;
    if (pick.fantasyTeam) {
      if (!summary.teams[pick.fantasyTeam]) summary.teams[pick.fantasyTeam] = { total: 0, byPosition: {} };
      summary.teams[pick.fantasyTeam].total += 1;
      summary.teams[pick.fantasyTeam].byPosition[position] = (summary.teams[pick.fantasyTeam].byPosition[position] || 0) + 1;
    }
  });
  return summary;
}

export function parseCompactDraftLines(text = '', options = {}) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [round, pickInRound, name, team, position, fantasyTeam] = splitCsvLine(line);
      return {
        round,
        pick: ((Number(round) - 1) * Number(options.teams || 12)) + Number(pickInRound),
        player: name,
        team,
        pos: position,
        manager: fantasyTeam,
      };
    });
  return normalizeYahooDraftResults(rows, options);
}