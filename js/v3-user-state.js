import { createPlayerId, normalizePosition, normalizeTeam } from './player-normalizer.js';

function canonicalFieldName(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[%+]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function lookupValue(row = {}, aliases = []) {
  const direct = aliases.find((alias) => row[alias] !== undefined && row[alias] !== '');
  if (direct) return row[direct];

  const canonicalAliases = new Set(aliases.map(canonicalFieldName));
  const match = Object.entries(row).find(([key, value]) => canonicalAliases.has(canonicalFieldName(key)) && value !== undefined && value !== '');
  return match ? match[1] : undefined;
}

function numberFrom(row, aliases = [], fallback = 0) {
  const value = lookupValue(row, aliases);
  const number = Number(String(value ?? '').replace(/[% ,]/g, '').trim());
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumberFrom(row, aliases = []) {
  const value = lookupValue(row, aliases);
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(/[% ,]/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function shareFrom(row, aliases = []) {
  const value = nullableNumberFrom(row, aliases);
  if (value === null) return null;
  return value > 1 ? value / 100 : value;
}

function booleanFrom(row, aliases = [], fallback = false) {
  const value = lookupValue(row, aliases);
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'rookie', 'r'].includes(String(value).trim().toLowerCase());
}

function cleanCsvText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ');
}

export function splitCsvLine(line = '') {
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

export function projectionCsvTextToV3(text = '') {
  const lines = cleanCsvText(text).trim().split(/\n/).filter((line) => line.trim().length);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((field, index) => [field, cells[index] ?? '']));
  });
  return projectionCsvRowsToV3(rows);
}

export function projectionCsvRowsToV3(rows = []) {
  return rows.map((row) => ({
    name: lookupValue(row, ['name', 'player', 'playerName', 'PLAYER NAME', 'Player Name']),
    team: normalizeTeam(lookupValue(row, ['team', 'tm', 'TEAM', 'player_team_id']) || ''),
    position: normalizePosition(lookupValue(row, ['position', 'pos', 'POS']) || ''),
    projections: {
      games: numberFrom(row, ['games', 'g', 'gp', 'Games', 'G'], 17) || 17,
      passing: {
        attempts: numberFrom(row, ['passAtt', 'passingAttempts', 'pass attempts', 'pass att', 'att', 'ATT'], 0),
        completions: numberFrom(row, ['passCmp', 'passingCompletions', 'pass completions', 'pass cmp', 'cmp', 'comp', 'CMP'], 0),
        yards: numberFrom(row, ['passYds', 'passingYards', 'pass yards', 'pass yds', 'Pass Yds', 'PYDS'], 0),
        touchdowns: numberFrom(row, ['passTD', 'passingTouchdowns', 'pass touchdowns', 'pass td', 'Pass TD', 'PTD'], 0),
        interceptions: numberFrom(row, ['int', 'ints', 'interceptions', 'INTS'], 0),
        fortyYardCompletions: numberFrom(row, ['pass40', 'fortyYardCompletions', '40+ pass', '40 yard pass', '40+ completions'], 0),
      },
      rushing: {
        attempts: numberFrom(row, ['rushAtt', 'rushingAttempts', 'rush attempts', 'rush att', 'carries', 'car', 'RUSH ATT'], 0),
        yards: numberFrom(row, ['rushYds', 'rushingYards', 'rush yards', 'rush yds', 'Rush Yds', 'RYDS'], 0),
        touchdowns: numberFrom(row, ['rushTD', 'rushingTouchdowns', 'rush touchdowns', 'rush td', 'Rush TD', 'RTD'], 0),
        fortyYardRuns: numberFrom(row, ['rush40', 'fortyYardRuns', '40+ rush', '40 yard rush', '40+ runs'], 0),
      },
      receiving: {
        targets: numberFrom(row, ['targets', 'target', 'tgt', 'tgts', 'receivingTargets', 'TGT'], 0),
        receptions: numberFrom(row, ['rec', 'receptions', 'catches', 'REC'], 0),
        yards: numberFrom(row, ['recYds', 'receivingYards', 'receiving yards', 'rec yards', 'rec yds', 'Recv Yds', 'YDS'], 0),
        touchdowns: numberFrom(row, ['recTD', 'receivingTouchdowns', 'receiving touchdowns', 'rec td', 'Recv TD', 'TD'], 0),
        fortyYardReceptions: numberFrom(row, ['rec40', 'fortyYardReceptions', '40+ rec', '40 yard rec', '40+ receptions'], 0),
      },
      fumblesLost: numberFrom(row, ['fumLost', 'fumblesLost', 'fl', 'fumbles lost', 'FUM LOST'], 0),
    },
    role: {
      snapShare: shareFrom(row, ['snapShare', 'snap share', 'snap%', 'snaps', 'Snap %']),
      routeParticipation: shareFrom(row, ['routeParticipation', 'route participation', 'route%', 'routes', 'Route %']),
      targetShare: shareFrom(row, ['targetShare', 'target share', 'target%', 'tgt%', 'Target %']),
      rushShare: shareFrom(row, ['rushShare', 'rush share', 'rush%', 'carryShare', 'carry share', 'Carry %']),
      goalLineShare: shareFrom(row, ['goalLineShare', 'goal line share', 'glShare', 'GL %']),
      twoMinuteShare: shareFrom(row, ['twoMinuteShare', 'two minute share', '2 minute share', '2Min %']),
      thirdDownShare: shareFrom(row, ['thirdDownShare', 'third down share', '3rd down share', '3D %']),
      deepTargetShare: shareFrom(row, ['deepTargetShare', 'deep target share', 'deep%', 'Deep Target %']),
      redZoneTargetShare: shareFrom(row, ['redZoneTargetShare', 'red zone target share', 'rzTargetShare', 'RZ Target %']),
    },
    risk: {
      injuryProbability: shareFrom(row, ['injuryProbability', 'injury probability', 'injury%', 'Injury %']),
      gamesProjection: numberFrom(row, ['gamesProjection', 'games projection', 'projected games', 'games', 'G'], 17) || 17,
      roleUncertainty: shareFrom(row, ['roleUncertainty', 'role uncertainty', 'role risk', 'Role Risk']),
      expertDisagreement: nullableNumberFrom(row, ['expertDisagreement', 'expert disagreement', 'rankStdDev', 'stdDev', 'ECR STD DEV']),
      rookie: booleanFrom(row, ['rookie', 'isRookie', 'Rookie'], false),
    },
  })).filter((row) => row.name);
}

export function createPreferenceKey(row = {}) {
  return createPlayerId({ name: row.name, team: row.team, position: row.position });
}

function numberValue(values = {}, key, fallback) {
  const value = Number(values[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function buildV3ScoringFromFormValues(values = {}) {
  return {
    passYardsPerPoint: numberValue(values, 's_passYdsPerPt', 25),
    passTd: numberValue(values, 's_passTD', 4),
    interception: numberValue(values, 's_int', -2),
    rushYardsPerPoint: numberValue(values, 's_rushYdsPerPt', 10),
    rushTd: numberValue(values, 's_rushTD', 6),
    reception: numberValue(values, 's_rec', 0.5),
    receivingYardsPerPoint: numberValue(values, 's_recYdsPerPt', 10),
    receivingTd: numberValue(values, 's_recTD', 6),
    fumbleLost: numberValue(values, 's_fumLost', -2),
    fortyYardPassBonus: numberValue(values, 's_pass40', 1),
    fortyYardRushBonus: numberValue(values, 's_rush40', 1),
    fortyYardReceptionBonus: numberValue(values, 's_rec40', 1),
  };
}

export function buildV3LeagueSettingsFromFormValues(values = {}) {
  return {
    teams: Math.max(1, Math.round(numberValue(values, 'numTeams', 12))),
    starters: {
      QB: Math.max(0, numberValue(values, 'rosterQB', 1)),
      RB: Math.max(0, numberValue(values, 'rosterRB', 2)),
      WR: Math.max(0, numberValue(values, 'rosterWR', 3)),
      TE: Math.max(0, numberValue(values, 'rosterTE', 1)),
      FLEX: Math.max(0, numberValue(values, 'rosterFLEX', 1)),
    },
    flexEligibility: ['RB', 'WR', 'TE'],
  };
}

export function buildV3PreferenceWeightsFromFormValues(values = {}) {
  const injurySlider = numberValue(values, 'injurySlider', 50);
  const rookieSlider = numberValue(values, 'rookieSlider', 0);
  return {
    injuryPenalty: Math.max(0, injurySlider) / 500,
    rookieBias: rookieSlider / 1000,
  };
}

export function buildV3RiskOptionsFromFormValues(values = {}) {
  const riskSlider = numberValue(values, 'riskSlider', 50);
  const injurySlider = numberValue(values, 'injurySlider', 50);
  const rookieSlider = numberValue(values, 'rookieSlider', 0);
  return {
    riskTolerance: Math.max(0, Math.min(1, riskSlider / 100)),
    injuryPenaltyWeight: Math.max(0, Math.min(1, injurySlider / 100)),
    rookiePreference: Math.max(-1, Math.min(1, rookieSlider / 100)),
  };
}

export function buildV3ContextWeightsFromFormValues(values = {}) {
  return {
    runBlocking: Math.max(0, numberValue(values, 'olRunSlider', 0)) / 100,
    passProtection: Math.max(0, numberValue(values, 'olPassSlider', 0)) / 100,
    qbSupport: Math.max(0, numberValue(values, 'qbSupportSlider', 0)) / 100,
    schedule: Math.max(0, numberValue(values, 'sosSlider', 0)) / 100,
    gameScript: Math.max(0, numberValue(values, 'gameScriptSlider', 0)) / 100,
    bigPlayConfidence: Math.max(0, Math.min(1, numberValue(values, 'bigPlaySlider', 100) / 100)),
    ...buildV3RiskOptionsFromFormValues(values),
  };
}

export function applyV3Preferences(players = [], preferences = {}, weights = {}) {
  const injuryPenalty = Number(weights.injuryPenalty ?? 0.05);
  const rookieBias = Number(weights.rookieBias ?? 0);
  return players.map((player) => {
    const key = createPreferenceKey(player);
    const pref = preferences[key] || {};
    const baseScore = Number(player.adjusted?.finalDraftScore || 0);
    let finalDraftScore = baseScore;
    const preferenceAudit = [];

    if (pref.injuryFlag) {
      finalDraftScore -= injuryPenalty;
      preferenceAudit.push(`Injury flag penalty: -${injuryPenalty.toFixed(3)}`);
    }
    if (pref.rookieFlag) {
      finalDraftScore += rookieBias;
      preferenceAudit.push(`Rookie preference: ${rookieBias >= 0 ? '+' : ''}${rookieBias.toFixed(3)}`);
    }
    if (Number(pref.overrideRank) > 0) {
      preferenceAudit.push(`Manual override rank: ${pref.overrideRank}`);
    }

    return {
      ...player,
      v3Preferences: pref,
      v3PreferenceAudit: preferenceAudit,
      adjusted: {
        ...(player.adjusted || {}),
        finalDraftScore,
      },
    };
  }).sort((a, b) => {
    const overrideA = Number(a.v3Preferences?.overrideRank || 0);
    const overrideB = Number(b.v3Preferences?.overrideRank || 0);
    if (overrideA && overrideB) return overrideA - overrideB;
    if (overrideA) return -1;
    if (overrideB) return 1;
    return Number(b.adjusted?.finalDraftScore || 0) - Number(a.adjusted?.finalDraftScore || 0);
  }).map((player, index) => ({
    ...player,
    personalRank: index + 1,
    v3Row: player.v3Row ? { ...player.v3Row, personalRank: index + 1, finalDraftScore: player.adjusted.finalDraftScore } : player.v3Row,
  }));
}