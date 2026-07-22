import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBaseProjection, applyContextAdjustment } from '../js/projection-engine.js';
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