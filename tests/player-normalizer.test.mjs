import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyPlayer,
  createPlayerId,
  normalizeName,
  normalizePosition,
  normalizeTeam,
} from '../js/player-normalizer.js';

test('normalizes suffixes, punctuation, apostrophes, initials, and spacing', () => {
  assert.equal(normalizeName('Brian Thomas Jr.'), 'brian thomas');
  assert.equal(normalizeName('Ja’Marr Chase'), 'jamarr chase');
  assert.equal(normalizeName('A. J. Brown'), 'aj brown');
  assert.equal(normalizeName('  Amon-Ra   St. Brown  '), 'amon ra st brown');
});

test('normalizes team and position aliases', () => {
  assert.equal(normalizeTeam('JAC'), 'JAX');
  assert.equal(normalizeTeam('wsh'), 'WAS');
  assert.equal(normalizePosition('WR12'), 'WR');
  assert.equal(normalizePosition('def'), 'DST');
});

test('creates stable player IDs from normalized fields', () => {
  assert.equal(
    createPlayerId({ name: "Ja'Marr Chase", team: 'cin', position: 'WR1' }),
    'jamarr-chase-CIN-WR',
  );
});

test('maps ranking rows into the standardized player shell', () => {
  const player = createEmptyPlayer({
    name: 'Bijan Robinson',
    team: 'ATL',
    position: 'RB',
    rank: 1,
    tier: 1,
    bye: 11,
    ecrStdDev: 1.2,
  });

  assert.equal(player.playerId, 'bijan-robinson-ATL-RB');
  assert.equal(player.consensus.overallRank, 1);
  assert.equal(player.consensus.rankStdDev, 1.2);
  assert.equal(player.byeWeek, 11);
  assert.equal(player.adjusted.finalDraftScore, 0);
});