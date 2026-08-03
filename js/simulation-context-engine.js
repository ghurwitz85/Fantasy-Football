function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionOf(player = {}) {
  return String(player.position || player.v3Row?.position || '').replace(/[0-9]/g, '').toUpperCase();
}

function projectionOf(player = {}) {
  return finite(player.v3Row?.adjustedProjection ?? player.adjusted?.contextFantasyPoints, 0);
}

function floorOf(player = {}) {
  return finite(player.adjusted?.floorProjection ?? player.v3Row?.floorProjection, projectionOf(player) * 0.82);
}

function ceilingOf(player = {}) {
  return finite(player.adjusted?.ceilingProjection ?? player.v3Row?.ceilingProjection, projectionOf(player) * 1.18);
}

function byeWeekOf(player = {}) {
  return Number(player.byeWeek || player.v3Row?.byeWeek || 0) || null;
}

function teamOf(player = {}) {
  return String(player.team || player.v3Row?.team || '').toUpperCase();
}

export function calculateStackValue(roster = []) {
  const byTeam = new Map();
  roster.forEach((player) => {
    const team = teamOf(player);
    if (!team) return;
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(player);
  });

  let value = 0;
  const stacks = [];
  byTeam.forEach((players, team) => {
    const qbs = players.filter((player) => positionOf(player) === 'QB');
    const receivers = players.filter((player) => ['WR', 'TE'].includes(positionOf(player)));
    if (!qbs.length || !receivers.length) return;
    const receiverValue = receivers.reduce((sum, player) => sum + projectionOf(player), 0);
    const stackValue = Math.min(8, 1.5 + receiverValue / 125);
    value += stackValue;
    stacks.push({ team, quarterback: qbs[0].name, receivers: receivers.map((player) => player.name), value: stackValue });
  });

  return { value: Math.min(12, value), stacks };
}

export function calculateByeWeekImpact(roster = [], leagueSettings = {}) {
  const starters = leagueSettings.starters || {};
  const eligible = roster.filter((player) => ['QB', 'RB', 'WR', 'TE'].includes(positionOf(player)));
  const byWeek = new Map();
  eligible.forEach((player) => {
    const week = byeWeekOf(player);
    if (!week) return;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(player);
  });

  let worstWeek = null;
  let penalty = 0;
  byWeek.forEach((players, week) => {
    const positionCounts = players.reduce((counts, player) => {
      const pos = positionOf(player);
      counts[pos] = (counts[pos] || 0) + 1;
      return counts;
    }, {});
    const projectedLoss = players.reduce((sum, player) => sum + projectionOf(player), 0) / 17;
    const concentratedStarterRisk = Object.entries(positionCounts).reduce((sum, [pos, count]) => {
      const required = finite(starters[pos], 0);
      return sum + Math.max(0, count - Math.max(1, required - 1)) * 1.5;
    }, 0);
    const weekPenalty = Math.min(12, projectedLoss * 0.35 + concentratedStarterRisk);
    if (!worstWeek || weekPenalty > worstWeek.penalty) worstWeek = { week, players: players.map((player) => player.name), penalty: weekPenalty };
    penalty = Math.max(penalty, weekPenalty);
  });

  return { penalty, worstWeek, score: -penalty };
}

export function calculatePlayoffScheduleValue(roster = []) {
  const starters = roster.filter((player) => ['QB', 'RB', 'WR', 'TE'].includes(positionOf(player)));
  if (!starters.length) return { value: 0, source: 'neutral' };
  const adjustments = starters.map((player) => finite(player.audit?.adjustments?.schedule, 0));
  const value = Math.max(-8, Math.min(8, adjustments.reduce((sum, item) => sum + item, 0) * 0.35));
  return {
    value,
    source: 'seasonal schedule proxy',
    note: 'Uses the current position-specific schedule adjustment until dedicated Weeks 15–17 data are loaded.',
  };
}

export function calculateVolatilityProfile(roster = []) {
  const relevant = roster.filter((player) => ['QB', 'RB', 'WR', 'TE'].includes(positionOf(player)));
  if (!relevant.length) return { averageSpread: 0, floorPoints: 0, ceilingPoints: 0, balanceScore: 0 };
  const floorPoints = relevant.reduce((sum, player) => sum + floorOf(player), 0);
  const ceilingPoints = relevant.reduce((sum, player) => sum + ceilingOf(player), 0);
  const medianPoints = relevant.reduce((sum, player) => sum + projectionOf(player), 0);
  const averageSpread = (ceilingPoints - floorPoints) / relevant.length;
  const balanceScore = medianPoints > 0 ? Math.max(-6, Math.min(6, ((ceilingPoints - medianPoints) - (medianPoints - floorPoints)) / 20)) : 0;
  return { averageSpread, floorPoints, ceilingPoints, balanceScore };
}

export function analyzeRosterSimulationContext(roster = [], leagueSettings = {}, options = {}) {
  const stack = calculateStackValue(roster);
  const bye = calculateByeWeekImpact(roster, leagueSettings);
  const playoff = calculatePlayoffScheduleValue(roster);
  const volatility = calculateVolatilityProfile(roster);
  const stackWeight = finite(options.stackWeight, 1);
  const byeWeight = finite(options.byeWeight, 1);
  const playoffWeight = finite(options.playoffWeight, 1);
  const volatilityWeight = finite(options.volatilityWeight, 0.5);
  const totalAdjustment =
    stack.value * stackWeight +
    bye.score * byeWeight +
    playoff.value * playoffWeight +
    volatility.balanceScore * volatilityWeight;

  return { stack, bye, playoff, volatility, totalAdjustment };
}
