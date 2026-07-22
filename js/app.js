import { buildV3BoardRows } from './board-adapter.js';
import { loadJson, loadV3StatusData } from './data-loader.js';

function statusClass(status) {
  if (status === 'loaded') return 'ok';
  if (status === 'partial' || status === 'fixture') return 'warn';
  return 'error';
}

function card(label, summary, extra = '') {
  return `<div class="v2-status-card"><strong class="${statusClass(summary.status)}">${summary.status}</strong><span>${label}: ${summary.count}${extra}</span></div>`;
}

async function renderV3Status() {
  const target = document.getElementById('v3DataQualityPanel');
  if (!target) return;

  try {
    const status = await loadV3StatusData();
    const refresh = status.metadata?.lastSuccessfulRefresh || 'unknown refresh time';
    target.innerHTML = `
      ${card('Consensus rankings', status.rankings)}
      ${card('Projections', status.projections, ' — actively used by V3 engines')}
      ${card('ADP', status.adp)}
      ${card('Team context', status.teamContext, ' — rank-based V2 data until normalized metrics are populated')}
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

function renderV3MainBoard(board) {
  const body = document.getElementById('boardBody');
  if (!body || !Array.isArray(board) || !board.length) return;

  body.innerHTML = board.slice(0, 250).map((player) => {
    const row = player.v3Row;
    const warnings = row.warnings || [];
    const warningText = warnings.length ? warnings.join(' ') : 'V3 projection-first ranking active.';
    const warningBadge = warnings.length ? '⚠' : 'V3';
    return `<tr data-id="${escapeHtml(player.playerId)}">
      <td class="rank-num">${row.personalRank}</td>
      <td>
        <button class="flag-btn" title="${escapeHtml(warningText)}">${warningBadge}</button>
        <div class="player-name" style="display:inline;">${escapeHtml(row.name)}</div>
        <div class="player-meta">${escapeHtml(row.team || '')} · V3 projection-first score</div>
      </td>
      <td><span class="pos-chip pos-${escapeHtml(row.position)}">${escapeHtml(row.position)}</span></td>
      <td>${row.consensusRank || '—'}</td>
      <td>${formatNumber(row.adjustedProjection, 1)}</td>
      <td class="delta ${row.vorp >= 0 ? 'up' : 'down'}">${row.vorp >= 0 ? '+' : ''}${formatNumber(row.vorp, 1)}</td>
      <td class="delta up">${formatNumber(row.finalDraftScore, 3)}</td>
      <td><span class="player-meta">${warnings.length ? `${warnings.length} warning(s)` : 'Active'}</span></td>
      <td><input type="number" class="override-input" placeholder="#" disabled title="Manual overrides will be rewired to V3 in the next checkpoint."></td>
    </tr>`;
  }).join('');
}

async function renderV3BoardPreview() {
  const target = document.getElementById('v3BoardPreviewBody');
  const status = document.getElementById('v3BoardPreviewStatus');
  if (!target) return;

  try {
    const [rankingsPayload, projectionsPayload, adpPayload] = await Promise.all([
      loadJson('data/rankings.json'),
      loadJson('data/projections.json'),
      loadJson('data/adp.json'),
    ]);
    const board = buildV3BoardRows({
      rankings: rows(rankingsPayload).slice(0, 80),
      projections: rows(projectionsPayload),
      adp: rows(adpPayload),
    });
    window.__v3Board = board;

    target.innerHTML = board.slice(0, 25).map((player) => {
      const row = player.v3Row;
      const warning = row.warnings.length ? ` <span title="${row.warnings.join(' ')}">⚠</span>` : '';
      return `<tr>
        <td class="rank-num">${row.personalRank}</td>
        <td><div class="player-name">${row.name}${warning}</div><div class="player-meta">${row.team || ''}</div></td>
        <td><span class="pos-chip pos-${row.position}">${row.position}</span></td>
        <td>${row.consensusRank || '—'}</td>
        <td>${formatNumber(row.adp, 1)}</td>
        <td>${formatNumber(row.adjustedProjection, 1)}</td>
        <td class="delta ${row.vorp >= 0 ? 'up' : 'down'}">${row.vorp >= 0 ? '+' : ''}${formatNumber(row.vorp, 1)}</td>
        <td>${formatNumber(row.finalDraftScore, 3)}</td>
      </tr>`;
    }).join('');

    if (status) {
      const projectedCount = board.filter((player) => player.v3Status?.hasProjection).length;
      status.textContent = `V3 preview loaded ${board.length} ranked players; ${projectedCount} currently have fixture projections.`;
      status.className = 'fetch-status ok';
    }
    renderV3MainBoard(board);
    setTimeout(() => renderV3MainBoard(board), 750);
  } catch (error) {
    target.innerHTML = `<tr><td colspan="8"><div class="empty-state">V3 preview unavailable: ${error.message}</div></td></tr>`;
    if (status) {
      status.textContent = `V3 preview unavailable: ${error.message}`;
      status.className = 'fetch-status error';
    }
  }
}

renderV3BoardPreview();