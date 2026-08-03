import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRosterSimulationContext,
  calculateByeWeekImpact,
  calculatePlayoffScheduleValue,
  calculateStackValue,
  calculateVolatilityProfile,
} from '../js/simulation-context-engine.js';

function player(name, team, position, points, byeWeek, extras = {}) {
  return {
    name, team, position, byeWeek,
    v3Row: { adjustedProjection: points },
    adjusted: { floorProjection: points * 0.8, ceilingProjection: points * 1.2 },
    audit: { adjustments: { schedule: extras.schedule || 0 } },
  };
}

test('QB plus same-team receiver creates positive stack value', () => {
  const result = calculateStackValue([
    player('QB One', 'BUF', 'QB', 320, 7),
    player('WR One', 'BUF', 'WR', 240, 7),
  ]);
  assert.ok(result.value > 0);
  assert.equal(result.stacks[0].team, 'BUF');
});

test('ordinary teammates without a QB do not create a stack', () => {
  const result = calculateStackValue([
    player('WR One', 'BUF', 'WR', 240, 7),
    player('RB One', 'BUF', 'RB', 230, 7),
  ]);
  assert.equal(result.value, 0);
});

test('concentrated bye weeks create a lineup penalty', () => {
  const result = calculateByeWeekImpact([
    player('RB One', 'ATL', 'RB', 250, 11),
    player('RB Two', 'LAR', 'RB', 220, 11),
    player('WR One', 'SEA', 'WR', 230, 11),
  ], { starters: { RB: 2, WR: 3, QB: 1, TE: 1, FLEX: 1 } });
  assert.ok(result.penalty > 0);
  assert.equal(result.worstWeek.week, 11);
});

test('playoff schedule proxy uses existing schedule adjustments', () => {
  const result = calculatePlayoffScheduleValue([
    player('WR One', 'SEA', 'WR', 230, 11, { schedule: 4 }),
    player('RB One', 'ATL', 'RB', 250, 11, { schedule: 2 }),
  ]);
  assert.ok(result.value > 0);
  assert.equal(result.source, 'seasonal schedule proxy');
});

test('volatility profile exposes aggregate floor and ceiling', () => {
  const result = calculateVolatilityProfile([
    player('WR One', 'SEA', 'WR', 200, 11),
    player('RB One', 'ATL', 'RB', 220, 11),
  ]);
  assert.ok(result.floorPoints < 420);
  assert.ok(result.ceilingPoints > 420);
});

test('combined context reports all four dimensions', () => {
  const result = analyzeRosterSimulationContext([
    player('QB One', 'BUF', 'QB', 320, 7, { schedule: 1 }),
    player('WR One', 'BUF', 'WR', 240, 7, { schedule: 2 }),
  ], { starters: { QB: 1, WR: 3, RB: 2, TE: 1, FLEX: 1 } });
  assert.ok(result.stack);
  assert.ok(result.bye);
  assert.ok(result.playoff);
  assert.ok(result.volatility);
  assert.ok(Number.isFinite(result.totalAdjustment));
});
