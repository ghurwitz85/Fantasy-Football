import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateAvailability,
  annotateDraftRecommendations,
  compareCandidateSimulations,
  createDraftState,
  draftedPlayerIds,
  draftPlayer,
  draftTeamForPick,
  estimateAvailability,
  filterAvailablePlayers,
  isUserPick,
  picksUntilNextTurn,
  prepareLiveDraftBoard,
  resetDraftState,
  rosterCountsByPosition,
  rosterForTeam,
  runDecisionExplorer,
  scoreStartingLineup,
  simulateCandidatePickImpact,
  simulateCandidateMonteCarlo,
  undoLastPick,
} from '../js/draft-state-engine.js';

test('estimates availability from ADP and next pick', () => {
  const earlyAdpLatePick = estimateAvailability(10, 8, 30);
  const lateAdpEarlyPick = estimateAvailability(80, 8, 30);

  assert.ok(earlyAdpLatePick < 0.2);
  assert.ok(lateAdpEarlyPick > 0.9);
  assert.equal(estimateAvailability(null), 0.5);
});

test('calculates snake-draft picks until next user turn', () => {
  assert.equal(picksUntilNextTurn({ currentPick: 1, userDraftSlot: 1, teams: 12 }), 23);
  assert.equal(picksUntilNextTurn({ currentPick: 12, userDraftSlot: 12, teams: 12 }), 1);
});

test('maps snake-draft picks to fantasy teams', () => {
  assert.equal(draftTeamForPick(1, 12), 1);
  assert.equal(draftTeamForPick(12, 12), 12);
  assert.equal(draftTeamForPick(13, 12), 12);
  assert.equal(draftTeamForPick(24, 12), 1);
  assert.equal(isUserPick(24, { teams: 12, userDraftSlot: 1 }), true);
  assert.equal(isUserPick(13, { teams: 12, userDraftSlot: 1 }), false);
});

test('creates, drafts, undoes, and resets live draft state immutably', () => {
  const state = createDraftState({ teams: 12, userDraftSlot: 5 });
  const afterPick = draftPlayer(state, { playerId: 'bijan-robinson-atl-rb', name: 'Bijan Robinson', position: 'RB', team: 'ATL' }, { pickNumber: 5, timestamp: 'now' });

  assert.equal(state.picks.length, 0);
  assert.equal(afterPick.picks.length, 1);
  assert.equal(afterPick.currentPick, 6);
  assert.equal(afterPick.picks[0].teamNumber, 5);
  assert.equal(afterPick.picks[0].isUserPick, true);
  assert.deepEqual(rosterCountsByPosition(afterPick), { RB: 1 });
  assert.equal(rosterForTeam(afterPick).at(0).name, 'Bijan Robinson');

  const undone = undoLastPick(afterPick);
  assert.equal(undone.picks.length, 0);
  assert.equal(undone.currentPick, 1);

  const reset = resetDraftState(afterPick);
  assert.equal(reset.picks.length, 0);
  assert.equal(reset.userDraftSlot, 5);
});

test('filters drafted players from the available board', () => {
  const players = [
    { playerId: 'one', name: 'One', position: 'RB' },
    { playerId: 'two', name: 'Two', position: 'WR' },
  ];
  const state = draftPlayer(createDraftState(), players[0], { timestamp: 'now' });

  assert.deepEqual([...draftedPlayerIds(state)], ['one']);
  assert.deepEqual(filterAvailablePlayers(players, state).map((player) => player.playerId), ['two']);
});

test('annotates players with availability and draft urgency', () => {
  const [player] = annotateAvailability([
    { name: 'Urgent Player', adp: { overall: 10 }, adjusted: { replacementValue: 50 } },
  ], { currentPick: 1, userDraftSlot: 1, teams: 12, defaultAdpStdDev: 8 });

  assert.ok(player.draft.availabilityProbability < 0.2);
  assert.ok(player.draft.goneBeforeNextPick > 0.8);
  assert.ok(player.draft.draftUrgency > 40);
});

test('annotates draft recommendations, ADP values, and outlier targets', () => {
  const [target, depth] = annotateDraftRecommendations([
    {
      name: 'Target Player',
      adp: { overall: 35 },
      adjusted: { replacementValue: 42 },
      draft: { draftUrgency: 38, availabilityProbability: 0.2 },
      v3Row: { personalRank: 12, consensusRank: 20, vorp: 42, finalDraftScore: 0.95 },
    },
    {
      name: 'Depth Player',
      adp: { overall: 28 },
      adjusted: { replacementValue: -2 },
      draft: { draftUrgency: 0, availabilityProbability: 0.9 },
      v3Row: { personalRank: 60, consensusRank: 55, vorp: -2, finalDraftScore: 0.2 },
    },
  ]);

  assert.equal(target.draft.valueVsAdp, 23);
  assert.equal(target.draft.valueVsConsensus, 8);
  assert.equal(target.draft.isOutlierValue, true);
  assert.equal(target.draft.recommendation, 'Draft now');
  assert.equal(target.v3Row.recommendation, 'Draft now');
  assert.equal(depth.draft.recommendation, 'Depth option');
});

test('prepares a live draft board by removing drafted players and refreshing next-pick context', () => {
  const players = [
    { playerId: 'one', name: 'One', adp: { overall: 5 }, adjusted: { replacementValue: 50 }, v3Row: { personalRank: 1, adp: 5, vorp: 50 } },
    { playerId: 'two', name: 'Two', adp: { overall: 30 }, adjusted: { replacementValue: 20 }, v3Row: { personalRank: 2, adp: 30, vorp: 20 } },
  ];
  const state = draftPlayer(createDraftState({ teams: 12, userDraftSlot: 1 }), players[0], { timestamp: 'now' });
  const board = prepareLiveDraftBoard(players, state, { defaultAdpStdDev: 8 });

  assert.deepEqual(board.map((player) => player.playerId), ['two']);
  assert.equal(board[0].draft.currentPick, 2);
  assert.equal(board[0].draft.valueVsAdp, 28);
  assert.equal(board[0].draft.isOutlierValue, true);
});

test('recalculates live replacement value from available players when league settings are provided', () => {
  const players = [
    { playerId: 'rb1', name: 'RB One', position: 'RB', adp: { overall: 1 }, adjusted: { contextFantasyPoints: 100, replacementValue: 40 }, v3Row: { personalRank: 1, adp: 1, vorp: 40 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', adp: { overall: 20 }, adjusted: { contextFantasyPoints: 90, replacementValue: 30 }, v3Row: { personalRank: 2, adp: 20, vorp: 30 } },
    { playerId: 'rb3', name: 'RB Three', position: 'RB', adp: { overall: 40 }, adjusted: { contextFantasyPoints: 80, replacementValue: 20 }, v3Row: { personalRank: 3, adp: 40, vorp: 20 } },
    { playerId: 'wr1', name: 'WR One', position: 'WR', adp: { overall: 10 }, adjusted: { contextFantasyPoints: 95 }, v3Row: { personalRank: 4, adp: 10 } },
  ];
  const state = draftPlayer(createDraftState({ teams: 1, userDraftSlot: 1 }), players[0], { timestamp: 'now' });
  const board = prepareLiveDraftBoard(players, state, {
    leagueSettings: { teams: 1, starters: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 0 } },
  });
  const rbTwo = board.find((player) => player.playerId === 'rb2');
  const rbThree = board.find((player) => player.playerId === 'rb3');

  assert.equal(rbTwo.v3Row.replacementBaseline, 90);
  assert.equal(rbTwo.v3Row.vorp, 0);
  assert.equal(rbThree.v3Row.replacementBaseline, 90);
  assert.equal(rbThree.v3Row.vorp, -10);
});

test('adds modest roster-need and position tier hints to live draft board', () => {
  const players = [
    { playerId: 'rb1', name: 'RB One', position: 'RB', adp: { overall: 8 }, adjusted: { contextFantasyPoints: 105 }, v3Row: { personalRank: 1, adp: 8, adjustedProjection: 105 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', adp: { overall: 18 }, adjusted: { contextFantasyPoints: 90 }, v3Row: { personalRank: 2, adp: 18, adjustedProjection: 90 } },
    { playerId: 'wr1', name: 'WR One', position: 'WR', adp: { overall: 12 }, adjusted: { contextFantasyPoints: 99 }, v3Row: { personalRank: 3, adp: 12, adjustedProjection: 99 } },
    { playerId: 'wr2', name: 'WR Two', position: 'WR', adp: { overall: 30 }, adjusted: { contextFantasyPoints: 94 }, v3Row: { personalRank: 4, adp: 30, adjustedProjection: 94 } },
  ];
  const state = draftPlayer(createDraftState({ teams: 1, userDraftSlot: 1 }), players[2], { timestamp: 'now' });
  const board = prepareLiveDraftBoard(players, state, {
    leagueSettings: { teams: 1, starters: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 1 }, flexEligibility: ['RB', 'WR', 'TE'] },
  });
  const rbOne = board.find((player) => player.playerId === 'rb1');
  const wrTwo = board.find((player) => player.playerId === 'wr2');

  assert.equal(rbOne.draft.rosterNeed.level, 'starter');
  assert.equal(rbOne.draft.tier.bestAvailableAtPosition, true);
  assert.equal(rbOne.draft.tier.dropoffLabel, 'Tier drop: 15.0 pts to next RB');
  assert.equal(rbOne.v3Row.positionRankAvailable, 1);
  assert.equal(wrTwo.draft.rosterNeed.level, 'flex');
});

test('adds points-maximizing strategy scores that can favor a tier cliff over static rank', () => {
  const players = [
    { playerId: 'wr1', name: 'WR One', position: 'WR', adp: { overall: 9 }, adjusted: { contextFantasyPoints: 110, replacementValue: 34 }, v3Row: { personalRank: 1, adp: 9, adjustedProjection: 110, vorp: 34 } },
    { playerId: 'wr2', name: 'WR Two', position: 'WR', adp: { overall: 28 }, adjusted: { contextFantasyPoints: 107, replacementValue: 31 }, v3Row: { personalRank: 3, adp: 28, adjustedProjection: 107, vorp: 31 } },
    { playerId: 'rb1', name: 'RB One', position: 'RB', adp: { overall: 8 }, adjusted: { contextFantasyPoints: 106, replacementValue: 32 }, v3Row: { personalRank: 2, adp: 8, adjustedProjection: 106, vorp: 32 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', adp: { overall: 34 }, adjusted: { contextFantasyPoints: 84, replacementValue: 10 }, v3Row: { personalRank: 4, adp: 34, adjustedProjection: 84, vorp: 10 } },
  ];
  const board = prepareLiveDraftBoard(players, createDraftState({ teams: 12, userDraftSlot: 1, currentPick: 1 }), {
    leagueSettings: { teams: 12, starters: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 1 }, flexEligibility: ['RB', 'WR', 'TE'] },
    defaultAdpStdDev: 8,
  });
  const wrOne = board.find((player) => player.playerId === 'wr1');
  const rbOne = board.find((player) => player.playerId === 'rb1');

  assert.ok(rbOne.draft.strategy.pointsMaximizingScore > wrOne.draft.strategy.pointsMaximizingScore);
  assert.match(rbOne.draft.strategy.explanation, /tier\/dropoff edge/);
  assert.equal(rbOne.v3Row.pointsMaximizingScore, rbOne.draft.strategy.pointsMaximizingScore);
});

test('scores the best legal starting lineup with flex from a modeled roster', () => {
  const scored = scoreStartingLineup([
    { playerId: 'qb1', name: 'QB One', position: 'QB', v3Row: { adjustedProjection: 300 } },
    { playerId: 'rb1', name: 'RB One', position: 'RB', v3Row: { adjustedProjection: 210 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', v3Row: { adjustedProjection: 180 } },
    { playerId: 'wr1', name: 'WR One', position: 'WR', v3Row: { adjustedProjection: 205 } },
    { playerId: 'wr2', name: 'WR Two', position: 'WR', v3Row: { adjustedProjection: 190 } },
    { playerId: 'te1', name: 'TE One', position: 'TE', v3Row: { adjustedProjection: 140 } },
  ], { starters: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1 }, flexEligibility: ['RB', 'WR', 'TE'] });

  assert.equal(scored.projectedStarterPoints, 300 + 210 + 205 + 140 + 190);
  assert.equal(scored.totalRosterPoints, 300 + 210 + 180 + 205 + 190 + 140);
  assert.equal(scored.lineup.FLEX[0].playerId, 'wr2');
});

test('scores K and DST starters plus fallback-adjusted roster totals', () => {
  const scored = scoreStartingLineup([
    { playerId: 'qb1', name: 'QB One', position: 'QB', adjusted: { fallbackFantasyPoints: 295 } },
    { playerId: 'k1', name: 'K One', position: 'K', adjusted: { contextFantasyPoints: 128 } },
    { playerId: 'dst1', name: 'DST One', position: 'DST', adjusted: { baseFantasyPoints: 135 } },
    { playerId: 'te1', name: 'TE One', position: 'TE', adjusted: { fallbackFantasyPoints: 95 } },
  ], { starters: { QB: 1, TE: 1, K: 1, DST: 1, FLEX: 0 }, flexEligibility: ['RB', 'WR', 'TE'] });

  assert.equal(scored.projectedStarterPoints, 295 + 128 + 135 + 95);
  assert.equal(scored.totalRosterPoints, 295 + 128 + 135 + 95);
  assert.equal(scored.lineup.K[0].playerId, 'k1');
  assert.equal(scored.lineup.DST[0].playerId, 'dst1');
});

test('simulates candidate pick impact and annotates modeled final starter points', () => {
  const players = [
    { playerId: 'rb1', name: 'RB One', position: 'RB', adp: { overall: 1 }, draft: { strategy: { pointsMaximizingScore: 80 } }, v3Row: { personalRank: 1, adp: 1, adjustedProjection: 220, vorp: 70 } },
    { playerId: 'wr1', name: 'WR One', position: 'WR', adp: { overall: 2 }, draft: { strategy: { pointsMaximizingScore: 70 } }, v3Row: { personalRank: 2, adp: 2, adjustedProjection: 215, vorp: 65 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', adp: { overall: 3 }, draft: { strategy: { pointsMaximizingScore: 20 } }, v3Row: { personalRank: 3, adp: 3, adjustedProjection: 120, vorp: 10 } },
    { playerId: 'wr2', name: 'WR Two', position: 'WR', adp: { overall: 40 }, draft: { strategy: { pointsMaximizingScore: 60 } }, v3Row: { personalRank: 4, adp: 40, adjustedProjection: 200, vorp: 50 } },
    { playerId: 'qb1', name: 'QB One', position: 'QB', adp: { overall: 60 }, draft: { strategy: { pointsMaximizingScore: 30 } }, v3Row: { personalRank: 5, adp: 60, adjustedProjection: 300, vorp: 40 } },
  ];
  const simulation = simulateCandidatePickImpact(players, createDraftState({ teams: 2, userDraftSlot: 1, currentPick: 1 }), players[0], {
    leagueSettings: { starters: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0 }, flexEligibility: ['RB', 'WR', 'TE'] },
    benchSpots: 0,
    maxSimulationPicks: 6,
  });

  assert.ok(simulation.projectedStarterPoints >= 520);
  assert.ok(simulation.totalRosterPoints >= simulation.projectedStarterPoints);
  assert.deepEqual(simulation.path.map((line) => line.replace(/:.*/, '')), ['Pick 1', 'Pick 4', 'Pick 5']);
  assert.match(simulation.explanation, /starter points and .* total roster points/);
});

test('simulation keeps existing user roster projections in modeled starters', () => {
  const allen = { playerId: 'qb1', name: 'Josh Allen', position: 'QB', v3Row: { adjustedProjection: 330 } };
  const bowers = { playerId: 'te1', name: 'Brock Bowers', position: 'TE', v3Row: { adjustedProjection: 170 } };
  const state = draftPlayer(createDraftState({ teams: 2, userDraftSlot: 1, currentPick: 1 }), allen, {
    pickNumber: 1,
    isUserPick: true,
    timestamp: 'now',
  });
  const simulation = simulateCandidatePickImpact([allen, bowers], createDraftState({ ...state, currentPick: 3 }), bowers, {
    leagueSettings: { starters: { QB: 1, RB: 0, WR: 0, TE: 1, FLEX: 0 }, flexEligibility: ['RB', 'WR', 'TE'] },
    benchSpots: 0,
    maxSimulationPicks: 2,
  });

  assert.equal(state.picks[0].adjustedProjection, 330);
  assert.equal(simulation.projectedStarterPoints, 500);
  assert.equal(simulation.startingLineup.QB[0].name, 'Josh Allen');
  assert.equal(simulation.startingLineup.TE[0].name, 'Brock Bowers');
});

test('simulation avoids early K and DST while core starters and flex are unfilled', () => {
  const players = [
    { playerId: 'wr1', name: 'Drake London', position: 'WR', adp: { overall: 19 }, draft: { strategy: { pointsMaximizingScore: 90 } }, v3Row: { personalRank: 1, adp: 19, adjustedProjection: 210, vorp: 55 } },
    { playerId: 'k1', name: 'Daniel Carlson', position: 'K', adp: { overall: 48 }, draft: { strategy: { pointsMaximizingScore: 300 } }, v3Row: { personalRank: 2, adp: 48, adjustedProjection: 150, vorp: 80 } },
    { playerId: 'dst1', name: 'Elite DST', position: 'DST', adp: { overall: 49 }, draft: { strategy: { pointsMaximizingScore: 280 } }, v3Row: { personalRank: 3, adp: 49, adjustedProjection: 145, vorp: 75 } },
    { playerId: 'qb1', name: 'Josh Allen', position: 'QB', adp: { overall: 24 }, draft: { strategy: { pointsMaximizingScore: 70 } }, v3Row: { personalRank: 4, adp: 24, adjustedProjection: 330, vorp: 70 } },
    { playerId: 'te1', name: 'Brock Bowers', position: 'TE', adp: { overall: 25 }, draft: { strategy: { pointsMaximizingScore: 65 } }, v3Row: { personalRank: 5, adp: 25, adjustedProjection: 170, vorp: 60 } },
    { playerId: 'rb1', name: 'Kenneth Walker III', position: 'RB', adp: { overall: 26 }, draft: { strategy: { pointsMaximizingScore: 60 } }, v3Row: { personalRank: 6, adp: 26, adjustedProjection: 205, vorp: 50 } },
    { playerId: 'wr2', name: 'Nico Collins', position: 'WR', adp: { overall: 27 }, draft: { strategy: { pointsMaximizingScore: 55 } }, v3Row: { personalRank: 7, adp: 27, adjustedProjection: 200, vorp: 45 } },
    { playerId: 'rb2', name: 'RB Depth', position: 'RB', adp: { overall: 28 }, draft: { strategy: { pointsMaximizingScore: 50 } }, v3Row: { personalRank: 8, adp: 28, adjustedProjection: 190, vorp: 40 } },
  ];
  const simulation = simulateCandidatePickImpact(players, createDraftState({ teams: 2, userDraftSlot: 1, currentPick: 19 }), players[0], {
    leagueSettings: { starters: { QB: 1, RB: 1, WR: 2, TE: 1, K: 1, DST: 1, FLEX: 1 }, flexEligibility: ['RB', 'WR', 'TE'] },
    benchSpots: 0,
    maxSimulationPicks: 12,
  });
  const earlyPathPositions = simulation.path.map((line) => line.match(/\(([^)]+)\)$/)?.[1]);

  assert.ok(!earlyPathPositions.includes('K'));
  assert.ok(!earlyPathPositions.includes('DST'));
  assert.ok(earlyPathPositions.includes('QB'));
  assert.ok(earlyPathPositions.includes('TE'));
});


test('compares recommended pick against alternatives with auditable deltas', () => {
  const recommended = {
    playerId: 'rb1', name: 'RB One', position: 'RB',
    draft: { simulation: {
      modeledDraftUtility: 82, projectedStarterPoints: 1400, totalRosterPoints: 1800, opportunityCost: 18, nextTurnDropoff: 24,
      modeledUtilityBreakdown: { starter: 20, flex: 4, bench: 2, rosterPlan: 30, opportunity: 18, tierScarcity: 5, availability: 4, strategy: 3, replaceabilityPenalty: 4 },
    } },
  };
  const alternative = {
    playerId: 'wr1', name: 'WR One', position: 'WR',
    draft: { simulation: {
      modeledDraftUtility: 70, projectedStarterPoints: 1410, totalRosterPoints: 1780, opportunityCost: 6, nextTurnDropoff: 8,
      modeledUtilityBreakdown: { starter: 18, flex: 4, bench: 3, rosterPlan: 22, opportunity: 6, tierScarcity: 2, availability: 5, strategy: 4, replaceabilityPenalty: 3 },
    } },
  };

  const comparison = compareCandidateSimulations(recommended, alternative);
  assert.equal(comparison.utilityDelta, 12);
  assert.equal(comparison.starterPointsDelta, -10);
  assert.equal(comparison.totalRosterPointsDelta, 20);
  assert.equal(comparison.nextTurnDropoffDelta, 16);
  assert.equal(comparison.utilityDeltas.rosterPlan, 8);
  assert.equal(comparison.utilityDeltas.opportunity, 12);
});

test('Monte Carlo simulation returns stable floor median ceiling and league run risk', () => {
  const players = [
    { playerId: 'rb1', name: 'RB One', position: 'RB', adp: { overall: 1 }, draft: { strategy: { pointsMaximizingScore: 80 } }, v3Row: { personalRank: 1, adp: 1, adjustedProjection: 220, vorp: 70 } },
    { playerId: 'wr1', name: 'WR One', position: 'WR', adp: { overall: 2 }, draft: { strategy: { pointsMaximizingScore: 70 } }, v3Row: { personalRank: 2, adp: 2, adjustedProjection: 215, vorp: 65 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', adp: { overall: 3 }, draft: { strategy: { pointsMaximizingScore: 40 } }, v3Row: { personalRank: 3, adp: 3, adjustedProjection: 190, vorp: 40 } },
    { playerId: 'wr2', name: 'WR Two', position: 'WR', adp: { overall: 4 }, draft: { strategy: { pointsMaximizingScore: 35 } }, v3Row: { personalRank: 4, adp: 4, adjustedProjection: 185, vorp: 35 } },
    { playerId: 'qb1', name: 'QB One', position: 'QB', adp: { overall: 5 }, draft: { strategy: { pointsMaximizingScore: 30 } }, v3Row: { personalRank: 5, adp: 5, adjustedProjection: 300, vorp: 45 } },
  ];
  const result = simulateCandidateMonteCarlo(players, createDraftState({ teams: 2, userDraftSlot: 1, currentPick: 1 }), players[0], {
    trials: 20,
    seed: 7,
    benchSpots: 0,
    maxSimulationPicks: 6,
    leagueSettings: { starters: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0 }, flexEligibility: ['RB', 'WR', 'TE'] },
    leagueTendencies: { teams: 2, roundPositionProbabilities: { 1: { RB: 0.5 }, 2: { RB: 0.5 } } },
  });

  assert.equal(result.trials, 20);
  assert.ok(result.starterFloor <= result.starterMedian);
  assert.ok(result.starterMedian <= result.starterCeiling);
  assert.ok(result.positionRunRisk.probabilityAtLeastOne > 0);
});

test('decision explorer compares candidates and returns confidence plus representative rosters', () => {
  const players = [
    { playerId: 'rb1', name: 'RB One', position: 'RB', adp: { overall: 1 }, draft: { simulation: { modeledDraftUtility: 90 }, strategy: { pointsMaximizingScore: 80 } }, v3Row: { personalRank: 1, finalDraftScore: 0.95, adjustedProjection: 220, vorp: 70 } },
    { playerId: 'wr1', name: 'WR One', position: 'WR', adp: { overall: 2 }, draft: { simulation: { modeledDraftUtility: 80 }, strategy: { pointsMaximizingScore: 70 } }, v3Row: { personalRank: 2, finalDraftScore: 0.90, adjustedProjection: 215, vorp: 65 } },
    { playerId: 'qb1', name: 'QB One', position: 'QB', adp: { overall: 3 }, draft: { simulation: { modeledDraftUtility: 60 }, strategy: { pointsMaximizingScore: 50 } }, v3Row: { personalRank: 3, finalDraftScore: 0.80, adjustedProjection: 300, vorp: 45 } },
    { playerId: 'rb2', name: 'RB Two', position: 'RB', adp: { overall: 4 }, draft: { simulation: { modeledDraftUtility: 40 }, strategy: { pointsMaximizingScore: 30 } }, v3Row: { personalRank: 4, finalDraftScore: 0.70, adjustedProjection: 185, vorp: 35 } },
    { playerId: 'wr2', name: 'WR Two', position: 'WR', adp: { overall: 5 }, draft: { simulation: { modeledDraftUtility: 35 }, strategy: { pointsMaximizingScore: 25 } }, v3Row: { personalRank: 5, finalDraftScore: 0.65, adjustedProjection: 180, vorp: 30 } },
  ];
  const analysis = runDecisionExplorer(players, createDraftState({ teams: 2, userDraftSlot: 1, currentPick: 1 }), {
    trials: 30,
    candidateLimit: 3,
    seed: 9,
    benchSpots: 0,
    maxSimulationPicks: 6,
    leagueSettings: { starters: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0 }, flexEligibility: ['RB', 'WR', 'TE'] },
    leagueTendencies: { teams: 2, roundPositionProbabilities: { 1: { RB: 0.5, WR: 0.5 }, 2: { QB: 0.5 } } },
  });

  assert.equal(analysis.trials, 30);
  assert.equal(analysis.candidateCount, 3);
  assert.ok(analysis.recommended);
  assert.ok(analysis.confidence >= 0 && analysis.confidence <= 1);
  assert.equal(analysis.candidates.length, 3);
  assert.ok(Array.isArray(analysis.recommended.medianRoster));
  assert.ok(analysis.candidates.every((candidate) => candidate.starterFloor <= candidate.starterMedian && candidate.starterMedian <= candidate.starterCeiling));
});
