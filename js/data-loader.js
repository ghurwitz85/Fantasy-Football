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
    loadJson('data/yahoo-projections-2026.json'),
    loadJson('data/adp.json'),
    loadJson('data/team-context.json'),
    loadJson('data/yahoo-history-2025.json'),
    loadJson('data/metadata.json'),
  ]);

  const [rankings, projections, yahooProjections, adp, teamContext, yahooHistory, metadata] = entries;
  const metadataValue = metadata.status === 'fulfilled' ? metadata.value : null;
  return {
    rankings: summarizePlayers(rankings, metadataValue?.feeds?.rankings),
    projections: summarizePlayers(projections, metadataValue?.feeds?.projections),
    yahooProjections: summarizePlayers(yahooProjections, metadataValue?.feeds?.yahooProjections),
    adp: summarizePlayers(adp, metadataValue?.feeds?.adp),
    teamContext: summarizeTeams(teamContext),
    yahooHistory: summarizePlayers(yahooHistory, metadataValue?.feeds?.yahooHistory),
    metadata: metadataValue,
  };
}

export function summarizePlayers(result, feedMetadata = null) {
  if (result.status !== 'fulfilled') return { status: 'missing', count: 0 };
  const rows = result.value.players || result.value;
  const count = Array.isArray(rows) ? rows.length : 0;
  const loaded = count > 0;
  const metadataStatus = feedMetadata?.status;
  return {
    status: loaded ? (metadataStatus || 'loaded') : 'missing',
    count,
    path: feedMetadata?.path || null,
    source: result.value.source || feedMetadata?.source || null,
    directness: metadataStatus === 'derived' ? 'derived' : metadataStatus === 'fixture' ? 'fixture' : loaded ? 'direct-or-cached' : 'missing',
  };
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