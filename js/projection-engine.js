import { calculateBigPlayPoints, calculateFantasyPoints, normalizeStats } from './scoring-engine.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionOf(player) {
  return String(player.position || '').replace(/[0-9]/g, '').toUpperCase();
}

function inferredPositionRank(player) {
  const explicit = Number(player.consensus?.positionRank || 0);
  if (explicit > 0) return explicit;
  const overall = Number(player.consensus?.overallRank || 0);
  if (!overall) return 99;
  const position = positionOf(player);
  const divisor = position === 'QB' || position === 'TE' ? 2.8 : 1.8;
  return Math.max(1, Math.round(overall / divisor));
}

export function estimateFallbackFantasyPoints(player = {}) {
  const position = positionOf(player);
  const rank = inferredPositionRank(player);
  const curves = {
    QB: { top: 360, drop: 7.5, floor: 120 },
    RB: { top: 295, drop: 6.2, floor: 45 },
    WR: { top: 285, drop: 5.1, floor: 45 },
    TE: { top: 220, drop: 4.7, floor: 35 },
  };
  const curve = curves[position];
  if (!curve) return 0;
  return Math.max(curve.floor, curve.top - (rank - 1) * curve.drop);
}

export function createFallbackProjection(player = {}, scoring = {}) {
  const target = estimateFallbackFantasyPoints(player);
  const position = positionOf(player);
  const stats = normalizeStats({ games: 17 });
  if (!target) return stats;

  if (position === 'QB') {
    const rushingPoints = target * 0.12;
    const passingPoints = target - rushingPoints;
    stats.passing.yards = passingPoints * 18;
    stats.passing.touchdowns = passingPoints / 18;
    stats.passing.interceptions = Math.max(4, passingPoints / 28);
    stats.passing.fortyYardCompletions = Math.max(1, passingPoints / 30);
    stats.rushing.yards = rushingPoints * 7;
    stats.rushing.touchdowns = rushingPoints / 14;
  } else if (position === 'RB') {
    stats.rushing.yards = target * 4.1;
    stats.rushing.touchdowns = target / 32;
    stats.rushing.attempts = stats.rushing.yards / 4.35;
    stats.rushing.fortyYardRuns = Math.max(0, target / 115);
    stats.receiving.receptions = target / 9;
    stats.receiving.targets = stats.receiving.receptions * 1.25;
    stats.receiving.yards = stats.receiving.receptions * 7.2;
    stats.receiving.touchdowns = target / 95;
  } else if (position === 'WR') {
    stats.receiving.receptions = target / 2.6;
    stats.receiving.targets = stats.receiving.receptions * 1.55;
    stats.receiving.yards = stats.receiving.receptions * 12.2;
    stats.receiving.touchdowns = target / 45;
    stats.receiving.fortyYardReceptions = Math.max(0, target / 75);
  } else if (position === 'TE') {
    stats.receiving.receptions = target / 2.7;
    stats.receiving.targets = stats.receiving.receptions * 1.45;
    stats.receiving.yards = stats.receiving.receptions * 10.4;
    stats.receiving.touchdowns = target / 42;
    stats.receiving.fortyYardReceptions = Math.max(0, target / 120);
  }

  const calculated = calculateFantasyPoints(stats, scoring);
  if (calculated > 0) {
    const scale = target / calculated;
    stats.passing.yards *= scale;
    stats.passing.touchdowns *= scale;
    stats.passing.interceptions *= scale;
    stats.passing.fortyYardCompletions *= scale;
    stats.rushing.yards *= scale;
    stats.rushing.touchdowns *= scale;
    stats.rushing.fortyYardRuns *= scale;
    stats.receiving.receptions *= scale;
    stats.receiving.yards *= scale;
    stats.receiving.touchdowns *= scale;
    stats.receiving.fortyYardReceptions *= scale;
  }
  return stats;
}

function applyBigPlayConfidence(stats, confidence = 1) {
  const normalizedConfidence = clamp(Number(confidence ?? 1), 0, 1);
  const adjustedStats = normalizeStats(stats);
  adjustedStats.passing.fortyYardCompletions *= normalizedConfidence;
  adjustedStats.rushing.fortyYardRuns *= normalizedConfidence;
  adjustedStats.receiving.fortyYardReceptions *= normalizedConfidence;
  return { stats: adjustedStats, confidence: normalizedConfidence };
}

export function attachBaseProjection(player, scoring, options = {}) {
  const hasProjection = Boolean(player.projections);
  const rawStats = hasProjection ? normalizeStats(player.projections) : createFallbackProjection(player, scoring);
  const rawBigPlayPoints = calculateBigPlayPoints(rawStats, scoring);
  const { stats, confidence: bigPlayConfidence } = applyBigPlayConfidence(rawStats, options.bigPlayConfidence ?? 1);
  const baseFantasyPoints = calculateFantasyPoints(stats, scoring);
  const bigPlayPoints = calculateBigPlayPoints(stats, scoring);

  return {
    ...player,
    projections: stats,
    adjusted: {
      ...(player.adjusted || {}),
      baseFantasyPoints,
      contextFantasyPoints: baseFantasyPoints,
    },
    audit: {
      baseProjection: baseFantasyPoints,
      adjustments: {
        bigPlayBonus: bigPlayPoints,
        bigPlayConfidenceAdjustment: bigPlayPoints - rawBigPlayPoints,
      },
      finalProjection: baseFantasyPoints,
      projectionSource: hasProjection ? 'loaded' : 'consensus-fallback',
      bigPlay: {
        confidence: bigPlayConfidence,
        projectedBonusBeforeConfidence: rawBigPlayPoints,
        projectedBonusAfterConfidence: bigPlayPoints,
        note: 'League 40+ yard bonuses are scored explicitly; confidence only regresses expected event counts and does not multiply scoring rules.',
      },
      warnings: hasProjection ? [] : ['Projection data missing; using explicit consensus-derived fallback projection until real stat projections are loaded.'],
    },
  };
}

export function applyContextAdjustment(player, adjustmentPoints, label, capPct = 0.10) {
  const base = Number(player.adjusted?.baseFantasyPoints || 0);
  const cappedAdjustment = clamp(Number(adjustmentPoints || 0), -base * capPct, base * capPct);
  const current = Number(player.adjusted?.contextFantasyPoints ?? base);
  const nextProjection = current + cappedAdjustment;

  return {
    ...player,
    adjusted: {
      ...(player.adjusted || {}),
      contextFantasyPoints: nextProjection,
    },
    audit: {
      ...(player.audit || { baseProjection: base, adjustments: {}, warnings: [] }),
      adjustments: {
        ...(player.audit?.adjustments || {}),
        [label]: cappedAdjustment,
      },
      finalProjection: nextProjection,
      warnings: player.audit?.warnings || [],
    },
  };
}

export const DEFAULT_CONTEXT_ADJUSTMENT_LABELS = Object.freeze([
  'runBlocking',
  'passProtection',
  'receiverPassProtection',
  'qbEnvironment',
  'schedule',
  'gameScript',
]);

export function applyAggregateContextCap(player, {
  defaultCapPct = 0.07,
  maxCapPct = 0.10,
  labels = DEFAULT_CONTEXT_ADJUSTMENT_LABELS,
} = {}) {
  const base = Number(player.adjusted?.baseFantasyPoints || 0);
  if (!base) return player;

  const capPct = clamp(Number(defaultCapPct || 0), 0, Number(maxCapPct || 0.10));
  const capPoints = base * capPct;
  const adjustments = player.audit?.adjustments || {};
  const rawContextAdjustments = Object.fromEntries(
    labels.map((label) => [label, Number(adjustments[label] || 0)]),
  );
  const rawTotal = Object.values(rawContextAdjustments).reduce((sum, value) => sum + value, 0);
  const cappedTotal = clamp(rawTotal, -capPoints, capPoints);
  const scale = rawTotal && cappedTotal !== rawTotal ? cappedTotal / rawTotal : 1;
  const cappedContextAdjustments = Object.fromEntries(
    Object.entries(rawContextAdjustments).map(([label, value]) => [label, value * scale]),
  );
  const finalProjection = base + cappedTotal;

  return {
    ...player,
    adjusted: {
      ...(player.adjusted || {}),
      contextFantasyPoints: finalProjection,
    },
    audit: {
      ...(player.audit || {}),
      adjustments: {
        ...adjustments,
        ...cappedContextAdjustments,
      },
      rawContextAdjustments,
      contextCap: {
        applied: cappedTotal !== rawTotal,
        capPct,
        capPoints,
        rawTotal,
        cappedTotal,
        totalPct: cappedTotal / base,
      },
      finalProjection,
    },
  };
}

export function applyAggregateContextCaps(players = [], options = {}) {
  return players.map((player) => applyAggregateContextCap(player, options));
}

function inferRoleUncertainty(player) {
  const explicit = Number(player.risk?.roleUncertainty);
  if (Number.isFinite(explicit) && explicit >= 0) return clamp(explicit, 0, 1);
  const disagreement = Number(player.risk?.expertDisagreement || player.consensus?.rankStdDev || 0);
  return clamp(disagreement / 40, 0, 0.35);
}

function inferInjuryProbability(player) {
  const explicit = Number(player.risk?.injuryProbability);
  if (Number.isFinite(explicit) && explicit >= 0) return clamp(explicit, 0, 1);
  const gamesProjection = Number(player.risk?.gamesProjection || player.projections?.games || 17);
  return clamp((17 - gamesProjection) / 17, 0, 0.35);
}

export function calculateRiskRange(player, options = {}) {
  const median = Number(player.adjusted?.contextFantasyPoints ?? player.adjusted?.baseFantasyPoints ?? 0);
  const injuryProbability = inferInjuryProbability(player);
  const roleUncertainty = inferRoleUncertainty(player);
  const rookieUncertainty = player.risk?.rookie ? Number(options.rookieUncertainty ?? 0.08) : 0;
  const volatility = clamp(0.08 + roleUncertainty * 0.22 + injuryProbability * 0.18 + rookieUncertainty, 0.06, 0.35);
  const downsidePct = clamp(volatility + injuryProbability * 0.35 + roleUncertainty * 0.12, 0.06, 0.45);
  const upsidePct = clamp(volatility + roleUncertainty * 0.18 + rookieUncertainty * 0.75, 0.06, 0.40);

  return {
    median,
    floor: median * (1 - downsidePct),
    ceiling: median * (1 + upsidePct),
    injuryProbability,
    roleUncertainty,
    rookieUncertainty,
    downsidePct,
    upsidePct,
  };
}

export function applyRiskAdjustedProjection(player, {
  riskTolerance = 0.5,
  injuryPenaltyWeight = 0.5,
  rookiePreference = 0,
} = {}) {
  const range = calculateRiskRange(player);
  const riskAversion = clamp(1 - Number(riskTolerance ?? 0.5), 0, 1);
  const upsidePreference = clamp(Number(riskTolerance ?? 0.5), 0, 1);
  const injuryWeight = clamp(Number(injuryPenaltyWeight ?? 0.5), 0, 1);
  const rookieBias = player.risk?.rookie ? clamp(Number(rookiePreference || 0), -1, 1) : 0;
  const upsideAdjustment = upsidePreference * (range.ceiling - range.median) * 0.35;
  const downsideAdjustment = riskAversion * (range.median - range.floor) * 0.35;
  const injuryAdjustment = -(range.median * range.injuryProbability * injuryWeight * 0.12);
  const rookieAdjustment = range.median * rookieBias * 0.03;
  const totalRiskAdjustment = upsideAdjustment - downsideAdjustment + injuryAdjustment + rookieAdjustment;
  const finalProjection = range.median + totalRiskAdjustment;

  return {
    ...player,
    adjusted: {
      ...(player.adjusted || {}),
      contextFantasyPoints: finalProjection,
      floorProjection: range.floor,
      medianProjection: range.median,
      ceilingProjection: range.ceiling,
    },
    audit: {
      ...(player.audit || {}),
      adjustments: {
        ...(player.audit?.adjustments || {}),
        risk: totalRiskAdjustment,
        injuryRisk: injuryAdjustment,
        rookiePreference: rookieAdjustment,
      },
      risk: {
        ...range,
        riskTolerance,
        riskAversion,
        upsidePreference,
        upsideAdjustment,
        downsideAdjustment,
        injuryAdjustment,
        rookieAdjustment,
      },
      finalProjection,
    },
  };
}

export function applyRiskAdjustedProjections(players = [], options = {}) {
  return players.map((player) => applyRiskAdjustedProjection(player, options));
}

function playerRushShare(player) {
  const explicitShare = Number(player.role?.rushShare);
  if (Number.isFinite(explicitShare) && explicitShare > 0) return clamp(explicitShare, 0, 1);
  const attempts = Number(player.projections?.rushing?.attempts || 0);
  if (!attempts) return 0.35;
  if (attempts >= 250) return 0.75;
  if (attempts >= 175) return 0.60;
  if (attempts >= 100) return 0.45;
  return 0.25;
}

function playerGoalLineShare(player) {
  const explicitShare = Number(player.role?.goalLineShare);
  if (Number.isFinite(explicitShare) && explicitShare > 0) return clamp(explicitShare, 0, 1);
  const rushingTouchdowns = Number(player.projections?.rushing?.touchdowns || 0);
  if (rushingTouchdowns >= 10) return 0.70;
  if (rushingTouchdowns >= 6) return 0.55;
  if (rushingTouchdowns >= 3) return 0.40;
  return 0.25;
}

export function calculateRunBlockingAdjustment(player, teamEnvironment, scoring, weight = 0) {
  if (String(player.position || '').replace(/[0-9]/g, '') !== 'RB') return { points: 0, warning: null };
  const runBlockScore = Number(teamEnvironment?.offensiveLine?.runBlockScore || 0);
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  if (!runBlockScore || !normalizedWeight) return { points: 0, warning: null };

  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const rushShare = playerRushShare(player);
  const goalLineShare = playerGoalLineShare(player);

  const rushYardsAdjustment = runBlockScore * rushShare * normalizedWeight * 0.04;
  const rushTdAdjustment = runBlockScore * goalLineShare * normalizedWeight * 0.05;
  const explosiveRunAdjustment = runBlockScore * rushShare * normalizedWeight * 0.03;

  adjustedStats.rushing = {
    ...adjustedStats.rushing,
    yards: stats.rushing.yards * (1 + rushYardsAdjustment),
    touchdowns: stats.rushing.touchdowns * (1 + rushTdAdjustment),
    fortyYardRuns: stats.rushing.fortyYardRuns * (1 + explosiveRunAdjustment),
  };

  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { runBlockScore, rushShare, goalLineShare, rushYardsAdjustment, rushTdAdjustment, explosiveRunAdjustment },
  };
}

export function applyRunBlockingAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) {
      return {
        ...player,
        audit: {
          ...(player.audit || {}),
          warnings: [...(player.audit?.warnings || []), 'Run blocking is neutral because team context is missing.'],
        },
      };
    }
    const adjustment = calculateRunBlockingAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'runBlocking', 0.10);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        details: {
          ...(adjusted.audit?.details || {}),
          runBlocking: adjustment.details || null,
        },
      },
    };
  });
}

export function calculateQbPassProtectionAdjustment(player, teamEnvironment, scoring, weight = 0) {
  if (String(player.position || '').replace(/[0-9]/g, '') !== 'QB') return { points: 0, warning: null };
  const passBlockScore = Number(teamEnvironment?.offensiveLine?.passBlockScore || 0);
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  if (!passBlockScore || !normalizedWeight) return { points: 0, warning: null };

  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const passEfficiencyAdjustment = passBlockScore * normalizedWeight * 0.025;
  const passTdAdjustment = passBlockScore * normalizedWeight * 0.020;
  const deepCompletionAdjustment = passBlockScore * normalizedWeight * 0.030;
  const interceptionAdjustment = passBlockScore * normalizedWeight * -0.015;

  adjustedStats.passing = {
    ...adjustedStats.passing,
    yards: stats.passing.yards * (1 + passEfficiencyAdjustment),
    touchdowns: stats.passing.touchdowns * (1 + passTdAdjustment),
    fortyYardCompletions: stats.passing.fortyYardCompletions * (1 + deepCompletionAdjustment),
    interceptions: stats.passing.interceptions * (1 + interceptionAdjustment),
  };

  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { passBlockScore, passEfficiencyAdjustment, passTdAdjustment, deepCompletionAdjustment, interceptionAdjustment },
  };
}

export function applyQbPassProtectionAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) {
      return {
        ...player,
        audit: {
          ...(player.audit || {}),
          warnings: [...(player.audit?.warnings || []), 'Pass protection is neutral because team context is missing.'],
        },
      };
    }
    const adjustment = calculateQbPassProtectionAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'passProtection', 0.10);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        details: {
          ...(adjusted.audit?.details || {}),
          passProtection: adjustment.details || null,
        },
      },
    };
  });
}

function receiverProtectionSensitivity(player) {
  const role = player.role || {};
  const deepTargetShare = Number(role.deepTargetShare ?? 0);
  const routeParticipation = Number(role.routeParticipation ?? 0);
  const targets = Number(player.projections?.receiving?.targets || 0);
  const receptions = Number(player.projections?.receiving?.receptions || 0);
  const yards = Number(player.projections?.receiving?.yards || 0);
  const yardsPerReception = receptions ? yards / receptions : 0;
  const inferredDeepRole = yardsPerReception >= 14 ? 0.25 : yardsPerReception >= 12 ? 0.15 : 0;
  const inferredRouteRole = targets >= 120 ? 0.15 : targets >= 80 ? 0.1 : 0.05;
  return clamp(0.5 + Math.max(deepTargetShare, inferredDeepRole) * 0.35 + Math.max(routeParticipation, inferredRouteRole) * 0.15, 0.35, 1);
}

export function calculateReceiverPassProtectionAdjustment(player, teamEnvironment, scoring, weight = 0) {
  const position = String(player.position || '').replace(/[0-9]/g, '');
  if (!['WR', 'TE'].includes(position)) return { points: 0, warning: null };
  const passBlockScore = Number(teamEnvironment?.offensiveLine?.passBlockScore || 0);
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  if (!passBlockScore || !normalizedWeight) return { points: 0, warning: null };

  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const sensitivity = receiverProtectionSensitivity(player);
  const yardsAdjustment = passBlockScore * normalizedWeight * sensitivity * 0.012;
  const touchdownAdjustment = passBlockScore * normalizedWeight * sensitivity * 0.010;
  const bigPlayAdjustment = passBlockScore * normalizedWeight * sensitivity * 0.025;

  adjustedStats.receiving = {
    ...adjustedStats.receiving,
    yards: stats.receiving.yards * (1 + yardsAdjustment),
    touchdowns: stats.receiving.touchdowns * (1 + touchdownAdjustment),
    fortyYardReceptions: stats.receiving.fortyYardReceptions * (1 + bigPlayAdjustment),
  };

  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { passBlockScore, sensitivity, yardsAdjustment, touchdownAdjustment, bigPlayAdjustment },
  };
}

export function applyReceiverPassProtectionAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) return player;
    const adjustment = calculateReceiverPassProtectionAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'receiverPassProtection', 0.10);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        details: {
          ...(adjusted.audit?.details || {}),
          receiverPassProtection: adjustment.details || null,
        },
      },
    };
  });
}

function receiverQbSensitivity(player) {
  const role = player.role || {};
  const targets = Number(player.projections?.receiving?.targets || 0);
  const receptions = Number(player.projections?.receiving?.receptions || 0);
  const yards = Number(player.projections?.receiving?.yards || 0);
  const touchdowns = Number(player.projections?.receiving?.touchdowns || 0);
  const yardsPerReception = receptions ? yards / receptions : 0;
  const possessionSensitivity = Math.max(Number(role.targetShare || 0), targets >= 120 ? 0.9 : targets >= 80 ? 0.7 : 0.45);
  const deepThreatSensitivity = Math.max(Number(role.deepTargetShare || 0), yardsPerReception >= 14 ? 0.85 : yardsPerReception >= 12 ? 0.55 : 0.25);
  const redZoneSensitivity = Math.max(Number(role.redZoneTargetShare || 0), touchdowns >= 8 ? 0.85 : touchdowns >= 5 ? 0.6 : 0.35);
  return { possessionSensitivity, deepThreatSensitivity, redZoneSensitivity };
}

export function calculateReceiverQbEnvironmentAdjustment(player, teamEnvironment, scoring, weight = 0) {
  const position = String(player.position || '').replace(/[0-9]/g, '');
  if (!['WR', 'TE'].includes(position)) return { points: 0, warning: null };
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  const quarterback = teamEnvironment?.quarterback || {};
  const overallScore = Number(quarterback.overallScore || 0);
  const accuracyScore = Number(quarterback.accuracyScore ?? overallScore);
  const deepAccuracyScore = Number(quarterback.deepAccuracyScore ?? overallScore);
  const touchdownEfficiencyScore = Number(quarterback.touchdownEfficiencyScore ?? overallScore);
  const stabilityScore = Number(quarterback.stabilityScore ?? overallScore);
  const signal = Math.max(Math.abs(overallScore), Math.abs(accuracyScore), Math.abs(deepAccuracyScore), Math.abs(touchdownEfficiencyScore), Math.abs(stabilityScore));
  if (!normalizedWeight) return { points: 0, warning: null };
  if (!signal) return { points: 0, warning: 'QB environment is neutral because no active QB context is loaded.' };

  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const sensitivities = receiverQbSensitivity(player);
  const catchVolumeAdjustment = accuracyScore * sensitivities.possessionSensitivity * normalizedWeight * 0.012;
  const yardsAdjustment = (accuracyScore * 0.45 + deepAccuracyScore * 0.55) * sensitivities.deepThreatSensitivity * normalizedWeight * 0.018;
  const touchdownAdjustment = touchdownEfficiencyScore * sensitivities.redZoneSensitivity * normalizedWeight * 0.025;
  const stabilityAdjustment = stabilityScore * normalizedWeight * 0.006;

  adjustedStats.receiving = {
    ...adjustedStats.receiving,
    receptions: stats.receiving.receptions * (1 + catchVolumeAdjustment + stabilityAdjustment),
    yards: stats.receiving.yards * (1 + yardsAdjustment + stabilityAdjustment),
    touchdowns: stats.receiving.touchdowns * (1 + touchdownAdjustment),
    fortyYardReceptions: stats.receiving.fortyYardReceptions * (1 + deepAccuracyScore * sensitivities.deepThreatSensitivity * normalizedWeight * 0.02),
  };

  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { overallScore, accuracyScore, deepAccuracyScore, touchdownEfficiencyScore, stabilityScore, ...sensitivities, catchVolumeAdjustment, yardsAdjustment, touchdownAdjustment, stabilityAdjustment },
  };
}

export function applyReceiverQbEnvironmentAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) return player;
    const adjustment = calculateReceiverQbEnvironmentAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'qbEnvironment', 0.10);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        warnings: adjustment.warning ? [...(adjusted.audit?.warnings || []), adjustment.warning] : (adjusted.audit?.warnings || []),
        details: {
          ...(adjusted.audit?.details || {}),
          qbEnvironment: adjustment.details || null,
        },
      },
    };
  });
}

function positionKey(position) {
  const normalized = String(position || '').replace(/[0-9]/g, '').toUpperCase();
  return normalized === 'QB' ? 'qb' : normalized === 'RB' ? 'rb' : normalized === 'TE' ? 'te' : normalized === 'WR' ? 'wr' : null;
}

function scaleStats(rawStats, position, factor) {
  const stats = normalizeStats(rawStats);
  const adjustedStats = normalizeStats(stats);
  if (position === 'QB') {
    adjustedStats.passing = {
      ...adjustedStats.passing,
      yards: stats.passing.yards * (1 + factor),
      touchdowns: stats.passing.touchdowns * (1 + factor),
      fortyYardCompletions: stats.passing.fortyYardCompletions * (1 + factor),
      interceptions: stats.passing.interceptions * (1 - factor * 0.5),
    };
  } else if (position === 'RB') {
    adjustedStats.rushing = {
      ...adjustedStats.rushing,
      yards: stats.rushing.yards * (1 + factor),
      touchdowns: stats.rushing.touchdowns * (1 + factor),
      fortyYardRuns: stats.rushing.fortyYardRuns * (1 + factor),
    };
    adjustedStats.receiving = {
      ...adjustedStats.receiving,
      yards: stats.receiving.yards * (1 + factor * 0.5),
      touchdowns: stats.receiving.touchdowns * (1 + factor * 0.5),
    };
  } else if (['WR', 'TE'].includes(position)) {
    adjustedStats.receiving = {
      ...adjustedStats.receiving,
      receptions: stats.receiving.receptions * (1 + factor * 0.4),
      yards: stats.receiving.yards * (1 + factor),
      touchdowns: stats.receiving.touchdowns * (1 + factor),
      fortyYardReceptions: stats.receiving.fortyYardReceptions * (1 + factor),
    };
  }
  return adjustedStats;
}

export function calculateScheduleAdjustment(player, teamEnvironment, scoring, weight = 0) {
  const position = String(player.position || '').replace(/[0-9]/g, '').toUpperCase();
  const key = positionKey(position);
  if (!key) return { points: 0, warning: null };
  const sosScore = Number(teamEnvironment?.strengthOfSchedule?.[key] || 0);
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  if (!sosScore || !normalizedWeight) return { points: 0, warning: null };
  const factor = clamp(sosScore * normalizedWeight * 0.025, -0.03, 0.03);
  const stats = normalizeStats(player.projections || {});
  const adjustedStats = scaleStats(stats, position, factor);
  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { position, sosScore, factor },
  };
}

export function applyScheduleAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) return player;
    const adjustment = calculateScheduleAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'schedule', 0.03);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        details: {
          ...(adjusted.audit?.details || {}),
          schedule: adjustment.details || null,
        },
      },
    };
  });
}

function rbGameScriptRoles(player) {
  const role = player.role || {};
  const earlyDownRole = Number(role.rushShare ?? playerRushShare(player));
  const receivingRole = Number(role.thirdDownShare ?? role.targetShare ?? (Number(player.projections?.receiving?.targets || 0) >= 60 ? 0.75 : Number(player.projections?.receiving?.targets || 0) >= 35 ? 0.55 : 0.25));
  return { earlyDownRole: clamp(earlyDownRole, 0, 1), receivingRole: clamp(receivingRole, 0, 1) };
}

export function calculateRbGameScriptAdjustment(player, teamEnvironment, scoring, weight = 0) {
  if (String(player.position || '').replace(/[0-9]/g, '') !== 'RB') return { points: 0, warning: null };
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  const leadScore = Number(teamEnvironment?.expectedGameScript?.leadProbabilityScore || 0);
  const trailingScore = Number(teamEnvironment?.expectedGameScript?.trailingProbabilityScore || 0);
  const signal = Math.max(Math.abs(leadScore), Math.abs(trailingScore));
  if (!normalizedWeight) return { points: 0, warning: null };
  if (!signal) return { points: 0, warning: 'Game script is neutral because defense/game-script context is missing or placeholder.' };
  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const { earlyDownRole, receivingRole } = rbGameScriptRoles(player);
  const rushAttemptAdjustment = leadScore * earlyDownRole * normalizedWeight * 0.05;
  const rushTdAdjustment = leadScore * earlyDownRole * normalizedWeight * 0.035;
  const receivingAdjustment = trailingScore * receivingRole * normalizedWeight * 0.06;

  adjustedStats.rushing = {
    ...adjustedStats.rushing,
    attempts: stats.rushing.attempts * (1 + rushAttemptAdjustment),
    yards: stats.rushing.yards * (1 + rushAttemptAdjustment),
    touchdowns: stats.rushing.touchdowns * (1 + rushTdAdjustment),
  };
  adjustedStats.receiving = {
    ...adjustedStats.receiving,
    targets: stats.receiving.targets * (1 + receivingAdjustment),
    receptions: stats.receiving.receptions * (1 + receivingAdjustment),
    yards: stats.receiving.yards * (1 + receivingAdjustment),
    touchdowns: stats.receiving.touchdowns * (1 + receivingAdjustment * 0.5),
  };
  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { leadScore, trailingScore, earlyDownRole, receivingRole, rushAttemptAdjustment, rushTdAdjustment, receivingAdjustment },
  };
}

export function applyRbGameScriptAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) return player;
    const adjustment = calculateRbGameScriptAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'gameScript', 0.10);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        warnings: adjustment.warning ? [...(adjusted.audit?.warnings || []), adjustment.warning] : (adjusted.audit?.warnings || []),
        details: {
          ...(adjusted.audit?.details || {}),
          gameScript: adjustment.details || null,
        },
      },
    };
  });
}

export function calculateQbGameScriptAdjustment(player, teamEnvironment, scoring, weight = 0) {
  if (String(player.position || '').replace(/[0-9]/g, '') !== 'QB') return { points: 0, warning: null };
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  const leadScore = Number(teamEnvironment?.expectedGameScript?.leadProbabilityScore || 0);
  const trailingScore = Number(teamEnvironment?.expectedGameScript?.trailingProbabilityScore || 0);
  const signal = Math.max(Math.abs(leadScore), Math.abs(trailingScore));
  if (!normalizedWeight) return { points: 0, warning: null };
  if (!signal) return { points: 0, warning: 'Game script is neutral because defense/game-script context is missing or placeholder.' };

  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const volumeAdjustment = trailingScore * normalizedWeight * 0.045;
  const efficiencyAdjustment = (leadScore * 0.018 - Math.max(0, trailingScore) * 0.014) * normalizedWeight;
  const interceptionAdjustment = Math.max(0, trailingScore) * normalizedWeight * 0.018;

  adjustedStats.passing = {
    ...adjustedStats.passing,
    attempts: stats.passing.attempts * (1 + volumeAdjustment),
    completions: stats.passing.completions * (1 + volumeAdjustment + efficiencyAdjustment),
    yards: stats.passing.yards * (1 + volumeAdjustment + efficiencyAdjustment),
    touchdowns: stats.passing.touchdowns * (1 + volumeAdjustment + efficiencyAdjustment * 0.8),
    fortyYardCompletions: stats.passing.fortyYardCompletions * (1 + volumeAdjustment + efficiencyAdjustment),
    interceptions: stats.passing.interceptions * (1 + interceptionAdjustment),
  };

  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { leadScore, trailingScore, volumeAdjustment, efficiencyAdjustment, interceptionAdjustment },
  };
}

function receiverGameScriptRole(player) {
  const role = player.role || {};
  const routeParticipation = Number(role.routeParticipation ?? 0);
  const targetShare = Number(role.targetShare ?? 0);
  const targets = Number(player.projections?.receiving?.targets || 0);
  const inferredRouteRole = targets >= 120 ? 0.9 : targets >= 80 ? 0.7 : targets >= 50 ? 0.5 : 0.3;
  const inferredTargetShare = targets >= 130 ? 0.28 : targets >= 100 ? 0.22 : targets >= 70 ? 0.16 : 0.10;
  return {
    routeRole: clamp(Math.max(routeParticipation, inferredRouteRole), 0, 1),
    targetRole: clamp(Math.max(targetShare, inferredTargetShare), 0, 0.35) / 0.35,
  };
}

export function calculateReceiverGameScriptAdjustment(player, teamEnvironment, scoring, weight = 0) {
  const position = String(player.position || '').replace(/[0-9]/g, '');
  if (!['WR', 'TE'].includes(position)) return { points: 0, warning: null };
  const normalizedWeight = clamp(Number(weight || 0), 0, 1);
  const leadScore = Number(teamEnvironment?.expectedGameScript?.leadProbabilityScore || 0);
  const trailingScore = Number(teamEnvironment?.expectedGameScript?.trailingProbabilityScore || 0);
  const signal = Math.max(Math.abs(leadScore), Math.abs(trailingScore));
  if (!normalizedWeight) return { points: 0, warning: null };
  if (!signal) return { points: 0, warning: 'Game script is neutral because defense/game-script context is missing or placeholder.' };

  const stats = normalizeStats(player.projections || {});
  const adjustedStats = normalizeStats(stats);
  const { routeRole, targetRole } = receiverGameScriptRole(player);
  const volumeAdjustment = trailingScore * routeRole * targetRole * normalizedWeight * 0.055;
  const efficiencyAdjustment = (leadScore * 0.010 - Math.max(0, trailingScore) * 0.008) * normalizedWeight;

  adjustedStats.receiving = {
    ...adjustedStats.receiving,
    targets: stats.receiving.targets * (1 + volumeAdjustment),
    receptions: stats.receiving.receptions * (1 + volumeAdjustment + efficiencyAdjustment),
    yards: stats.receiving.yards * (1 + volumeAdjustment + efficiencyAdjustment),
    touchdowns: stats.receiving.touchdowns * (1 + volumeAdjustment * 0.6 + efficiencyAdjustment),
    fortyYardReceptions: stats.receiving.fortyYardReceptions * (1 + volumeAdjustment + efficiencyAdjustment),
  };

  return {
    points: calculateFantasyPoints(adjustedStats, scoring) - calculateFantasyPoints(stats, scoring),
    warning: null,
    details: { leadScore, trailingScore, routeRole, targetRole, volumeAdjustment, efficiencyAdjustment },
  };
}

export function applyQbAndReceiverGameScriptAdjustments(players = [], teamEnvironments = {}, scoring, weight = 0) {
  return players.map((player) => {
    const environment = teamEnvironments[player.team];
    if (!environment) return player;
    const position = String(player.position || '').replace(/[0-9]/g, '');
    if (!['QB', 'WR', 'TE'].includes(position)) return player;
    const adjustment = position === 'QB'
      ? calculateQbGameScriptAdjustment(player, environment, scoring, weight)
      : calculateReceiverGameScriptAdjustment(player, environment, scoring, weight);
    const adjusted = applyContextAdjustment(player, adjustment.points, 'gameScript', 0.10);
    return {
      ...adjusted,
      audit: {
        ...adjusted.audit,
        warnings: adjustment.warning ? [...(adjusted.audit?.warnings || []), adjustment.warning] : (adjusted.audit?.warnings || []),
        details: {
          ...(adjusted.audit?.details || {}),
          gameScript: adjustment.details || adjusted.audit?.details?.gameScript || null,
        },
      },
    };
  });
}

export function buildProjectedPlayers(players = [], scoring, options = {}) {
  return players.map((player) => attachBaseProjection(player, scoring, options));
}