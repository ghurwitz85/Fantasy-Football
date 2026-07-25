import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFantasyProsAdpText } from '../scripts/import-fantasypros-adp.mjs';

test('derives approximate ADP from FantasyPros rank and ECR-vs-ADP delta', () => {
  const rows = parseFantasyProsAdpText(`"RK",TIERS,"PLAYER NAME",TEAM,"POS","BYE WEEK","ECR VS. ADP"
"1",1,"Bijan Robinson",ATL,"RB1","11","+1"
"7",1,"Christian McCaffrey",SF,"RB3","8","-2"`);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Bijan Robinson');
  assert.equal(rows[0].team, 'ATL');
  assert.equal(rows[0].position, 'RB');
  assert.equal(rows[0].adp, 2);
  assert.equal(rows[0].platform, 'FantasyPros ECR-vs-ADP derived');
  assert.equal(rows[1].adp, 5);
});

test('handles quoted commas and filters rows without usable ADP inputs', () => {
  const rows = parseFantasyProsAdpText(`RK,PLAYER NAME,TEAM,POS,ECR VS. ADP
10,"Comma, Player",JAC,WR2,+3
,No Rank,ATL,RB,+1`);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Comma, Player');
  assert.equal(rows[0].team, 'JAX');
  assert.equal(rows[0].position, 'WR');
  assert.equal(rows[0].adp, 13);
});

test('excludes free-agent rows from cached ADP data', () => {
  const rows = parseFantasyProsAdpText(`RK,PLAYER NAME,TEAM,POS,ECR VS. ADP
188,Stefon Diggs,FA,WR,+5
189,Rostered Player,BUF,WR,+1`);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Rostered Player');
  assert.equal(rows[0].team, 'BUF');
});