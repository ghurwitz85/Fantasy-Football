const TEAM_ALIASES = Object.freeze({
  JAC: 'JAX',
  WSH: 'WAS',
  GNB: 'GB',
  KAN: 'KC',
  NWE: 'NE',
  NOR: 'NO',
  SFO: 'SF',
  TAM: 'TB',
  LA: 'LAR',
});

export function normalizeTeam(code = '') {
  const value = String(code || '').trim().toUpperCase();
  return TEAM_ALIASES[value] || value;
}

export function normalizePosition(position = '') {
  const match = String(position || '').toUpperCase().match(/QB|RB|WR|TE|K|DST|DEF/);
  if (!match) return '';
  return match[0] === 'DEF' ? 'DST' : match[0];
}

export function normalizeName(name = '') {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/\b([a-z])\.\s*/g, '$1 ')
    .replace(/[.']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b([a-z])\s+([a-z])\b/g, '$1$2')
    .trim()
    .replace(/\s+/g, ' ');
}

export function createPlayerId({ name, team, position } = {}) {
  const normalizedName = normalizeName(name).replace(/\s+/g, '-');
  const normalizedTeam = normalizeTeam(team) || 'FA';
  const normalizedPosition = normalizePosition(position) || 'UNK';
  return `${normalizedName}-${normalizedTeam}-${normalizedPosition}`;
}

export function createEmptyPlayer(row = {}) {
  const name = String(row.name || row.player || row.playerName || '').trim();
  const team = normalizeTeam(row.team || row.player_team_id || '');
  const position = normalizePosition(row.position || row.pos || '');

  return {
    playerId: createPlayerId({ name, team, position }),
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
    byeWeek: Number(row.byeWeek || row.bye || 0) || null,
    consensus: {
      overallRank: Number(row.overallRank || row.rank || 0) || null,
      positionRank: Number(row.positionRank || 0) || null,
      tier: Number(row.tier || 0) || null,
      bestRank: Number(row.bestRank || 0) || null,
      worstRank: Number(row.worstRank || 0) || null,
      rankStdDev: Number(row.rankStdDev || row.ecrStdDev || 0) || 0,
    },
    adp: {
      overall: Number(row.adp || row.adpOverall || 0) || null,
      platform: row.adpPlatform || null,
    },
    projections: null,
    role: {},
    risk: {
      injuryProbability: null,
      gamesProjection: 17,
      roleUncertainty: null,
      expertDisagreement: Number(row.rankStdDev || row.ecrStdDev || 0) || null,
      rookie: Boolean(row.rookie || row.rookieFlag),
    },
    adjusted: {
      baseFantasyPoints: 0,
      contextFantasyPoints: 0,
      replacementValue: 0,
      finalDraftScore: 0,
    },
  };
}