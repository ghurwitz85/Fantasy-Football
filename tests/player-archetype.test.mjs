import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePlayerArchetype } from '../js/projection-engine.js';

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