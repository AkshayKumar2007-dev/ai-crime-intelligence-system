/* ============================================================
   CrimeIntel AI — Complaint Page
   Handles form submission + animated AI agent pipeline
   ============================================================ */

const PIPELINE_STEPS = AGENT_META.map(a => ({
  name: a.name,
  icon: a.icon,
  color: a.color,
  status: 'pending',
  result: ''
}));

const COMPLAINT_EXAMPLES = {
  chain: "My gold chain was snatched by two men on a motorcycle near Connaught Place, Delhi yesterday evening at around 7 PM. One suspect wore a red helmet. A passerby tried to chase them but they escaped towards Rajiv Chowk.",
  cyber: "I received a call from someone posing as an SBI bank official asking for my OTP. I shared it and Rs 45,000 was transferred from my account. This happened this morning in Mumbai. I have the phone number they called from.",
  murder: "There is a dead body found near the lake in Koramangala, Bengaluru. I found it during my morning walk at 6 AM today. No idea who it is. Please come immediately, it looks suspicious.",
  drug: "Drug peddlers are operating openly near the school in Sector 18, Noida. I have seen them exchange packets near the back gate every afternoon for the last two weeks. They drive a white Maruti Swift.",
  domestic: "My husband beat me again last night and threatened to kill me if I go to the police. I am hiding at my neighbor's house in Bandra West, Mumbai right now. I have bruises and need immediate help.",
  kidnap: "My 10-year-old daughter went missing from T Nagar market, Chennai this afternoon around 3 PM. She was wearing a blue dress and was with her friends when a stranger took her. Please find her urgently.",
  arson: "Unknown persons set fire to my car parked outside my house in the Cyber Hub area of Hyderabad early this morning. The car is completely burnt. It seems deliberate as there was a petrol smell.",
  extortion: "Two men came to my shop in Lajpat Nagar, Delhi and threatened me to pay Rs 5 lakhs protection money or they will burn my shop. I have their phone number and a CCTV recording of them.",
  tn_chain: "My gold chain was snatched by two men on a motorcycle near T Nagar, Chennai yesterday evening around 7 PM. One suspect wore a red helmet. The chain was worth Rs 3 lakhs. I am a 35-year-old woman walking back from the market.",
  tn_cyber: "I received a WhatsApp call from someone claiming to be from Chennai Cyber Crime cell saying my bank account is compromised. They asked for my OTP and UPI PIN. Rs 85,000 was transferred from my account in Coimbatore. The call came from a number starting with +91 9XXXXXX.",
  tn_kidnap: "My 21-year-old daughter was abducted from her textile showroom workplace in Perambur, Chennai last night around 11 PM. Her family received a ransom call demanding Rs 20 lakhs. She was working late that day. Police have not traced her so far.",
  tn_drug: "Suspected drug peddlers are selling ganja and tablets near PSG Tech bus stop in Peelamedu, Coimbatore. Students are being targeted. I have seen at least 5 boys selling near the college gates every day for the past week. They use code words.",
  tn_arson: "A fire broke out in a warehouse storing chemicals and textiles near SIPCOT industrial zone in Guindy, Chennai early this morning. Firefighters took 3 hours to control it. The cause is unknown but looks suspicious as there were no fire safety equipment."
};

function fillExample(key) {
  const text = COMPLAINT_EXAMPLES[key];
  if (!text) return;
  const ta = document.getElementById('complaintText');
  ta.value = text;
  updateCharCount();
  ta.focus();
  showToast('Example complaint loaded — review and submit', 'info');
}

function updateCharCount() {
  const el = document.getElementById('complaintText');
  document.getElementById('char-count').textContent = el.value.length;
}

function renderPipeline() {
  const container = document.getElementById('pipeline-steps');
  if (!container) return;
  container.innerHTML = PIPELINE_STEPS.map(step => `
    <div class="pipeline-step" data-agent="${step.name}" style="--step-color:${step.color}; --step-glow:${step.color}33">
      <div class="step-icon">${step.icon}</div>
      <div style="flex:1; min-width:0">
        <div class="step-name">${step.name}</div>
        <div class="step-status">Queued</div>
        <div class="step-result"></div>
      </div>
      <div class="step-spinner" style="display:none"></div>
      <div class="step-check" style="display:none">✓</div>
    </div>
  `).join('');
}

function setStepState(index, state, resultText) {
  const step = PIPELINE_STEPS[index];
  if (!step) return;
  step.status = state;
  const el = document.querySelector(`.pipeline-step[data-agent="${CSS.escape(step.name)}"]`);
  if (!el) return;
  el.className = 'pipeline-step ' + state;
  const statusEl = el.querySelector('.step-status');
  const resultEl = el.querySelector('.step-result');
  const spinner = el.querySelector('.step-spinner');
  const check = el.querySelector('.step-check');

  if (state === 'active') {
    statusEl.textContent = 'Processing…';
    spinner.style.display = 'block';
    check.style.display = 'none';
    resultEl.textContent = '';
  } else if (state === 'done') {
    statusEl.textContent = 'Complete';
    spinner.style.display = 'none';
    check.style.display = 'block';
    resultEl.textContent = resultText || '';
  } else {
    statusEl.textContent = 'Queued';
    spinner.style.display = 'none';
    check.style.display = 'none';
    resultEl.textContent = '';
  }
}

function setPipelineStatus(text) {
  const el = document.getElementById('pipeline-status');
  if (el) el.textContent = text;
}

// Sequentially animate the pipeline while the server processes the request.
// The server runs all 6 agents before responding, so we mark each step done
// as its ~300-500ms mock latency elapses; real results render from the response.
async function animatePipeline(results) {
  const stepMs = [280, 260, 200, 320, 420, 380];
  const resultsByAgent = {};
  if (results) {
    if (results.intake) resultsByAgent['Intake Agent'] = results.intake.incident_summary || '';
    if (results.classification) {
      const conf = Math.round((results.classification.confidence || 0) * 100);
      resultsByAgent['Classification Agent'] = `${results.classification.primary_type} — ${results.classification.subcategory} (ML ${conf}%)`;
    }
    if (results.severity) resultsByAgent['Severity Agent'] = `${results.severity.severity_label} (${results.severity.severity_score}/10)`;
    if (results.triage) resultsByAgent['Triage Agent'] = results.triage.department.split('(')[0].trim();
    if (results.intelligence) resultsByAgent['Intelligence Agent'] = `${results.intelligence.geo_risk_level} Zone`;
    if (results.summary) resultsByAgent['Summary Agent'] = results.summary.case_title || '';
  }

  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const name = PIPELINE_STEPS[i].name;
    if (PIPELINE_STEPS[i].status === 'done') continue; // already finished (fast response)
    setStepState(i, 'active');
    await new Promise(r => setTimeout(r, stepMs[i]));
    setStepState(i, 'done', resultsByAgent[name] || '');
  }
}

async function submitComplaint(e) {
  e.preventDefault();

  const text = document.getElementById('complaintText').value.trim();
  if (text.length < 30) {
    showToast('Please describe the incident in at least 30 characters.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  const btnText = document.getElementById('btn-text');
  const form = document.getElementById('complaint-form');

  btn.disabled = true;
  btnText.textContent = '🤖 Analyzing…';
  setPipelineStatus('PROCESSING');
  renderPipeline();

  const payload = {
    complaintText: text,
    reporterName: document.getElementById('reporterName').value.trim(),
    reporterPhone: document.getElementById('reporterPhone').value.trim(),
    city: document.getElementById('city').value,
  };

  try {
    const res = await fetch('/api/complaints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Submission failed');

    // If the server already finished, mark remaining steps done instantly
    if (data.case) {
      const flat = {
        intake: data.case.intake,
        classification: data.case.classification,
        severity: data.case.severity,
        triage: data.case.triage,
        intelligence: data.case.intelligence,
        summary: data.case.summary,
      };
      for (let i = 0; i < PIPELINE_STEPS.length; i++) {
        if (PIPELINE_STEPS[i].status !== 'done') setStepState(i, 'done');
      }
      animatePipeline(flat);
    }

    setPipelineStatus('COMPLETE');
    showSuccess(data.caseId);
    form.reset();
    updateCharCount();
  } catch (err) {
    console.error('Submit error:', err);
    setPipelineStatus('ERROR');
    // reveal remaining steps as failed-looking (just reset display)
    renderPipeline();
    showToast(err.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btnText.textContent = '🚀 Submit & Analyze';
  }
}

function showSuccess(caseId) {
  document.getElementById('success-case-id').textContent = caseId;
  document.getElementById('form-body').classList.add('hidden');
  const ss = document.getElementById('success-screen');
  ss.classList.add('visible');
  ss.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  document.getElementById('success-screen').classList.remove('visible');
  document.getElementById('form-body').classList.remove('hidden');
  setPipelineStatus('READY');
  renderPipeline();
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('complaint-form');
  if (!form) return;

  renderPipeline();

  document.getElementById('complaintText').addEventListener('input', updateCharCount);
  form.addEventListener('submit', submitComplaint);
  window.fillExample = fillExample;
  window.resetForm = resetForm;

  // ---- AI Chatbox ----
  initChatbox();
  window.chatSuggest = chatSuggest;
});

// ---------------------------------------------------------------
// AI Chatbox — answers "what sections come under this complaint"
// by calling /api/agents/pipeline and extracting the relevant sections
// from the pipeline output (IPC sections, routing, actions, flags, etc.)
// ---------------------------------------------------------------
const CHAT_SUGGEST_PROMPTS = {
  sections: "What sections and charges come under this complaint?",
  ipc: "Which IPC sections apply to this complaint?",
  action: "What are the immediate action items for this complaint?",
  routing: "Which department and unit should handle this complaint?",
};

let chatOpen = false;
let chatComplaintText = '';
let chatPipelineResult = null;

function initChatbox() {
  const toggleBtn = document.getElementById('chatbox-toggle');
  const closeBtn = document.getElementById('chatbox-close');
  const panel = document.getElementById('chatbox-panel');
  const sendBtn = document.getElementById('chatbox-send');
  const input = document.getElementById('chatbox-input');

  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener('click', () => {
    chatOpen = true;
    panel.hidden = false;
    toggleBtn.style.display = 'none';
    if (chatComplaintText) {
      document.getElementById('chatbox-prompt').textContent =
        `Your complaint is loaded. Ask what sections, IPC charges, routing, or action items apply.`;
    }
    scrollChatToBottom();
  });

  closeBtn.addEventListener('click', () => {
    chatOpen = false;
    panel.hidden = true;
    toggleBtn.style.display = '';
  });

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handleChatMessage(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
}

function scrollChatToBottom() {
  const box = document.getElementById('chatbox-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function addChatMessage(role, html) {
  const box = document.getElementById('chatbox-messages');
  if (!box) return;
  const msg = document.createElement('div');
  msg.className = 'chat-message ' + role;
  msg.innerHTML = html;
  box.appendChild(msg);
  scrollChatToBottom();
}

function showChatThinking() {
  const box = document.getElementById('chatbox-messages');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'chat-message bot';
  el.id = 'chatthinking';
  el.innerHTML = '<span class="chatbox-thinking">AI is analyzing your complaint to extract every applicable section…</span>';
  box.appendChild(el);
  scrollChatToBottom();
}

function removeChatThinking() {
  const el = document.getElementById('chatthinking');
  if (el) el.remove();
}

function setChatInputEnabled(enabled) {
  const input = document.getElementById('chatbox-input');
  const send = document.getElementById('chatbox-send');
  if (input) input.disabled = !enabled;
  if (send) send.disabled = !enabled;
}

function chatSuggest(key) {
  const input = document.getElementById('chatbox-input');
  const prompt = CHAT_SUGGEST_PROMPTS[key];
  if (prompt && input) {
    input.value = prompt;
    input.focus();
  }
}

async function handleChatMessage(userText) {
  addChatMessage('user', escapeHtml(userText));
  setChatInputEnabled(false);

  // If the user hasn't submitted a complaint yet, prompt them.
  if (!chatComplaintText) {
    addChatMessage('bot', `<div style="color:var(--text-muted); font-style:italic;">You haven't filed a complaint yet. Write a complaint in the form and submit it — the AI assistant will then be able to tell you exactly which sections, IPC charges, and departments apply.</div>`);
    setChatInputEnabled(true);
    return;
  }

  // If the pipeline hasn't run yet for this complaint, run it now via the
  // agent API so the chatbox can extract sections from a live result.
  if (!chatPipelineResult) {
    showChatThinking();
    try {
      const res = await fetch('/api/agents/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complaintText: chatComplaintText }),
      });
      const data = await res.json();
      if (!data.success) throw new Error('Pipeline failed');
      chatPipelineResult = data.pipeline;
    } catch (err) {
      removeChatThinking();
      addChatMessage('bot', `<div style="color:var(--critical);">⚠️ Could not re-run the pipeline. Please submit the complaint first.</div>`);
      setChatInputEnabled(true);
      return;
    }
    removeChatThinking();
  }

  // Build the sectioning answer from the pipeline outputs.
  const ans = buildSectioningAnswer(chatPipelineResult, userText);
  addChatMessage('bot', ans);
  setChatInputEnabled(true);
}

/**
 * From the pipeline output, build a structured answer that lists every
 * "section" that comes under the complaint — IPC charges, department
 * routing, action items, intelligence flags, geo risk, severity, evidence,
 * key facts, etc. The `userText` is used to bias which sections to highlight.
 */
function buildSectioningAnswer(pipeline, userText) {
  const lower = (userText || '').toLowerCase();
  const { classification, severity, triage, intelligence, summary, intake } = pipeline;
  const cls = classification?.classification || classification || {};
  const sev = severity || {};
  const tri = triage || {};
  const intel = intelligence || {};
  const summ = summary || {};

  const primaryType = cls.primary_type || 'Unknown';
  const subcat = cls.subcategory || '';
  const ipc = Array.isArray(cls.ipc_sections) ? cls.ipc_sections : [];
  const dept = tri.department || 'Local Police Station';
  const unit = tri.unit || 'General Duty';
  const queue = tri.priority_queue || 'NORMAL';
  const officers = tri.recommended_officers != null ? tri.recommended_officers : 2;
  const days = tri.estimated_resolution_days != null ? tri.estimated_resolution_days : 21;
  const actions = Array.isArray(tri.action_items) ? tri.action_items : [];
  const patterns = Array.isArray(intel.pattern_flags) ? intel.pattern_flags : [];
  const geo = intel.geo_risk_level || 'YELLOW';
  const repeatPct = intel.repeat_offender_likelihood != null ? Math.round(intel.repeat_offender_likelihood * 100) : '—';
  const organised = intel.organized_crime_indicator ? 'Yes — organised crime nexus suspected' : 'No indication';
  const surveillance = intel.recommended_surveillance ? 'Yes — surveillance recommended' : 'Not recommended';
  const facts = Array.isArray(summ.key_facts) ? summ.key_facts : [];
  const tags = Array.isArray(summ.case_tags) ? summ.case_tags : [];
  const entities = intake?.entities || {};

  // Determine which sections the user cares about from their question.
  const wantIpc = /ipc|section|charge|law|section/i.test(lower) || /ipc|section|charge|law/i.test(userText || '');
  const wantRouting = /rout|department|unit|who|where|station|polic/i.test(lower);
  const wantActions = /action|step|do|task|what next|handle/i.test(lower);
  const wantPatterns = /pattern|flag|intel|risk|repeat|organised|surveillance/i.test(lower);
  const wantAll = /section|everything|all|full|complete|detail|breakdown/i.test(lower) || !userText;

  const rows = [];

  // 1. Crime classification section
  rows.push(mkSection('🔍', 'Crime Classification',
    `${primaryType}${subcat ? ' — ' + subcat : ''}`,
    wantAll || /classif|crime|type|what/i.test(lower), primaryType, cls.crime_icon || '📋'));

  // 2. IPC sections
  if (wantIpc || wantAll) {
    const ipcList = ipc.length
      ? ipc.map(s => `<span>Section ${escapeHtml(s)} IPC</span>`).join(', ')
      : '<span style="color:var(--text-muted)">No specific IPC sections mapped</span>';
    rows.push(mkSection('⚖️', 'IPC / Legal Sections', '', true, 'Legal', '⚖️', ipcList));
  }

  // 3. Severity & SLA
  rows.push(mkSection('⚡', 'Severity & SLA',
    `${sev.severity_label || 'MEDIUM'} — Score ${sev.severity_score != null ? sev.severity_score + '/10' : '—'} · SLA ${sev.sla_hours != null ? sev.sla_hours + 'h' : '—'}`,
    wantAll || /severit|sla|urg|urgent|priority/i.test(lower), sev.severity_label || 'MEDIUM', sev.threat_to_life ? '🔴' : '🟢'));


  // Facts and tags only appear in the "all sections" view
  if (wantAll) {
    const factsHtml = facts.slice(0, 4).map(f => `<li style="margin:2px 0; font-size:11px; color:var(--text-secondary);">${escapeHtml(f)}</li>`).join('');
    rows.push(mkSectionList('📋', 'Key Facts (Officer Briefing)',
      `<ul style="margin:4px 0 0 16px;">${factsHtml}</ul>`,
      true, 'Facts', '📋'));
    const tagHtml = tags.slice(0, 5).map(t => `<span>${escapeHtml(t)}</span>`).join(' · ') || '—';
    rows.push(mkSection('🏷️', 'Case Tags', '', true, 'Tags', '🏷️', tagHtml));
  }

  // 4. Department routing
  if (wantRouting || wantAll) {
    rows.push(mkSection('🗂️', 'Department Routing', `${escapeHtml(dept)} — ${escapeHtml(unit)}`, true, 'Routing', '🗂️'));
    rows.push(mkSection('📌', 'Priority Queue', queue, true, queue, queue === 'IMMEDIATE' ? '🔴' : queue === 'URGENT' ? '🟠' : '🟡'));
    rows.push(mkSection('👥', 'Recommended Officers', `${officers} officers`, true, 'Officers', '👥'));
    rows.push(mkSection('📅', 'Estimated Resolution', `${days} days`, true, 'Days', '📅'));
  }

  // 5. Action items
  if (wantActions || wantAll) {
    const actionList = actions.length
      ? actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')
      : '<li style="color:var(--text-muted)">No specific action items</li>';
    rows.push(mkSectionList('✅', 'Immediate Action Items',
      `<ul style="margin:4px 0 0 16px; font-size:11px; color:var(--text-secondary);">${actionList}</ul>`,
      true, 'Actions', '✅'));
  }

  // 6. Intelligence flags
  if (wantPatterns || wantAll) {
    rows.push(mkSection('🧠', 'Geo Risk Level', geo + ' Zone', true, geo, geo === 'RED' ? '🔴' : geo === 'ORANGE' ? '🟠' : '🟢'));
    rows.push(mkSection('🔁', 'Repeat Offender Likelihood', repeatPct + '%', true, 'Repeat', '🔁'));
    rows.push(mkSection('🕸️', 'Organised Crime Indicator', organised, true, organised.startsWith('Yes') ? 'CRITICAL' : 'LOW', organised.startsWith('Yes') ? '🕸️' : '🟢'));
    rows.push(mkSection('📡', 'Surveillance Recommended', surveillance, true, surveillance.startsWith('Yes') ? 'CRITICAL' : 'LOW', surveillance.startsWith('Yes') ? '📡' : '🟢'));
    if (patterns.length) {
      const patternHtml = patterns.slice(0, 3).map(p => `<li style="margin:2px 0; font-size:11px; color:var(--text-secondary);">${escapeHtml(p)}</li>`).join('');
      rows.push(mkSectionList('🚩', 'Pattern Flags',
        `<ul style="margin:4px 0 0 16px;">${patternHtml}</ul>`,
        true, patterns.length + ' patterns', '🚩'));
    }
  }

  // 8. Extracted entities (the sections of evidence/context the agent pulled out)
  if (wantAll || /evid|witn|detail|extract|entit/i.test(lower)) {
    const entityRows = [
      entities.location ? `📍 ${escapeHtml(entities.location)}` : null,
      entities.city ? `🏙️ ${escapeHtml(entities.city)}` : null,
      entities.date_time ? `🕒 ${escapeHtml(entities.date_time)}` : null,
      entities.persons_involved?.length ? `👤 Persons: ${escapeHtml(entities.persons_involved.join(', '))}` : null,
      entities.evidence_mentioned?.length ? `🔎 Evidence: ${escapeHtml(entities.evidence_mentioned.join(', '))}` : null,
      entities.vehicle ? `🚗 Vehicle: ${escapeHtml(entities.vehicle)}` : null,
    ].filter(Boolean).join('<br>');
    if (entityRows) {
      rows.push(mkSection('📥', 'Extracted Entities (Evidence & Context)', entityRows, true, 'Entities', '📥'));
    }
  }

  if (!rows.length) {
    return `<div style="color:var(--text-secondary);">I've analyzed your complaint. Here are the sections that come under it:</div>` +
      rows.map(r => r).join('');
  }

  return `<div style="color:var(--text-secondary); margin-bottom:4px; font-size:11px;">Based on your complaint, here are the sections that come under it:</div>` +
    rows.map(r => r).join('');
}

function mkSection(icon, name, detail, highlight, colorLabel, dotColor, htmlDetail) {
  const dot = dotColor || '🟢';
  const renderedDetail = htmlDetail != null ? htmlDetail : escapeHtml(detail);
  return `<div class="section-item" style="--step-color:${colorFor(colorLabel)};">
    <span class="sec-icon">${icon}</span>
    <span class="sec-name">${escapeHtml(name)}</span>
    <span class="sec-detail">${dot} ${renderedDetail}</span>
  </div>`;
}

function mkSectionList(icon, name, innerHtml, highlight, colorLabel, dotColor) {
  const dot = dotColor || '🟢';
  return `<div class="section-item" style="--step-color:${colorFor(colorLabel)};">
    <span class="sec-icon">${icon}</span>
    <span class="sec-name">${escapeHtml(name)}</span>
    <span class="sec-detail">${dot} ${escapeHtml(colorLabel)}</span>
    ${innerHtml}
  </div>`;
}

function colorFor(label) {
  const map = {
    'Legal': '#ffd60a',
    'CRITICAL': '#ff3b5c',
    'HIGH': '#ff6600',
    'MEDIUM': '#ffd60a',
    'LOW': '#06d6a0',
    'IMMEDIATE': '#ff3b5c',
    'URGENT': '#ff6600',
    'NORMAL': '#ffd60a',
    'DEFERRED': '#06d6a0',
    'RED': '#ff3b5c',
    'ORANGE': '#ff6600',
    'YELLOW': '#ffd60a',
    'GREEN': '#06d6a0',
    'Theft': '#00d4ff',
    'Cybercrime': '#7b2fff',
  };
  return map[label] || 'var(--purple)';
}

// When a complaint is successfully submitted, store its text + pipeline result
// so the chatbox can answer sectioning questions without re-running the pipeline.
function wireChatboxToCase(caseId, caseData) {
  chatComplaintText = caseData?.complaintText || '';
  chatPipelineResult = null; // force re-run on first chat question
  // We do NOT auto-run the pipeline here — the user has to ask a question first.
  // But we pre-populate the chatbox prompt and show a hint.
  const promptEl = document.getElementById('chatbox-prompt');
  if (promptEl) {
    promptEl.textContent = `Your complaint (Case ${caseId}) has been filed. Ask the AI what sections, IPC charges, routing, or action items apply — e.g. "What IPC sections apply?" or "Which department should handle this?"`;
  }
}

// Patch the success screen so the chatbox gets wired into the newly filed case.
const _origShowSuccess = showSuccess;
showSuccess = function(caseId) {
  _origShowSuccess(caseId);
  // The case data isn't stored here directly, but we can fetch it from the
  // API so the chatbox has the full pipeline output.
  fetch('/api/complaints/' + caseId)
    .then(r => r.json())
    .then(c => {
      if (c && c.complaintText) wireChatboxToCase(caseId, c);
    })
    .catch(() => {
      // If we can't fetch the case, the chatbox will prompt the user to
      // re-submit — graceful degradation.
    });
};

// Also wire when the form is reset so a new complaint replaces the old one.
const _origResetForm = resetForm;
resetForm = function() {
  _origResetForm();
  chatComplaintText = '';
  chatPipelineResult = null;
  const promptEl = document.getElementById('chatbox-prompt');
  if (promptEl) {
    promptEl.textContent = 'The AI will scan your complaint and list every section — IPC charges, department routing, action items, intelligence flags, and more. Type your question below or use a suggested prompt.';
  }
};