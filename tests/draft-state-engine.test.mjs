import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateAvailability,
  annotateDraftRecommendations,
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