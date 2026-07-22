import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBigPlayPoints,
  calculateFantasyPoints,
} from '../js/scoring-engine.js';

test('calculates passing scoring with interceptions and 40-yard completions', () => {
  const points = calculateFantasyPoints({
    passing: {
      yards: 250,
      touchdowns: 2,
      interceptions: 1,
      fortyYardCompletions: 1,
    },
  });

  assert.equal(points, 17);
});

test('calculates half-PPR receiving scoring', () => {
  const points = calculateFantasyPoints({
    receiving: {
      receptions: 8,
      yards: 90,
      touchdowns: 1,
    },
  });

  assert.equal(points, 19);
});

test('calculates rushing scoring and fumbles lost', () => {
  const points = calculateFantasyPoints({
    rushing: {
      yards: 105,
      touchdowns: 2,
      fortyYardRuns: 1,
    },
    fumblesLost: 1,
  });

  assert.equal(points, 21.5);
});

test('tracks big-play bonus points explicitly', () => {
  const points = calculateBigPlayPoints({
    passing: { fortyYardCompletions: 2 },
    rushing: { fortyYardRuns: 1 },
    receiving: { fortyYardReceptions: 3 },
  });

  assert.equal(points, 6);
});

test('supports custom league scoring overrides', () => {
  const points = calculateFantasyPoints(
    {
      receiving: {
        receptions: 10,
        yards: 100,
        touchdowns: 1,
      },
    },
    {
      reception: 1,
      receivingYardsPerPoint: 20,
    },
  );

  assert.equal(points, 21);
});