import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeYahooDraftResults,
  parseCompactDraftLines,
  splitCsvLine,
  summarizeDraftTendencies,
  yahooDraftCsvTextToV3,
} from '../js/yahoo-draft-results.js';

test('splits quoted Yahoo draft CSV rows', () => {
  assert.deepEqual(splitCsvLine('1,"Smith, Jr.",Team A'), ['1', 'Smith, Jr.', 'Team A']);
});

test('bundled 2025 Yahoo standings and draft fixture has expected early data', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../data/yahoo-draft-results-2025.json', import.meta.url), 'utf8'));
  const picks = parseCompactDraftLines(fixture.compactDraftCsv, { season: fixture.season, teams: fixture.teams });

  assert.equal(fixture.standings.length, 12);
  assert.equal(fixture.standings[0].team, 'TebowDied4OurSins');
  assert.equal(picks.length, 72);
  assert.equal(picks[0].name, "Ja'Marr Chase");
  assert.equal(picks[0].fantasyTeam, 'TebowDied4OurSins');
  assert.equal(picks[1].name, 'Bijan Robinson');
  assert.equal(picks[12].name, 'Chase Brown');
  assert.equal(picks.at(-1).name, 'Jaylen Warren');
});

test('normalizes Yahoo draft results into stable V3 draft rows', () => {
  const rows = yahooDraftCsvTextToV3(`Pick,Round,Player,Team,Pos,Drafted By\n1,1,Bijan Robinson,ATL,RB,Team Alpha\n14,2,Amon-Ra St. Brown,DET,WR,Team Beta`, { season: 2025 });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].playerId, 'bijan-robinson-ATL-RB');
  assert.equal(rows[0].fantasyTeam, 'Team Alpha');
  assert.equal(rows[1].normalizedName, 'amon ra st brown');
});

test('normalizes object rows and summarizes draft tendencies', () => {
  const rows = normalizeYahooDraftResults([
    { player: 'Josh Allen', team: 'BUF', pos: 'QB', pick: '24', round: '2', manager: 'A' },
    { player: 'Breece Hall', team: 'NYJ', pos: 'RB', pick: '12', round: '1', manager: 'A' },
    { player: 'Sam LaPorta', team: 'DET', pos: 'TE', pick: '48', round: '4', manager: 'B' },
  ]);
  const summary = summarizeDraftTendencies(rows);

  assert.equal(summary.totalPicks, 3);
  assert.deepEqual(summary.byPosition, { QB: 1, RB: 1, TE: 1 });
  assert.equal(summary.teams.A.byPosition.RB, 1);
  assert.equal(summary.earlyRoundsByPosition.TE, 1);
});