import test from 'node:test';
import assert from 'node:assert/strict';
import { buildV3BoardRows } from '../js/board-adapter.js';

const leagueSettings = {
  teams: 1,
  starters: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0 },
  flexEligibility: ['RB', 'WR', 'TE'],
};

test('builds V3 board rows with projections, ADP, VORP, and final score', () => {
  const rows = buildV3BoardRows({
    rankings: [
      { name: 'Bijan Robinson', team: 'ATL', position: 'RB', rank: 1 },
      { name: "Ja'Marr Chase", team: 'CIN', position: 'WR', rank: 2 },
    ],
    projections: [
      { name: 'Bijan Robinson', team: 'ATL', position: 'RB', projections: { rushing: { yards: 1000, touchdowns: 10 } } },
      { name: 'Ja’Marr Chase', team: 'CIN', position: 'WR', projections: { receiving: { receptions: 100, yards: 1400, touchdowns: 10 } } },
    ],
    adp: [
      { name: 'Bijan Robinson', team: 'ATL', position: 'RB', adp: 1.5, platform: 'Fixture' },
      { name: "Ja'Marr Chase", team: 'CIN', position: 'WR', adp: 2.5, platform: 'Fixture' },
    ],
  }, undefined, leagueSettings);

  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => Number.isFinite(row.v3Row.adjustedProjection)));
  assert.ok(rows.every((row) => Number.isFinite(row.v3Row.vorp)));
  assert.ok(rows.every((row) => Number.isFinite(row.v3Row.finalDraftScore)));
  assert.equal(rows.find((row) => row.name === 'Bijan Robinson').v3Row.adp, 1.5);
});

test('marks missing projections and ADP with visible warnings', () => {
  const [row] = buildV3BoardRows({
    rankings: [{ name: 'Unknown Player', team: 'ATL', position: 'RB', rank: 99 }],
    projections: [],
    adp: [],
  }, undefined, leagueSettings);

  assert.equal(row.v3Status.hasProjection, false);
  assert.equal(row.v3Status.hasAdp, false);
  assert.equal(row.v3Row.adp, 99);
  assert.equal(row.v3Row.adpSource, 'consensus-fallback');
  assert.equal(row.v3Row.warnings.length, 2);
  assert.ok(row.v3Row.warnings.some((warning) => warning.includes('using consensus rank')));
});

test('uses loaded ADP ahead of consensus fallback when available', () => {
  const [row] = buildV3BoardRows({
    rankings: [{ name: 'Market Player', team: 'BUF', position: 'QB', rank: 10 }],
    projections: [{ name: 'Market Player', team: 'BUF', position: 'QB', projections: { passing: { yards: 4000, touchdowns: 30 } } }],
    adp: [{ name: 'Market Player', team: 'BUF', position: 'QB', adp: 27.5, platform: 'Yahoo' }],
  }, undefined, leagueSettings);

  assert.equal(row.v3Status.hasAdp, true);
  assert.equal(row.v3Row.adp, 27.5);
  assert.equal(row.v3Row.adpSource, 'loaded');
  assert.equal(row.v3Row.adpPlatform, 'Yahoo');
});

test('uses normalized name matching across apostrophe variants', () => {
  const [row] = buildV3BoardRows({
    rankings: [{ name: "Ja'Marr Chase", team: 'CIN', position: 'WR', rank: 1 }],
    projections: [{ name: 'Ja’Marr Chase', team: 'CIN', position: 'WR', projections: { receiving: { receptions: 10 } } }],
    adp: [],
  }, undefined, leagueSettings);

  assert.equal(row.v3Status.hasProjection, true);
  assert.equal(row.v3Row.adjustedProjection, 5);
});

test('passes big-play confidence through the V3 board audit', () => {
  const [row] = buildV3BoardRows({
    rankings: [{ name: 'Explosive Back', team: 'ATL', position: 'RB', rank: 1 }],
    projections: [{ name: 'Explosive Back', team: 'ATL', position: 'RB', projections: { rushing: { yards: 100, touchdowns: 1, fortyYardRuns: 2 } } }],
    adp: [],
  }, undefined, leagueSettings, { bigPlayConfidence: 0.5 });

  assert.equal(row.v3Row.audit.adjustments.bigPlayBonus, 1);
  assert.equal(row.v3Row.audit.adjustments.bigPlayConfidenceAdjustment, -1);
  assert.equal(row.v3Row.audit.bigPlay.confidence, 0.5);
});