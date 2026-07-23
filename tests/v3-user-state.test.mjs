import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adpCsvTextToV3,
  applyV3Preferences,
  buildV3ContextWeightsFromFormValues,
  buildV3LeagueSettingsFromFormValues,
  buildV3PreferenceWeightsFromFormValues,
  buildV3ScoringFromFormValues,
  createPreferenceKey,
  projectionCsvTextToV3,
  projectionCsvRowsToV3,
} from '../js/v3-user-state.js';

test('converts legacy projection CSV rows to V3 nested projections', () => {
  const [row] = projectionCsvRowsToV3([{ name: 'A Player', team: 'JAC', position: 'RB1', rushYds: 100, rushTD: 1, rec: 2 }]);
  assert.equal(row.team, 'JAX');
  assert.equal(row.position, 'RB');
  assert.equal(row.projections.rushing.yards, 100);
  assert.equal(row.projections.receiving.receptions, 2);
});

test('converts expanded QB projection aliases to V3 passing volume fields', () => {
  const [row] = projectionCsvRowsToV3([{
    Player: 'Quarter Back',
    TM: 'BUF',
    POS: 'QB',
    ATT: '590',
    CMP: '390',
    PYDS: '4450',
    PTD: '34',
    INTS: '11',
    '40+ pass': '8',
    FL: '3',
  }]);

  assert.equal(row.name, 'Quarter Back');
  assert.equal(row.team, 'BUF');
  assert.equal(row.position, 'QB');
  assert.equal(row.projections.passing.attempts, 590);
  assert.equal(row.projections.passing.completions, 390);
  assert.equal(row.projections.passing.yards, 4450);
  assert.equal(row.projections.passing.touchdowns, 34);
  assert.equal(row.projections.passing.interceptions, 11);
  assert.equal(row.projections.passing.fortyYardCompletions, 8);
  assert.equal(row.projections.fumblesLost, 3);
});

test('converts expanded RB projections, role shares, and risk fields', () => {
  const [row] = projectionCsvRowsToV3([{
    'Player Name': 'Role Back',
    Team: 'JAC',
    Pos: 'RB',
    Carries: '245',
    RYDS: '1120',
    RTD: '10',
    Targets: '68',
    REC: '52',
    'Rec Yds': '440',
    'Recv TD': '3',
    'Snap %': '72',
    'Carry %': '64',
    'GL %': '58',
    '3D %': '46',
    'Injury %': '12',
    'Role Risk': '0.2',
  }]);

  assert.equal(row.team, 'JAX');
  assert.equal(row.projections.rushing.attempts, 245);
  assert.equal(row.projections.rushing.yards, 1120);
  assert.equal(row.projections.rushing.touchdowns, 10);
  assert.equal(row.projections.receiving.targets, 68);
  assert.equal(row.projections.receiving.receptions, 52);
  assert.equal(row.projections.receiving.yards, 440);
  assert.equal(row.projections.receiving.touchdowns, 3);
  assert.equal(row.role.snapShare, 0.72);
  assert.equal(row.role.rushShare, 0.64);
  assert.equal(row.role.goalLineShare, 0.58);
  assert.equal(row.role.thirdDownShare, 0.46);
  assert.equal(row.risk.injuryProbability, 0.12);
  assert.equal(row.risk.roleUncertainty, 0.2);
});

test('converts expanded WR/TE role aliases and rookie/disagreement risk fields', () => {
  const [row] = projectionCsvRowsToV3([{
    playerName: 'Deep Rookie',
    player_team_id: 'KC',
    position: 'WR3',
    tgts: '112',
    catches: '63',
    YDS: '1080',
    TD: '7',
    rec40: '6',
    'Route %': '88%',
    'Target %': '23',
    'Deep Target %': '37',
    'RZ Target %': '19',
    'ECR STD DEV': '18.5',
    Rookie: 'yes',
  }]);

  assert.equal(row.position, 'WR');
  assert.equal(row.projections.receiving.targets, 112);
  assert.equal(row.projections.receiving.receptions, 63);
  assert.equal(row.projections.receiving.yards, 1080);
  assert.equal(row.projections.receiving.touchdowns, 7);
  assert.equal(row.projections.receiving.fortyYardReceptions, 6);
  assert.equal(row.role.routeParticipation, 0.88);
  assert.equal(row.role.targetShare, 0.23);
  assert.equal(row.role.deepTargetShare, 0.37);
  assert.equal(row.role.redZoneTargetShare, 0.19);
  assert.equal(row.risk.expertDisagreement, 18.5);
  assert.equal(row.risk.rookie, true);
});

test('parses projection CSV text into expanded V3 projection rows', () => {
  const [row] = projectionCsvTextToV3(`Player Name,Team,POS,Pass Att,Pass Cmp,Pass Yds,Pass TD,INTS,Route %,Target %\n"Comma, Player",SF,QB,500,330,"4,100",29,9,75%,10%`);

  assert.equal(row.name, 'Comma, Player');
  assert.equal(row.team, 'SF');
  assert.equal(row.position, 'QB');
  assert.equal(row.projections.passing.attempts, 500);
  assert.equal(row.projections.passing.completions, 330);
  assert.equal(row.projections.passing.yards, 4100);
  assert.equal(row.projections.passing.touchdowns, 29);
  assert.equal(row.projections.passing.interceptions, 9);
  assert.equal(row.role.routeParticipation, 0.75);
  assert.equal(row.role.targetShare, 0.10);
});

test('parses ADP CSV text into V3 ADP rows', () => {
  const rows = adpCsvTextToV3('Player,Team,Pos,ADP,Platform,Std Dev\nBijan Robinson,ATL,RB,1.8,Yahoo,4.2\nNo ADP,ATL,RB,,Yahoo,');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Bijan Robinson');
  assert.equal(rows[0].team, 'ATL');
  assert.equal(rows[0].position, 'RB');
  assert.equal(rows[0].adp, 1.8);
  assert.equal(rows[0].platform, 'Yahoo');
  assert.equal(rows[0].adpStdDev, 4.2);
});

test('applies injury, rookie, and manual override preferences to V3 players', () => {
  const players = [
    { name: 'Safe Player', team: 'ATL', position: 'RB', adjusted: { finalDraftScore: 0.8 }, v3Row: { finalDraftScore: 0.8 } },
    { name: 'Risk Player', team: 'CIN', position: 'WR', adjusted: { finalDraftScore: 0.9 }, v3Row: { finalDraftScore: 0.9 } },
  ];
  const riskKey = createPreferenceKey(players[1]);
  const ranked = applyV3Preferences(players, { [riskKey]: { injuryFlag: true, overrideRank: 1 } }, { injuryPenalty: 0.2 });
  assert.equal(ranked[0].name, 'Risk Player');
  assert.equal(ranked[0].personalRank, 1);
  assert.equal(ranked[0].adjusted.finalDraftScore, 0.7);
});

test('maps legacy form scoring values to V3 scoring keys', () => {
  const scoring = buildV3ScoringFromFormValues({
    s_passYdsPerPt: '20',
    s_passTD: '6',
    s_int: '-1',
    s_rec: '1',
    s_pass40: '2',
  });

  assert.equal(scoring.passYardsPerPoint, 20);
  assert.equal(scoring.passTd, 6);
  assert.equal(scoring.interception, -1);
  assert.equal(scoring.reception, 1);
  assert.equal(scoring.fortyYardPassBonus, 2);
  assert.equal(scoring.rushYardsPerPoint, 10);
});

test('maps legacy roster form values to V3 league settings', () => {
  const settings = buildV3LeagueSettingsFromFormValues({
    numTeams: '10',
    rosterQB: '1',
    rosterRB: '2',
    rosterWR: '2',
    rosterTE: '1',
    rosterFLEX: '2',
  });

  assert.equal(settings.teams, 10);
  assert.deepEqual(settings.starters, { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 });
  assert.deepEqual(settings.flexEligibility, ['RB', 'WR', 'TE']);
});

test('converts injury and rookie sliders to modest final-score preference weights', () => {
  const weights = buildV3PreferenceWeightsFromFormValues({ injurySlider: '75', rookieSlider: '-25' });

  assert.equal(weights.injuryPenalty, 0.15);
  assert.equal(weights.rookieBias, -0.025);
});

test('converts context sliders to V3 context weights', () => {
  const weights = buildV3ContextWeightsFromFormValues({ olRunSlider: '35', olPassSlider: '60', qbSupportSlider: '45', sosSlider: '20', gameScriptSlider: '30', bigPlaySlider: '60', historyWeightSlider: '12', vorpSlider: '65' });

  assert.equal(weights.runBlocking, 0.35);
  assert.equal(weights.passProtection, 0.6);
  assert.equal(weights.qbSupport, 0.45);
  assert.equal(weights.bigPlayConfidence, 0.6);
  assert.equal(weights.schedule, 0.2);
  assert.equal(weights.gameScript, 0.3);
  assert.equal(weights.historyWeight, 0.12);
  assert.ok(weights.rankingWeights.projection > 0.4);
  assert.ok(weights.rankingWeights.vorp > 0.2);
  assert.equal(
    Number(Object.values(weights.rankingWeights).reduce((sum, value) => sum + value, 0).toFixed(6)),
    1,
  );
});