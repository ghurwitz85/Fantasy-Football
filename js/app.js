import { buildV3BoardRows } from './board-adapter.js';
import { loadJson, loadV3StatusData } from './data-loader.js';
import {
  createDraftState,
  draftPlayer,
  prepareLiveDraftBoard,
  resetDraftState,
  rosterCountsByPosition,
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
const v3SortState = {
  main: null,
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
    const liveDraftHints = [
      row.rosterNeed,
      row.bestAvailableAtPosition ? `Best available ${row.position}` : '',
      row.dropoffLabel,
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
      <td class="delta up">${formatNumber(row.finalDraftScore, 3)}</td>
      <td><span class="player-meta" title="${escapeHtml(warningText)}">${escapeHtml(row.recommendation || player.draft?.recommendation || 'Active')}${row.isOutlierValue ? ' · value' : ''}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}${preferenceAudit.length ? ` · ${preferenceAudit.length} pref` : ''}</span></td>
      <td><input type="number" class="override-input v3-override-input" data-pref-key="${escapeHtml(key)}" min="1" placeholder="#" value="${pref.overrideRank || ''}" title="Set a V3 manual override rank."></td>
    </tr>
    <tr id="${whyId}" class="v3-why-row" style="display:none;">
      <td></td>
      <td colspan="8">
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
  const topTargets = liveBoard.slice(0, 5).map((player) => `${player.name} (${player.position}, ${player.draft?.recommendation || 'Watchlist'})`).join('; ');
  target.innerHTML = `
    <strong>Pick ${v3DraftState.currentPick}</strong> · ${v3DraftState.picks.length} drafted · ${liveBoard.length}/${fullBoard.length} available<br>
    <strong>Your roster:</strong> ${escapeHtml(rosterSummary)}<br>
    <strong>Top available targets:</strong> ${escapeHtml(topTargets || 'No available players yet')}
  `;
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