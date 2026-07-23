import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateAvailability, estimateAvailability, picksUntilNextTurn } from '../js/draft-state-engine.js';

test('estimates availability from ADP and next pick', () => {
  const earlyAdpLatePick = estimateAvailability(10, 8, 30);
  const lateAdpEarlyPick = estimateAvailability(80, 8, 30);

  assert.ok(earlyAdpLatePick < 0.2);
  assert.ok(lateAdpEarlyPick > 0.9);
  assert.equal(estimateAvailability(null), 0.5);
});

test('calculates snake-draft picks until next user turn', () => {
  assert.equal(picksUntilNextTurn({ currentPick: 1, userDraftSlot: 1, teams: 12 }), 23);
  assert.equal(picksUntilNextTurn({ currentPick: 12, userDraftSlot: 12, teams: 12 }), 1);
});

test('annotates players with availability and draft urgency', () => {
  const [player] = annotateAvailability([
    { name: 'Urgent Player', adp: { overall: 10 }, adjusted: { replacementValue: 50 } },
  ], { currentPick: 1, userDraftSlot: 1, teams: 12, defaultAdpStdDev: 8 });

  assert.ok(player.draft.availabilityProbability < 0.2);
  assert.ok(player.draft.goneBeforeNextPick > 0.8);
  assert.ok(player.draft.draftUrgency > 40);
});