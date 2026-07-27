import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeYahooDraftResults,
  parseCompactDraftLines,
  splitCsvLine,
  summarizeDraftTendencies,
  yahooDraftAppTextToRows,
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

test('parses Yahoo Draft App copied line blocks with repeated player names', () => {
  const text = `
B. Robinson
B. Robinson
RB
Atl
Bye 11
2
You
J. Gibbs
J. Gibbs
RB
Det
Bye 6
3
wesley
J. Chase
J. Chase
WR
Cin
Bye 6
4
ja
P. Nacua
P. Nacua
WR
LAR
Bye 11
5
gabe
C. McCaffrey
C. McCaffrey
RB
SF
Bye 8
6
jordan
J. Jefferson
J. Jefferson
WR
Min
Bye 6`;

  const rawRows = yahooDraftAppTextToRows(text, { teams: 12 });
  const rows = yahooDraftCsvTextToV3(text, { season: 2026, teams: 12 });

  assert.equal(rawRows.length, 6);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].name, 'B. Robinson');
  assert.equal(rows[0].team, 'ATL');
  assert.equal(rows[0].position, 'RB');
  assert.equal(rows[0].pickNumber, 2);
  assert.equal(rows[0].fantasyTeam, 'You');
  assert.equal(rows[1].fantasyTeam, 'wesley');
  assert.equal(rows[5].name, 'J. Jefferson');
  assert.equal(rows[5].pickNumber, 6);
  assert.equal(rows[5].fantasyTeam, null);
  assert.equal(rows[0].source, 'yahoo-draft-app-paste');
});

test('parses longer Yahoo Draft App paste through chat and system noise', () => {
  const picks = [
    ['J. Chase', 'WR', 'Cin', '1', 'TebowDied4OurSins'],
    ['B. Robinson', 'RB', 'Atl', '2', 'You'],
    ['J. Gibbs', 'RB', 'Det', '3', 'wesley'],
    ['P. Nacua', 'WR', 'LAR', '4', 'ja'],
    ['C. McCaffrey', 'RB', 'SF', '5', 'gabe'],
    ['J. Jefferson', 'WR', 'Min', '6', 'jordan'],
    ['A. St. Brown', 'WR', 'Det', '7', 'chris'],
    ['M. Nabers', 'WR', 'NYG', '8', 'nick'],
    ['N. Collins', 'WR', 'Hou', '9', 'steve'],
    ['B. Thomas', 'WR', 'Jax', '10', 'mike'],
    ['D. Henry', 'RB', 'Bal', '11', 'adam'],
    ['S. Barkley', 'RB', 'Phi', '12', 'ryan'],
    ['D. Achane', 'RB', 'Mia', '13', 'TebowDied4OurSins'],
    ['C. Lamb', 'WR', 'Dal', '14', 'You'],
    ['A. Brown', 'WR', 'Phi', '15', 'wesley'],
    ['L. Jackson', 'QB', 'Bal', '16', 'ja'],
    ['J. Allen', 'QB', 'Buf', '17', 'gabe'],
    ['J. Hurts', 'QB', 'Phi', '18', 'jordan'],
    ['D. London', 'WR', 'Atl', '19', 'chris'],
    ['G. Wilson', 'WR', 'NYJ', '20', 'nick'],
    ['M. Harrison', 'WR', 'Ari', '21', 'steve'],
    ['L. McConkey', 'WR', 'LAC', '22', 'mike'],
    ['B. Bowers', 'TE', 'LV', '23', 'adam'],
    ['T. McBride', 'TE', 'Ari', '24', 'ryan'],
    ['K. Williams', 'RB', 'LAR', '25', 'TebowDied4OurSins'],
    ['J. Taylor', 'RB', 'Ind', '26', 'You'],
    ['J. Jacobs', 'RB', 'GB', '27', 'wesley'],
    ['B. Irving', 'RB', 'TB', '28', 'ja'],
    ['D. Smith', 'WR', 'Phi', '29', 'gabe'],
    ['T. Higgins', 'WR', 'Cin', '30', 'jordan'],
    ['M. Evans', 'WR', 'TB', '31', 'chris'],
    ['D. Metcalf', 'WR', 'Sea', '32', 'nick'],
    ['J. Cook', 'RB', 'Buf', '33', 'steve'],
    ['A. Kamara', 'RB', 'NO', '34', 'mike'],
    ['K. Walker', 'RB', 'Sea', '35', 'adam'],
    ['T. Kelce', 'TE', 'KC', '36', 'ryan'],
    ['M. Andrews', 'TE', 'Bal', '37', 'TebowDied4OurSins'],
    ['J. Burrow', 'QB', 'Cin', '38', 'You'],
    ['P. Mahomes', 'QB', 'KC', '39', 'wesley'],
    ['C. Stroud', 'QB', 'Hou', '40', 'ja'],
    ['G. Kittle', 'TE', 'SF', '41', 'gabe'],
    ['D. Kincaid', 'TE', 'Buf', '42', 'jordan'],
    ['X. Worthy', 'WR', 'KC', '43', 'chris'],
  ];
  const noisyYahooPaste = [
    'HC',
    ...picks.flatMap(([name, position, team, pick, manager], index) => [
      name,
      name,
      position,
      team,
      `Bye ${((index + 5) % 14) + 5}`,
      pick,
      manager,
      ...(index === 8 ? ['ja', 'ja', 'ja left', 'ja', 'ja', 'ja joined'] : []),
      ...(index === 27 ? ['HC'] : []),
    ]),
  ].join('\n');

  const rawRows = yahooDraftAppTextToRows(noisyYahooPaste, { teams: 12 });
  const rows = yahooDraftCsvTextToV3(noisyYahooPaste, { season: 2026, teams: 12 });

  assert.equal(rawRows.length, 43);
  assert.equal(rows.length, 43);
  assert.equal(rows[0].name, 'J. Chase');
  assert.equal(rows[0].pickNumber, 1);
  assert.equal(rows[0].fantasyTeam, 'TebowDied4OurSins');
  assert.equal(rows[1].name, 'B. Robinson');
  assert.equal(rows[1].team, 'ATL');
  assert.equal(rows[6].name, 'A. St. Brown');
  assert.equal(rows[6].team, 'DET');
  assert.equal(rows[23].name, 'T. McBride');
  assert.equal(rows[23].position, 'TE');
  assert.equal(rows[42].name, 'X. Worthy');
  assert.equal(rows[42].pickNumber, 43);
  assert.equal(rows[42].fantasyTeam, 'chris');
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