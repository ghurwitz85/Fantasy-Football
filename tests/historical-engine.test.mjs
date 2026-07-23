import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBaseProjection } from '../js/projection-engine.js';
import {
  applyHistoricalCalibration,
  buildHistoricalIndex,
  summarizeHistoricalSignal,
} from '../js/historical-engine.js';

test('builds historical signals with recency weighting and reliability', () => {
  const history = {
    players: [
      { name: 'History WR', team: 'CIN', position: 'WR', season: 2025, games: 17, fantasyPoints: 255 },
      { name: 'History WR', team: 'CIN', position: 'WR', season: 2024, games: 12, fantasyPoints: 150 },
    ],
  };
  const player = attachBaseProjection({
    name: 'History WR',
    team: 'CIN',
    position: 'WR',
    projections: { receiving: { receptions: 90, yards: 1100, touchdowns: 7 } },
  });

  const index = buildHistoricalIndex(history, undefined, { currentSeason: 2026 });
  const signal = summarizeHistoricalSignal(player, index);

  assert.equal(signal.matched, true);
  assert.equal(signal.seasons, 2);
  assert.ok(signal.weightedPointsPerGame > 0);
  assert.ok(signal.reliabilityScore > 0.7);
  assert.equal(signal.teamChanged, false);
});

test('historical calibration is modest and does not replace current projection', () => {
  const [player] = applyHistoricalCalibration([
    attachBaseProjection({
      name: 'Calibrated RB',
      team: 'ATL',
      position: 'RB',
      projections: { rushing: { yards: 1000, touchdowns: 8 }, receiving: { receptions: 30, yards: 240 } },
    }),
  ], {
    players: [{ name: 'Calibrated RB', team: 'ATL', position: 'RB', season: 2025, games: 17, fantasyPoints: 400 }],
  }, undefined, { currentSeason: 2026, weight: 0.04 });

  assert.equal(player.history.matched, true);
  assert.ok(player.history.reliabilityScore > 0.9);
  assert.ok(player.audit.adjustments.historyCalibration > 0);
  assert.ok(player.audit.adjustments.historyCalibration < player.adjusted.baseFantasyPoints * 0.01);
});

test('missing historical rows keep reliability neutral with visible warning', () => {
  const [player] = applyHistoricalCalibration([
    attachBaseProjection({
      name: 'No History',
      team: 'BUF',
      position: 'QB',
      projections: { passing: { yards: 4000, touchdowns: 30 } },
    }),
  ], { players: [] });

  assert.equal(player.history.matched, false);
  assert.equal(player.history.reliabilityScore, 0.5);
  assert.ok(player.audit.warnings.some((warning) => warning.includes('Historical calibration is neutral')));
});