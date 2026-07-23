import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReplacementValues,
  calculateReplacementLevels,
} from '../js/replacement-value-engine.js';

function player(position, points, id = `${position}-${points}`) {
  return {
    playerId: id,
    position,
    adjusted: { contextFantasyPoints: points },
  };
}

test('calculates starter replacement levels by position', () => {
  const players = [
    player('QB', 300),
    player('QB', 250),
    player('RB', 220),
    player('RB', 210),
    player('RB', 200),
    player('RB', 190),
  ];

  const levels = calculateReplacementLevels(players, {
    teams: 2,
    starters: { QB: 1, RB: 2, WR: 0, TE: 0, FLEX: 0 },
    flexEligibility: ['RB', 'WR', 'TE'],
  });

  assert.equal(levels.QB, 250);
  assert.equal(levels.RB, 190);
});

test('allocates flex spots to highest remaining eligible players', () => {
  const players = [
    player('RB', 220, 'rb1'),
    player('RB', 210, 'rb2'),
    player('RB', 200, 'rb3'),
    player('WR', 230, 'wr1'),
    player('WR', 205, 'wr2'),
    player('WR', 195, 'wr3'),
    player('TE', 180, 'te1'),
    player('TE', 170, 'te2'),
  ];

  const levels = calculateReplacementLevels(players, {
    teams: 1,
    starters: { QB: 0, RB: 1, WR: 1, TE: 1, FLEX: 1 },
    flexEligibility: ['RB', 'WR', 'TE'],
  });

  assert.equal(levels.RB, 210);
  assert.equal(levels.WR, 230);
  assert.equal(levels.TE, 180);
});

test('applies VORP to each player', () => {
  const players = [player('QB', 300), player('QB', 250)];
  const withValues = applyReplacementValues(players, {
    teams: 1,
    starters: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0 },
    flexEligibility: ['RB', 'WR', 'TE'],
  });

  assert.equal(withValues[0].adjusted.replacementBaseline, 300);
  assert.equal(withValues[0].adjusted.replacementValue, 0);
  assert.equal(withValues[1].adjusted.replacementValue, -50);
});