function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePosition(position = '') {
  const value = String(position).toUpperCase().replace('DEF', 'DST');
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(value) ? value : 'UNK';
}

export function parseHistoricalDraftCsv(csv = '', teams = 12) {
  const rows = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (!rows.length) return [];
  const start = /round/i.test(rows[0]) ? 1 : 0;
  return rows.slice(start).map((line, index) => {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 6) return null;
    const round = Math.max(1, Math.round(finite(parts[0], 1)));
    const pickInRound = Math.max(1, Math.round(finite(parts[1], 1)));
    const overallPick = (round - 1) * teams + pickInRound;
    return {
      round,
      pickInRound,
      overallPick,
      player: parts[2],
      nflTeam: parts[3],
      position: normalizePosition(parts[4]),
      fantasyTeam: parts.slice(5).join(',').trim(),
      sequence: index + 1,
    };
  }).filter(Boolean);
}

function mean(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function buildLeagueTendencies(picks = [], { teams = 12, rounds = 15 } = {}) {
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const roundPositionCounts = {};
  const ownerProfiles = {};
  const positionRounds = Object.fromEntries(positions.map((position) => [position, []]));

  picks.forEach((pick) => {
    const position = normalizePosition(pick.position);
    roundPositionCounts[pick.round] ||= Object.fromEntries(positions.map((item) => [item, 0]));
    roundPositionCounts[pick.round][position] = (roundPositionCounts[pick.round][position] || 0) + 1;
    if (positionRounds[position]) positionRounds[position].push(pick.round);

    const owner = pick.fantasyTeam || `Slot ${pick.pickInRound}`;
    ownerProfiles[owner] ||= {
      team: owner,
      totalPicks: 0,
      positionCounts: Object.fromEntries(positions.map((item) => [item, 0])),
      firstRoundByPosition: {},
      averageRoundByPosition: {},
    };
    const profile = ownerProfiles[owner];
    profile.totalPicks += 1;
    profile.positionCounts[position] = (profile.positionCounts[position] || 0) + 1;
    profile.firstRoundByPosition[position] = Math.min(profile.firstRoundByPosition[position] || Infinity, pick.round);
  });

  Object.values(ownerProfiles).forEach((profile) => {
    positions.forEach((position) => {
      const roundsForPosition = picks
        .filter((pick) => (pick.fantasyTeam || `Slot ${pick.pickInRound}`) === profile.team && normalizePosition(pick.position) === position)
        .map((pick) => pick.round);
      profile.averageRoundByPosition[position] = roundsForPosition.length ? mean(roundsForPosition) : null;
      if (!Number.isFinite(profile.firstRoundByPosition[position])) profile.firstRoundByPosition[position] = null;
    });
  });

  const positionAverageRound = Object.fromEntries(positions.map((position) => [position, mean(positionRounds[position])]));
  const roundPositionProbabilities = {};
  for (let round = 1; round <= rounds; round += 1) {
    const counts = roundPositionCounts[round] || {};
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || teams;
    roundPositionProbabilities[round] = Object.fromEntries(positions.map((position) => [position, finite(counts[position], 0) / total]));
  }

  return {
    teams,
    rounds,
    sampleSize: picks.length,
    positionAverageRound,
    roundPositionProbabilities,
    ownerProfiles,
  };
}

export function leaguePositionDemandScore(position = '', round = 1, tendencies = {}) {
  const normalized = normalizePosition(position);
  const exact = finite(tendencies.roundPositionProbabilities?.[round]?.[normalized], 0);
  const prior = finite(tendencies.roundPositionProbabilities?.[Math.max(1, round - 1)]?.[normalized], 0);
  const next = finite(tendencies.roundPositionProbabilities?.[round + 1]?.[normalized], 0);
  return exact * 0.60 + prior * 0.15 + next * 0.25;
}

export function estimatePositionRunRisk(position = '', currentPick = 1, picksUntilNext = 12, tendencies = {}) {
  const teams = Math.max(1, finite(tendencies.teams, 12));
  let expected = 0;
  for (let offset = 1; offset <= Math.max(1, picksUntilNext); offset += 1) {
    const pick = currentPick + offset;
    const round = Math.floor((pick - 1) / teams) + 1;
    expected += leaguePositionDemandScore(position, round, tendencies);
  }
  return {
    expectedPicks: expected,
    probabilityAtLeastOne: 1 - Math.exp(-expected),
    probabilityThreeOrMore: expected > 0 ? 1 - Math.exp(-expected) * (1 + expected + (expected ** 2) / 2) : 0,
  };
}

export function ownerPositionPreference(ownerName = '', position = '', round = 1, tendencies = {}) {
  const profile = tendencies.ownerProfiles?.[ownerName];
  if (!profile) return 0;
  const normalized = normalizePosition(position);
  const share = finite(profile.positionCounts?.[normalized], 0) / Math.max(1, finite(profile.totalPicks, 1));
  const firstRound = profile.firstRoundByPosition?.[normalized];
  const timingBoost = Number.isFinite(firstRound) && round >= firstRound ? 0.10 : 0;
  return share + timingBoost;
}

export function summarizeLeagueTendencies(tendencies = {}) {
  const avg = tendencies.positionAverageRound || {};
  const ordered = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
    .filter((position) => finite(avg[position], 0) > 0)
    .sort((a, b) => avg[a] - avg[b]);
  return ordered.map((position) => `${position} avg R${avg[position].toFixed(1)}`).join(' · ');
}
