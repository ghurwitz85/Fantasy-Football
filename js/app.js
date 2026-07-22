import { loadV3StatusData } from './data-loader.js';

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