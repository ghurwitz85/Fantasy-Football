import { calculateBigPlayPoints, calculateFantasyPoints, normalizeStats } from './scoring-engine.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function attachBaseProjection(player, scoring) {
  const stats = normalizeStats(player.projections || {});
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
      },
      finalProjection: baseFantasyPoints,
      warnings: player.projections ? [] : ['Projection data missing; player remains at neutral projected value.'],
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

export function buildProjectedPlayers(players = [], scoring) {
  return players.map((player) => attachBaseProjection(player, scoring));
}