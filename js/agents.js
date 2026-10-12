/* ============================================================
   CrimeIntel AI — Agent Monitor
   ============================================================ */

function renderPipelineVisual() {
  const el = document.getElementById('pipeline-visual');
  if (!el) return;
  el.innerHTML = AGENT_META.map((a, i) => `
    ${i > 0 ? '<span class="pv-arrow">→</span>' : ''}
    <div class="pv-node" data-agent="${a.name}" style="--pv-color:${a.color}; --pv-glow:${a.color}33">
      <span>${a.icon}</span> ${a.name.replace(' Agent', '')}
    </div>
  `).join('');
}

function renderAgentCards(stats) {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  grid.innerHTML = AGENT_META.map(a => {
    const s = stats[a.name] || { processed: 0, avgTime: '—', status: 'idle' };
    return `
      <div class="agent-card" style="--accent:${a.color}; --accent-soft:${a.color}1a">
        <div class="agent-card-head">
          <div class="agent-card-icon">${a.icon}</div>
          <div>
            <div class="agent-card-name">${a.name}</div>
            <div class="agent-card-desc">${a.desc}</div>
          </div>
          <div class="agent-card-status ${escapeHtml(s.status)}">${escapeHtml(s.status)}</div>
        </div>
        <div class="agent-card-stats">
          <div class="agent-stat">
            <div class="v">${s.processed || 0}</div>
            <div class="l">Cases Processed</div>
          </div>
          <div class="agent-stat">
            <div class="v">${s.avgTime || '—'}<span style="font-size:12px">ms</span></div>
            <div class="l">Avg Response Time</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function markLiveAgent(stats) {
  document.querySelectorAll('.pv-node').forEach(node => {
    const name = node.dataset.agent;
    if (stats[name] && stats[name].status === 'processing') {
      node.classList.add('live');
    } else {
      node.classList.remove('live');
    }
  });
}

async function loadAgentStats() {
  try {
    const r = await fetch('/api/dashboard/agents');
    const stats = await r.json();
    renderAgentCards(stats);
    markLiveAgent(stats);
  } catch (e) {
    document.getElementById('agents-grid').innerHTML =
      '<div class="empty-state">Failed to load agent telemetry.</div>';
  }
}

async function loadActivity() {
  try {
    const r = await fetch('/api/dashboard/activity');
    const entries = await r.json();
    const log = document.getElementById('agents-activity-log');
    const seen = new Set();
    log.querySelectorAll('[data-id]').forEach(el => seen.add(el.dataset.id));

    const newEntries = entries.filter(e => !seen.has(e.id));
    const html = newEntries.map(e => `
      <div class="activity-entry" data-id="${escapeHtml(e.id)}">
        <div class="activity-dot" style="background:${escapeHtml(e.color)}"></div>
        <div class="activity-content">
          <div class="activity-agent" style="color:${escapeHtml(e.color)}">${escapeHtml(e.agent)}</div>
          <div class="activity-action" title="${escapeHtml(e.action)}">${escapeHtml(e.action)}</div>
          <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px">${escapeHtml(e.caseId || '')}</div>
        </div>
        <div class="activity-time">${formatRelativeTime(e.timestamp)}</div>
      </div>
    `).join('');

    if (newEntries.length) log.insertAdjacentHTML('afterbegin', html);
    while (log.children.length > 60) log.removeChild(log.lastChild);

    if (!newEntries.length && !log.children.length) {
      log.innerHTML = '<div class="empty-state">No agent activity yet. Submit a complaint!</div>';
    }
  } catch (e) { /* silent */ }
}

function refreshAgents() {
  loadAgentStats();
  loadActivity();
  updateAgentsStatus();
  showToast('Agent telemetry refreshed', 'info', 1500);
}

function updateAgentsStatus() {
  Promise.all([
    fetch('/api/dashboard/agents').then(r => r.json()).catch(() => ({})),
    fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
  ]).then(([stats, dash]) => {
    const indicator = document.getElementById('agents-status-indicator');
    const totalEl = document.getElementById('agents-total-cases');
    const active = Object.values(stats).filter(a => a.status === 'processing').length;
    if (active > 0) {
      indicator.textContent = `● ${active} agent${active > 1 ? 's' : ''} processing`;
      indicator.style.color = 'var(--text-accent)';
    } else {
      const idle = Object.keys(stats).length - active;
      indicator.textContent = `● ${idle} agent${idle !== 1 ? 's' : ''} idle · ready`;
      indicator.style.color = 'var(--low)';
    }
    if (totalEl) totalEl.textContent = `${dash.total || 0} total cases · ${dash.critical || 0} critical`;
  }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  renderPipelineVisual();
  loadAgentStats();
  loadActivity();
  updateAgentsStatus();
  setInterval(() => { loadAgentStats(); loadActivity(); updateAgentsStatus(); }, 4000);
  window.refreshAgents = refreshAgents;
});