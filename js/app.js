/* ============================================================
   CrimeIntel AI — Shared Frontend Helpers
   ============================================================ */

// Agent metadata (colors mirror server/store.js agentStats)
const AGENT_META = [
  { name: 'Intake Agent', icon: '📥', color: '#00d4ff', desc: 'Entity extraction & parsing' },
  { name: 'Classification Agent', icon: '🔍', color: '#7b2fff', desc: 'Crime type & IPC mapping' },
  { name: 'Severity Agent', icon: '⚡', color: '#ff8c42', desc: 'Urgency & SLA scoring' },
  { name: 'Triage Agent', icon: '🗂️', color: '#ffd60a', desc: 'Department routing & resources' },
  { name: 'Intelligence Agent', icon: '🧠', color: '#06d6a0', desc: 'Patterns & geo risk analysis' },
  { name: 'Summary Agent', icon: '📋', color: '#ff3b5c', desc: 'Officer briefing synthesis' },
];

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRelativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function severityBadgeClass(label) {
  const map = {
    CRITICAL: 'badge-critical',
    HIGH: 'badge-high',
    MEDIUM: 'badge-medium',
    LOW: 'badge-low',
  };
  return map[label] || 'badge-medium';
}

function statusBadgeClass(status) {
  return 'badge-status-' + (status || 'open').replace(/_/g, '_');
}

function statusLabel(status) {
  const map = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
  return map[status] || status || 'Open';
}

function showToast(message, type = 'success', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icon = type === 'error' ? '❌' : type === 'info' ? 'ℹ️' : '✅';
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Update the DEMO/LIVE badge in the navbar
async function initModeBadge() {
  const badge = document.getElementById('mode-badge');
  if (!badge) return;
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    if (d.mode && d.mode.includes('LIVE')) {
      badge.textContent = '⚡ LIVE (GEMINI)';
      badge.className = 'mode-badge live';
    }
  } catch (e) { /* keep DEMO MODE default */ }
}

document.addEventListener('DOMContentLoaded', initModeBadge);