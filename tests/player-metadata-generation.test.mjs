import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerMetadata } from '../scripts/generate-player-metadata.mjs';

test('generates stable V3 player metadata from rankings, projections, and ADP', () => {
  const [player] = buildPlayerMetadata({
    rankings: [{ name: 'Bijan Robinson', team: 'ATL', position: 'RB1', rank: 1, tier: 1, bye: 11 }],
    yahooProjections: [{ name: 'Bijan Robinson', team: 'ATL', position: 'RB', byeWeek: 11 }],
    adp: [{ name: 'Bijan Robinson', team: 'ATL', position: 'RB', adp: 2, platform: 'Derived' }],
  });

  assert.equal(player.playerId, 'bijan-robinson-ATL-RB');
  assert.equal(player.normalizedName, 'bijan robinson');
  assert.equal(player.position, 'RB');
  assert.equal(player.byeWeek, 11);
  assert.equal(player.consensus.overallRank, 1);
  assert.equal(player.consensus.tier, 1);
  assert.equal(player.adp.overall, 2);
  assert.deepEqual(player.metadataSource, ['rankings', 'yahoo-projections', 'adp']);
});

test('deduplicates apostrophe variants using normalized player identity', () => {
  const players = buildPlayerMetadata({
    rankings: [{ name: "Ja'Marr Chase", team: 'CIN', position: 'WR', rank: 3 }],
    yahooProjections: [{ name: 'Ja’Marr Chase', team: 'CIN', position: 'WR', byeWeek: 6 }],
    adp: [],
  });

  assert.equal(players.length, 1);
  assert.equal(players[0].byeWeek, 6);
  assert.equal(players[0].consensus.overallRank, 3);
});

test('excludes free-agent rows from generated metadata cache', () => {
  const players = buildPlayerMetadata({
    rankings: [
      { name: 'Free Agent', team: 'FA', position: 'WR', rank: 100 },
      { name: 'Rostered Player', team: 'BUF', position: 'WR', rank: 101 },
    ],
  });

  assert.equal(players.length, 1);
  assert.equal(players[0].name, 'Rostered Player');
  assert.equal(players[0].team, 'BUF');
});