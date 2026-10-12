/* ============================================================
   CrimeIntel AI — Dashboard (Command Center)
   ============================================================ */

let map = null;
let markers = [];
let allCases = [];

const SEVERITY_COLORS = {
  CRITICAL: '#ff3b5c',
  HIGH: '#ff8c42',
  MEDIUM: '#ffd60a',
  LOW: '#06d6a0',
};

function initMap() {
  map = L.map('crime-map', { zoomControl: true }).setView([22.5, 79.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);
}

function updateMap(cases) {
  if (!map) initMap();
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  // Rebuild 3D scene if it's currently visible
  if (currently3d && typeof window.refresh3D === 'function') {
    window.refresh3D(cases);
  }

  cases.forEach(c => {
    if (!c.lat || !c.lng) return;
    const color = SEVERITY_COLORS[c.severity] || '#8899b4';
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 10px ${color}66"></div>`,
      iconSize: [14, 14],
    });
    const m = L.marker([c.lat, c.lng], { icon }).addTo(map);
    m.bindPopup(`
      <div style="font-family:Inter,sans-serif;font-size:12px;max-width:240px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${escapeHtml(c.caseTitle)}</div>
        <div style="margin-bottom:4px"><span class="badge ${severityBadgeClass(c.severity)}">${escapeHtml(c.severity)}</span>
        <span class="geo-badge geo-${escapeHtml(c.geoRisk)}">${escapeHtml(c.geoRisk)}</span></div>
        <div style="color:#8899b4">${escapeHtml(c.crimeType)}${c.subcategory ? ' — ' + escapeHtml(c.subcategory) : ''}</div>
        <div style="color:#8899b4">📍 ${escapeHtml(c.city)}</div>
        <div style="margin-top:6px"><span class="case-id">${escapeHtml(c.id)}</span></div>
      </div>
    `);
    markers.push(m);
  });

  document.getElementById('map-count').textContent = `${markers.length} markers`;

  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.15));
  }
}

async function loadStats() {
  try {
    const r = await fetch('/api/dashboard');
    const d = await r.json();
    document.getElementById('stat-total').textContent = d.total || 0;
    document.getElementById('stat-open').textContent = d.open || 0;
    document.getElementById('stat-critical').textContent = d.critical || 0;
    document.getElementById('stat-resolved').textContent = d.resolved || 0;
  } catch (e) {
    ['stat-total', 'stat-open', 'stat-critical', 'stat-resolved'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
  }
}

function statusBadge(status) {
  return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function renderCases(cases) {
  const body = document.getElementById('cases-body');
  if (!cases.length) {
    body.innerHTML = '<div class="empty-state">No cases match your filter. 📭</div>';
    return;
  }
  body.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Case ID</th>
          <th>Title</th>
          <th>Crime Type</th>
          <th>Severity</th>
          <th>Dept</th>
          <th>City</th>
          <th>Status</th>
          <th>Reported</th>
        </tr>
      </thead>
      <tbody>
        ${cases.map(c => `
          <tr onclick="openCase('${escapeHtml(c.id)}')">
            <td><span class="case-id">${escapeHtml(c.id)}</span></td>
            <td>
              <div class="case-row-title">${escapeHtml(c.crimeIcon)} ${escapeHtml(c.caseTitle)}</div>
              <div class="case-row-meta">${escapeHtml(c.subcategory)}</div>
            </td>
            <td>${escapeHtml(c.crimeType)}</td>
            <td><span class="badge ${severityBadgeClass(c.severity)}">${escapeHtml(c.severity)}</span></td>
            <td style="font-size:12px">${escapeHtml(c.department)}</td>
            <td>${escapeHtml(c.city)}</td>
            <td>${c.inspectorId ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:${c.inspectorColor || '#00d4ff'}"></span>${escapeHtml(c.inspectorName || 'Inspector')}</span>` : '<span style="color:var(--text-muted);font-size:11px">Unassigned</span>'}</td>
            <td>${statusBadge(c.status)}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${formatRelativeTime(c.createdAt)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

let inspectors = {};

async function loadInspectors() {
  try {
    const r = await fetch('/api/inspectors');
    const list = await r.json();
    inspectors = {};
    list.forEach(i => { inspectors[i.id] = i; });
  } catch (e) { /* silent */ }
}

let unassignedCases = [];

async function loadUnassignedCases() {
  try {
    const r = await fetch('/api/dashboard/cases');
    const data = await r.json();
    unassignedCases = data.filter(c => !c.inspectorId && c.status !== 'resolved' && c.status !== 'closed');
    renderUnassigned();
  } catch (e) { /* silent */ }
}

function renderUnassigned() {
  const list = document.getElementById('unassigned-list');
  const count = document.getElementById('unassigned-count');
  if (!list || !count) return;
  count.textContent = unassignedCases.length;
  if (unassignedCases.length === 0) {
    list.innerHTML = '<div class="unassigned-empty">✅ All cases assigned to inspectors</div>';
    return;
  }
  list.innerHTML = unassignedCases.slice(0, 8).map(c => {
    const insp = inspectors[c.inspectorId];
    return `
      <div class="unassigned-item">
        <div class="ui">
          <div class="id">${escapeHtml(c.id)}</div>
          <div class="desc">${escapeHtml(c.crimeIcon || '📋')} ${escapeHtml(c.caseTitle || c.complaintText.substring(0, 50))}</div>
          <div class="meta">${escapeHtml(c.city)} · ${escapeHtml(c.crimeType)} · ${escapeHtml(c.severity)} · ${escapeHtml(c.status)}</div>
        </div>
        <button class="assign-btn" onclick="assignInspectorFromWidget('${escapeHtml(c.id)}')" ${!inspectorsList() ? 'disabled title="No inspectors available"' : ''}>
          👤 Assign
        </button>
      </div>
    `;
  }).join('');
}

function inspectorsList() {
  return Object.entries(inspectors).filter(([id, i]) => i.active);
}

async function assignInspectorFromWidget(caseId) {
  const list = inspectorsList();
  if (list.length === 0) { showToast('No inspectors available', 'error'); return; }
  const names = list.map((i, idx) => `${idx + 1}. ${i.name} — ${i.rank}, ${i.station} [${i.badgeNumber}]`).join('\n');
  const choice = prompt(`Assign inspector to case ${caseId.substring(0, 12)}…\n\n${names}\n\nEnter number (1-${list.length}):`);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= list.length) { showToast('Invalid selection', 'error'); return; }
  try {
    const r = await fetch(`/api/cases/${encodeURIComponent(caseId)}/inspector`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectorId: list[idx].id }),
    });
    if (!r.ok) throw new Error('Assign failed');
    showToast(`Assigned to ${list[idx].name}`, 'info');
    await loadCases();
    await loadUnassignedCases();
    await loadActivity();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadCases() {
  const status = document.getElementById('status-filter').value;
  const query = document.getElementById('case-search').value.trim().toLowerCase();
  try {
    const url = '/api/dashboard/cases' + (status ? `?status=${encodeURIComponent(status)}` : '');
    const r = await fetch(url);
    const data = await r.json();
    allCases = data;
    // Attach inspector info to each case
    allCases.forEach(c => {
      if (c.inspectorId && inspectors[c.inspectorId]) {
        c.inspectorName = inspectors[c.inspectorId].name;
        c.inspectorColor = inspectors[c.inspectorId].color;
      }
    });
    let filtered = data;
    if (query) {
      filtered = data.filter(c =>
        (c.id || '').toLowerCase().includes(query) ||
        (c.crimeType || '').toLowerCase().includes(query) ||
        (c.city || '').toLowerCase().includes(query) ||
        (c.caseTitle || '').toLowerCase().includes(query) ||
        (c.subcategory || '').toLowerCase().includes(query)
      );
    }
    renderCases(filtered);
    updateMap(filtered);
  } catch (e) {
    document.getElementById('cases-body').innerHTML = '<div class="empty-state">Failed to load cases. Is the server running?</div>';
  }
}

async function loadActivity() {
  try {
    const r = await fetch('/api/dashboard/activity');
    const entries = await r.json();
    const log = document.getElementById('activity-log');
    // Track entries already rendered by their id
    const existing = new Set();
    log.querySelectorAll('[data-id]').forEach(el => existing.add(el.dataset.id));

    const newEntries = entries.filter(e => !existing.has(e.id));
    const html = newEntries.map(e => `
      <div class="activity-entry" data-id="${escapeHtml(e.id)}">
        <div class="activity-dot" style="background:${escapeHtml(e.color)}"></div>
        <div class="activity-content">
          <div class="activity-agent" style="color:${escapeHtml(e.color)}">${escapeHtml(e.agent)}</div>
          <div class="activity-action" title="${escapeHtml(e.action)}">${escapeHtml(e.action)}</div>
        </div>
        <div class="activity-time">${formatRelativeTime(e.timestamp)}</div>
      </div>
    `).join('');

    if (newEntries.length) log.insertAdjacentHTML('afterbegin', html);
    while (log.children.length > 40) log.removeChild(log.lastChild);

    if (!newEntries.length && !log.children.length) {
      log.innerHTML = '<div class="empty-state">No agent activity yet. Submit a complaint!</div>';
    }
  } catch (e) { /* silent */ }
}

async function loadAgentTotals() {
  try {
    const r = await fetch('/api/dashboard/agents');
    const agents = await r.json();
    let total = 0;
    Object.values(agents).forEach(a => total += a.processed || 0);
    document.getElementById('agent-total').textContent = total + ' processed';
  } catch (e) { /* silent */ }
}

/* ---------- Case Detail Modal ---------- */

function openCase(id) {
  fetch(`/api/complaints/${encodeURIComponent(id)}`)
    .then(r => r.json())
    .then(c => renderModal(c))
    .catch(() => showToast('Failed to load case details', 'error'));
}

function listHtml(items) {
  if (!items || !items.length) return '<span style="color:var(--text-muted)">None</span>';
  return items.map(i => `<div class="detail-val" style="text-align:left">${escapeHtml(i)}</div>`).join('');
}

function renderModal(c) {
  document.getElementById('modal-title').innerHTML =
    `${c.classification?.crime_icon || '📋'} ${escapeHtml(c.id)}`;
  document.getElementById('modal-meta').innerHTML =
    `Reported ${formatDateTime(c.createdAt)} · ${escapeHtml(c.city || 'Unknown')} · ${statusBadge(c.status)}`;

  const sev = c.severity || {};
  const triage = c.triage || {};
  const intel = c.intelligence || {};
  const intake = c.intake || {};
  const cls = c.classification || {};
  const sum = c.summary || {};

  document.getElementById('modal-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-section">
        <h4>⚠️ Severity Assessment</h4>
        <div class="detail-row"><span class="detail-key">Severity</span>
          <span class="badge ${severityBadgeClass(sev.severity_label)}">${escapeHtml(sev.severity_label || 'N/A')}</span></div>
        <div class="detail-row"><span class="detail-key">Score</span><span class="detail-val">${sev.severity_score ?? '—'} / 10</span></div>
        <div class="detail-row"><span class="detail-key">SLA</span><span class="detail-val">${sev.sla_hours ?? '—'} hours</span></div>
        <div class="detail-row"><span class="detail-key">Threat to life</span><span class="detail-val">${sev.threat_to_life ? '⚠️ YES' : 'No'}</span></div>
        <div class="detail-row"><span class="detail-key">Ongoing</span><span class="detail-val">${sev.ongoing_incident ? 'Yes — live' : 'No'}</span></div>
        <div class="detail-row"><span class="detail-key">Escalate</span><span class="detail-val">${sev.escalate_to_senior ? '🚨 Senior officer' : 'No'}</span></div>
      </div>
      <div class="detail-section">
        <h4>🗂️ Triage Routing</h4>
        <div class="detail-row"><span class="detail-key">Department</span><span class="detail-val">${escapeHtml(triage.department || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Unit</span><span class="detail-val">${escapeHtml(triage.unit || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Priority</span><span class="detail-val">${escapeHtml(triage.priority_queue || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Officers</span><span class="detail-val">${triage.recommended_officers ?? '—'}</span></div>
        <div class="detail-row"><span class="detail-key">Est. resolution</span><span class="detail-val">${triage.estimated_resolution_days ?? '—'} days</span></div>
      </div>
    </div>

    <div class="detail-section" style="margin-top:16px">
      <h4>👮 Inspector Assignment</h4>
      ${c.inspectorId && inspectors[c.inspectorId] ? `
        <div class="detail-row"><span class="detail-key">Inspector</span>
          <span class="detail-val" style="display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(inspectors[c.inspectorId].color)}"></span>
            ${escapeHtml(inspectors[c.inspectorId].name)} (${escapeHtml(inspectors[c.inspectorId].rank)})
          </span></div>
        <div class="detail-row"><span class="detail-key">Station</span><span class="detail-val">${escapeHtml(inspectors[c.inspectorId].station || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Badge</span><span class="detail-val">${escapeHtml(inspectors[c.inspectorId].badgeNumber || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Specialty</span><span class="detail-val">${escapeHtml(inspectors[c.inspectorId].specialty || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Assigned</span><span class="detail-val">${c.assignedAt ? formatRelativeTime(c.assignedAt) : '—'}</span></div>
        <div class="detail-row"><span class="detail-key">Handled</span><span class="detail-val">${c.handledAt ? formatDateTime(c.handledAt) : '<span style="color:var(--text-muted)">Pending</span>'}</span></div>
        <div class="detail-row" style="flex-direction:column;align-items:stretch;gap:6px">
          <span class="detail-key" style="margin-bottom:2px">Notes</span>
          <span class="detail-val" style="text-align:left;font-size:12px;line-height:1.6;color:var(--text-secondary);white-space:pre-wrap">${c.inspectorNotes ? escapeHtml(typeof c.inspectorNotes === 'string' ? c.inspectorNotes : JSON.stringify(c.inspectorNotes || '', null, 2)) : '<span style="color:var(--text-muted)">No notes yet</span>'}</span>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="quickAssign('${escapeHtml(c.id)}')">👤 Assign Inspector</button>
          <button class="btn btn-outline btn-sm" onclick="quickNote('${escapeHtml(c.id)}')">📝 Add Note</button>
          <button class="btn btn-primary btn-sm" onclick="markHandled('${escapeHtml(c.id)}')">✓ Mark Handled</button>
        </div>
      ` : `
        <div class="detail-row"><span class="detail-key">Inspector</span><span class="detail-val" style="color:var(--text-muted);font-style:italic">Unassigned</span></div>
        <div style="margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="quickAssign('${escapeHtml(c.id)}')">👤 Assign Inspector</button>
        </div>
      `}
    </div>

    <div class="detail-grid" style="margin-top:16px">
      <div class="detail-section">
        <h4>🔍 Classification</h4>
        <div class="detail-row"><span class="detail-key">Primary type</span><span class="detail-val">${escapeHtml(cls.primary_type || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Subcategory</span><span class="detail-val">${escapeHtml(cls.subcategory || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">IPC Sections</span>
          <span class="detail-val">${(cls.ipc_sections || []).map(s => `<span class="ipc-tag">${escapeHtml(s)}</span>`).join(' ') || '—'}</span></div>
        <div class="detail-row"><span class="detail-key">Confidence</span><span class="detail-val">${Math.round((cls.confidence || 0) * 100)}%</span></div>
      </div>
      <div class="detail-section">
        <h4>🧠 Intelligence</h4>
        <div class="detail-row"><span class="detail-key">Geo risk</span><span class="detail-val"><span class="geo-badge geo-${escapeHtml(intel.geo_risk_level || 'YELLOW')}">${escapeHtml(intel.geo_risk_level || '—')}</span></span></div>
        <div class="detail-row"><span class="detail-key">Hotspot risk</span><span class="detail-val">${escapeHtml(intel.hotspot_risk || '—')}</span></div>
        <div class="detail-row"><span class="detail-key">Repeat offender</span><span class="detail-val">${Math.round((intel.repeat_offender_likelihood || 0) * 100)}%</span></div>
        <div class="detail-row"><span class="detail-key">Organized crime</span><span class="detail-val">${intel.organized_crime_indicator ? '⚠️ YES' : 'No'}</span></div>
        <div class="detail-row"><span class="detail-key">Surveillance</span><span class="detail-val">${intel.recommended_surveillance ? '📡 Recommended' : 'No'}</span></div>
      </div>
    </div>

    <div class="detail-section" style="margin-top:16px">
      <h4>📝 Original Complaint</h4>
      <div class="briefing-text" style="border-left-color:var(--text-secondary)">${escapeHtml(c.complaintText)}</div>
    </div>

    <div class="detail-section" style="margin-top:16px">
      <h4>🧑‍⚖️ Officer Briefing</h4>
      <div class="briefing-text">${escapeHtml(sum.briefing || 'No briefing generated.')}</div>
      ${sum.key_facts?.length ? `
        <div style="margin-top:14px"><strong style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted)">Key Facts</strong>
        <ul class="key-facts" style="margin-top:10px">${sum.key_facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>` : ''}
      ${sum.immediate_actions?.length ? `
        <div style="margin-top:14px"><strong style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted)">Immediate Actions</strong>
        <ul class="action-items" style="margin-top:10px">${sum.immediate_actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>` : ''}
      ${sum.case_tags?.length ? `
        <div style="margin-top:14px">${sum.case_tags.map(t => `<span class="case-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>

    <div class="detail-section" style="margin-top:16px">
      <h4>🤖 Agent Pipeline Outputs</h4>
      <details>
        <summary style="cursor:pointer;font-size:13px;color:var(--text-accent)">Intake Agent — entities extracted</summary>
        <pre style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;margin-top:10px">${escapeHtml(JSON.stringify(intake, null, 2))}</pre>
      </details>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:13px;color:var(--text-accent)">Triage — action items & agencies</summary>
        <pre style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;margin-top:10px">${escapeHtml(JSON.stringify(triage, null, 2))}</pre>
      </details>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:13px;color:var(--text-accent)">Intelligence — pattern flags</summary>
        <pre style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;margin-top:10px">${escapeHtml(JSON.stringify(intel, null, 2))}</pre>
      </details>
    </div>

    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:24px">
      <button class="btn btn-ghost btn-sm" onclick="updateStatus('${escapeHtml(c.id)}','open')">Mark Open</button>
      <button class="btn btn-outline btn-sm" onclick="updateStatus('${escapeHtml(c.id)}','in_progress')">In Progress</button>
      <button class="btn btn-primary btn-sm" onclick="updateStatus('${escapeHtml(c.id)}','resolved')">✓ Resolve</button>
    </div>
  `;

  document.getElementById('case-modal').classList.add('open');
}

async function updateStatus(id, status) {
  try {
    const r = await fetch(`/api/complaints/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error('Update failed');
    showToast(`Case ${id} marked ${status.replace('_', ' ')}`);
    closeModal();
    loadStats();
    loadCases();
    loadActivity();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function closeModal() {
  document.getElementById('case-modal').classList.remove('open');
}

async function quickAssign(caseId) {
  try {
    const list = Object.values(inspectors).filter(i => i.active);
    if (list.length === 0) { showToast('No inspectors available', 'error'); return; }
    const names = list.map((i, idx) => `${idx + 1}. ${i.name} (${i.rank}, ${i.station})`).join('\n');
    const choice = prompt(`Assign inspector to this case:\n\n${names}\n\nEnter number (1-${list.length}):`);
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= list.length) { showToast('Invalid selection', 'error'); return; }
    const r = await fetch(`/api/cases/${encodeURIComponent(caseId)}/inspector`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectorId: list[idx].id }),
    });
    if (!r.ok) throw new Error('Assign failed');
    showToast(`Assigned to ${list[idx].name}`, 'info');
    loadCases();
    loadActivity();
    openCase(caseId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function quickNote(caseId) {
  const note = prompt('Enter inspector notes for this case:');
  if (note === null || note.trim() === '') return;
  try {
    const r = await fetch(`/api/cases/${encodeURIComponent(caseId)}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: note.trim() }),
    });
    if (!r.ok) throw new Error('Note update failed');
    showToast('Note saved', 'info');
    openCase(caseId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function markHandled(caseId) {
  if (!confirm('Mark this case as handled and resolved?')) return;
  try {
    const r = await fetch(`/api/cases/${encodeURIComponent(caseId)}/handled`, { method: 'PATCH' });
    if (!r.ok) throw new Error('Failed');
    showToast('Case marked handled & resolved', 'info');
    closeModal();
    loadCases();
    loadActivity();
  } catch (e) { showToast(e.message, 'error'); }
}

window.quickAssign = quickAssign;
window.quickNote = quickNote;
window.markHandled = markHandled;

function refreshAll() {
  loadStats();
  loadCases();
  loadActivity();
  loadAgentTotals();
  loadModelBadge();
  loadUnassignedCases();
  showToast('Dashboard refreshed', 'info', 1500);
}

async function loadModelBadge() {
  try {
    const r = await fetch('/api/ml-model');
    const d = await r.json();
    if (d.current) {
      const m = d.current;
      const acc = (m.accuracy * 100).toFixed(1);
      const date = new Date(m.trainedAt || m.createdAt).toLocaleDateString();
      document.getElementById('model-badge').textContent = `ML v${m.version} · ${acc}% · ${date}`;
      document.getElementById('model-badge').className = 'mode-badge mock';
    } else {
      document.getElementById('model-badge').textContent = 'ML: not loaded';
    }
  } catch (e) {
    document.getElementById('model-badge').textContent = 'ML: —';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadInspectors();
  loadCases();
  loadActivity();
  loadAgentTotals();
  loadModelBadge();
  loadUnassignedCases();
  // Live activity polling
  setInterval(loadActivity, 4000);
  setInterval(loadInspectors, 30000);
  setInterval(loadUnassignedCases, 10000);

  document.getElementById('case-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  window.openCase = openCase;
  window.closeModal = closeModal;
  window.updateStatus = updateStatus;
  window.refreshAll = refreshAll;
  window.loadCases = loadCases;
  window.quickAssign = quickAssign;
  window.quickNote = quickNote;
  window.markHandled = markHandled;
  window.assignInspectorFromWidget = assignInspectorFromWidget;
  window.inspectors = inspectors;
  window.initDashChatbox = initDashChatbox;
  window.dashChatSuggest = dashChatSuggest;
  initDashChatbox();
});

/* ---------- Dashboard AI Chatbox ---------- */

let dashChatOpen = false;
let dashChatCases = [];
let dashChatStats = null;

const DASH_CHAT_SUGGEST_PROMPTS = {
  totals: 'What are the total cases, open, critical and resolved counts?',
  crimes: 'Which crime types are most common and how many cases each?',
  cities: 'Which cities have the most cases and the most critical cases?',
  hourly: 'What is the hourly case trend throughout the day?',
  casesByCrime: 'Show me the cases under Murder',
};

function initDashChatbox() {
  const toggle = document.getElementById('dash-chat-toggle');
  const closeBtn = document.getElementById('dash-chatbox-close');
  const panel = document.getElementById('dash-chatbox-panel');
  const sendBtn = document.getElementById('dash-chatbox-send');
  const input = document.getElementById('dash-chatbox-input');

  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    dashChatOpen = true;
    panel.hidden = false;
    toggle.style.display = 'none';
    if (dashChatStats) {
      document.getElementById('dash-chatbox-prompt').textContent =
        `Loaded ${dashChatStats.total} cases. Ask about case data — totals, crimes, cities, hourly trends.`;
    }
    scrollDashChatToBottom();
  });

  closeBtn.addEventListener('click', () => {
    dashChatOpen = false;
    panel.hidden = true;
    toggle.style.display = '';
  });

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handleDashChatMessage(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
}

function scrollDashChatToBottom() {
  const box = document.getElementById('dash-chatbox-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function addDashChatMessage(role, html) {
  const box = document.getElementById('dash-chatbox-messages');
  if (!box) return;
  const msg = document.createElement('div');
  msg.className = 'dash-chat-message ' + role;
  msg.innerHTML = html;
  box.appendChild(msg);
  scrollDashChatToBottom();
}

function showDashChatThinking() {
  const box = document.getElementById('dash-chatbox-messages');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'dash-chat-message bot';
  el.id = 'dash-chatthinking';
  el.innerHTML = '<span style="color:var(--cyan); font-style:italic; animation: pulse 1.4s infinite;">Analyzing case data…</span>';
  box.appendChild(el);
  scrollDashChatToBottom();
}

function removeDashChatThinking() {
  const el = document.getElementById('dash-chatthinking');
  if (el) el.remove();
}

function setDashChatInputEnabled(enabled) {
  const input = document.getElementById('dash-chatbox-input');
  const send = document.getElementById('dash-chatbox-send');
  if (input) input.disabled = !enabled;
  if (send) send.disabled = !enabled;
}

function dashChatSuggest(key) {
  const input = document.getElementById('dash-chatbox-input');
  const prompt = DASH_CHAT_SUGGEST_PROMPTS[key];
  if (prompt && input) {
    input.value = prompt;
    input.focus();
  }
}

async function handleDashChatMessage(userText) {
  addDashChatMessage('user', escapeHtml(userText));
  setDashChatInputEnabled(false);

  if (!dashChatStats) {
    showDashChatThinking();
    try {
      const [statsR, casesR] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/dashboard/cases'),
      ]);
      dashChatStats = await statsR.json();
      dashChatCases = await casesR.json();
    } catch (err) {
      removeDashChatThinking();
      addDashChatMessage('bot', `<div style="color:var(--critical);">⚠️ Could not load case data. Is the server running?</div>`);
      setDashChatInputEnabled(true);
      return;
    }
    removeDashChatThinking();
  }

  const ans = buildDashboardAnswer(dashChatStats, dashChatCases, userText);
  addDashChatMessage('bot', ans);
  setDashChatInputEnabled(true);
}

/**
 * Build a natural-language answer about dashboard case data from the
 * /api/dashboard stats + /api/dashboard/cases payloads.
 */
function buildDashboardAnswer(stats, cases, userText) {
  const lower = (userText || '').toLowerCase();
  const total = stats?.total ?? 0;
  const open = stats?.open ?? 0;
  const critical = stats?.critical ?? 0;
  const resolved = stats?.resolved ?? 0;
  const inProgress = stats?.inProgress ?? 0;
  const crimeTypeCounts = stats?.crimeTypeCounts || {};
  const hourlyData = stats?.hourlyData || [];

  // City severity analysis from case list
  const cityCases = {};
  const cityCritical = {};
  cases.forEach(c => {
    const city = c.city || 'Unknown';
    if (!cityCases[city]) cityCases[city] = { total: 0, critical: 0, high: 0 };
    cityCases[city].total++;
    if ((c.severity || '').toUpperCase() === 'CRITICAL') cityCases[city].critical++;
    if ((c.severity || '').toUpperCase() === 'HIGH') cityCases[city].high++;
  });

  const sortedCities = Object.entries(cityCases).sort((a, b) => b[1].total - a[1].total);
  const sortedCrimes = Object.entries(crimeTypeCounts).sort((a, b) => b[1] - a[1]);

  const wantTotals = /total|stat|count|open|critical|resolved|close|status|how many/i.test(lower);
  const wantCrimes = /crime|type|most common|top crime|frequent|fraud|theft|cyber/i.test(lower);
  const wantCities = /city|distric|area|location|where|worst|which.*most/i.test(lower);
  const wantHourly = /hour|time|trend|when|throughout|daily|distribution/i.test(lower);
  const wantAll = /everything|all|full|complete|overview|summary|dashboard|what.*data/i.test(lower) || !userText;

  // "Which cases fall under <crime type>?" — list matching cases from the DB
  const casesUnderMatch = lower.match(/(?:cases?|complaints?|incidents?)\s+(?:under|of|for|about|related to|in)\s+([a-z &']+)/i)
    || lower.match(/(?:show|list|give|tell)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:cases?|complaints?|incidents?)\s+(?:under|of|for|in)\s+([a-z &']+)/i);
  if (casesUnderMatch) {
    let crimeQuery = casesUnderMatch[1].trim()
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/\b(crime|crimes|category|categories|type|types|section|sections)\b/g, '')
      .replace(/\s+/g, ' ').trim();
    // Strip trailing filler like "?", "please", "in the system"
    crimeQuery = crimeQuery.replace(/[?.!]+$/g, '').replace(/\s+(please|thanks|thank you)$/i, '').trim();
    if (crimeQuery && !/^(total|all|each|every|most|how many)$/i.test(crimeQuery)) {
      return buildCasesUnderCrime(cases, crimeQuery, total);
    }
  }

  const rows = [];

  if (wantTotals || wantAll) {
    const badge = (label, val, colorClass) =>
      `<span class="dash-stat ${colorClass}">${label}: <strong>${val}</strong></span>`;
    rows.push(mkDashBotLine(
      'Case Snapshot',
      `<div class="dash-stat-row">` +
        badge('Total', total, '') + ' ' +
        badge('Open', open, 'highlight') + ' ' +
        badge('In Progress', inProgress, '') + ' ' +
        badge('Critical', critical, critical > 0 ? 'highlight' : '') + ' ' +
        badge('Resolved', resolved, '') +
      `</div>`));
  }

  if (wantCrimes || wantAll) {
    if (sortedCrimes.length === 0) {
      rows.push(mkDashBotLine('Crime Types', '<span style="color:var(--text-muted)">No crime type data available.</span>'));
    } else {
      const maxVal = sortedCrimes[0][1];
      const items = sortedCrimes.slice(0, 8).map(([crime, cnt]) => {
        const pct = (cnt / maxVal * 100).toFixed(0);
        return `<li>${escapeHtml(crime)}: ${cnt} case${cnt !== 1 ? 's' : ''} <span style="color:var(--text-muted)">(${pct}% of top)</span></li>`;
      }).join('');
      rows.push(mkDashBotLine(
        'Top Crime Types',
        `<ul>${items}</ul>`,
        sortedCrimes.slice(0, 3).map(c => c[0]).join(', ')));
    }
  }

  if (wantCities || wantAll) {
    if (sortedCities.length === 0) {
      rows.push(mkDashBotLine('City Breakdown', '<span style="color:var(--text-muted)">No city data available.</span>'));
    } else {
      const topCities = sortedCities.slice(0, 6).map(([city, data]) => {
        const worst = data.critical > 0 ? 'CRITICAL' : data.high > 0 ? 'HIGH' : '—';
        return `<li>${escapeHtml(city)}: ${data.total} case${data.total !== 1 ? 's' : ''}${data.critical ? ` · ${data.critical} critical` : ''} <span style="color:var(--text-muted); font-size:10px">worst: ${worst}</span></li>`;
      }).join('');
      rows.push(mkDashBotLine(
        'Cases by City (top 6)',
        `<ul>${topCities}</ul>`,
        sortedCities.slice(0, 3).map(c => c[0]).join(', ')));
    }
  }

  if (wantHourly || wantAll) {
    if (!hourlyData.length) {
      rows.push(mkDashBotLine('Hourly Trend', '<span style="color:var(--text-muted)">No hourly data.</span>'));
    } else {
      const peakHour = hourlyData.indexOf(Math.max(...hourlyData));
      const peakLabel = peakHour >= 0 ? `${peakHour}:00–${peakHour + 1}:00` : '—';
      const peakVal = peakHour >= 0 ? hourlyData[peakHour] : 0;
      const peakDesc = peakHour >= 6 && peakHour < 12 ? 'morning' :
        peakHour >= 12 && peakHour < 17 ? 'afternoon' :
        peakHour >= 17 && peakHour < 21 ? 'evening' : 'night';
      const hourlyBars = hourlyData.map((v, h) => {
        const pct = v > 0 ? (v / Math.max(...hourlyData) * 100).toFixed(0) : 0;
        return `<span style="display:inline-block;width:${pct}%;height:8px;border-radius:2px;background:${v > 0 ? 'var(--text-accent)' : 'var(--border)'};margin-right:2px;vertical-align:middle"></span>`;
      }).join('');
      rows.push(mkDashBotLine(
        'Hourly Case Distribution',
        `<div style="margin-top:4px; line-height:1.8; font-family:var(--font-mono); font-size:10px;">${hourlyBars}</div>` +
        `<div style="margin-top:4px; color:var(--text-secondary); font-size:10px;">Peak: ${peakLabel} (${peakVal} cases, ${peakDesc})</div>`));
    }
  }

  if (!rows.length) {
    return `<div style="color:var(--text-secondary);">I have the case data. Try asking about totals, crime types, cities, or the hourly trend.</div>`;
  }

  return `<div style="color:var(--text-secondary); margin-bottom:4px; font-size:10px;">Based on ${total} cases in the system:</div>` + rows.map(r => r).join('');
}

function mkDashBotLine(label, contentHtml, highlight) {
  const hl = highlight ? `<div style="margin-top:3px; font-size:10px; color:var(--purple); font-weight:600;">${escapeHtml(highlight)}</div>` : '';
  return `<div class="dash-stat-row" style="margin-bottom:4px">
    <strong style="color:var(--text-accent); font-size:11px;">${escapeHtml(label)}</strong>
  </div>
  <div style="margin-left:14px;">${contentHtml}</div>
  ${hl}`;
}

/**
 * List the actual cases that fall under a given crime type (e.g. "Murder",
 * "Theft", "Cybercrime"). Matches by primary type, then subcategory, then
 * fuzzy substring — and shows each case's IPC sections from its stored
 * classification when available.
 */
function buildCasesUnderCrime(cases, crimeQuery, total) {
  const q = crimeQuery.toLowerCase();
  const IPC_BY_TYPE = {
    'theft': ['379', '380'], 'robbery': ['392', '397'],
    'assault': ['351', '352', '323'], 'fraud': ['420', '406'],
    'cybercrime': ['66C', '66D'], 'drug trafficking': ['NDPS Act'],
    'kidnapping': ['363', '364'], 'murder': ['302', '304'],
    'hit & run': ['279', '304A'], 'domestic violence': ['498A', '323'],
    'arson': ['435', '436'], 'sexual harassment': ['376', '354'],
    'extortion': ['383', '503'], 'general complaint': ['107'],
  };

  // Score each case: exact type match > substring in type > substring in subcategory/title
  const matched = cases.filter(c => {
    const type = (c.crimeType || c.classification?.primary_type || '').toLowerCase();
    const sub = (c.subcategory || c.classification?.subcategory || '').toLowerCase();
    const title = (c.caseTitle || '').toLowerCase();
    return type === q || type.includes(q) || sub.includes(q) || title.includes(q);
  });

  if (!matched.length) {
    const available = [...new Set(cases.map(c => c.crimeType).filter(Boolean))].sort();
    return mkDashBotLine(
      `No cases found for "${crimeQuery}"`,
      `<div style="color:var(--text-secondary); font-size:11px;">Crime types currently in the system:</div>` +
      `<div style="margin-top:4px;">${available.map(t =>
        `<span class="dash-stat" style="margin:2px;">${escapeHtml(t)}</span>`).join('')}</div>`);
  }

  const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  matched.sort((a, b) => (sevOrder[(a.severity || '').toUpperCase()] ?? 9) - (sevOrder[(b.severity || '').toUpperCase()] ?? 9));

  const sevColor = s => ({ CRITICAL: 'var(--critical)', HIGH: '#ff8c42', MEDIUM: 'var(--accent)', LOW: 'var(--text-muted)' }[(s || '').toUpperCase()] || 'var(--text-muted)');

  const items = matched.slice(0, 10).map((c, i) => {
    const sev = (c.severity || '—').toUpperCase();
    const ipc = (c.classification?.ipc_sections || IPC_BY_TYPE[(c.crimeType || '').toLowerCase()] || []);
    const ipcTxt = ipc.length ? ` · IPC ${ipc.join(', ')}` : '';
    return `<li style="margin-bottom:6px;">
      <span onclick="openCase('${escapeHtml(c.id)}')" style="color:var(--cyan); cursor:pointer; text-decoration:underline;">${escapeHtml(c.id)}</span>
      <span style="color:var(--text-secondary);"> — ${escapeHtml(c.caseTitle || c.subcategory || c.crimeType || 'Untitled')}</span>
      <div style="font-size:10px; margin-top:2px;">
        <span style="color:${sevColor(c.severity)}; font-weight:700;">${escapeHtml(sev)}</span>
        <span style="color:var(--text-muted);"> · ${escapeHtml(c.city || 'Unknown')} · ${escapeHtml((c.status || '').replace('_', ' '))}${ipcTxt}</span>
      </div>
    </li>`;
  }).join('');

  const shown = Math.min(10, matched.length);
  const more = matched.length > shown ? `<div style="margin-top:4px; color:var(--text-muted); font-size:10px;">…and ${matched.length - shown} more. Ask to filter by city or severity.</div>` : '';

  return `<div style="color:var(--text-secondary); margin-bottom:4px; font-size:10px;">${matched.length} of ${total} cases fall under "${escapeHtml(crimeQuery)}":</div>` +
    mkDashBotLine(`Cases under ${crimeQuery} (${matched.length})`, `<ul style="padding-left:16px; margin:4px 0;">${items}</ul>` + more);
}

/* ---------- Tamil Nadu State Card ---------- */

const TN_CITIES = [
  'Chennai', 'Coimbatore', 'Madurai', 'Salem', 'Thoothukudi', 'Karaikudi',
  'Tiruchirappalli', 'Tirunelveli', 'Vellore', 'Erode', 'Thanjavur',
  'Dindigul', 'Nagercoil', 'Hosur',
];

async function loadTNCard() {
  try {
    const r = await fetch('/api/dashboard/cases');
    const cases = await r.json();
    const tnCases = cases.filter(c => TN_CITIES.includes(c.city));

    document.getElementById('tn-total').textContent = tnCases.length;
    document.getElementById('tn-critical').textContent = tnCases.filter(c => c.severity === 'CRITICAL').length;
    document.getElementById('tn-open').textContent = tnCases.filter(c => c.status === 'open' || c.status === 'in_progress').length;
    document.getElementById('tn-resolved').textContent = tnCases.filter(c => c.status === 'resolved' || c.status === 'closed').length;
    document.getElementById('tn-update-time').textContent =
      tnCases.length > 0 ? `refresh ${formatRelativeTime(new Date().toISOString())}` : 'no TN cases';

    const cityCounts = {};
    tnCases.forEach(c => { cityCounts[c.city] = (cityCounts[c.city] || 0) + 1; });
    const cityEl = document.getElementById('tn-cities');
    if (Object.keys(cityCounts).length === 0) {
      cityEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px">No TN cities with cases</div>';
    } else {
      cityEl.innerHTML = Object.entries(cityCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([city, cnt]) => {
          const sev = getWorstTNSeverity(city, tnCases);
          const color = SEVERITY_COLORS[sev] || '#8899b4';
          return `
            <div class="tn-city-chip">
              <span class="dot" style="background:${color}"></span>
              <span>${escapeHtml(city)}</span>
              <span class="cnt">${cnt}</span>
            </div>`;
        }).join('');
    }

    const crimeCounts = {};
    tnCases.forEach(c => { crimeCounts[c.crimeType] = (crimeCounts[c.crimeType] || 0) + 1; });
    const crimeEl = document.getElementById('tn-crimes');
    if (Object.keys(crimeCounts).length === 0) {
      crimeEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px">No crime types recorded</div>';
    } else {
      const maxCrime = Math.max(...Object.values(crimeCounts));
      crimeEl.innerHTML = Object.entries(crimeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([crime, cnt]) => {
          const pct = maxCrime > 0 ? (cnt / maxCrime) * 100 : 0;
          return `
            <div class="tn-crime-tag">
              <span>${escapeHtml(crime)}</span>
              <span class="bar" style="width:${pct}%;background:${getCrimeColor(crime)}"></span>
              <span>${cnt}</span>
            </div>`;
        }).join('');
    }
  } catch (e) {
    document.getElementById('tn-update-time').textContent = 'failed to load';
  }
}

function getWorstTNSeverity(city, cases) {
  const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  let worst = 'LOW';
  cases.filter(c => c.city === city).forEach(c => {
    const s = c.severity || 'LOW';
    if (order[s] > order[worst]) worst = s;
  });
  return worst;
}

function getCrimeColor(crime) {
  const map = {
    'Theft': '#00d4ff',
    'Assault': '#ff8c42',
    'Fraud': '#7b2fff',
    'Cybercrime': '#06d6a0',
    'Drug Trafficking': '#ffd60a',
    'Kidnapping': '#ff3b5c',
    'Murder': '#ff3b5c',
    'Hit & Run': '#118ab2',
    'Domestic Violence': '#ff3b5c',
    'Arson': '#ff6600',
    'Sexual Harassment': '#ff3b5c',
    'Extortion': '#ff8c42',
    'General Complaint': '#8899b4',
  };
  return map[crime] || '#8899b4';
}

document.addEventListener('DOMContentLoaded', () => {
  loadTNCard();
  setInterval(loadTNCard, 15000);
});
