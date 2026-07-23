import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQbPassProtectionAdjustments,
  applyReceiverPassProtectionAdjustments,
  applyReceiverQbEnvironmentAdjustments,
  applyRbGameScriptAdjustments,
  applyRunBlockingAdjustments,
  applyScheduleAdjustments,
  attachBaseProjection,
  createFallbackProjection,
  estimateFallbackFantasyPoints,
  calculateScheduleAdjustment,
  calculateReceiverQbEnvironmentAdjustment,
  calculateRbGameScriptAdjustment,
  calculateQbGameScriptAdjustment,
  calculateReceiverGameScriptAdjustment,
  applyQbAndReceiverGameScriptAdjustments,
  calculateReceiverPassProtectionAdjustment,
  calculateQbPassProtectionAdjustment,
  calculateRunBlockingAdjustment,
  applyAggregateContextCap,
  applyContextAdjustment,
  applyRiskAdjustedProjection,
  calculateRiskRange,
} from '../js/projection-engine.js';
import { rankPlayers, normalizeWeights } from '../js/ranking-engine.js';

test('attaches base fantasy points and explicit big-play audit', () => {
  const player = attachBaseProjection({
    name: 'Test RB',
    projections: {
      rushing: { yards: 100, touchdowns: 1, fortyYardRuns: 1 },
      receiving: { receptions: 2, yards: 20 },
    },
  });

  assert.equal(player.adjusted.baseFantasyPoints, 20);
  assert.equal(player.audit.adjustments.bigPlayBonus, 1);
  assert.equal(player.audit.finalProjection, 20);
});

test('big-play confidence regresses expected 40-yard counts without changing scoring rules', () => {
  const fullConfidence = attachBaseProjection({
    name: 'Boom RB',
    projections: { rushing: { yards: 100, touchdowns: 1, fortyYardRuns: 2 } },
  }, undefined, { bigPlayConfidence: 1 });
  const halfConfidence = attachBaseProjection({
    name: 'Boom RB',
    projections: { rushing: { yards: 100, touchdowns: 1, fortyYardRuns: 2 } },
  }, undefined, { bigPlayConfidence: 0.5 });

  assert.equal(fullConfidence.audit.adjustments.bigPlayBonus, 2);
  assert.equal(halfConfidence.audit.adjustments.bigPlayBonus, 1);
  assert.equal(halfConfidence.audit.adjustments.bigPlayConfidenceAdjustment, -1);
  assert.equal(halfConfidence.adjusted.baseFantasyPoints, fullConfidence.adjusted.baseFantasyPoints - 1);
  assert.match(halfConfidence.audit.bigPlay.note, /does not multiply scoring rules/);
});

test('creates explicit consensus-derived fallback projections when stat projections are missing', () => {
  const player = attachBaseProjection({
    name: 'Fallback RB',
    position: 'RB',
    consensus: { positionRank: 10, overallRank: 25 },
  });

  assert.ok(player.adjusted.baseFantasyPoints > 0);
  assert.equal(player.audit.projectionSource, 'consensus-fallback');
  assert.ok(player.audit.warnings.some((warning) => warning.includes('consensus-derived fallback')));
});

test('fallback projection estimates decrease by position rank', () => {
  const rb1 = estimateFallbackFantasyPoints({ position: 'RB', consensus: { positionRank: 1 } });
  const rb30 = estimateFallbackFantasyPoints({ position: 'RB', consensus: { positionRank: 30 } });
  const stats = createFallbackProjection({ position: 'WR', consensus: { positionRank: 12 } });

  assert.ok(rb1 > rb30);
  assert.ok(stats.receiving.yards > 0);
});

test('caps context adjustments at the requested percentage', () => {
  const player = attachBaseProjection({
    name: 'Test WR',
    projections: { receiving: { receptions: 10, yards: 100 } },
  });
  const adjusted = applyContextAdjustment(player, 50, 'qbEnvironment', 0.10);

  assert.equal(player.adjusted.baseFantasyPoints, 15);
  assert.equal(adjusted.audit.adjustments.qbEnvironment, 1.5);
  assert.equal(adjusted.adjusted.contextFantasyPoints, 16.5);
});

test('applies aggregate context cap across all contextual adjustments', () => {
  const player = attachBaseProjection({
    name: 'Context Cap WR',
    projections: { receiving: { receptions: 10, yards: 100 } },
  });
  const withRunBlocking = applyContextAdjustment(player, 1.5, 'runBlocking', 0.10);
  const withQbEnvironment = applyContextAdjustment(withRunBlocking, 1.5, 'qbEnvironment', 0.10);
  const capped = applyAggregateContextCap(withQbEnvironment, { defaultCapPct: 0.07 });

  assert.equal(player.adjusted.baseFantasyPoints, 15);
  assert.equal(Number(capped.audit.contextCap.rawTotal.toFixed(2)), 3.00);
  assert.equal(Number(capped.audit.contextCap.cappedTotal.toFixed(2)), 1.05);
  assert.equal(capped.audit.contextCap.applied, true);
  assert.equal(Number(capped.adjusted.contextFantasyPoints.toFixed(2)), 16.05);
  assert.equal(Number(capped.audit.adjustments.runBlocking.toFixed(3)), 0.525);
  assert.equal(Number(capped.audit.adjustments.qbEnvironment.toFixed(3)), 0.525);
});

test('calculates floor, median, ceiling and applies risk-adjusted projection', () => {
  const player = attachBaseProjection({
    name: 'Risky Rookie',
    position: 'WR',
    risk: { injuryProbability: 0.20, roleUncertainty: 0.30, rookie: true },
    projections: { receiving: { receptions: 80, yards: 1000, touchdowns: 8 } },
  });
  const range = calculateRiskRange(player);
  const conservative = applyRiskAdjustedProjection(player, { riskTolerance: 0, injuryPenaltyWeight: 1, rookiePreference: -0.5 });
  const aggressive = applyRiskAdjustedProjection(player, { riskTolerance: 1, injuryPenaltyWeight: 0, rookiePreference: 0.5 });

  assert.ok(range.floor < range.median);
  assert.ok(range.ceiling > range.median);
  assert.ok(conservative.adjusted.contextFantasyPoints < player.adjusted.contextFantasyPoints);
  assert.ok(aggressive.adjusted.contextFantasyPoints > conservative.adjusted.contextFantasyPoints);
  assert.ok(Number.isFinite(conservative.audit.adjustments.risk));
  assert.ok(Number.isFinite(aggressive.adjusted.floorProjection));
});

test('normalizes weights to sum to one', () => {
  const weights = normalizeWeights({ projection: 2, vorp: 1 });
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  assert.equal(Number(total.toFixed(6)), 1);
});

test('ranks by projection-first score without NaN values', () => {
  const players = rankPlayers([
    {
      name: 'High Projection',
      adjusted: { contextFantasyPoints: 250, replacementValue: 80 },
      consensus: { overallRank: 20, rankStdDev: 2 },
      adp: { overall: 25 },
    },
    {
      name: 'Market Favorite',
      adjusted: { contextFantasyPoints: 180, replacementValue: 20 },
      consensus: { overallRank: 1, rankStdDev: 1 },
      adp: { overall: 1 },
    },
  ]);

  assert.equal(players[0].name, 'High Projection');
  assert.equal(players[0].personalRank, 1);
  assert.ok(Number.isFinite(players[0].adjusted.finalDraftScore));
  assert.ok(Number.isFinite(players[1].adjusted.finalDraftScore));
});

test('run blocking helps high-rush-share RBs more than receiving specialists', () => {
  const environment = { offensiveLine: { runBlockScore: 1 } };
  const workhorse = attachBaseProjection({
    name: 'Workhorse RB',
    position: 'RB',
    role: { rushShare: 0.8, goalLineShare: 0.7 },
    projections: { rushing: { attempts: 280, yards: 1200, touchdowns: 10, fortyYardRuns: 2 } },
  });
  const specialist = attachBaseProjection({
    name: 'Receiving RB',
    position: 'RB',
    role: { rushShare: 0.25, goalLineShare: 0.2 },
    projections: { rushing: { attempts: 60, yards: 260, touchdowns: 1, fortyYardRuns: 0 }, receiving: { receptions: 55, yards: 430 } },
  });

  const workhorseAdjustment = calculateRunBlockingAdjustment(workhorse, environment, undefined, 1).points;
  const specialistAdjustment = calculateRunBlockingAdjustment(specialist, environment, undefined, 1).points;

  assert.ok(workhorseAdjustment > specialistAdjustment);
});

test('run blocking does not adjust non-RB players and respects projection cap', () => {
  const environment = { ATL: { offensiveLine: { runBlockScore: 1 } } };
  const players = [
    attachBaseProjection({
      name: 'Explosive RB',
      team: 'ATL',
      position: 'RB',
      role: { rushShare: 1, goalLineShare: 1 },
      projections: { rushing: { attempts: 350, yards: 2000, touchdowns: 25, fortyYardRuns: 8 } },
    }),
    attachBaseProjection({
      name: 'Mobile QB',
      team: 'ATL',
      position: 'QB',
      projections: { rushing: { attempts: 120, yards: 700, touchdowns: 8 } },
    }),
  ];

  const adjusted = applyRunBlockingAdjustments(players, environment, undefined, 1);
  assert.ok(adjusted[0].audit.adjustments.runBlocking <= adjusted[0].adjusted.baseFantasyPoints * 0.10);
  assert.equal(adjusted[1].audit.adjustments.runBlocking, 0);
});

test('pass protection adjusts QB passing efficiency but not RB players', () => {
  const environment = { ATL: { offensiveLine: { passBlockScore: 1 } } };
  const players = [
    attachBaseProjection({
      name: 'Pocket QB',
      team: 'ATL',
      position: 'QB',
      projections: {
        passing: { yards: 4000, touchdowns: 30, interceptions: 12, fortyYardCompletions: 8 },
      },
    }),
    attachBaseProjection({
      name: 'RB',
      team: 'ATL',
      position: 'RB',
      projections: { rushing: { yards: 1000, touchdowns: 8 } },
    }),
  ];

  const adjusted = applyQbPassProtectionAdjustments(players, environment, undefined, 1);
  assert.ok(adjusted[0].audit.adjustments.passProtection > 0);
  assert.equal(adjusted[1].audit.adjustments.passProtection, 0);
});

test('bad pass protection can reduce QB projection and caps still apply', () => {
  const qb = attachBaseProjection({
    name: 'Pressured QB',
    position: 'QB',
    projections: { passing: { yards: 5000, touchdowns: 40, interceptions: 15, fortyYardCompletions: 10 } },
  });
  const adjustment = calculateQbPassProtectionAdjustment(qb, { offensiveLine: { passBlockScore: -1 } }, undefined, 1);
  const [adjusted] = applyQbPassProtectionAdjustments([{ ...qb, team: 'BAD' }], { BAD: { offensiveLine: { passBlockScore: -1 } } }, undefined, 1);

  assert.ok(adjustment.points < 0);
  assert.ok(adjusted.audit.adjustments.passProtection >= -adjusted.adjusted.baseFantasyPoints * 0.10);
});

test('receiver pass protection helps deep WRs more than possession WRs', () => {
  const environment = { offensiveLine: { passBlockScore: 1 } };
  const deepThreat = attachBaseProjection({
    name: 'Deep WR',
    position: 'WR',
    role: { deepTargetShare: 0.45, routeParticipation: 0.9 },
    projections: { receiving: { targets: 110, receptions: 60, yards: 1050, touchdowns: 7, fortyYardReceptions: 6 } },
  });
  const possession = attachBaseProjection({
    name: 'Possession WR',
    position: 'WR',
    role: { deepTargetShare: 0.05, routeParticipation: 0.8 },
    projections: { receiving: { targets: 110, receptions: 82, yards: 850, touchdowns: 6, fortyYardReceptions: 1 } },
  });

  const deepAdjustment = calculateReceiverPassProtectionAdjustment(deepThreat, environment, undefined, 1).points;
  const possessionAdjustment = calculateReceiverPassProtectionAdjustment(possession, environment, undefined, 1).points;

  assert.ok(deepAdjustment > possessionAdjustment);
});

test('receiver pass protection affects WR/TE only', () => {
  const environment = { ATL: { offensiveLine: { passBlockScore: 1 } } };
  const players = [
    attachBaseProjection({ name: 'TE', team: 'ATL', position: 'TE', projections: { receiving: { receptions: 70, yards: 800, touchdowns: 6 } } }),
    attachBaseProjection({ name: 'RB', team: 'ATL', position: 'RB', projections: { receiving: { receptions: 70, yards: 500, touchdowns: 3 } } }),
  ];

  const adjusted = applyReceiverPassProtectionAdjustments(players, environment, undefined, 1);
  assert.ok(adjusted[0].audit.adjustments.receiverPassProtection > 0);
  assert.equal(adjusted[1].audit.adjustments.receiverPassProtection, 0);
});

test('receiver QB environment remains neutral when QB context is placeholder', () => {
  const wr = attachBaseProjection({
    name: 'Neutral WR',
    team: 'ATL',
    position: 'WR',
    projections: { receiving: { receptions: 80, yards: 1000, touchdowns: 6 } },
  });
  const [adjusted] = applyReceiverQbEnvironmentAdjustments([wr], { ATL: { quarterback: { overallScore: 0 } } }, undefined, 1);

  assert.equal(adjusted.audit.adjustments.qbEnvironment, 0);
  assert.ok(adjusted.audit.warnings.some((warning) => warning.includes('QB environment is neutral')));
});

test('strong QB deep accuracy helps deep WRs more than possession WRs', () => {
  const environment = { quarterback: { overallScore: 0.5, accuracyScore: 0.4, deepAccuracyScore: 1, touchdownEfficiencyScore: 0.5, stabilityScore: 0.2 } };
  const deepThreat = attachBaseProjection({
    name: 'Deep WR',
    position: 'WR',
    role: { deepTargetShare: 0.5 },
    projections: { receiving: { targets: 100, receptions: 55, yards: 1050, touchdowns: 7, fortyYardReceptions: 6 } },
  });
  const possession = attachBaseProjection({
    name: 'Possession WR',
    position: 'WR',
    role: { deepTargetShare: 0.05 },
    projections: { receiving: { targets: 100, receptions: 78, yards: 820, touchdowns: 6, fortyYardReceptions: 1 } },
  });

  const deepAdjustment = calculateReceiverQbEnvironmentAdjustment(deepThreat, environment, undefined, 1).points;
  const possessionAdjustment = calculateReceiverQbEnvironmentAdjustment(possession, environment, undefined, 1).points;

  assert.ok(deepAdjustment > possessionAdjustment);
});

test('schedule adjustment is position-specific and capped to low preseason impact', () => {
  const rb = attachBaseProjection({
    name: 'Schedule RB',
    team: 'ATL',
    position: 'RB',
    projections: { rushing: { yards: 1400, touchdowns: 14 }, receiving: { receptions: 40, yards: 300, touchdowns: 2 } },
  });
  const [adjusted] = applyScheduleAdjustments([rb], { ATL: { strengthOfSchedule: { rb: 1 } } }, undefined, 1);

  assert.ok(adjusted.audit.adjustments.schedule > 0);
  assert.ok(adjusted.audit.adjustments.schedule <= adjusted.adjusted.baseFantasyPoints * 0.03);
});

test('schedule adjustment uses matching position schedule score', () => {
  const wr = attachBaseProjection({
    name: 'Schedule WR',
    position: 'WR',
    projections: { receiving: { receptions: 80, yards: 1000, touchdowns: 8 } },
  });
  const positive = calculateScheduleAdjustment(wr, { strengthOfSchedule: { wr: 1, rb: -1 } }, undefined, 1).points;
  const negative = calculateScheduleAdjustment(wr, { strengthOfSchedule: { wr: -1, rb: 1 } }, undefined, 1).points;

  assert.ok(positive > 0);
  assert.ok(negative < 0);
});

test('RB game script boosts early-down rushing in positive script', () => {
  const rb = attachBaseProjection({
    name: 'Early Down RB',
    position: 'RB',
    role: { rushShare: 0.8, thirdDownShare: 0.2 },
    projections: { rushing: { attempts: 240, yards: 1100, touchdowns: 10 }, receiving: { targets: 25, receptions: 18, yards: 120 } },
  });
  const adjustment = calculateRbGameScriptAdjustment(rb, { expectedGameScript: { leadProbabilityScore: 1, trailingProbabilityScore: -1 } }, undefined, 1);

  assert.ok(adjustment.points > 0);
  assert.ok(adjustment.details.rushAttemptAdjustment > 0);
  assert.ok(adjustment.details.receivingAdjustment < 0);
});

test('RB game script can help receiving backs in negative script and remains neutral with placeholders', () => {
  const rb = attachBaseProjection({
    name: 'Receiving RB',
    team: 'ATL',
    position: 'RB',
    role: { rushShare: 0.25, thirdDownShare: 0.85 },
    projections: { rushing: { attempts: 70, yards: 320, touchdowns: 2 }, receiving: { targets: 80, receptions: 64, yards: 520, touchdowns: 4 } },
  });
  const negative = calculateRbGameScriptAdjustment(rb, { expectedGameScript: { leadProbabilityScore: -1, trailingProbabilityScore: 1 } }, undefined, 1);
  const [neutral] = applyRbGameScriptAdjustments([rb], { ATL: { expectedGameScript: { leadProbabilityScore: 0, trailingProbabilityScore: 0 } } }, undefined, 1);

  assert.ok(negative.details.receivingAdjustment > 0);
  assert.equal(neutral.audit.adjustments.gameScript, 0);
  assert.ok(neutral.audit.warnings.some((warning) => warning.includes('Game script is neutral')));
});

test('QB game script separates trailing volume from efficiency', () => {
  const qb = attachBaseProjection({
    name: 'Volume QB',
    position: 'QB',
    projections: { passing: { attempts: 560, completions: 360, yards: 4200, touchdowns: 30, interceptions: 10, fortyYardCompletions: 8 } },
  });

  const trailing = calculateQbGameScriptAdjustment(qb, { expectedGameScript: { leadProbabilityScore: -1, trailingProbabilityScore: 1 } }, undefined, 1);
  const leading = calculateQbGameScriptAdjustment(qb, { expectedGameScript: { leadProbabilityScore: 1, trailingProbabilityScore: -1 } }, undefined, 1);

  assert.ok(trailing.details.volumeAdjustment > 0);
  assert.ok(trailing.details.efficiencyAdjustment < 0);
  assert.ok(trailing.details.interceptionAdjustment > 0);
  assert.ok(leading.details.volumeAdjustment < 0);
  assert.ok(leading.details.efficiencyAdjustment > 0);
});

test('WR/TE game script boosts route-heavy target earners more in trailing scripts', () => {
  const environment = { expectedGameScript: { leadProbabilityScore: -1, trailingProbabilityScore: 1 } };
  const alpha = attachBaseProjection({
    name: 'Alpha WR',
    position: 'WR',
    role: { routeParticipation: 0.95, targetShare: 0.30 },
    projections: { receiving: { targets: 150, receptions: 100, yards: 1300, touchdowns: 8, fortyYardReceptions: 4 } },
  });
  const partTimer = attachBaseProjection({
    name: 'Part Time WR',
    position: 'WR',
    role: { routeParticipation: 0.35, targetShare: 0.08 },
    projections: { receiving: { targets: 40, receptions: 24, yards: 320, touchdowns: 2, fortyYardReceptions: 1 } },
  });

  const alphaAdjustment = calculateReceiverGameScriptAdjustment(alpha, environment, undefined, 1);
  const partTimeAdjustment = calculateReceiverGameScriptAdjustment(partTimer, environment, undefined, 1);

  assert.ok(alphaAdjustment.details.volumeAdjustment > partTimeAdjustment.details.volumeAdjustment);
  assert.ok(alphaAdjustment.points > partTimeAdjustment.points);
});

test('applies QB and receiver game script while leaving RB handling to the RB engine', () => {
  const players = [
    attachBaseProjection({ name: 'QB', team: 'BUF', position: 'QB', projections: { passing: { attempts: 500, yards: 3800, touchdowns: 28, interceptions: 10 } } }),
    attachBaseProjection({ name: 'WR', team: 'BUF', position: 'WR', projections: { receiving: { targets: 120, receptions: 80, yards: 1000, touchdowns: 7 } } }),
    attachBaseProjection({ name: 'RB', team: 'BUF', position: 'RB', projections: { rushing: { attempts: 220, yards: 1000, touchdowns: 8 } } }),
  ];

  const adjusted = applyQbAndReceiverGameScriptAdjustments(players, { BUF: { expectedGameScript: { leadProbabilityScore: -1, trailingProbabilityScore: 1 } } }, undefined, 1);

  assert.notEqual(adjusted[0].audit.adjustments.gameScript, 0);
  assert.notEqual(adjusted[1].audit.adjustments.gameScript, 0);
  assert.equal(adjusted[2].audit.adjustments.gameScript, undefined);
});