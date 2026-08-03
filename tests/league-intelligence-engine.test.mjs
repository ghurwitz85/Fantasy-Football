import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeagueTendencies,
  estimatePositionRunRisk,
  leaguePositionDemandScore,
  parseHistoricalDraftCsv,
} from '../js/league-intelligence-engine.js';

test('parses compact historical draft CSV and builds round-position priors', () => {
  const csv = `Round,PickInRound,Player,NFLTeam,Pos,FantasyTeam\n1,1,Alpha,CIN,WR,Team A\n1,2,Beta,ATL,RB,Team B\n2,1,Gamma,BAL,QB,Team B\n2,2,Delta,PHI,WR,Team A`;
  const picks = parseHistoricalDraftCsv(csv, 2);
  const tendencies = buildLeagueTendencies(picks, { teams: 2, rounds: 2 });

  assert.equal(picks[2].overallPick, 3);
  assert.equal(tendencies.sampleSize, 4);
  assert.equal(tendencies.roundPositionProbabilities[1].WR, 0.5);
  assert.equal(tendencies.ownerProfiles['Team B'].firstRoundByPosition.QB, 2);
});

test('estimates elevated run risk when a position was frequently drafted in upcoming rounds', () => {
  const tendencies = {
    teams: 12,
    roundPositionProbabilities: {
      2: { RB: 0.50 },
      3: { RB: 0.40 },
    },
  };
  assert.ok(leaguePositionDemandScore('RB', 2, tendencies) > 0.30);
  const risk = estimatePositionRunRisk('RB', 12, 12, tendencies);
  assert.ok(risk.expectedPicks > 4);
  assert.ok(risk.probabilityAtLeastOne > 0.95);
});
