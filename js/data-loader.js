import { normalizeLegacyTeamContext } from './team-environment-engine.js';

export async function loadJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

export async function loadV3StatusData() {
  const entries = await Promise.allSettled([
    loadJson('data/rankings.json'),
    loadJson('data/projections.json'),
    loadJson('data/adp.json'),
    loadJson('data/team-context.json'),
    loadJson('data/yahoo-history-2025.json'),
    loadJson('data/metadata.json'),
  ]);

  const [rankings, projections, adp, teamContext, yahooHistory, metadata] = entries;
  return {
    rankings: summarizePlayers(rankings),
    projections: summarizePlayers(projections),
    adp: summarizePlayers(adp),
    teamContext: summarizeTeams(teamContext),
    yahooHistory: summarizePlayers(yahooHistory),
    metadata: metadata.status === 'fulfilled' ? metadata.value : null,
  };
}

function summarizePlayers(result) {
  if (result.status !== 'fulfilled') return { status: 'missing', count: 0 };
  const rows = result.value.players || result.value;
  return { status: Array.isArray(rows) && rows.length ? 'loaded' : 'missing', count: Array.isArray(rows) ? rows.length : 0 };
}

function summarizeTeams(result) {
  if (result.status !== 'fulfilled') return { status: 'missing', count: 0 };
  const rows = result.value.teams || result.value;
  const count = rows && typeof rows === 'object' ? Object.keys(rows).length : 0;
  const normalized = count ? normalizeLegacyTeamContext(result.value) : null;
  return {
    status: count >= 32 ? 'loaded' : count ? 'partial' : 'missing',
    count,
    environment: normalized?.summary || { supported: 0, populated: 0, active: 0, neutral: 0 },
    fieldStatus: normalized?.status || {},
  };
}