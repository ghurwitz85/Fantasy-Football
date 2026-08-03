import { buildV3BoardRows } from './board-adapter.js';
import { loadJson, loadV3StatusData } from './data-loader.js';
import {
  compareCandidateSimulations,
  createDraftState,
  draftPlayer,
  prepareLiveDraftBoard,
  resetDraftState,
  rosterCountsByPosition,
  runDecisionExplorer,
  undoLastPick,
} from './draft-state-engine.js';
import {
  adpCsvTextToV3,
  applyV3Preferences,
  buildV3ContextWeightsFromFormValues,
  buildV3LeagueSettingsFromFormValues,
  buildV3PreferenceWeightsFromFormValues,
  buildV3ScoringFromFormValues,
  createPreferenceKey,
  projectionCsvTextToV3,
} from './v3-user-state.js';
import { namesMatchLoosely, normalizeName } from './player-normalizer.js';
import { summarizeDraftTendencies, yahooDraftCsvTextToV3 } from './yahoo-draft-results.js';

const V3_PREFERENCES_KEY = 'theboard_state_v3_preferences';
const V3_DRAFT_STATE_KEY = 'theboard_state_v3_live_draft';
const FORM_VALUE_IDS = [
  's_passYdsPerPt', 's_passTD', 's_int', 's_rushYdsPerPt', 's_rushTD', 's_rec',
  's_recYdsPerPt', 's_recTD', 's_fumLost', 's_pass40', 's_rush40', 's_rec40',
  'numTeams', 'rosterQB', 'rosterRB', 'rosterWR', 'rosterTE', 'rosterFLEX',
  'riskSlider', 'injurySlider', 'rookieSlider', 'olRunSlider', 'olPassSlider', 'qbSupportSlider', 'sosSlider', 'gameScriptSlider',
  'bigPlaySlider', 'historyWeightSlider', 'vorpSlider',
];

let v3RawPayloads = null;
let v3CachedProjections = [];
let v3ImportedProjections = [];
let v3CachedAdp = [];
let v3ImportedAdp = [];
let v3Preferences = loadV3Preferences();
let v3DraftState = loadV3DraftState();
let v3PreviousRecommendation = null;
const v3SortState = {
  main: { key: 'modeledStarterPoints', direction: 'desc' },
  preview: null,
};
let v3OwnsMainBoard = false;

function formValues() {
  return Object.fromEntries(FORM_VALUE_IDS.map((id) => [id, document.getElementById(id)?.value]));
}

function loadV3Preferences() {
  try {
    return JSON.parse(localStorage.getItem(V3_PREFERENCES_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function loadV3DraftState() {
  try {
    return createDraftState(JSON.parse(localStorage.getItem(V3_DRAFT_STATE_KEY) || '{}'));
  } catch (_) {
    return createDraftState();
  }
}

function saveV3DraftState() {
  localStorage.setItem(V3_DRAFT_STATE_KEY, JSON.stringify(v3DraftState));
}

function syncDraftStateFromControls() {
  const teams = Number(document.getElementById('v3DraftTeams')?.value || document.getElementById('numTeams')?.value || v3DraftState.teams || 12);
  const userDraftSlot = Number(document.getElementById('v3DraftSlot')?.value || v3DraftState.userDraftSlot || 1);
  const currentPick = Number(document.getElementById('v3CurrentPick')?.value || v3DraftState.currentPick || 1);
  v3DraftState = createDraftState({ ...v3DraftState, teams, userDraftSlot, currentPick });
  saveV3DraftState();
}

function playerById(board = [], playerId = '') {
  return board.find((player) => String(player.playerId) === String(playerId));
}

function playerByDraftImportRow(board = [], draftRow = {}) {
  const importedId = String(draftRow.playerId || '');
  const normalizedName = draftRow.normalizedName || normalizeName(draftRow.name || '');
  const draftPosition = String(draftRow.position || '').toUpperCase();
  const draftTeam = String(draftRow.team || '').toUpperCase();
  const compatible = (player) => {
    const playerPosition = String(player.position || player.v3Row?.position || '').toUpperCase();
    const playerTeam = String(player.team || player.v3Row?.team || '').toUpperCase();
    const positionMatches = !draftPosition || playerPosition === draftPosition;
    const teamMatches = !draftTeam || playerTeam === draftTeam;
    return positionMatches && teamMatches;
  };
  return board.find((player) => String(player.playerId) === importedId)
    || board.find((player) => normalizeName(player.name || player.v3Row?.name || '') === normalizedName && compatible(player))
    || board.find((player) => namesMatchLoosely(draftRow.name || '', player.name || player.v3Row?.name || '') && compatible(player))
    || null;
}

function saveV3Preferences() {
  localStorage.setItem(V3_PREFERENCES_KEY, JSON.stringify(v3Preferences));
}

function rebuildV3BoardFromState() {
  if (!v3RawPayloads) return [];
  const values = formValues();
  const board = buildV3BoardRows(
    v3RawPayloads,
    buildV3ScoringFromFormValues(values),
    buildV3LeagueSettingsFromFormValues(values),
    buildV3ContextWeightsFromFormValues(values),
  );
  return applyV3Preferences(board, v3Preferences, buildV3PreferenceWeightsFromFormValues(values));
}

function statusClass(status) {
  if (status === 'loaded') return 'ok';
  if (status === 'partial' || status === 'fixture' || status === 'derived') return 'warn';
  return 'error';
}

function card(label, summary, extra = '') {
  const title = summary.source ? ` title="${escapeHtml(summary.source)}"` : '';
  return `<div class="v2-status-card"><strong class="${statusClass(summary.status)}">${summary.status}</strong><span${title}>${label}: ${summary.count}${extra}</span></div>`;
}

function adpStatusCard(adp) {
  const detail = adp.directness === 'derived'
    ? ' — derived from FantasyPros ECR-vs-ADP; actively influences cost/availability but is not direct platform ADP'
    : adp.directness === 'fixture'
      ? ' — fixture/sample feed; cost and availability are approximate'
      : ' — actively used for draft cost and next-pick availability';
  return card('ADP', adp, detail);
}

function teamEnvironmentCard(teamContext) {
  const env = teamContext.environment || { supported: 0, populated: 0, active: 0, neutral: 0 };
  const qbStatus = teamContext.fieldStatus?.qbStrength;
  const defStatus = teamContext.fieldStatus?.defStrength;
  const details = [qbStatus?.message, defStatus?.message].filter(Boolean).join(' ');
  const className = env.active === env.supported ? 'ok' : env.active ? 'warn' : 'error';
  return `<div class="v2-status-card"><strong class="${className}">${env.active}/${env.supported}</strong><span title="${escapeHtml(details)}">Team environment factors active; ${env.neutral} neutral placeholder(s)</span></div>`;
}

async function renderV3Status() {
  const target = document.getElementById('v3DataQualityPanel');
  if (!target) return;

  try {
    const status = await loadV3StatusData();
    const refresh = status.metadata?.lastSuccessfulRefresh || 'unknown refresh time';
    target.innerHTML = `
      ${card('Consensus rankings', status.rankings)}
      ${card('Yahoo 2026 projections', status.yahooProjections, ' — preferred V3 stat projection feed')}
      ${card('Fallback projections', status.projections, ' — used only when Yahoo is missing a player')}
      ${adpStatusCard(status.adp)}
      ${card('Team context', status.teamContext, ' — normalized QB, defense, and game-script data active')}
      ${teamEnvironmentCard(status.teamContext)}
      ${card('Yahoo history', status.yahooHistory)}
      <div class="v2-status-card"><strong>supported</strong><span>Last successful refresh: ${refresh}</span></div>
    `;
  } catch (error) {
    target.innerHTML = `<div class="notice-box"><strong>V3 status unavailable:</strong> ${error.message}</div>`;
  }
}

renderV3Status();

function rows(payload) {
  return payload?.players || payload || [];
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatSigned(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}`;
}

function formatPercent(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(digits)}%` : '—';
}

function isFallbackProjectionSource(source = '') {
  return source === 'consensus-fallback';
}

function isLoadedProjectionSource(source = '') {
  return Boolean(source) && !isFallbackProjectionSource(source) && source !== 'unknown';
}

function projectionSourceLabel(source = '') {
  if (isFallbackProjectionSource(source)) return 'Fallback projection';
  if (source === 'yahoo-2026-export') return 'Yahoo 2026 projection';
  if (source === 'consensus-derived-fixture') return 'Consensus-derived fixture projection';
  if (source === 'loaded') return 'Loaded projection';
  return source ? `${source} projection` : 'Projection source unknown';
}

function valueForV3Sort(player = {}, key = '') {
  const row = player.v3Row || {};
  const auditWarnings = row.audit?.warnings || [];
  const rowWarnings = row.warnings || [];
  const values = {
    personalRank: row.personalRank,
    name: row.name,
    position: row.position,
    consensusRank: row.consensusRank,
    adp: row.adp,
    adjustedProjection: row.adjustedProjection,
    vorp: row.vorp,
    modeledStarterPoints: row.modeledStarterPoints,
    modeledTotalRosterPoints: row.modeledTotalRosterPoints,
    modeledPointsVsBest: row.modeledPointsVsBest,
    finalDraftScore: row.finalDraftScore,
    warningsCount: rowWarnings.length + auditWarnings.length,
  };
  return values[key];
}

function sortV3BoardForView(board = [], tableName = 'main') {
  const sort = v3SortState[tableName];
  if (!sort?.key) return board;
  return [...board].sort((a, b) => {
    const av = valueForV3Sort(a, sort.key);
    const bv = valueForV3Sort(b, sort.key);
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) || Number.isFinite(bn)) {
      return (Number.isFinite(bn) ? bn : -Infinity) - (Number.isFinite(an) ? an : -Infinity);
    }
    return String(bv || '').localeCompare(String(av || ''), undefined, { sensitivity: 'base' });
  });
}

function simulationImpactLabel(pointsVsBest) {
  const delta = Number(pointsVsBest);
  if (!Number.isFinite(delta)) return 'not modeled';
  if (Math.abs(delta) < 0.05) return 'Best modeled roster path';
  return `${formatSigned(delta, 1)} starter pts vs best modeled roster path`;
}

function updateV3SortHeaders() {
  document.querySelectorAll('[data-v3-main-sort], [data-v3-preview-sort]').forEach((header) => {
    const tableName = header.dataset.v3MainSort ? 'main' : 'preview';
    const key = header.dataset.v3MainSort || header.dataset.v3PreviewSort;
    const active = v3SortState[tableName]?.key === key;
    header.style.cursor = 'pointer';
    header.title = `Sort ${header.textContent.replace(/ ↓$/, '')} descending`;
    header.textContent = `${header.textContent.replace(/ ↓$/, '')}${active ? ' ↓' : ''}`;
  });
}

function renderV3MainBoard(board) {
  const body = document.getElementById('boardBody');
  if (!body || !Array.isArray(board) || !board.length) return;
  v3OwnsMainBoard = true;
  window.__v3OwnsMainBoard = true;

  body.innerHTML = sortV3BoardForView(board, 'main').slice(0, 250).map((player) => {
    const row = player.v3Row;
    const warnings = [...(row.warnings || []), ...(row.audit?.warnings || [])];
    const preferenceAudit = player.v3PreferenceAudit || [];
    const warningText = [...warnings, ...preferenceAudit].length ? [...warnings, ...preferenceAudit].join(' ') : 'V3 projection-first ranking active.';
    const pref = player.v3Preferences || {};
    const key = createPreferenceKey(player);
    const audit = row.audit || {};
    const adjustments = audit.adjustments || {};
    const contextCap = audit.contextCap || null;
    const risk = audit.risk || null;
    const history = audit.history || null;
    const details = audit.details || {};
    const bigPlay = audit.bigPlay || null;
    const bigPlayBonus = audit.adjustments?.bigPlayBonus;
    const bigPlayConfidenceAdjustment = adjustments.bigPlayConfidenceAdjustment;
    const projectionLabel = projectionSourceLabel(row.projectionSource);
    const adpLabel = row.adpSource === 'loaded' ? `${row.adpPlatform || 'Loaded'} ADP` : row.adpSource === 'consensus-fallback' ? 'Consensus fallback ADP' : 'ADP missing';
    const simulation = player.draft?.simulation || {};
    const simulationPath = (simulation.path || []).slice(0, 5).join(' → ');
    const lineupSummary = simulation.startingLineup
      ? Object.entries(simulation.startingLineup)
        .filter(([, lineupPlayers]) => lineupPlayers.length)
        .map(([slot, lineupPlayers]) => `${slot}: ${lineupPlayers.map((lineupPlayer) => lineupPlayer.name || lineupPlayer.v3Row?.name).join(', ')}`)
        .join('; ')
      : '';
    const liveDraftHints = [
      row.rosterNeed,
      row.bestAvailableAtPosition ? `Best available ${row.position}` : '',
      row.dropoffLabel,
      Number.isFinite(row.modeledStarterPoints) ? `Modeled ${formatNumber(row.modeledStarterPoints, 1)} starter pts` : '',
      Number.isFinite(row.modeledTotalRosterPoints) ? `${formatNumber(row.modeledTotalRosterPoints, 1)} total roster pts` : '',
    ].filter(Boolean);
    const whyId = `why-${escapeHtml(player.playerId)}`;
    return `<tr data-id="${escapeHtml(player.playerId)}">
      <td class="rank-num">${row.personalRank}</td>
      <td>
        <button class="flag-btn v3-draft-player" data-player-id="${escapeHtml(player.playerId)}" title="Mark player drafted by the team currently on the clock">Drafted</button>
        <button class="flag-btn v3-my-pick" data-player-id="${escapeHtml(player.playerId)}" title="Draft this player to your roster">My Pick</button>
        <button class="flag-btn v3-injury-toggle ${pref.injuryFlag ? 'active-injury' : ''}" data-pref-key="${escapeHtml(key)}" title="Toggle V3 injury penalty">INJ</button>
        <button class="flag-btn v3-rookie-toggle ${pref.rookieFlag ? 'active-rookie' : ''}" data-pref-key="${escapeHtml(key)}" title="Toggle V3 rookie preference">ROK</button>
        <button class="flag-btn v3-why-toggle" data-why-id="${whyId}" title="Show V3 explanation">why</button>
        <div class="player-name" style="display:inline;">${escapeHtml(row.name)}</div>
          <div class="player-meta">${escapeHtml(row.team || '')} · ${escapeHtml(row.recommendation || player.draft?.recommendation || 'Watchlist')}${row.isOutlierValue ? ' · outlier target' : ''}${liveDraftHints.length ? ` · ${escapeHtml(liveDraftHints.join(' · '))}` : ''} · ${projectionLabel} · ${escapeHtml(adpLabel)}${bigPlay ? ` · BP ${formatNumber(bigPlayBonus, 1)} pts @ ${formatNumber(bigPlay.confidence * 100, 0)}% (${formatSigned(bigPlayConfidenceAdjustment, 1)})` : ''}</div>
      </td>
      <td><span class="pos-chip pos-${escapeHtml(row.position)}">${escapeHtml(row.position)}</span></td>
      <td>${row.consensusRank || '—'}</td>
      <td title="Big-play bonus: ${formatNumber(bigPlayBonus, 1)} pts${bigPlay ? ` at ${formatNumber(bigPlay.confidence * 100, 0)}% confidence; confidence adjustment ${formatSigned(bigPlayConfidenceAdjustment, 1)} pts` : ''}">${formatNumber(row.adjustedProjection, 1)}</td>
      <td class="delta ${row.vorp >= 0 ? 'up' : 'down'}">${row.vorp >= 0 ? '+' : ''}${formatNumber(row.vorp, 1)}</td>
      <td title="Modeled final starter and total roster points if this is your current pick. ${escapeHtml(simulation.explanation || '')}">
        ${formatNumber(row.modeledStarterPoints, 1)} <span class="player-meta">starter · ${formatNumber(row.modeledTotalRosterPoints, 1)} total</span><br>
        <span class="player-meta">${escapeHtml(simulationImpactLabel(row.modeledPointsVsBest))}</span>
      </td>
      <td class="delta up">${formatNumber(row.finalDraftScore, 3)}</td>
      <td><span class="player-meta" title="${escapeHtml(warningText)}">${escapeHtml(row.recommendation || player.draft?.recommendation || 'Active')}${row.isOutlierValue ? ' · value' : ''}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}${preferenceAudit.length ? ` · ${preferenceAudit.length} pref` : ''}</span></td>
      <td><input type="number" class="override-input v3-override-input" data-pref-key="${escapeHtml(key)}" min="1" placeholder="#" value="${pref.overrideRank || ''}" title="Set a V3 manual override rank."></td>
    </tr>
    <tr id="${whyId}" class="v3-why-row" style="display:none;">
      <td></td>
      <td colspan="9">
        <div class="notice-box">
          <strong>${escapeHtml(row.name)} — V3 why</strong><br>
          Base league projection: ${formatNumber(row.baseProjection, 1)}<br>
          Projection source: ${escapeHtml(projectionLabel)}<br>
          Derived archetype: ${escapeHtml(row.archetype || 'Unclassified')}<br>
          ADP source: ${escapeHtml(adpLabel)}${row.adpSource === 'consensus-fallback' ? ' — availability/cost is approximate until a real ADP feed is loaded.' : ''}<br>
          Expected 40+ yard bonuses: ${formatNumber(bigPlayBonus, 1)}${bigPlay ? ` (confidence ${formatNumber(bigPlay.confidence * 100, 0)}%; before confidence ${formatNumber(bigPlay.projectedBonusBeforeConfidence, 1)})` : ''}<br>
          Big-play confidence adjustment: ${formatSigned(adjustments.bigPlayConfidenceAdjustment, 1)}<br>
          Run-blocking adjustment: ${formatSigned(adjustments.runBlocking, 1)}<br>
          ${details.runBlocking ? `Run-blocking role inputs: rush share ${formatPercent(details.runBlocking.rushShare)}, goal-line share ${formatPercent(details.runBlocking.goalLineShare)}, yard factor ${formatSigned(details.runBlocking.rushYardsAdjustment * 100, 2)}%, TD factor ${formatSigned(details.runBlocking.rushTdAdjustment * 100, 2)}%<br>` : ''}
          Pass-protection adjustment: ${formatSigned(adjustments.passProtection, 1)}<br>
          ${details.passProtection ? `QB pass-protection inputs: pass-block score ${formatSigned(details.passProtection.passBlockScore, 2)}, efficiency factor ${formatSigned(details.passProtection.passEfficiencyAdjustment * 100, 2)}%, deep factor ${formatSigned(details.passProtection.deepCompletionAdjustment * 100, 2)}%<br>` : ''}
          Receiver pass-protection adjustment: ${formatSigned(adjustments.receiverPassProtection, 1)}<br>
          ${details.receiverPassProtection ? `Receiver protection sensitivity: ${formatPercent(details.receiverPassProtection.sensitivity)}; yard factor ${formatSigned(details.receiverPassProtection.yardsAdjustment * 100, 2)}%, big-play factor ${formatSigned(details.receiverPassProtection.bigPlayAdjustment * 100, 2)}%<br>` : ''}
          QB-environment adjustment: ${formatSigned(adjustments.qbEnvironment, 1)}<br>
          ${details.qbEnvironment ? `QB-environment sensitivities: possession ${formatPercent(details.qbEnvironment.possessionSensitivity)}, deep ${formatPercent(details.qbEnvironment.deepThreatSensitivity)}, red-zone ${formatPercent(details.qbEnvironment.redZoneSensitivity)}<br>` : ''}
          Strength-of-schedule adjustment: ${formatSigned(adjustments.schedule, 1)}<br>
          ${details.schedule ? `Schedule input: ${escapeHtml(details.schedule.position)} SOS score ${formatSigned(details.schedule.sosScore, 2)}, factor ${formatSigned(details.schedule.factor * 100, 2)}%<br>` : ''}
          Game-script adjustment: ${formatSigned(adjustments.gameScript, 1)}<br>
          ${details.gameScript ? `Game-script inputs: lead score ${formatSigned(details.gameScript.leadScore, 2)}, trailing score ${formatSigned(details.gameScript.trailingScore, 2)}${details.gameScript.earlyDownRole !== undefined ? `, early-down role ${formatPercent(details.gameScript.earlyDownRole)}, receiving role ${formatPercent(details.gameScript.receivingRole)}` : ''}${details.gameScript.routeRole !== undefined ? `, route role ${formatPercent(details.gameScript.routeRole)}, target role ${formatPercent(details.gameScript.targetRole)}` : ''}${details.gameScript.volumeAdjustment !== undefined ? `, volume factor ${formatSigned(details.gameScript.volumeAdjustment * 100, 2)}%` : ''}<br>` : ''}
          Raw context total before aggregate cap: ${formatSigned(contextCap?.rawTotal, 1)}<br>
          Aggregate context cap: ${contextCap ? `${formatSigned(contextCap.cappedTotal, 1)} (${formatNumber(contextCap.totalPct * 100, 1)}%; ${contextCap.applied ? 'cap applied' : 'within cap'})` : '—'}<br>
          Floor / median / ceiling: ${risk ? `${formatNumber(risk.floor, 1)} / ${formatNumber(risk.median, 1)} / ${formatNumber(risk.ceiling, 1)}` : '—'}<br>
          Risk adjustment: ${formatSigned(adjustments.risk, 1)}<br>
          Injury adjustment: ${formatSigned(adjustments.injuryRisk, 1)}<br>
          Rookie preference adjustment: ${formatSigned(adjustments.rookiePreference, 1)}<br>
          Historical reliability: ${history ? `${formatNumber(history.reliabilityScore * 100, 0)}% over ${history.seasons} season(s)` : 'neutral / no match'}<br>
          Historical calibration: ${formatSigned(adjustments.historyCalibration, 1)}<br>
          Chance available at pick ${formatNumber(row.nextPick, 0)}: ${formatNumber(row.availabilityProbability * 100, 0)}%<br>
          Draft urgency score: ${formatNumber(row.draftUrgency, 1)}<br>
          Value versus ADP: ${formatSigned(row.valueVsAdp, 0)} pick(s)<br>
          Live draft hints: ${liveDraftHints.length ? escapeHtml(liveDraftHints.join('; ')) : 'No strong roster/tier signal'}<br>
          Modeled final starter points if drafted now: ${formatNumber(row.modeledStarterPoints, 1)} (${escapeHtml(simulationImpactLabel(row.modeledPointsVsBest))})<br>
          Modeled total roster points if drafted now: ${formatNumber(row.modeledTotalRosterPoints, 1)}<br>
          ${simulation.explanation ? `Simulation: ${escapeHtml(simulation.explanation)}<br>` : ''}
          ${simulationPath ? `Modeled path: ${escapeHtml(simulationPath)}<br>` : ''}
          ${lineupSummary ? `Modeled starters: ${escapeHtml(lineupSummary)}<br>` : ''}
          Recommendation: ${escapeHtml(row.recommendation || player.draft?.recommendation || 'Watchlist')}${row.isOutlierValue ? ' — outlier target versus ADP' : ''}<br>
          Replacement baseline: ${formatNumber(row.replacementBaseline, 1)}<br>
          VORP: ${row.vorp >= 0 ? '+' : ''}${formatNumber(row.vorp, 1)}<br>
          Final adjusted projection: ${formatNumber(row.adjustedProjection, 1)}<br>
          Final draft score: ${formatNumber(row.finalDraftScore, 3)}
          ${preferenceAudit.length ? `<br>Preferences: ${escapeHtml(preferenceAudit.join('; '))}` : ''}
          ${warnings.length ? `<br>Warnings: ${escapeHtml(warnings.join(' '))}` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
  updateV3SortHeaders();
}

function updateV3Preference(key, patch) {
  const next = { ...(v3Preferences[key] || {}), ...patch };
  Object.keys(next).forEach((field) => {
    if (next[field] === false || next[field] === '' || next[field] === null || next[field] === undefined) delete next[field];
  });
  if (Object.keys(next).length) v3Preferences[key] = next;
  else delete v3Preferences[key];
  saveV3Preferences();
  renderCurrentV3Board();
}

function renderCurrentV3Board() {
  const fullBoard = rebuildV3BoardFromState();
  if (!fullBoard.length) return;
  syncDraftInputsFromState();
  const liveBoard = prepareLiveDraftBoard(fullBoard, v3DraftState, {
    leagueSettings: buildV3LeagueSettingsFromFormValues(formValues()),
    monteCarloTrials: 24,
    monteCarloCandidateLimit: 4,
  });
  window.__v3FullBoard = fullBoard;
  window.__v3Board = liveBoard;
  renderV3DraftPanel(fullBoard, liveBoard);
  renderV3MainBoard(liveBoard);
  renderV3PreviewRows(liveBoard);
  renderV3CoverageStatus(liveBoard);
}

function syncDraftInputsFromState() {
  const teamsInput = document.getElementById('v3DraftTeams');
  const slotInput = document.getElementById('v3DraftSlot');
  const pickInput = document.getElementById('v3CurrentPick');
  if (teamsInput) teamsInput.value = v3DraftState.teams;
  if (slotInput) slotInput.value = v3DraftState.userDraftSlot;
  if (pickInput) pickInput.value = v3DraftState.currentPick;
}

function renderV3DraftPanel(fullBoard = [], liveBoard = []) {
  const target = document.getElementById('v3DraftSummary');
  if (!target) return;
  const counts = rosterCountsByPosition(v3DraftState);
  const rosterSummary = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
    .map((position) => `${position}: ${counts[position] || 0}`)
    .join(' · ');
  const strategySorted = [...liveBoard].sort((a, b) => {
    const utilityDelta = Number(b.draft?.simulation?.modeledDraftUtility || 0) - Number(a.draft?.simulation?.modeledDraftUtility || 0);
    if (utilityDelta) return utilityDelta;
    const modeledDelta = Number(b.draft?.simulation?.projectedStarterPoints || 0) - Number(a.draft?.simulation?.projectedStarterPoints || 0);
    if (modeledDelta) return modeledDelta;
    return Number(b.draft?.strategy?.pointsMaximizingScore || 0) - Number(a.draft?.strategy?.pointsMaximizingScore || 0);
  });
  const recommended = strategySorted[0];
  const recommendationChangeLine = recommended && v3PreviousRecommendation && v3PreviousRecommendation.playerId !== recommended.playerId
    ? `<div class="player-meta"><strong>Recommendation changed:</strong> ${escapeHtml(v3PreviousRecommendation.name)} → ${escapeHtml(recommended.name)} after the latest draft-state update.</div>`
    : '';
  if (recommended) v3PreviousRecommendation = { playerId: recommended.playerId, name: recommended.name };
  const alternatives = Object.values(strategySorted.reduce((byPosition, player) => {
    const position = player.position || player.v3Row?.position || 'UNK';
    if (!byPosition[position]) byPosition[position] = player;
    return byPosition;
  }, {})).filter((player) => player.playerId !== recommended?.playerId).slice(0, 5);
  const utility = recommended?.draft?.simulation?.modeledUtilityBreakdown;
  const monteCarlo = recommended?.draft?.monteCarlo;
  const monteCarloLine = monteCarlo
    ? `<div class="player-meta"><strong>${monteCarlo.trials}-trial outcome range:</strong> Avg ${formatNumber(monteCarlo.averageStarterPoints, 1)} starter pts · Floor ${formatNumber(monteCarlo.starterFloor, 1)} · Median ${formatNumber(monteCarlo.starterMedian, 1)} · Ceiling ${formatNumber(monteCarlo.starterCeiling, 1)} · ${Math.round((monteCarlo.positionRunRisk?.probabilityAtLeastOne || 0) * 100)}% chance at least one more ${escapeHtml(recommended.position || recommended.v3Row?.position || '')} goes before your next turn</div>`
    : '';
  const utilityLine = utility
    ? `<div class="player-meta"><strong>Utility breakdown:</strong> Starter ${formatNumber(utility.starter, 1)} · Flex ${formatNumber(utility.flex, 1)} · Bench ${formatNumber(utility.bench, 1)} · Roster plan ${formatNumber(utility.rosterPlan, 1)} · Opportunity ${formatNumber(utility.opportunity, 1)} · Tier/scarcity ${formatNumber(utility.tierScarcity, 1)} · Availability ${formatNumber(utility.availability, 1)} · Strategy ${formatNumber(utility.strategy, 1)} · Replaceability penalty -${formatNumber(utility.replaceabilityPenalty, 1)} · <strong>Total ${formatNumber(utility.total, 1)}</strong></div>`
    : '';
  const recommendedLine = recommended
    ? `<div style="font-size:18px;margin:8px 0;"><strong style="color:var(--gold);">Recommended now:</strong> ${escapeHtml(recommended.name)} (${escapeHtml(recommended.position || recommended.v3Row?.position || '')}) · ${formatNumber(recommended.draft?.simulation?.modeledDraftUtility, 1)} modeled utility</div>
       <div><strong>Modeled final starters:</strong> ${formatNumber(recommended.draft?.simulation?.projectedStarterPoints, 1)} pts · ${escapeHtml(simulationImpactLabel(recommended.draft?.simulation?.pointsVsBest))}</div>
       ${monteCarloLine}
       ${utilityLine}
       ${recommendationChangeLine}
       <div><strong>Why:</strong> ${escapeHtml(recommended.draft?.simulation?.explanation || recommended.draft?.strategy?.explanation || 'Best projected live-draft roster fit.')}</div>`
    : '<div><strong>Recommended now:</strong> No available players.</div>';
  const simulatedPathSteps = recommended?.draft?.simulation?.path?.slice(0, 6) || [];
  const simulatedPath = simulatedPathSteps.join(' → ');
  const simulatedPathDetails = simulatedPath
    ? `<details style="margin:6px 0;"><summary><strong>Simulated path</strong> <span class="player-meta">next ${simulatedPathSteps.length} modeled picks</span></summary><div class="player-meta" style="margin-top:4px;">${escapeHtml(simulatedPath)}</div></details>`
    : '';
  const alternativeSummary = alternatives.map((player) => `${player.position || player.v3Row?.position}: ${player.name} (${formatNumber(player.draft?.simulation?.projectedStarterPoints, 1)} pts, ${simulationImpactLabel(player.draft?.simulation?.pointsVsBest)})`).join(' · ');
  const comparisonRows = recommended ? alternatives.slice(0, 3).map((player) => {
    const comparison = compareCandidateSimulations(recommended, player);
    const strongestUtilityEdges = Object.entries(comparison.utilityDeltas)
      .filter(([, value]) => Math.abs(Number(value)) >= 0.5)
      .sort(([, a], [, b]) => Math.abs(Number(b)) - Math.abs(Number(a)))
      .slice(0, 3)
      .map(([field, value]) => `${field.replace(/([A-Z])/g, ' $1').toLowerCase()} ${formatSigned(value, 1)}`)
      .join(' · ');
    return `<tr>
      <td>${escapeHtml(player.name)} (${escapeHtml(comparison.alternativePosition)})</td>
      <td>${formatSigned(comparison.utilityDelta, 1)}</td>
      <td>${formatSigned(comparison.starterPointsDelta, 1)}</td>
      <td>${formatSigned(comparison.totalRosterPointsDelta, 1)}</td>
      <td>${formatSigned(comparison.nextTurnDropoffDelta, 1)}</td>
      <td>${escapeHtml(strongestUtilityEdges || 'Near-even component profile')}</td>
    </tr>`;
  }).join('') : '';
  const comparisonDetails = comparisonRows
    ? `<details style="margin:8px 0;"><summary><strong>Why this pick beats the alternatives</strong></summary>
       <div style="overflow-x:auto;margin-top:6px;"><table class="rank-table"><thead><tr><th>Alternative</th><th>Utility edge</th><th>Starter pts edge</th><th>Total roster edge</th><th>Next-turn dropoff edge</th><th>Largest component edges</th></tr></thead><tbody>${comparisonRows}</tbody></table></div></details>`
    : '';
  const topTargets = strategySorted.slice(0, 5).map((player) => `${player.name} (${player.position}, ${formatNumber(player.draft?.simulation?.projectedStarterPoints, 1)} modeled pts)`).join('; ');
  target.innerHTML = `
    <strong>Pick ${v3DraftState.currentPick}</strong> · ${v3DraftState.picks.length} drafted · ${liveBoard.length}/${fullBoard.length} available<br>
    <strong>Your roster:</strong> ${escapeHtml(rosterSummary)}<br>
    ${recommendedLine}
    ${simulatedPathDetails}
    ${comparisonDetails}
    <strong>League-history influence:</strong> OFF · 2025 draft data is advisory only and does not affect rankings or simulations.<br>
    <strong>Best by position:</strong> ${escapeHtml(alternativeSummary || 'No alternatives yet')}<br>
    <strong>Top strategy targets:</strong> ${escapeHtml(topTargets || 'No available players yet')}
  `;
}

function renderDecisionExplorerResult(analysis = null) {
  const target = document.getElementById('v3DecisionExplorerResult');
  if (!target) return;
  if (!analysis?.recommended) {
    target.innerHTML = '<span class="fetch-status error">No candidates were available for deep simulation.</span>';
    return;
  }
  const confidence = Math.round(analysis.confidence * 100);
  const rows = analysis.candidates.map((candidate, index) => `<tr>
    <td>${index + 1}. ${escapeHtml(candidate.name)} (${escapeHtml(candidate.position)})</td>
    <td>${formatNumber(candidate.starterMedian, 1)}</td>
    <td>${formatNumber(candidate.starterFloor, 1)}</td>
    <td>${formatNumber(candidate.starterCeiling, 1)}</td>
    <td>${formatNumber(candidate.averageRosterPoints, 1)}</td>
    <td>${Math.round(candidate.bestOutcomeRate * 100)}%</td>
    <td>${Math.round((candidate.positionRunRisk?.probabilityAtLeastOne || 0) * 100)}%</td>
    <td>${formatSigned(candidate.averageContextAdjustment, 1)}</td>
  </tr>`).join('');
  const medianRoster = analysis.recommended.medianRoster.slice(0, 12).join(' · ');
  const context = analysis.recommended.medianContext || {};
  const stackText = context.stack?.stacks?.length ? context.stack.stacks.map((stack) => `${stack.team}: ${stack.quarterback} + ${stack.receivers.join(', ')}`).join(' · ') : 'No active QB-receiver stack';
  const byeText = context.bye?.worstWeek ? `Week ${context.bye.worstWeek.week}: ${context.bye.worstWeek.players.join(', ')} (${formatSigned(-context.bye.worstWeek.penalty, 1)})` : 'No material bye-week concentration';
  const playoffText = `${formatSigned(context.playoff?.value, 1)} (${context.playoff?.source || 'neutral'})`;
  const volatilityText = context.volatility ? `${formatNumber(context.volatility.floorPoints, 1)} floor / ${formatNumber(context.volatility.ceilingPoints, 1)} ceiling` : 'Unavailable';
  target.innerHTML = `
    <div style="font-size:17px;margin-bottom:6px;"><strong style="color:var(--gold);">Deep recommendation:</strong> ${escapeHtml(analysis.recommended.name)} (${escapeHtml(analysis.recommended.position)})</div>
    <div class="player-meta"><strong>Confidence:</strong> ${confidence}% · Median edge over runner-up: ${formatSigned(analysis.medianEdge, 1)} starter points · ${analysis.trials} complete draft trials per candidate</div>
    <div style="overflow-x:auto;margin-top:8px;"><table class="rank-table"><thead><tr><th>Candidate</th><th>Median starters</th><th>Floor</th><th>Ceiling</th><th>Avg roster</th><th>Best outcome rate</th><th>Position run risk</th><th>Context edge</th></tr></thead><tbody>${rows}</tbody></table></div>
    <details style="margin-top:8px;"><summary><strong>Typical final roster after drafting ${escapeHtml(analysis.recommended.name)}</strong></summary><div class="player-meta" style="margin-top:5px;">${escapeHtml(medianRoster || 'Roster details unavailable')}</div></details>
    <details style="margin-top:8px;"><summary><strong>Stack, bye, playoff, and volatility effects</strong></summary><div class="player-meta" style="margin-top:5px;"><strong>Stack:</strong> ${escapeHtml(stackText)}<br><strong>Bye-week risk:</strong> ${escapeHtml(byeText)}<br><strong>Playoff schedule:</strong> ${escapeHtml(playoffText)}<br><strong>Volatility range:</strong> ${escapeHtml(volatilityText)}</div></details>
  `;
}

function runDeepDecisionExplorer() {
  const target = document.getElementById('v3DecisionExplorerResult');
  const button = document.getElementById('v3DeepSimBtn');
  const board = window.__v3Board || [];
  if (!board.length) {
    if (target) target.textContent = 'The live board is not ready yet.';
    return;
  }
  const trials = Number(document.getElementById('v3DeepSimTrials')?.value || 300);
  const candidateLimit = Number(document.getElementById('v3DeepSimCandidates')?.value || 4);
  if (target) target.innerHTML = `<span class="fetch-status">Running ${trials} full-draft trials for ${candidateLimit} candidates…</span>`;
  if (button) button.disabled = true;
  window.setTimeout(() => {
    try {
      const analysis = runDecisionExplorer(board, v3DraftState, {
        trials,
        candidateLimit,
        leagueSettings: buildV3LeagueSettingsFromFormValues(formValues()),
            benchSpots: 6,
      });
      renderDecisionExplorerResult(analysis);
    } catch (error) {
      if (target) target.innerHTML = `<span class="fetch-status error">Deep simulation failed: ${escapeHtml(error.message || String(error))}</span>`;
    } finally {
      if (button) button.disabled = false;
    }
  }, 20);
}

function setYahooDraftSyncStatus(message, className = '') {
  const status = document.getElementById('v3YahooDraftSyncStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `fetch-status ${className}`.trim();
}

function syncYahooDraftResultsFromText(text = '') {
  const fullBoard = window.__v3FullBoard || rebuildV3BoardFromState();
  if (!fullBoard.length) {
    setYahooDraftSyncStatus('V3 board is not ready yet.', 'error');
    return;
  }

  const importedPicks = yahooDraftCsvTextToV3(text, {
    teams: v3DraftState.teams,
    season: 2026,
    players: fullBoard,
    startingPick: Math.max(1, Number(v3DraftState.currentPick) || 1),
  })
    .filter((pick) => Number(pick.pickNumber) > 0)
    .sort((a, b) => Number(a.pickNumber) - Number(b.pickNumber));
  if (!importedPicks.length) {
    setYahooDraftSyncStatus('No draft picks found. Check the pasted columns.', 'error');
    return;
  }

  syncDraftStateFromControls();
  const existingPlayerNames = new Set((v3DraftState.picks || []).map((pick) => normalizeName(pick.name || '')));
  let nextOpenPick = Math.max(1, ...((v3DraftState.picks || []).map((pick) => Number(pick.pickNumber) || 0))) + 1;
  const preparedImportedPicks = importedPicks
    .filter((pick) => !existingPlayerNames.has(normalizeName(pick.name || '')))
    .map((pick) => {
      if (pick.pickExplicit !== false) return pick;
      const prepared = { ...pick, pickNumber: nextOpenPick, round: Math.ceil(nextOpenPick / Number(v3DraftState.teams || 12)) };
      nextOpenPick += 1;
      return prepared;
    });
  const importedByPick = new Map(preparedImportedPicks.map((pick) => [Number(pick.pickNumber), pick]));
  const preserved = (v3DraftState.picks || [])
    .filter((pick) => !importedByPick.has(Number(pick.pickNumber)))
    .map((pick) => ({ ...pick, source: 'preserved-live-state' }));
  const mergedRows = [...preserved, ...preparedImportedPicks]
    .sort((a, b) => Number(a.pickNumber) - Number(b.pickNumber));
  let nextState = createDraftState({ ...v3DraftState, picks: [], currentPick: 1 });
  let matched = 0;
  const unmatched = [];
  mergedRows.forEach((pick) => {
    const player = playerByDraftImportRow(fullBoard, pick);
    if (player) matched += 1;
    else if (pick.source !== 'preserved-live-state') unmatched.push(pick.name);
    nextState = draftPlayer(nextState, player || pick, {
      pickNumber: pick.pickNumber,
      fantasyTeam: pick.fantasyTeam || null,
      timestamp: pick.timestamp || `import-${pick.pickNumber}`,
    });
  });

  v3DraftState = nextState;
  saveV3DraftState();
  renderCurrentV3Board();
  const tendencies = summarizeDraftTendencies(preparedImportedPicks);
  const positionSummary = Object.entries(tendencies.byPosition)
    .sort(([, a], [, b]) => b - a)
    .map(([position, count]) => `${position}: ${count}`)
    .join(' · ');
  const ignoredDuplicates = importedPicks.length - preparedImportedPicks.length;
  setYahooDraftSyncStatus(`Merged ${preparedImportedPicks.length} new pasted pick(s); ${nextState.picks.length} total drafted, matched ${matched} to board. ${positionSummary}${ignoredDuplicates ? ` · ignored ${ignoredDuplicates} already-drafted player(s)` : ''}${unmatched.length ? ` · unmatched: ${unmatched.slice(0, 3).join(', ')}` : ''}`, unmatched.length ? '' : 'ok');
}

function v3CoverageSummary(board = []) {
  return board.reduce((summary, player) => {
    const row = player.v3Row || {};
    const projectionSource = row.projectionSource || 'unknown';
    const adpSource = row.adpSource || 'unknown';
    summary.projectionSources[projectionSource] = (summary.projectionSources[projectionSource] || 0) + 1;
    if (isLoadedProjectionSource(projectionSource)) summary.projections.loaded += 1;
    else if (isFallbackProjectionSource(projectionSource)) summary.projections.fallback += 1;
    else summary.projections.missing += 1;

    if (adpSource === 'loaded') summary.adp.loaded += 1;
    else if (adpSource === 'consensus-fallback') summary.adp.fallback += 1;
    else summary.adp.missing += 1;
    return summary;
  }, {
    total: board.length,
    projections: { loaded: 0, fallback: 0, missing: 0 },
    projectionSources: {},
    adp: { loaded: 0, fallback: 0, missing: 0 },
  });
}

function renderV3CoverageStatus(board = []) {
  const status = document.getElementById('v3BoardPreviewStatus');
  if (!status || !board.length) return;
  const coverage = v3CoverageSummary(board);
  const sourceBreakdown = Object.entries(coverage.projectionSources)
    .sort(([, a], [, b]) => b - a)
    .map(([source, count]) => `${source}: ${count}`)
    .join('; ');
  status.textContent = `V3 loaded ${coverage.total} ranked players. Projections: ${coverage.projections.loaded} loaded, ${coverage.projections.fallback} fallback, ${coverage.projections.missing} missing/unknown. Source breakdown: ${sourceBreakdown}. ADP: ${coverage.adp.loaded} loaded, ${coverage.adp.fallback} consensus fallback, ${coverage.adp.missing} missing.`;
  status.className = coverage.adp.loaded && !coverage.adp.fallback && !coverage.adp.missing ? 'fetch-status ok' : 'fetch-status error';
  if (coverage.adp.fallback || coverage.adp.missing) status.className = 'fetch-status';
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportCurrentV3Board() {
  const board = rebuildV3BoardFromState();
  if (!board.length) return;
  const headers = [
    'Personal Rank', 'Player', 'Team', 'Position', 'Consensus Rank', 'ADP', 'ADP Source',
    'Adjusted Projection', 'Base Projection', 'Replacement Baseline', 'VORP', 'Final Draft Score',
    'Availability Next Pick', 'Draft Urgency', 'Projection Source', 'Archetype',
    'Run Blocking Adjustment', 'Pass Protection Adjustment', 'Receiver Protection Adjustment',
    'QB Environment Adjustment', 'Schedule Adjustment', 'Game Script Adjustment',
    'Risk Adjustment', 'History Calibration', 'Context Cap Applied', 'Context Cap Percent', 'Warnings',
  ];
  const rowsToExport = sortV3BoardForView(board, 'main').map((player) => {
    const row = player.v3Row || {};
    const audit = row.audit || {};
    const adjustments = audit.adjustments || {};
    const contextCap = audit.contextCap || null;
    const warnings = [...(row.warnings || []), ...(row.audit?.warnings || []), ...(player.v3PreferenceAudit || [])];
    return [
      row.personalRank,
      row.name,
      row.team,
      row.position,
      row.consensusRank,
      row.adp,
      row.adpSource,
      formatNumber(row.adjustedProjection, 2),
      formatNumber(row.baseProjection, 2),
      formatNumber(row.replacementBaseline, 2),
      formatNumber(row.vorp, 2),
      formatNumber(row.finalDraftScore, 4),
      formatNumber(row.availabilityProbability, 4),
      formatNumber(row.draftUrgency, 2),
      row.projectionSource,
      row.archetype,
      formatNumber(adjustments.runBlocking, 2),
      formatNumber(adjustments.passProtection, 2),
      formatNumber(adjustments.receiverPassProtection, 2),
      formatNumber(adjustments.qbEnvironment, 2),
      formatNumber(adjustments.schedule, 2),
      formatNumber(adjustments.gameScript, 2),
      formatNumber(adjustments.risk, 2),
      formatNumber(adjustments.historyCalibration, 2),
      contextCap ? (contextCap.applied ? 'yes' : 'no') : '',
      contextCap ? formatNumber(contextCap.totalPct * 100, 2) : '',
      warnings.join(' '),
    ];
  });
  const csv = [headers, ...rowsToExport].map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'the-board-v3-rankings.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateSliderReadout(id) {
  const input = document.getElementById(id);
  const output = document.getElementById(id.replace('Slider', 'Val'));
  if (input && output) output.textContent = input.value;
}

function mergeV3ProjectionRows(rowsToAdd = []) {
  const byKey = new Map();
  [...v3CachedProjections, ...v3ImportedProjections, ...rowsToAdd].forEach((row) => {
    const key = createPreferenceKey(row);
    if (key) byKey.set(key, row);
  });
  v3ImportedProjections = [...v3ImportedProjections, ...rowsToAdd];
  if (v3RawPayloads) {
    v3RawPayloads = {
      ...v3RawPayloads,
      projections: Array.from(byKey.values()),
    };
    renderCurrentV3Board();
  }
}

function mergeV3AdpRows(rowsToAdd = []) {
  const byKey = new Map();
  [...v3CachedAdp, ...v3ImportedAdp, ...rowsToAdd].forEach((row) => {
    const key = createPreferenceKey(row);
    if (key) byKey.set(key, row);
  });
  v3ImportedAdp = [...v3ImportedAdp, ...rowsToAdd];
  if (v3RawPayloads) {
    v3RawPayloads = {
      ...v3RawPayloads,
      adp: Array.from(byKey.values()),
    };
    renderCurrentV3Board();
  }
}

function setV3ProjectionStatus(message, className = 'ok') {
  const status = document.getElementById('projStatus');
  if (!status) return;
  const existing = status.textContent ? `${status.textContent} ` : '';
  status.textContent = `${existing}V3: ${message}`;
  status.className = `fetch-status ${className}`;
}

function setV3AdpStatus(message, className = 'ok') {
  const status = document.getElementById('adpStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `fetch-status ${className}`;
}

function handleV3ProjectionImport(text) {
  const rowsToAdd = projectionCsvTextToV3(text);
  if (!rowsToAdd.length) {
    setV3ProjectionStatus('No V3 projection rows found.', 'error');
    return;
  }
  mergeV3ProjectionRows(rowsToAdd);
  setV3ProjectionStatus(`${rowsToAdd.length} expanded projection row(s) added to the V3 board.`, 'ok');
}

function handleV3AdpImport(text) {
  const rowsToAdd = adpCsvTextToV3(text);
  if (!rowsToAdd.length) {
    setV3AdpStatus('No ADP rows found. Check for Player and ADP columns.', 'error');
    return;
  }
  mergeV3AdpRows(rowsToAdd);
  setV3AdpStatus(`${rowsToAdd.length} ADP row(s) added to the V3 board.`, 'ok');
}

document.addEventListener('click', (event) => {
  const draftButton = event.target.closest?.('.v3-draft-player, .v3-my-pick');
  if (draftButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const fullBoard = window.__v3FullBoard || rebuildV3BoardFromState();
    const player = playerById(fullBoard, draftButton.dataset.playerId);
    if (player) {
      syncDraftStateFromControls();
      v3DraftState = draftPlayer(v3DraftState, player, {
        isUserPick: draftButton.classList.contains('v3-my-pick'),
        teamNumber: draftButton.classList.contains('v3-my-pick') ? v3DraftState.userDraftSlot : undefined,
      });
      saveV3DraftState();
      renderCurrentV3Board();
    }
    return;
  }

  const undoDraftButton = event.target.closest?.('#v3DraftUndoBtn');
  if (undoDraftButton) {
    event.preventDefault();
    v3DraftState = undoLastPick(v3DraftState);
    saveV3DraftState();
    renderCurrentV3Board();
    return;
  }

  const resetDraftButton = event.target.closest?.('#v3DraftResetBtn');
  if (resetDraftButton) {
    event.preventDefault();
    v3DraftState = resetDraftState(v3DraftState);
    saveV3DraftState();
    renderCurrentV3Board();
    return;
  }

  const resetFlagsButton = event.target.closest?.('#resetFlagsBtn');
  if (resetFlagsButton && v3OwnsMainBoard) {
    event.preventDefault();
    event.stopImmediatePropagation();
    v3Preferences = {};
    saveV3Preferences();
    renderCurrentV3Board();
    return;
  }

  const yahooDraftSyncButton = event.target.closest?.('#v3YahooDraftSyncBtn');
  if (yahooDraftSyncButton) {
    event.preventDefault();
    syncYahooDraftResultsFromText(document.getElementById('v3YahooDraftPaste')?.value || '');
    return;
  }

  const deepSimButton = event.target.closest?.('#v3DeepSimBtn');
  if (deepSimButton) {
    event.preventDefault();
    runDeepDecisionExplorer();
    return;
  }

  const exportButton = event.target.closest?.('#exportBtn');
  if (exportButton && v3OwnsMainBoard) {
    event.preventDefault();
    event.stopImmediatePropagation();
    exportCurrentV3Board();
    return;
  }

  const legacyVorpButton = event.target.closest?.('#sortVorpBtn');
  if (legacyVorpButton && v3OwnsMainBoard) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const currentlyVorp = v3SortState.main?.key === 'vorp';
    v3SortState.main = currentlyVorp ? null : { key: 'vorp', direction: 'desc' };
    legacyVorpButton.textContent = currentlyVorp ? 'Sort by VORP instead' : 'Sort by your rank instead';
    renderCurrentV3Board();
    return;
  }

  const whyButton = event.target.closest?.('.v3-why-toggle');
  if (whyButton) {
    const whyRow = document.getElementById(whyButton.dataset.whyId);
    if (whyRow) whyRow.style.display = whyRow.style.display === 'none' ? 'table-row' : 'none';
    return;
  }
  const injuryButton = event.target.closest?.('.v3-injury-toggle');
  const rookieButton = event.target.closest?.('.v3-rookie-toggle');
  if (!injuryButton && !rookieButton) return;
  const button = injuryButton || rookieButton;
  const key = button.dataset.prefKey;
  const current = v3Preferences[key] || {};
  updateV3Preference(key, injuryButton ? { injuryFlag: !current.injuryFlag } : { rookieFlag: !current.rookieFlag });
}, true);

document.addEventListener('change', (event) => {
  if (!event.target.matches?.('.v3-override-input')) return;
  updateV3Preference(event.target.dataset.prefKey, { overrideRank: Number(event.target.value) || null });
});

document.getElementById('projCsvLoadBtn')?.addEventListener('click', () => {
  handleV3ProjectionImport(document.getElementById('projCsvPaste')?.value || '');
});

document.getElementById('projCsvFile')?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (readerEvent) => handleV3ProjectionImport(readerEvent.target?.result || '');
  reader.onerror = () => setV3ProjectionStatus('Could not read file for V3 projection import.', 'error');
  reader.readAsText(file);
});

document.getElementById('projClearBtn')?.addEventListener('click', () => {
  v3ImportedProjections = [];
  if (v3RawPayloads) {
    v3RawPayloads = { ...v3RawPayloads, projections: v3CachedProjections };
    renderCurrentV3Board();
  }
  setV3ProjectionStatus('Imported V3 projections cleared; cached fixture projections remain active.', 'ok');
});

document.getElementById('adpCsvLoadBtn')?.addEventListener('click', () => {
  handleV3AdpImport(document.getElementById('adpCsvPaste')?.value || '');
});

document.getElementById('adpCsvFile')?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (readerEvent) => handleV3AdpImport(readerEvent.target?.result || '');
  reader.onerror = () => setV3AdpStatus('Could not read ADP file.', 'error');
  reader.readAsText(file);
});

document.getElementById('adpClearBtn')?.addEventListener('click', () => {
  v3ImportedAdp = [];
  if (v3RawPayloads) {
    v3RawPayloads = { ...v3RawPayloads, adp: v3CachedAdp };
    renderCurrentV3Board();
  }
  setV3AdpStatus('Imported ADP cleared; cached ADP rows remain active.', 'ok');
});

FORM_VALUE_IDS.forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => {
    updateSliderReadout(id);
    renderCurrentV3Board();
  });
});

['v3DraftTeams', 'v3DraftSlot', 'v3CurrentPick'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => {
    syncDraftStateFromControls();
    renderCurrentV3Board();
  });
});

document.addEventListener('v3:preset-applied', () => {
  FORM_VALUE_IDS.forEach(updateSliderReadout);
  renderCurrentV3Board();
});

function renderV3PreviewRows(board) {
  const target = document.getElementById('v3BoardPreviewBody');
  if (!target || !Array.isArray(board) || !board.length) return;
  target.innerHTML = sortV3BoardForView(board, 'preview').slice(0, 25).map((player) => {
    const row = player.v3Row;
    const warnings = [...(row.warnings || []), ...(row.audit?.warnings || [])];
    const warning = warnings.length ? ` <span title="${escapeHtml(warnings.join(' '))}">⚠</span>` : '';
    const bigPlay = row.audit?.bigPlay || null;
    const bigPlayBonus = row.audit?.adjustments?.bigPlayBonus;
    const bigPlayAdjustment = row.audit?.adjustments?.bigPlayConfidenceAdjustment;
    const adpLabel = row.adpSource === 'loaded' ? `${row.adpPlatform || 'Loaded'} ADP` : row.adpSource === 'consensus-fallback' ? 'fallback ADP' : 'ADP missing';
    return `<tr>
      <td class="rank-num">${row.personalRank}</td>
      <td><div class="player-name">${escapeHtml(row.name)}${warning}</div><div class="player-meta">${escapeHtml(row.team || '')} · ${escapeHtml(row.projectionSource || 'unknown')} · ${escapeHtml(row.archetype || 'Unclassified')} · ${escapeHtml(adpLabel)}${bigPlay ? ` · BP ${formatNumber(bigPlayBonus, 1)} @ ${formatNumber(bigPlay.confidence * 100, 0)}%` : ''}</div></td>
      <td><span class="pos-chip pos-${escapeHtml(row.position)}">${escapeHtml(row.position)}</span></td>
      <td>${row.consensusRank || '—'}</td>
      <td>${formatNumber(row.adp, 1)}</td>
      <td title="Big-play confidence adjustment: ${formatSigned(bigPlayAdjustment, 1)} pts">${formatNumber(row.adjustedProjection, 1)}</td>
      <td class="delta ${row.vorp >= 0 ? 'up' : 'down'}">${row.vorp >= 0 ? '+' : ''}${formatNumber(row.vorp, 1)}</td>
      <td title="Chance available next pick: ${formatNumber(row.availabilityProbability * 100, 0)}%">${formatNumber(row.finalDraftScore, 3)}</td>
    </tr>`;
  }).join('');
  updateV3SortHeaders();
}

document.addEventListener('click', (event) => {
  const mainHeader = event.target.closest?.('[data-v3-main-sort]');
  const previewHeader = event.target.closest?.('[data-v3-preview-sort]');
  if (!mainHeader && !previewHeader) return;
  if (mainHeader) v3SortState.main = { key: mainHeader.dataset.v3MainSort, direction: 'desc' };
  if (previewHeader) v3SortState.preview = { key: previewHeader.dataset.v3PreviewSort, direction: 'desc' };
  renderCurrentV3Board();
});

async function renderV3BoardPreview() {
  const target = document.getElementById('v3BoardPreviewBody');
  const status = document.getElementById('v3BoardPreviewStatus');
  if (!target) return;

  try {
    const [rankingsPayload, projectionsPayload, yahooProjectionsPayload, adpPayload, playerMetadataPayload, teamContextPayload, historicalPayload] = await Promise.all([
      loadJson('data/rankings.json'),
      loadJson('data/projections.json'),
      loadJson('data/yahoo-projections-2026.json').catch(() => ({ players: [] })),
      loadJson('data/adp.json'),
      loadJson('data/players.json').catch(() => ({ players: [] })),
      loadJson('data/team-context.json'),
      loadJson('data/yahoo-history-2025.json'),
    ]);
    v3CachedProjections = [...rows(projectionsPayload), ...rows(yahooProjectionsPayload)];
    v3CachedAdp = rows(adpPayload);
    v3RawPayloads = {
      rankings: rows(rankingsPayload),
      projections: [...v3CachedProjections, ...v3ImportedProjections],
      adp: [...v3CachedAdp, ...v3ImportedAdp],
      playerMetadata: rows(playerMetadataPayload),
      teamContext: teamContextPayload,
      historical: historicalPayload,
    };
    renderCurrentV3Board();
    setTimeout(() => renderCurrentV3Board(), 750);
  } catch (error) {
    target.innerHTML = `<tr><td colspan="8"><div class="empty-state">V3 preview unavailable: ${error.message}</div></td></tr>`;
    if (status) {
      status.textContent = `V3 preview unavailable: ${error.message}`;
      status.className = 'fetch-status error';
    }
  }
}

renderV3BoardPreview();