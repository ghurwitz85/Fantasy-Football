import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  detectPlaceholderField,
  normalizeLegacyTeamContext,
  rankToStandardScore,
} from '../js/team-environment-engine.js';

const fixtureContext = {
  generatedAt: '2026-07-20T00:00:00Z',
  teams: {
    ATL: { olRun: 1, olPass: 2, qbStrength: 16, defStrength: 16, sosRB: 4, sosWRTE: 3, sosQB: 1 },
    CIN: { olRun: 4, olPass: 3, qbStrength: 16, defStrength: 16, sosRB: 1, sosWRTE: 2, sosQB: 4 },
    JAC: { olRun: 2, olPass: 1, qbStrength: 16, defStrength: 16, sosRB: 3, sosWRTE: 4, sosQB: 2 },
    BUF: { olRun: 3, olPass: 4, qbStrength: 16, defStrength: 16, sosRB: 2, sosWRTE: 1, sosQB: 3 },
  },
};

test('converts rank-style values to capped standard scores', () => {
  assert.equal(rankToStandardScore(1, { teams: 4, rankOneIsBest: true }), 1);
  assert.equal(rankToStandardScore(4, { teams: 4, rankOneIsBest: true }), -1);
  assert.equal(rankToStandardScore(4, { teams: 4, rankOneIsBest: false }), 1);
  assert.equal(rankToStandardScore(999, { teams: 4, rankOneIsBest: true }), -1);
});

test('detects all-neutral placeholder fields', () => {
  assert.equal(detectPlaceholderField(fixtureContext.teams, 'qbStrength'), true);
  assert.equal(detectPlaceholderField(fixtureContext.teams, 'olRun'), false);
});

test('normalizes legacy team context and leaves placeholder QB/defense neutral', () => {
  const normalized = normalizeLegacyTeamContext(fixtureContext);

  assert.equal(normalized.generatedAt, fixtureContext.generatedAt);
  assert.equal(normalized.teams.JAX.team, 'JAX');
  assert.equal(normalized.teams.ATL.offensiveLine.runBlockScore, 1);
  assert.equal(normalized.teams.CIN.offensiveLine.runBlockScore, -1);
  assert.equal(normalized.teams.ATL.strengthOfSchedule.rb, 1);
  assert.equal(normalized.teams.ATL.quarterback.overallScore, 0);
  assert.equal(normalized.teams.ATL.defense.overallScore, 0);
  assert.equal(normalized.status.qbStrength.active, false);
  assert.equal(normalized.status.defStrength.placeholder, true);
  assert.ok(normalized.teams.ATL.warnings.some((warning) => warning.includes('QB environment is neutral')));
});

test('summarizes supported, populated, active, and neutral context fields', () => {
  const normalized = normalizeLegacyTeamContext(fixtureContext);

  assert.deepEqual(normalized.summary, {
    supported: 7,
    populated: 7,
    active: 5,
    neutral: 2,
  });
});

test('accepts normalized V3 team context while preserving legacy fallback fields', () => {
  const normalized = normalizeLegacyTeamContext({
    generatedAt: '2026-07-21T00:00:00Z',
    teams: {
      ATL: {
        olRun: 16,
        olPass: 16,
        qbStrength: 16,
        defStrength: 16,
        sosRB: 16,
        sosWRTE: 16,
        sosQB: 16,
        quarterback: {
          overallScore: 0.6,
          accuracyScore: 0.7,
          deepAccuracyScore: 0.4,
          touchdownEfficiencyScore: 0.8,
          stabilityScore: 0.5,
        },
        defense: { overallScore: -0.3 },
        expectedGameScript: { leadProbabilityScore: -0.2, trailingProbabilityScore: 0.35 },
      },
    },
  });

  assert.equal(normalized.teams.ATL.quarterback.overallScore, 0.6);
  assert.equal(normalized.teams.ATL.quarterback.accuracyScore, 0.7);
  assert.equal(normalized.teams.ATL.quarterback.deepAccuracyScore, 0.4);
  assert.equal(normalized.teams.ATL.quarterback.touchdownEfficiencyScore, 0.8);
  assert.equal(normalized.teams.ATL.quarterback.stabilityScore, 0.5);
  assert.equal(normalized.teams.ATL.defense.overallScore, -0.3);
  assert.equal(normalized.teams.ATL.expectedGameScript.leadProbabilityScore, -0.2);
  assert.equal(normalized.teams.ATL.expectedGameScript.trailingProbabilityScore, 0.35);
  assert.equal(normalized.teams.ATL.expectedGameScript.source, 'normalized-v3');
  assert.equal(normalized.status.qbStrength.active, true);
  assert.equal(normalized.status.defStrength.active, true);
  assert.equal(normalized.status.qbStrength.placeholder, false);
});

test('caps normalized V3 team-context scores to the expected -1 to 1 range', () => {
  const normalized = normalizeLegacyTeamContext({
    teams: {
      BUF: {
        quarterback: { overallScore: 2.4, accuracyScore: -3 },
        defense: { overallScore: -1.7 },
        expectedGameScript: { leadProbabilityScore: 4, trailingProbabilityScore: -4 },
      },
    },
  });

  assert.equal(normalized.teams.BUF.quarterback.overallScore, 1);
  assert.equal(normalized.teams.BUF.quarterback.accuracyScore, -1);
  assert.equal(normalized.teams.BUF.defense.overallScore, -1);
  assert.equal(normalized.teams.BUF.expectedGameScript.leadProbabilityScore, 1);
  assert.equal(normalized.teams.BUF.expectedGameScript.trailingProbabilityScore, -1);
});

test('local team-context fixture has active normalized QB and defense examples', async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../data/team-context.json', import.meta.url), 'utf8'));
  const normalized = normalizeLegacyTeamContext(fixture);
  const activeExampleTeams = Object.values(fixture.teams)
    .filter((team) => team.quarterback?.overallScore !== undefined && team.defense?.overallScore !== undefined);

  assert.equal(normalized.status.qbStrength.active, true);
  assert.equal(normalized.status.defStrength.active, true);
  assert.equal(activeExampleTeams.length, 32);
  assert.ok(normalized.teams.BUF.quarterback.overallScore > 0);
  assert.ok(normalized.teams.CAR.quarterback.overallScore < 0);
  assert.ok(normalized.teams.BUF.defense.overallScore > 0);
  assert.ok(normalized.teams.CAR.defense.overallScore < 0);
  assert.equal(normalized.teams.BUF.expectedGameScript.source, 'normalized-v3');
});