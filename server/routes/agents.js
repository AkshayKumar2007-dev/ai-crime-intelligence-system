const express = require('express');
const router = express.Router();
const { getStore } = require('../store');
const {
  runIntakeAgent,
  runClassificationAgent,
  runSeverityAgent,
  runTriageAgent,
  runIntelligenceAgent,
  runSummaryAgent,
} = require('../agents/intakeAgent');
const { runClassificationAgent: _c } = require('../agents/classificationAgent');
const { runSeverityAgent: _s } = require('../agents/severityAgent');
const { runTriageAgent: _t } = require('../agents/triageAgent');
const { runIntelligenceAgent: _i } = require('../agents/intelligenceAgent');
const { runSummaryAgent: _su } = require('../agents/summaryAgent');

// Re-export by name so the router's runOne switch stays clean.
const _agents = {
  'Intake Agent': runIntakeAgent,
  'Classification Agent': _c,
  'Severity Agent': _s,
  'Triage Agent': _t,
  'Intelligence Agent': _i,
  'Summary Agent': _su,
};

// ---------------------------------------------------------------------------
// Agent registry — static metadata for the 6 agents so clients don't need
// hardcoded knowledge of the pipeline.
// ---------------------------------------------------------------------------
const AGENTS = [
  {
    name: 'Intake Agent',
    role: 'extract structured entities from raw complaint text (location, city, time, persons, evidence)',
    order: 1,
    consumes: ['complaintText'],
    produces: ['entities', 'incident_summary', 'confidence_score', 'missing_information'],
    color: '#00d4ff',
    icon: '📥',
  },
  {
    name: 'Classification Agent',
    role: 'identify crime type, subcategory, IPC sections and keywords from complaint + entities',
    order: 2,
    consumes: ['complaintText', 'entities'],
    produces: ['primary_type', 'subcategory', 'ipc_sections', 'keywords', 'crime_icon', 'confidence'],
    color: '#7b2fff',
    icon: '🔍',
  },
  {
    name: 'Severity Agent',
    role: 'score urgency 1-10, assign CRITICAL/HIGH/MEDIUM/LOW, set SLA, flag threat-to-life',
    order: 3,
    consumes: ['complaintText', 'entities', 'classification'],
    produces: ['severity_score', 'severity_label', 'sla_hours', 'threat_to_life', 'ongoing_incident', 'reasoning', 'escalate_to_senior'],
    color: '#ff8c42',
    icon: '⚡',
  },
  {
    name: 'Triage Agent',
    role: 'route to the correct department + unit, set priority queue and recommend officer count',
    order: 4,
    consumes: ['complaintText', 'entities', 'classification', 'severity'],
    produces: ['department', 'unit', 'priority_queue', 'recommended_officers', 'action_items', 'notify_agencies', 'estimated_resolution_days'],
    color: '#ffd60a',
    icon: '🗂️',
  },
  {
    name: 'Intelligence Agent',
    role: 'analyse geo-risk, hotspot risk, repeat-offender likelihood, organised-crime indicators',
    order: 5,
    consumes: ['complaintText', 'entities', 'classification', 'severity'],
    produces: ['pattern_flags', 'hotspot_risk', 'repeat_offender_likelihood', 'organized_crime_indicator', 'similar_case_pattern', 'intelligence_notes', 'recommended_surveillance', 'geo_risk_level'],
    color: '#06d6a0',
    icon: '🧠',
  },
  {
    name: 'Summary Agent',
    role: 'synthesise all prior outputs into an officer briefing, key facts and case tags',
    order: 6,
    consumes: ['complaintText', 'entities', 'classification', 'severity', 'triage', 'intelligence'],
    produces: ['case_title', 'briefing', 'key_facts', 'immediate_actions', 'case_tags', 'officer_notes'],
    color: '#ff3b5c',
    icon: '📋',
  },
];

// ---------------------------------------------------------------------------
// Agent-level mock/live toggle
// When an agent has an explicit override in memory the global MOCK_MODE is
// ignored for that agent only.  By default every agent inherits the global
// setting so the system behaves identically to before.
// ---------------------------------------------------------------------------
const agentModeOverrides = new Map(); // name -> 'mock' | 'live' | null (inherit)

function effectiveMode(agentName) {
  const override = agentModeOverrides.get(agentName);
  if (override) return override;
  return process.env.MOCK_MODE === 'true' ? 'mock' : 'live';
}

// ---------------------------------------------------------------------------
// Helpers shared by the single-agent and pipeline endpoints
// ---------------------------------------------------------------------------
function buildInput(agetName, body, acc) {
  // Every agent accepts a complaintText at minimum; downstream agents also
  // accept prior agent outputs from `acc`.
  if (!body.complaintText && !acc) {
    throw new Error('complaintText is required');
  }
  return { body, acc };
}

// Run one agent and record its activity + run duration in the store.
async function runOne(agentName, complaintText, input, t0) {
  const store = await getStore();
  const mode = effectiveMode(agentName);
  store.setAgentStatus(agentName, 'processing');
  await store.addActivity(agentName, `Starting (mode: ${mode})`, null);

  const tAgent = Date.now();
  let result;
  {
    const fn = _agents[agentName];
    if (!fn) throw new Error(`Unknown agent: ${agentName}`);

    result = await fn(
      complaintText,
      input?.entities || null,
      input?.classification || null,
      input?.severity || null,
      input?.triage || null,
      input?.intelligence || null,
    );
  }
  const duration = Date.now() - tAgent;
  await store.recordAgentRun(agentName, duration);
  store.setAgentStatus(agentName, 'idle');
  await store.addActivity(agentName, `Completed in ${duration}ms (mode: ${mode})`, null);
  return { result, duration, mode };
}

// ---------------------------------------------------------------------------
// GET /api/agents — registry + live per-agent status
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const store = await getStore();
  const stats = await store.getAgentStats();
  // getAgentStats() returns an object keyed by agent name (in-memory) or an
  // array of rows from PostgreSQL. Normalise both to an array we can search.
  const statsArr = Array.isArray(stats)
    ? stats
    : Object.entries(stats).map(([name, s]) => ({ name, ...s }));
  const now = Date.now();
  const registry = AGENTS.map(a => {
    const s = statsArr.find(x => x.name === a.name) || {};
    return {
      ...a,
      status: s.status || 'idle',
      runs: s.runs || 0,
      avgMs: s.avgMs || 0,
      lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
      mode: effectiveMode(a.name),
      latency: s.status === 'processing' ? 'active' : (s.avgMs ? `${Math.round(s.avgMs)}ms` : '—'),
    };
  });
  res.json({
    agents: registry,
    pipeline: {
      totalAgents: registry.length,
      processing: registry.filter(a => a.status === 'processing').length,
      mockModeAgents: registry.filter(a => a.mode === 'mock').length,
      liveModeAgents: registry.filter(a => a.mode === 'live').length,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/pipeline — run the full 6-agent pipeline on a complaint
// Body: { complaintText, reporterName?, reporterPhone?, city?, lat?, lng? }
// Returns the enriched case object exactly as the complaint submission route
// would build it (without persisting it).
// ---------------------------------------------------------------------------
router.post('/pipeline', async (req, res) => {
  const { complaintText } = req.body;
  if (!complaintText || complaintText.trim().length < 20) {
    return res.status(400).json({ error: 'complaintText must be at least 20 characters.' });
  }

  const store = await getStore();
  const startTime = Date.now();
  let input = {};

  // We run agents in pipeline order so each agent sees the accumulated
  // outputs of the previous ones — same semantics as complaint submission.
  const results = {};
  const order = AGENTS.map(a => a.name);

  for (const agentName of order) {
    try {
      store.setAgentStatus(agentName, 'processing');
      const { result, duration, mode } = await runOne(agentName, complaintText, input, startTime);
      results[agentName] = result;
      // Merge this agent's output into `input` so the next agent can consume it.
      input = { ...input, ...result };
      store.setAgentStatus(agentName, 'idle');
    } catch (err) {
      store.setAgentStatus(agentName, 'idle');
      console.error(`[Pipeline:${agentName}]`, err.message);
      // Continue pipeline with a best-effort empty result so downstream agents
      // still receive a shaped (if degraded) output instead of failing hard.
      results[agentName] = { _error: err.message, _degraded: true };
      input = { ...input, [agentName]: results[agentName] };
    }
  }

  const totalMs = Date.now() - startTime;

  res.status(200).json({
    success: true,
    pipeline: {
      complaintText,
      totalProcessingMs: totalMs,
      agentResults: results,
      // Convenience aliases matching the shape the dashboard expects
      intake: results['Intake Agent'],
      classification: results['Classification Agent'],
      severity: results['Severity Agent'],
      triage: results['Triage Agent'],
      intelligence: results['Intelligence Agent'],
      summary: results['Summary Agent'],
      modes: order.reduce((m, name) => { m[name] = effectiveMode(name); return m; }, {}),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents/:name — run a single agent
// Body: { complaintText, entities?, classification?, severity?, triage?, intelligence? }
// The body may include prior agent outputs so you can test a single agent with
// hand-crafted upstream data.
// ---------------------------------------------------------------------------
router.post('/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!AGENTS.some(a => a.name === name)) {
    return res.status(404).json({ error: `Unknown agent: ${name}. Known: ${AGENTS.map(a => a.name).join(', ')}` });
  }

  const { complaintText, entities, classification, severity, triage, intelligence } = req.body;
  if (!complaintText) {
    return res.status(400).json({ error: 'complaintText is required' });
  }

  try {
    const { result, duration, mode } = await runOne(name, complaintText, {
      entities, classification, severity, triage, intelligence,
    }, Date.now());

    res.status(200).json({
      success: true,
      agent: name,
      mode,
      durationMs: duration,
      output: result,
    });
  } catch (err) {
    console.error(`[Single:${name}]`, err.message);
    res.status(500).json({ success: false, agent: name, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/agents/:name/log — activity log for a single agent
// Returns the most recent activity entries attributed to that agent.
// ---------------------------------------------------------------------------
router.get('/:name/log', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!AGENTS.some(a => a.name === name)) {
    return res.status(404).json({ error: `Unknown agent: ${name}` });
  }

  const store = await getStore();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  let entries = await store.getActivity(limit);
  entries = entries.filter(e => e.agent === name);
  res.json({
    agent: name,
    mode: effectiveMode(name),
    count: entries.length,
    entries,
  });
});

// ---------------------------------------------------------------------------
// Utility — per-agent mock/live toggle
// Useful for testing a single agent against the real Gemini API while keeping
// the rest of the pipeline in demo mode, or vice-versa.
// ---------------------------------------------------------------------------

// POST /api/agents/:name/mode — set override: { mode: 'mock' | 'live' }
router.post('/:name/mode', express.json(), async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!AGENTS.some(a => a.name === name)) {
    return res.status(404).json({ error: `Unknown agent: ${name}` });
  }
  const { mode } = req.body;
  if (mode !== 'mock' && mode !== 'live') {
    return res.status(400).json({ error: 'mode must be "mock" or "live"' });
  }
  agentModeOverrides.set(name, mode);
  res.json({ agent: name, mode, effectiveMode: mode });
});

// DELETE /api/agents/:name/mode — remove override (revert to global MOCK_MODE)
router.delete('/:name/mode', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!AGENTS.some(a => a.name === name)) {
    return res.status(404).json({ error: `Unknown agent: ${name}` });
  }
  agentModeOverrides.delete(name);
  res.json({ agent: name, mode: 'inherited', effectiveMode: effectiveMode(name) });
});

// ---------------------------------------------------------------------------
// GET /api/agents/modes — dump the current per-agent mode overrides
// ---------------------------------------------------------------------------
router.get('/modes', async (req, res) => {
  res.json({
    global: process.env.MOCK_MODE === 'true' ? 'mock' : 'live',
    overrides: [...agentModeOverrides.entries()].map(([name, mode]) => ({ name, mode })),
  });
});

// GET /api/agents/modes/reset — clear all overrides
router.delete('/modes', async (req, res) => {
  agentModeOverrides.clear();
  res.json({ cleared: agentModeOverrides.size, global: effectiveMode('Intake Agent') });
});

module.exports = router;
