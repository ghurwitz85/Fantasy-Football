import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBaseProjection, derivePlayerArchetype, estimateFallbackFantasyPoints } from '../js/projection-engine.js';
import { DEFAULT_SCORING } from '../js/scoring-engine.js';

test('classifies RB archetypes from rushing and receiving roles', () => {
  assert.equal(derivePlayerArchetype({ position: 'RB', projections: { rushing: { attempts: 240, touchdowns: 9 }, receiving: { targets: 65 } } }), 'Three-down RB');
  assert.equal(derivePlayerArchetype({ position: 'RB', projections: { rushing: { attempts: 190, touchdowns: 9 }, receiving: { targets: 20 } } }), 'Early-down/goal-line RB');
  assert.equal(derivePlayerArchetype({ position: 'RB', projections: { rushing: { attempts: 80 }, receiving: { targets: 60 } } }), 'Receiving RB');
});

test('classifies WR and TE archetypes from target profile', () => {
  assert.equal(derivePlayerArchetype({ position: 'WR', projections: { receiving: { targets: 145, receptions: 100, yards: 1300 } } }), 'Alpha target earner');
  assert.equal(derivePlayerArchetype({ position: 'WR', projections: { receiving: { targets: 80, receptions: 45, yards: 720 } } }), 'Deep threat');
  assert.equal(derivePlayerArchetype({ position: 'TE', projections: { receiving: { targets: 120, receptions: 85, yards: 900 } } }), 'Elite target earner TE');
});

test('creates non-zero fallback projections for lower-ranked TE, K, and DST', () => {
  const players = [
    { name: 'Depth TE', position: 'TE', consensus: { positionRank: 32, overallRank: 260 } },
    { name: 'Fallback K', position: 'K', consensus: { positionRank: 14, overallRank: 190 } },
    { name: 'Fallback DST', position: 'DST', consensus: { positionRank: 16, overallRank: 210 } },
  ].map((player) => attachBaseProjection(player, DEFAULT_SCORING));

  players.forEach((player) => {
    assert.ok(player.adjusted.baseFantasyPoints > 0);
    assert.equal(player.adjusted.fallbackFantasyPoints, player.adjusted.baseFantasyPoints);
    assert.equal(player.audit.projectionSource, 'consensus-fallback');
    assert.match(player.audit.warnings[0], /consensus fallback curve/);
  });
  assert.equal(players[1].audit.fallbackProjection.syntheticStatCategory, 'receiving.yards');
  assert.equal(players[2].audit.fallbackProjection.syntheticStatCategory, 'receiving.yards');
});

test('fallback curves degrade depth players without collapsing to zero', () => {
  const teOne = estimateFallbackFantasyPoints({ position: 'TE', consensus: { positionRank: 1 } });
  const teDepth = estimateFallbackFantasyPoints({ position: 'TE', consensus: { positionRank: 40 } });
  const dstDepth = estimateFallbackFantasyPoints({ position: 'DST', consensus: { positionRank: 28 } });

  assert.ok(teOne > teDepth);
  assert.ok(teDepth >= 35);
  assert.ok(dstDepth >= 70);
});