import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooProjectionText } from '../scripts/import-yahoo-projections.mjs';

test('parses Yahoo RB projection block into V3 projection shape', () => {
  const [player] = parseYahooProjectionText(`
Jahmyr GibbsNo new player Notes
Det - RB
Sun 10:00 am vs NO
FA
16
6
304.20
1
1
100%
0
0
0
0
252
1211
11.9
2.3
79.3
62.9
529
3.8
0.7
0
0
0.9
1.0
`);

  assert.equal(player.name, 'Jahmyr Gibbs');
  assert.equal(player.team, 'DET');
  assert.equal(player.position, 'RB');
  assert.equal(player.projections.games, 16);
  assert.equal(player.byeWeek, 6);
  assert.equal(player.yahoo.fanPoints, 304.2);
  assert.equal(player.projections.rushing.attempts, 252);
  assert.equal(player.projections.rushing.yards, 1211);
  assert.equal(player.projections.rushing.touchdowns, 11.9);
  assert.equal(player.projections.rushing.fortyYardRuns, 2.3);
  assert.equal(player.projections.receiving.targets, 79.3);
  assert.equal(player.projections.receiving.receptions, 62.9);
  assert.equal(player.projections.receiving.yards, 529);
  assert.equal(player.projections.receiving.touchdowns, 3.8);
  assert.equal(player.projections.receiving.fortyYardReceptions, 0.7);
  assert.equal(player.projections.fumblesLost, 1);
});

test('parses Yahoo QB and TE projection blocks', () => {
  const players = parseYahooProjectionText(`
Josh AllenVideo ForecastNo new player Notes
Buf - QB
Sun 10:00 am @ Hou
FA
16
7
339.39
27
27
100%
3575
24.7
9.4
4.4
105
514
10.0
0.2
0
0
0
0
0
0
0
1.6
2.6

Brock BowersVideo ForecastNo new player Notes
LV - TE
Sun 1:25 pm vs Mia
FA
16
13
181.06
18
18
100%
0
0
0
0
3.2
10.7
0.0
0.0
124
88.6
932
6.8
1.3
0
0
0.6
0.7
`);

  assert.equal(players.length, 2);
  assert.equal(players[0].name, 'Josh Allen');
  assert.equal(players[0].team, 'BUF');
  assert.equal(players[0].projections.passing.yards, 3575);
  assert.equal(players[0].projections.passing.touchdowns, 24.7);
  assert.equal(players[0].projections.passing.fortyYardCompletions, 4.4);
  assert.equal(players[0].projections.rushing.yards, 514);
  assert.equal(players[1].name, 'Brock Bowers');
  assert.equal(players[1].position, 'TE');
  assert.equal(players[1].projections.receiving.targets, 124);
  assert.equal(players[1].projections.receiving.receptions, 88.6);
  assert.equal(players[1].projections.receiving.fortyYardReceptions, 1.3);
});