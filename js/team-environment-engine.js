import { normalizeTeam } from './player-normalizer.js';

export const LEGACY_TEAM_CONTEXT_FIELDS = Object.freeze({
  olRun: { outputPath: ['offensiveLine', 'runBlockScore'], label: 'Run blocking', rankOneIsBest: true },
  olPass: { outputPath: ['offensiveLine', 'passBlockScore'], label: 'Pass protection', rankOneIsBest: true },
  qbStrength: { outputPath: ['quarterback', 'overallScore'], label: 'QB environment', rankOneIsBest: true },
  defStrength: { outputPath: ['defense', 'overallScore'], label: 'Defense/game script', rankOneIsBest: true },
  sosRB: { outputPath: ['strengthOfSchedule', 'rb'], label: 'RB schedule', rankOneIsBest: false },
  sosWRTE: { outputPath: ['strengthOfSchedule', 'wr'], label: 'WR/TE schedule', rankOneIsBest: false },
  sosQB: { outputPath: ['strengthOfSchedule', 'qb'], label: 'QB schedule', rankOneIsBest: false },
});

export function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function rankToStandardScore(rank, { teams = 32, rankOneIsBest = true } = {}) {
  const numericRank = Number(rank);
  if (!Number.isFinite(numericRank) || numericRank <= 0 || teams <= 1) return 0;
  const midpoint = (teams + 1) / 2;
  const halfRange = (teams - 1) / 2;
  const raw = rankOneIsBest ? (midpoint - numericRank) / halfRange : (numericRank - midpoint) / halfRange;
  return clamp(raw);
}

function setNested(target, path, value) {
  let current = target;
  path.slice(0, -1).forEach((part) => {
    current[part] = current[part] || {};
    current = current[part];
  });
  current[path[path.length - 1]] = value;
}

function getNested(source, path) {
  return path.reduce((current, part) => current?.[part], source);
}

function finiteScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : null;
}

function valuesForField(teamRows, field) {
  return Object.values(teamRows)
    .map((row) => Number(row?.[field]))
    .filter((value) => Number.isFinite(value));
}

export function detectPlaceholderField(teamRows = {}, field, placeholder = 16) {
  const values = valuesForField(teamRows, field);
  return Boolean(values.length) && values.every((value) => value === placeholder);
}

export function normalizeLegacyTeamContext(payload = {}, options = {}) {
  const sourceTeams = payload.teams || payload;
  const teams = {};
  const fieldStatus = {};
  const teamCount = Object.keys(sourceTeams || {}).length || 32;

  Object.entries(LEGACY_TEAM_CONTEXT_FIELDS).forEach(([field, config]) => {
    const populated = valuesForField(sourceTeams, field).length;
    const richPopulated = Object.values(sourceTeams || {})
      .some((row) => finiteScore(getNested(row, config.outputPath)) !== null);
    const placeholder = detectPlaceholderField(sourceTeams, field, options.placeholder ?? 16);
    fieldStatus[field] = {
      label: config.label,
      supported: true,
      populated: populated > 0 || richPopulated,
      active: richPopulated || (populated > 0 && !placeholder),
      placeholder: !richPopulated && placeholder,
      message: richPopulated
        ? `${config.label} loaded from normalized V3 team context.`
        : placeholder
        ? `${config.label} is neutral because every team is still the placeholder value ${options.placeholder ?? 16}.`
        : `${config.label} normalized from rank-style team context.`,
    };
  });

  Object.entries(sourceTeams || {}).forEach(([teamCode, row]) => {
    const team = normalizeTeam(teamCode);
    const normalized = { team, sourceFormat: 'legacy-rank', warnings: [] };

    Object.entries(LEGACY_TEAM_CONTEXT_FIELDS).forEach(([field, config]) => {
      const status = fieldStatus[field];
      const richScore = finiteScore(getNested(row, config.outputPath));
      const score = richScore !== null
        ? richScore
        : status.active
        ? rankToStandardScore(row?.[field], { teams: teamCount, rankOneIsBest: config.rankOneIsBest })
        : 0;
      setNested(normalized, config.outputPath, score);
      if (status.placeholder) normalized.warnings.push(status.message);
    });

    const richQuarterback = row.quarterback || {};
    normalized.quarterback = {
      ...(normalized.quarterback || {}),
      accuracyScore: finiteScore(richQuarterback.accuracyScore) ?? normalized.quarterback?.overallScore ?? 0,
      deepAccuracyScore: finiteScore(richQuarterback.deepAccuracyScore) ?? normalized.quarterback?.overallScore ?? 0,
      touchdownEfficiencyScore: finiteScore(richQuarterback.touchdownEfficiencyScore) ?? normalized.quarterback?.overallScore ?? 0,
      pressureToSackScore: finiteScore(richQuarterback.pressureToSackScore) ?? 0,
      stabilityScore: finiteScore(richQuarterback.stabilityScore) ?? normalized.quarterback?.overallScore ?? 0,
    };

    if (row.offense) {
      normalized.offense = {
        projectedPointsPerGame: row.offense.projectedPointsPerGame ?? null,
        projectedPassRate: row.offense.projectedPassRate ?? null,
        passRateOverExpected: row.offense.passRateOverExpected ?? null,
        paceSecondsPerPlay: row.offense.paceSecondsPerPlay ?? null,
        offensiveEpaPerPlay: row.offense.offensiveEpaPerPlay ?? null,
      };
    }

    // Until separate TE schedule data exists, mirror the combined WR/TE fixture score to TE.
    normalized.strengthOfSchedule.te = normalized.strengthOfSchedule.wr;
    const defenseScore = normalized.defense?.overallScore || 0;
    const richLeadScore = finiteScore(row.expectedGameScript?.leadProbabilityScore ?? row.expectedGameScript?.leadProbability);
    const richTrailingScore = finiteScore(row.expectedGameScript?.trailingProbabilityScore ?? row.expectedGameScript?.trailingProbability);
    normalized.expectedGameScript = {
      leadProbabilityScore: richLeadScore ?? defenseScore,
      trailingProbabilityScore: richTrailingScore ?? -defenseScore,
      source: richLeadScore !== null || richTrailingScore !== null
        ? 'normalized-v3'
        : fieldStatus.defStrength?.active ? 'defense-proxy' : 'neutral-placeholder',
    };
    teams[team] = normalized;
  });

  return {
    generatedAt: payload.generatedAt || null,
    sourceFormat: 'legacy-rank',
    teams,
    status: fieldStatus,
    summary: summarizeTeamEnvironmentStatus(fieldStatus),
  };
}

export function summarizeTeamEnvironmentStatus(status = {}) {
  const fields = Object.values(status);
  const supported = fields.filter((field) => field.supported).length;
  const populated = fields.filter((field) => field.populated).length;
  const active = fields.filter((field) => field.active).length;
  const neutral = fields.filter((field) => field.populated && !field.active).length;
  return { supported, populated, active, neutral };
}