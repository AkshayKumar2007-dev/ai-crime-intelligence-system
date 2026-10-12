/* ============================================================
   Store — PostgreSQL-backed with in-memory fallback.
   All methods are async and share the same API, so callers
   work identically whether persistence is enabled or not.
   ============================================================ */
const crypto = require('crypto');
const db = require('./db');

const DEFAULT_AGENT_STATS = {
  'Intake Agent': { processed: 0, avgTime: 312, status: 'idle', color: '#00d4ff' },
  'Classification Agent': { processed: 0, avgTime: 287, status: 'idle', color: '#7b2fff' },
  'Severity Agent': { processed: 0, avgTime: 198, status: 'idle', color: '#ff8c42' },
  'Triage Agent': { processed: 0, avgTime: 341, status: 'idle', color: '#ffd60a' },
  'Intelligence Agent': { processed: 0, avgTime: 524, status: 'idle', color: '#06d6a0' },
  'Summary Agent': { processed: 0, avgTime: 445, status: 'idle', color: '#ff3b5c' },
};

const AGENT_COLORS = {};
Object.entries(DEFAULT_AGENT_STATS).forEach(([name, s]) => { AGENT_COLORS[name] = s.color; });
AGENT_COLORS['Inspector'] = '#ff00ff'; // human inspector actions — cyberpunk magenta

/* ---------- row helpers ---------- */

function normalizeJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

function rowToCase(r) {
  return {
    id: r.id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    status: r.status,
    complaintText: r.complaint_text,
    reporterName: r.reporter_name,
    reporterPhone: r.reporter_phone,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    intake: normalizeJson(r.intake),
    classification: normalizeJson(r.classification),
    severity: normalizeJson(r.severity),
    triage: normalizeJson(r.triage),
    intelligence: normalizeJson(r.intelligence),
    summary: normalizeJson(r.summary),
    agentProcessed: r.agent_processed,
    totalProcessingMs: r.total_processing_ms,
    modelVersion: r.model_version || null,
    inspectorId: r.inspector_id || null,
    inspectorNotes: normalizeJson(r.inspector_notes),
    handledAt: r.handled_at instanceof Date ? r.handled_at.toISOString() : (typeof r.handled_at === 'string' ? r.handled_at : null),
    assignedAt: r.assigned_at instanceof Date ? r.assigned_at.toISOString() : (typeof r.assigned_at === 'string' ? r.assigned_at : null),
  };
}

function rowToActivity(r) {
  return {
    id: r.id,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    agent: r.agent,
    action: r.action,
    caseId: r.case_id,
    color: r.color,
  };
}

/* ============================================================
   Store factory
   backend: { query(text, params) } for PostgreSQL, or null for
   an in-memory store (used when the DB is unreachable).
   ============================================================ */
function createStore(backend) {
  // In-memory state (used when backend is null, or as fallback on DB errors)
  const memory = {
    cases: [],
    agentActivityLog: [],
    agentStats: JSON.parse(JSON.stringify(DEFAULT_AGENT_STATS)),
    inspectors: [],
  };

  // Monotonic counters so rapid successive IDs never collide
  let inspectorIdCounter = 0;

  const fallback = (err, method) => {
    console.warn(`[Store] DB error in ${method}, using in-memory fallback: ${err.message}`);
  };

  /* ---------- Agent activity ---------- */

  async function addActivity(agent, action, caseId) {
    if (backend) {
      try {
        const r = await backend.query(
          `INSERT INTO activity_log (id, agent, action, case_id, color)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [crypto.randomUUID(), agent, action, caseId || null, AGENT_COLORS[agent] || '#00d4ff']
        );
        return rowToActivity(r.rows[0]);
      } catch (err) { fallback(err, 'addActivity'); }
    }
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      agent,
      action,
      caseId,
      color: AGENT_COLORS[agent] || '#00d4ff',
    };
    memory.agentActivityLog.unshift(entry);
    if (memory.agentActivityLog.length > 100) memory.agentActivityLog.pop();
    return entry;
  }

  async function getActivity(limit = 50) {
    if (backend) {
      try {
        const r = await backend.query(
          'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT $1',
          [parseInt(limit, 10) || 50]
        );
        return r.rows.map(rowToActivity);
      } catch (err) { fallback(err, 'getActivity'); }
    }
    return memory.agentActivityLog.slice(0, limit);
  }

  /* ---------- Agent stats ---------- */

  async function recordAgentRun(agentName, durationMs) {
    if (backend) {
      try {
        await backend.query(
          `INSERT INTO agent_stats (agent, processed, avg_time, color)
           VALUES ($1, 1, $2, $3)
           ON CONFLICT (agent) DO UPDATE SET
             processed = agent_stats.processed + 1,
             avg_time = (agent_stats.avg_time + EXCLUDED.avg_time) / 2`,
          [agentName, Math.round(durationMs), AGENT_COLORS[agentName] || '#00d4ff']
        );
        return;
      } catch (err) { fallback(err, 'recordAgentRun'); }
    }
    if (memory.agentStats[agentName]) {
      memory.agentStats[agentName].processed++;
      memory.agentStats[agentName].avgTime = Math.round(
        (memory.agentStats[agentName].avgTime + durationMs) / 2
      );
      memory.agentStats[agentName].status = 'idle';
    }
  }

  // Runtime status (idle/processing) — intentionally not persisted
  function setAgentStatus(agentName, status) {
    if (memory.agentStats[agentName]) memory.agentStats[agentName].status = status;
  }

  async function getAgentStats() {
    if (backend) {
      try {
        const r = await backend.query('SELECT agent, processed, avg_time, color FROM agent_stats');
        const stats = JSON.parse(JSON.stringify(DEFAULT_AGENT_STATS));
        r.rows.forEach(row => {
          if (stats[row.agent]) {
            stats[row.agent].processed = row.processed;
            stats[row.agent].avgTime = row.avg_time;
            if (row.color) stats[row.agent].color = row.color;
          }
        });
        return stats;
      } catch (err) { fallback(err, 'getAgentStats'); }
    }
    return memory.agentStats;
  }

  /* ---------- Cases ---------- */

  async function addCase(caseData) {
    if (backend) {
      try {
        const r = await backend.query(
          `INSERT INTO cases (
             id, created_at, status, complaint_text, reporter_name, reporter_phone,
             city, lat, lng, intake, classification, severity, triage, intelligence,
             summary, agent_processed, total_processing_ms, model_version,
             inspector_id, inspector_notes, handled_at, assigned_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           RETURNING *`,
          [
            caseData.id,
            caseData.createdAt || new Date().toISOString(),
            caseData.status || 'open',
            caseData.complaintText,
            caseData.reporterName || null,
            caseData.reporterPhone || null,
            caseData.city || null,
            caseData.lat || null,
            caseData.lng || null,
            caseData.intake ? JSON.stringify(caseData.intake) : null,
            caseData.classification ? JSON.stringify(caseData.classification) : null,
            caseData.severity ? JSON.stringify(caseData.severity) : null,
            caseData.triage ? JSON.stringify(caseData.triage) : null,
            caseData.intelligence ? JSON.stringify(caseData.intelligence) : null,
            caseData.summary ? JSON.stringify(caseData.summary) : null,
            caseData.agentProcessed !== undefined ? caseData.agentProcessed : true,
            caseData.totalProcessingMs || null,
            caseData.modelVersion || null,
            caseData.inspectorId || null,
            caseData.inspectorNotes ? JSON.stringify(caseData.inspectorNotes) : null,
            caseData.handledAt || null,
            caseData.assignedAt || null,
          ]
        );
        return rowToCase(r.rows[0]);
      } catch (err) { fallback(err, 'addCase'); }
    }
    memory.cases.unshift(caseData);
    return caseData;
  }

  async function getCaseById(id) {
    if (backend) {
      try {
        const r = await backend.query('SELECT * FROM cases WHERE id = $1', [id]);
        return r.rows.length ? rowToCase(r.rows[0]) : null;
      } catch (err) { fallback(err, 'getCaseById'); }
    }
    return memory.cases.find(c => c.id === id) || null;
  }

  async function getAllCases() {
    if (backend) {
      try {
        const r = await backend.query('SELECT * FROM cases ORDER BY created_at DESC');
        return r.rows.map(rowToCase);
      } catch (err) { fallback(err, 'getAllCases'); }
    }
    return [...memory.cases];
  }

  async function countCases() {
    if (backend) {
      try {
        const r = await backend.query('SELECT COUNT(*) AS n FROM cases');
        return parseInt(r.rows[0].n, 10) || 0;
      } catch (err) { fallback(err, 'countCases'); }
    }
    return memory.cases.length;
  }

  async function updateCaseStatus(id, status) {
    if (backend) {
      try {
        const r = await backend.query(
          'UPDATE cases SET status = $2 WHERE id = $1 RETURNING *',
          [id, status]
        );
        return r.rows.length ? rowToCase(r.rows[0]) : null;
      } catch (err) { fallback(err, 'updateCaseStatus'); }
    }
    const c = memory.cases.find(x => x.id === id);
    if (c) c.status = status;
    return c || null;
  }

  /* ---------- Dashboard stats ---------- */

  async function getDashboardStats() {
    const all = await getAllCases();
    const total = all.length;
    const open = all.filter(c => c.status === 'open').length;
    const critical = all.filter(c => c.severity?.severity_label === 'CRITICAL').length;
    const resolved = all.filter(c => c.status === 'resolved').length;
    const inProgress = all.filter(c => c.status === 'in_progress').length;

    const crimeTypeCounts = {};
    all.forEach(c => {
      const t = c.classification?.primary_type || 'Unknown';
      crimeTypeCounts[t] = (crimeTypeCounts[t] || 0) + 1;
    });

    const hourlyData = Array(24).fill(0);
    all.forEach(c => {
      const h = new Date(c.createdAt).getHours();
      if (!isNaN(h)) hourlyData[h]++;
    });

    return { total, open, critical, resolved, inProgress, crimeTypeCounts, hourlyData };
  }

  /**
   * Per-model-version classification stats: how many cases each
   * model version has classified, plus the crime types it produced.
   * Useful for comparing model versions over time.
   */
  async function getModelVersionStats() {
    const all = await getAllCases();
    const byVersion = {};
    all.forEach(c => {
      const vid = c.modelVersion || 'none';
      if (!byVersion[vid]) byVersion[vid] = { count: 0, crimeTypes: {} };
      byVersion[vid].count++;
      const t = c.classification?.primary_type || 'Unknown';
      byVersion[vid].crimeTypes[t] = (byVersion[vid].crimeTypes[t] || 0) + 1;
    });
    return byVersion;
  }

  /* ---------- ML Model registry ---------- */

  async function saveModelVersion(versionData) {
    if (backend) {
      try {
        const id = `MLV-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        await backend.query(
          `INSERT INTO model_versions (
             id, version, classes, vocab_size, n_classes, accuracy,
             train_samples, test_samples, trained_at, model_json
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            id,
            versionData.version,
            JSON.stringify(versionData.classes),
            versionData.vocabSize,
            versionData.nClasses,
            versionData.accuracy,
            versionData.trainSamples,
            versionData.testSamples,
            versionData.trainedAt ? new Date(versionData.trainedAt) : null,
            JSON.stringify(versionData.model),
          ]
        );
        return { id, ...versionData };
      } catch (err) { fallback(err, 'saveModelVersion'); }
    }
    // In-memory: keep a history array
    if (!memory.modelHistory) memory.modelHistory = [];
    const entry = {
      id: `MLV-mem-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...versionData,
    };
    memory.modelHistory.unshift(entry);
    return entry;
  }

  async function getCurrentModel() {
    if (backend) {
      try {
        const r = await backend.query(
          'SELECT * FROM model_versions ORDER BY created_at DESC LIMIT 1'
        );
        if (!r.rows.length) return null;
        const row = r.rows[0];
        return {
          id: row.id,
          version: row.version,
          classes: normalizeJson(row.classes),
          vocabSize: row.vocab_size,
          nClasses: row.n_classes,
          accuracy: row.accuracy,
          trainSamples: row.train_samples,
          testSamples: row.test_samples,
          trainedAt: row.trained_at instanceof Date ? row.trained_at.toISOString() : row.trained_at,
          model: normalizeJson(row.model_json),
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        };
      } catch (err) { fallback(err, 'getCurrentModel'); }
    }
    if (memory.modelHistory && memory.modelHistory.length) {
      const e = memory.modelHistory[0];
      return { ...e };
    }
    return null;
  }

  async function getModelHistory(limit = 20) {
    if (backend) {
      try {
        const r = await backend.query(
          'SELECT * FROM model_versions ORDER BY created_at DESC LIMIT $1',
          [limit]
        );
        return r.rows.map(row => ({
          id: row.id,
          version: row.version,
          classes: normalizeJson(row.classes),
          vocabSize: row.vocab_size,
          nClasses: row.n_classes,
          accuracy: row.accuracy,
          trainSamples: row.train_samples,
          testSamples: row.test_samples,
          trainedAt: row.trained_at instanceof Date ? row.trained_at.toISOString() : row.trained_at,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        }));
      } catch (err) { fallback(err, 'getModelHistory'); }
    }
    if (memory.modelHistory) return memory.modelHistory.slice(0, limit);
    return [];
  }

  /* ---------- Inspector management ---------- */

  async function getInspectors() {
    if (backend) {
      try {
        const r = await backend.query('SELECT * FROM inspectors WHERE active = 1 ORDER BY name');
        return r.rows.map(row => ({
          id: row.id,
          name: row.name,
          rank: row.rank,
          station: row.station,
          phone: row.phone,
          email: row.email,
          badgeNumber: row.badge_number,
          specialty: row.specialty,
          color: row.color,
          active: row.active,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        }));
      } catch (err) { fallback(err, 'getInspectors'); }
    }
    return memory.inspectors || [];
  }

  async function getInspectorById(id) {
    if (backend) {
      try {
        const r = await backend.query('SELECT * FROM inspectors WHERE id = $1', [id]);
        if (!r.rows.length) return null;
        const row = r.rows[0];
        return {
          id: row.id, name: row.name, rank: row.rank, station: row.station,
          phone: row.phone, email: row.email, badgeNumber: row.badge_number,
          specialty: row.specialty, color: row.color, active: row.active,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        };
      } catch (err) { fallback(err, 'getInspectorById'); }
    }
    return (memory.inspectors || []).find(i => i.id === id) || null;
  }

  async function assignInspectorToCase(caseId, inspectorId) {
    if (backend) {
      try {
        const now = new Date().toISOString();
        const r = await backend.query(
          `UPDATE cases SET inspector_id = $2, assigned_at = $3
           WHERE id = $1 RETURNING *`,
          [caseId, inspectorId, now]
        );
        if (!r.rows.length) return null;
        // Log activity
        await addActivity('Inspector', `Assigned to ${getInspectorById(inspectorId)?.name || 'Inspector'}`, caseId);
        return rowToCase(r.rows[0]);
      } catch (err) { fallback(err, 'assignInspectorToCase'); }
    }
    const c = memory.cases.find(x => x.id === caseId);
    if (c) {
      c.inspectorId = inspectorId;
      c.assignedAt = new Date().toISOString();
      await addActivity('Inspector', `Assigned to case`, caseId);
    }
    return c || null;
  }

  async function updateInspectorNotes(caseId, notes) {
    if (backend) {
      try {
        const r = await backend.query(
          `UPDATE cases SET inspector_notes = $2 WHERE id = $1 RETURNING *`,
          [caseId, JSON.stringify(notes)]
        );
        if (!r.rows.length) return null;
        await addActivity('Inspector', `Updated case notes`, caseId);
        return rowToCase(r.rows[0]);
      } catch (err) { fallback(err, 'updateInspectorNotes'); }
    }
    const c = memory.cases.find(x => x.id === caseId);
    if (c) {
      c.inspectorNotes = notes;
      await addActivity('Inspector', `Updated case notes`, caseId);
    }
    return c || null;
  }

  async function markCaseHandled(caseId) {
    if (backend) {
      try {
        const now = new Date().toISOString();
        const r = await backend.query(
          `UPDATE cases SET handled_at = $2 WHERE id = $1 RETURNING *`,
          [caseId, now]
        );
        if (!r.rows.length) return null;
        await addActivity('Inspector', `Case handled and closed`, caseId);
        return rowToCase(r.rows[0]);
      } catch (err) { fallback(err, 'markCaseHandled'); }
    }
    const c = memory.cases.find(x => x.id === caseId);
    if (c) {
      c.handledAt = new Date().toISOString();
      await addActivity('Inspector', `Case handled and closed`, caseId);
    }
    return c || null;
  }

  async function createInspector(inspectorData) {
    // Generate a collision-safe ID using a counter so rapid successive calls never collide
    const id = inspectorData.id || `INSP-${++ inspectorIdCounter}`;
    if (backend) {
      try {
        const r = await backend.query(
          `INSERT INTO inspectors (id, name, rank, station, phone, email, badge_number, specialty, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [id, inspectorData.name, inspectorData.rank || 'Inspector', inspectorData.station || 'Local Police Station',
           inspectorData.phone || null, inspectorData.email || null, inspectorData.badgeNumber || null,
           inspectorData.specialty || null, inspectorData.color || '#00d4ff']
        );
        const entry = {
          id: r.rows[0].id, name: r.rows[0].name, rank: r.rows[0].rank, station: r.rows[0].station,
          phone: r.rows[0].phone, email: r.rows[0].email, badgeNumber: r.rows[0].badge_number,
          specialty: r.rows[0].specialty, color: r.rows[0].color, active: 1,
          createdAt: r.rows[0].created_at instanceof Date ? r.rows[0].created_at.toISOString() : r.rows[0].created_at,
        };
        if (!memory.inspectors) memory.inspectors = [];
        memory.inspectors.push(entry);
        return entry;
      } catch (err) { fallback(err, 'createInspector'); }
    }
    const entry = { id, ...inspectorData, active: 1, createdAt: new Date().toISOString() };
    if (!memory.inspectors) memory.inspectors = [];
    memory.inspectors.push(entry);
    return entry;
  }

  /* ---------- Seeding ---------- */

  async function seedDemoData() {
    const { runIntakeAgent } = require('./agents/intakeAgent');
    const { runClassificationAgent } = require('./agents/classificationAgent');
    const { runSeverityAgent } = require('./agents/severityAgent');
    const { runTriageAgent } = require('./agents/triageAgent');
    const { runIntelligenceAgent } = require('./agents/intelligenceAgent');
    const { runSummaryAgent } = require('./agents/summaryAgent');

    const existing = await countCases();
    if (existing > 0) {
      console.log(`[Store] ${existing} cases already stored — skipping demo seed.`);
      return;
    }

    const complaints = [
      { text: "My gold chain was snatched by two men on a motorcycle near Connaught Place, Delhi yesterday evening at around 7 PM. One suspect wore a red helmet.", city: "Delhi", lat: 28.6329, lng: 77.2195 },
      { text: "I received a call from someone posing as SBI bank official asking for my OTP. I shared it and Rs 45,000 was transferred from my account. This happened this morning in Mumbai.", city: "Mumbai", lat: 19.0760, lng: 72.8777 },
      { text: "There is a dead body found near the lake in Koramangala, Bengaluru. I found it during my morning walk. No idea who it is. Please come immediately.", city: "Bengaluru", lat: 12.9352, lng: 77.6245 },
      { text: "My husband beat me again last night and threatened to kill me. I am hiding at my neighbor's house in Bandra West, Mumbai. Please help.", city: "Mumbai", lat: 19.0596, lng: 72.8295 },
      { text: "Drug peddlers are operating openly near the school in Sector 18, Noida. I have seen them exchange packets near the back gate every afternoon.", city: "Noida", lat: 28.5708, lng: 77.3219 },
      { text: "My 10-year-old daughter went missing from T Nagar market, Chennai this afternoon. She was wearing a blue dress. Please find her urgently.", city: "Chennai", lat: 13.0418, lng: 80.2341 },
      { text: "A woman was assaulted and thrown off a moving bus near Avinashi Road, Coimbatore this morning. The accused has not been identified yet. She is in stable condition at GMCH.", city: "Coimbatore", lat: 11.0019, lng: 76.9558 },
      { text: "Two men came to my shop in Lajpat Nagar, Delhi and threatened me to pay Rs 5 lakhs protection money or they will burn my shop. I have their phone number.", city: "Delhi", lat: 28.5677, lng: 77.2433 },
      { text: "A car crashed into my vehicle on Pune-Mumbai highway and the driver fled without stopping. My car is badly damaged and I have a broken arm. Need medical help.", city: "Pune", lat: 18.5204, lng: 73.8567 },
      { text: "My laptop and Rs 30,000 cash were stolen from my house in Salt Lake, Kolkata while I was away. The lock was broken. This happened between 10 AM to 4 PM today.", city: "Kolkata", lat: 22.5726, lng: 88.3639 },
      { text: "Unknown persons set fire to my car parked outside my house in Hyderabad Cyber Hub area in the early morning hours. The car is completely burnt. It seems deliberate.", city: "Hyderabad", lat: 17.4474, lng: 78.3762 },
      { text: "A man on the metro train in Delhi groped me and when I shouted he ran away. This happened at Rajiv Chowk station at rush hour. He was wearing a grey shirt.", city: "Delhi", lat: 28.6328, lng: 77.2197 },
      { text: "Online job scam — I paid Rs 80,000 advance to a company for a fake job offer. Now their website and phone are shut down. I was cheated in Bengaluru.", city: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      { text: "Large consignment of suspected narcotics is being loaded into a truck near the warehouse in Turbhe, Navi Mumbai. I can see about 10 men involved right now.", city: "Mumbai", lat: 19.0588, lng: 73.0191 },
      { text: "A neighbor's stray dog attacked my 8-year-old son in our housing society in Gurugram. The child has been bitten badly and needs medical help urgently.", city: "Gurugram", lat: 28.4595, lng: 77.0266 },
      { text: "Someone has been hacking into my company's server and stealing employee data. We discovered the breach today. The attacker seems to be accessing from outside India.", city: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      { text: "Three armed men robbed our jewelry store at MG Road, Jaipur at gunpoint this afternoon. They took gold ornaments worth Rs 15 lakhs and fled in a white SUV.", city: "Jaipur", lat: 26.9124, lng: 75.7873 },
      { text: "Man found dead at railway tracks near Churchgate station Mumbai. He appears to have been there since last night based on condition. Reporting as I spotted it.", city: "Mumbai", lat: 18.9322, lng: 72.8264 },
      { text: "I have been receiving threatening calls from unknown number demanding money. They say they know where I live and will harm my family if I don't pay. Lucknow.", city: "Lucknow", lat: 26.8467, lng: 80.9462 },
      { text: "Someone stole my e-scooter from the parking lot near Juhu Beach, Mumbai. I had a GPS tracker on it — last signal was near Andheri East. Please help retrieve.", city: "Mumbai", lat: 19.1075, lng: 72.8263 },
      { text: "My elderly mother was tricked into signing property documents by our distant relative. She didn't understand what she was signing. This is property fraud in Ahmedabad.", city: "Ahmedabad", lat: 23.0225, lng: 72.5714 },
      { text: "A 21-year-old woman was abducted from her workplace in Perambur, Chennai last night. Her family received a ransom call of Rs 20 lakhs. Police have not traced her so far. She works at a textile showroom.", city: "Chennai", lat: 13.0745, lng: 80.2209 },
      { text: "Suspected drug peddlers are selling ganja and RDX tablets near PSG Tech bus stop in Peelamedu, Coimbatore. Students are being targeted. I have seen at least 5 boys selling near the college gates daily.", city: "Coimbatore", lat: 11.0028, lng: 77.0664 },
      { text: "A shopkeeper was murdered inside his textile shop on Ritchie Street, Chennai at night. The shop was locked from outside and the body was found this morning by the watchman. There are no witnesses. The safe was also emptied.", city: "Chennai", lat: 13.0828, lng: 80.2692 },
      { text: "A speeding car hit a vegetable vendor and fled on Trichy Main Road near Thoothukudi junction. The vendor is in critical condition with leg amputated. The truck driver disappeared into the dark. This happened at 11 PM last night.", city: "Thoothukudi", lat: 8.7641, lng: 78.1328 },
      { text: "A bride was harassed for dowry and beaten by her husband and in-laws in Madurai. She was thrown out of the house on the third day of marriage. She has severe injuries on her face and arms. She is staying at her parents home now.", city: "Madurai", lat: 9.9157, lng: 78.1193 },
      { text: "A cyber fraud call center is operating from a rented house in T Nepal Nagar, Coimbatore. They are making fake customer care calls and cheating people of their bank details. I have recorded some conversations. Around 15 people work there.", city: "Coimbatore", lat: 11.0028, lng: 76.9632 },
      { text: "A young woman was molested by a group of men at the Karaikudi bus stand while she was returning from college. They took photos and threatened her when she resisted. She is traumatized and refuses to come out of her house now. The incident happened last evening.", city: "Karaikudi", lat: 10.4750, lng: 78.7711 },
      { text: "A fire broke out in a warehouse storing chemicals and textiles near SIPCOT industrial zone in Guindy, Chennai early this morning. Firefighters took 3 hours to control it. The cause is unknown but it looks suspicious as there were no fire safety equipment.", city: "Chennai", lat: 13.0142, lng: 80.2085 },
      { text: "An agricultural lime merchant is being extorted by a local gang in Salem. They are demanding Rs 3 lakhs every month or they will burn his warehouse. He has been paying for the last 3 months out of fear. He wants to file a complaint now. He is from surrounding areas of Salem town.", city: "Salem", lat: 11.6584, lng: 78.1588 },
      { text: "My husband went missing from our home in Tiruchirappalli last night after an argument. His phone is switched off and his vehicle was found parked near the railway station. I have no idea where he is.", city: "Tiruchirappalli", lat: 10.7903, lng: 78.7000 },
      { text: "A gang of four men broke into my jewellery shop in Tirunelveli night market and took gold ornaments worth Rs 8 lakhs. They cut the power supply before breaking in. CCTV shows two faces clearly.", city: "Tirunelveli", lat: 8.7242, lng: 77.4216 },
      { text: "I was stalked and harassed by a man on my way back from college in Vellore. He followed me for two kilometers, kept calling my phone, and tried to touch me near the bus stop. I filed a complaint but no action yet.", city: "Vellore", lat: 12.9267, lng: 79.1440 },
      { text: "My textile factory in Erode is being extorted by a local group who threatened to kill my workers if I don't pay Rs 2 lakhs weekly. They have been watching the gate for a week. I am scared to send my staff.", city: "Erode", lat: 11.3402, lng: 77.0137 },
      { text: "A 16-year-old girl from Thanjavur went missing after attending a festival. Her family says she was last seen talking to a group of boys near the bus stand. Police have not responded despite multiple complaints.", city: "Thanjavur", lat: 10.7895, lng: 79.1320 },
      { text: "I was drugged and robbed at a bar in Dindigul last night. Two men spiked my drink, stole my phone and wallet with Rs 50,000 inside. When I woke up I was on the roadside with a broken arm.", city: "Dindigul", lat: 10.3678, lng: 78.0858 },
      { text: "A baby was found abandoned in a trash bin near the railway station in Nagercoil this morning. The baby is alive but badly injured. No one knows who the mother is or why this happened.", city: "Nagercoil", lat: 8.1854, lng: 77.2933 },
      { text: "Someone has been sending threatening messages to my wife through WhatsApp for the past two weeks. They claim they know where we live and will come to harm us if we don't pay Rs 1 lakh. We live in Hosur.", city: "Hosur", lat: 12.1507, lng: 78.9733 },
      { text: "A fight between two groups in a Kovai pub turned violent and one person was stabbed in the chest. He is in ICU at Gopal Singh Hospital. Police say it was over a personal dispute but witnesses say there was betting involved.", city: "Coimbatore", lat: 11.0028, lng: 76.9800 },
      { text: "I received an SMS saying my Aadhaar has been suspended and I must call a number immediately to reactivate it. I called and they asked for my OTP and OTP was used to open a loan of Rs 3 lakhs in my name. This is identity theft and I am in Chennai.", city: "Chennai", lat: 13.0800, lng: 80.2700 },
    ];

    // ── Generate 500 additional Tamil Nadu cases using narrative templates ──
    const tnCities = [
      { name: 'Chennai',        lat: 13.0827, lng: 80.2707, pop: 91 },
      { name: 'Coimbatore',     lat: 11.0028, lng: 76.9626, pop: 29 },
      { name: 'Madurai',        lat:  9.9157, lng: 78.1193, pop: 24 },
      { name: 'Tiruchirappalli', lat: 10.7903, lng: 78.7000, pop: 18 },
      { name: 'Salem',          lat: 11.6584, lng: 78.1588, pop: 17 },
      { name: 'Thoothukudi',    lat:  8.7641, lng: 78.1328, pop: 14 },
      { name: 'Thanjavur',      lat: 10.7895, lng: 79.1320, pop: 12 },
      { name: 'Erode',          lat: 11.3402, lng: 77.0137, pop: 11 },
      { name: 'Vellore',        lat: 12.9267, lng: 79.1440, pop: 10 },
      { name: 'Tirunelveli',    lat:  8.7242, lng: 77.4216, pop:  9 },
      { name: 'Karaikudi',      lat: 10.4750, lng: 78.7711, pop:  7 },
      { name: 'Dindigul',       lat: 10.3678, lng: 78.0858, pop:  6 },
      { name: 'Nagercoil',      lat:  8.1854, lng: 77.2933, pop:  5 },
      { name: 'Hosur',          lat: 12.1507, lng: 78.9733, pop:  5 },
    ];
    const crimeTemplates = [
      { type: 'theft',   tmpl: 'My %s was stolen from my %s in %s %s. The scene was disturbed and I have filed a complaint at the local police station.' },
      { type: 'assault', tmpl: 'I was assaulted by %s in %s, %s. %s. I was injured and need medical attention. The accused has not been arrested yet.' },
      { type: 'fraud',   tmpl: 'I was cheated of Rs %s by %s in %s. %s. I have all the transaction records and screenshots as evidence.' },
      { type: 'cybercrime', tmpl: 'Someone hacked my %s account and %s. This happened in %s. I have reported this to the cyber crime cell but no action yet.' },
      { type: 'drugs',   tmpl: 'Suspected drug peddlers are selling narcotics near %s in %s. I have seen at least %s people involved %s. This is an ongoing operation.' },
      { type: 'kidnapping', tmpl: 'My %s was abducted from %s in %s %s. The family received a ransom call demanding Rs %s. Police have been informed but no breakthrough yet.' },
      { type: 'murder',  tmpl: 'A body was found %s in %s, %s. The victim appears to have been %s. This seems like a homicide and we request immediate investigation.' },
      { type: 'hitrun',  tmpl: 'A %s hit and ran over a %s near %s in %s %s. The victim is in %s. The vehicle number was partially visible and the driver fled %s.' },
      { type: 'dv',      tmpl: 'I am being subjected to domestic violence by my %s at our home in %s, %s. %s. I am afraid for my life and need police protection.' },
      { type: 'arson',   tmpl: 'A fire broke out at %s in %s %s. The fire destroyed %s. This appears to be deliberate arson as %s. Firefighters took %s to control it.' },
      { type: 'harassment', tmpl: 'I was sexually harassed by %s at %s in %s %s. %s. I am traumatized and have filed a formal complaint.' },
      { type: 'extortion', tmpl: 'I am being extorted by %s in %s. They are demanding Rs %s %s. They have threatened to %s if I do not pay. I have been paying for %s out of fear.' },
      { type: 'general', tmpl: 'A suspicious incident occurred at %s in %s %s. %s. I am reporting this so that police can investigate and prevent any crime.' },
    ];
    const theftItems     = ['gold chain', 'mobile phone', 'laptop', 'bicycle', 'cash Rs 20,000', 'jewellery box', 'e-scooter', 'fridge', 'washing machine', 'LED TV', 'tablet', 'watch', 'wallet with cards', 'motorcycle', 'car keys'];
    const theftPlaces    = ['house', 'shop', 'office', 'parking lot', 'bus stop', 'train', 'market', 'garage', 'lift', 'college canteen'];
    const assaultPlaces  = ['street', 'market', 'bus stop', 'colony', 'office', 'pub', 'park', 'road', 'mosque', 'temple'];
    const assaultBy      = ['a group of men', 'two men', 'a man', 'three youths', 'a neighbor', 'unknown persons', 'a drunkard', 'a rowdy', 'a rival', 'some boys'];
    const assaultDesc    = ['I was beaten with a stick', 'I was pushed and fell', 'I was hit with a stone', 'I was slapped and kicked', 'I was threatened with a knife', 'I was chased and attacked', 'I was beaten in front of my family', 'I was attacked from behind', 'I was punched several times', 'I was dragged by my hair'];
    const fraudMethods   = ['a fake bank call', 'a phishing link', 'a fake job offer', 'a lottery scam', 'a relationship fraud', 'a rental scam', 'a fake police call', 'an ATM skimmer', 'a crypto investment fraud', 'a KYC update scam'];
    const fraudAmounts   = ['Rs 50,000', 'Rs 3 lakhs', 'Rs 1.5 lakhs', 'Rs 80,000', 'Rs 2.5 lakhs', 'Rs 75,000', 'Rs 40,000', 'Rs 10 lakhs', 'Rs 20,000', 'Rs 60,000'];
    const cyberActions   = ['stole my data', 'took money from my account', 'blocked my profile', 'impersonated me', 'sent threatening messages from my account', 'opened a loan in my name', 'accessed my photos', 'changed my password'];
    const drugLocations  = ['the bus stand', 'the college gate', 'the market', 'the park', 'the railway station', 'the slum area', 'a rented house', 'behind the temple', 'a tea shop', 'a abandoned building'];
    const drugDesc       = ['selling ganja and tablets', 'distributing drugs to students', 'operating a drug ring', 'dealing in ganja', 'selling tablets near school', 'running a narco network'];
    const kidnapRel      = ['daughter', 'son', 'wife', 'sister', 'niece', 'cousin', 'employee', 'house helper'];
    const kidnapWhere    = ['her workplace', 'his school', 'our home', 'the market', 'a bus stop', 'the railway station', 'a relative\'s house'];
    const murderWhere    = ['near the lake', 'inside a shop', 'at the bus stand', 'on the railway tracks', 'in a abandoned building', 'near the market', 'in a car', 'at the park', 'near the temple', 'on the highway'];
    const murderHow      = ['stabbed', 'beaten to death', 'shot', 'strangled', 'poisoned', 'hanged', 'thrown from a building', 'run over'];
    const vehicleDesc    = ['car', 'truck', 'bike', 'auto', 'van', 'SUV', 'tempo', 'bus', 'taxi', 'tractor'];
    const victimDesc     = ['pedestrian', 'cyclist', 'two-wheeler rider', 'shopkeeper', 'student', 'vendor', 'elderly person', 'child', 'woman', 'daily wage worker'];
    const injuryDesc     = ['the victim is in critical condition', 'the victim is hospitalized with broken bones', 'the victim lost a leg', 'the victim is in ICU', 'the victim suffered head injuries', 'the victim is on ventilator', 'the victim is stable but serious', 'the victim died on the spot'];
    const dvDesc         = ['he beats me every night', 'he has threatened to kill me', 'he locks me inside the house', 'he takes away my phone', 'he has not given me food for days', 'he beats the children too', 'he has thrown me out of the house', 'he is demanding more dowry', 'he drinks and abuses me', 'he has cut my hair'];
    const arsonWhere     = ['our factory', 'a godown', 'a shop', 'our house', 'a warehouse', 'a warehouse storing chemicals', 'a textile shop', 'a political office', 'a rival\'s property', 'a vacant plot'];
    const arsonWhat     = ['all our inventory', 'the entire building', 'the shop and its contents', 'the house and vehicles', 'chemicals and textiles', 'documents and cash', 'the office equipment', 'the stock worth crores', 'the furniture and electronics', 'the stored grain'];
    const arsonWhy       = ['there was no accident', 'it was set deliberately', 'neighbours saw a person pouring petrol', 'the fire started in multiple places', 'it was an act of revenge', 'someone had a grudge against the owner'];
    const arsonTime     = ['3 hours', '2 hours', '4 hours', '5 hours', '6 hours', 'an hour'];
    const harassWhere    = ['the bus stop', 'my workplace', 'the college', 'the market', 'the park', 'the street', 'the metro station', 'the lift', 'my colony', 'the railway station'];
    const harassWho     = ['a man', 'a group of men', 'a co-worker', 'a neighbor', 'a stranger', 'a relative', 'a shopkeeper', 'a driver', 'a security guard', 'a college senior'];
    const harassDesc     = ['he touched me inappropriately', 'he followed me for 2 kilometers', 'he took my photos without consent', 'he sent me obscene messages', 'he threatened to share my photos', 'he tried to kidnap me', 'he molested me in public', 'he blackmailed me', 'he made lewd comments', 'he cornered me in the lift'];
    const extortWho     = ['a local gang', 'a criminal group', 'a rival businessman', 'a gang of rowdies', 'a political group', 'a group of youths', 'an organized syndicate'];
    const extortWhy     = ['or they will burn my shop', 'or they will kill my family', 'or they will harm my children', 'or they will destroy my business', 'or they will expose my secrets', 'or they will attack my workers'];
    const extortHowLong = ['for the last 3 months', 'for the last 2 months', 'for the last 6 months', 'for the last month', 'for the last 4 months', 'since last year'];
    const generalPlaces = ['the market', 'the railway station', 'the bus stand', 'our colony', 'the park', 'the school', 'the hospital', 'the temple', 'the mosque', 'the commercial street'];
    const generalDesc   = ['I saw a suspicious person loitering', 'I noticed a fire hazard', 'I heard unusual sounds', 'I saw a suspicious vehicle', 'I noticed drugs being sold', 'I am reporting a lost item', 'I want to report a missing person', 'I saw a theft happening', 'I found a suspicious object', 'I want to report a suspicious activity'];
    const streets = ['T Nagar', 'Anna Nagar', 'Vadapalani', 'Ashok Nagar', 'Mylapore', 'Adyar', 'T. Nagar', 'Kilpauk', 'Valasaravakkam', 'Padi', 'Peelamedu', 'RS Purana'];
    const suffixes = ['this morning', 'last night', 'yesterday afternoon', 'this evening', 'last week', 'two days ago', 'yesterday morning', 'last evening', 'this afternoon', 'a day ago'];

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function pad(lat, lng, jitter) { return { lat: lat + (Math.random() - 0.5) * jitter, lng: lng + (Math.random() - 0.5) * jitter }; }

    for (let i = 0; i < 500; i++) {
      // Weighted city selection by population
      const totalPop = tnCities.reduce((s, c) => s + c.pop, 0);
      let r = Math.random() * totalPop, cityIdx = tnCities.length - 1;
      for (let k = 0; k < tnCities.length; k++) { r -= tnCities[k].pop; if (r <= 0) { cityIdx = k; break; } }
      const city = tnCities[cityIdx];
      const crime = crimeTemplates[Math.floor(Math.random() * crimeTemplates.length)];
      const locJitter = city.name === 'Chennai' ? 0.04 : city.name === 'Coimbatore' ? 0.03 : 0.06;
      const coords = pad(city.lat, city.lng, locJitter);
      const suffix = pick(suffixes);
      const street = pick(streets);
      let text;
      switch (crime.type) {
        case 'theft':
          text = `My ${pick(theftItems)} was stolen from my ${pick(theftPlaces)} in ${street}, ${city.name} ${suffix}. The scene was disturbed and I have filed a complaint at the local police station.`;
          break;
        case 'assault':
          text = `I was assaulted by ${pick(assaultBy)} in ${city.name} ${suffix}. ${pick(assaultDesc)}. I was injured and need medical attention. The accused has not been arrested yet.`;
          break;
        case 'fraud':
          text = `I was cheated of ${pick(fraudAmounts)} by ${pick(fraudMethods)} in ${city.name} ${suffix}. I have all the transaction records and screenshots as evidence. The accused is ${pick(['still contacting me', 'blocking my number', 'threatening me if I report', 'pretending to be a police officer', 'using a fake identity', 'part of a larger network', 'operating from a different city', 'using multiple SIM cards'])}.`;
          break;
        case 'cybercrime':
          text = `Someone hacked my ${pick(['bank account', 'email', 'social media', 'UPI', 'paytm', 'government portal', 'company server', 'cloud storage', 'trading account', 'Aadhaar-linked account'])} and ${pick(cyberActions)} ${suffix} in ${city.name}. I have reported this to the cyber crime cell but no action yet.`;
          break;
        case 'drugs':
          text = `Suspected drug peddlers are ${pick(drugDesc)} near ${pick(drugLocations)} in ${city.name} ${suffix}. I have seen at least ${pick([2,3,4,5,6,8,10,'a dozen'])} people involved ${pick(['daily', 'every evening', 'on weekends', 'during school hours', 'after 10 PM', 'in the afternoon', 'throughout the day', 'in the early morning'])}. This is an ongoing operation.`;
          break;
        case 'kidnapping':
          text = `My ${pick(kidnapRel)} was abducted from ${pick(kidnapWhere)} in ${city.name} ${suffix}. The family received a ransom call demanding ${pick(fraudAmounts)}. Police have been informed but no breakthrough yet. The victim was ${pick(['wearing a blue dress', 'carrying a school bag', 'on a two-wheeler', 'walking alone', 'with a friend', 'at work', 'on their way home'])}.`;
          break;
        case 'murder':
          text = `A body was found ${pick(murderWhere)} in ${city.name} ${suffix}. The victim appears to have been ${pick(murderHow)}. This seems like a homicide and we request immediate investigation. ${pick(['The victim was identified as a shopkeeper', 'The body was found by a passerby', 'Police have cordoned off the area', 'Witnesses say they heard a scream', 'The victim was found with injury marks', 'The body was sent for autopsy', 'Police are questioning locals', 'CCTV footage is being examined', 'The victim was a daily wage worker', 'The victim was a student'])}.`;
          break;
        case 'hitrun':
          text = `A ${pick(vehicleDesc)} hit and ran over a ${pick(victimDesc)} near ${pick([...streets, 'the railway crossing', 'the market crossing', 'the school gate', 'the bus stop', 'the signal', 'the flyover', 'the hospital entrance', 'the temple street', 'the main road'])} in ${city.name} ${suffix}. ${pick(injuryDesc)}. The vehicle number was partially visible and the driver fled ${pick(['in the opposite direction', 'through the bypass', 'into a narrow lane', 'towards the highway', 'into the crowded market', 'without stopping', 'towards the city center', 'towards the outskirts'])}.`;
          break;
        case 'dv':
          text = `I am being subjected to domestic violence by my ${pick(['husband', 'father-in-law', 'mother-in-law', 'brother', 'sister-in-law', 'uncle'])} at our home in ${street}, ${city.name} ${suffix}. ${pick(dvDesc)}. I am afraid for my life and need police protection.`;
          break;
        case 'arson':
          text = `A fire broke out at ${pick(arsonWhere)} in ${city.name} ${suffix}. The fire destroyed ${pick(arsonWhat)}. This appears to be deliberate arson as ${pick(arsonWhy)}. Firefighters took ${pick(arsonTime)} to control it.`;
          break;
        case 'harassment':
          text = `I was sexually harassed by ${pick(harassWho)} at ${pick(harassWhere)} in ${city.name} ${suffix}. ${pick(harassDesc)}. I am traumatized and have filed a formal complaint.`;
          break;
        case 'extortion':
          text = `I am being extorted by ${pick(extortWho)} in ${city.name} ${suffix}. They are demanding ${pick(fraudAmounts)} ${pick(['every month', 'every week', 'once', 'in total', 'as protection money', 'for silence', 'to stop threatening me', 'as a one-time payment', 'to leave us alone', 'or else'])}. ${pick(extortWhy)}. I have been paying ${pick(extortHowLong)} out of fear.`;
          break;
        default:
          text = `A suspicious incident occurred at ${pick(generalPlaces)} in ${city.name} ${suffix}. ${pick(generalDesc)}. I am reporting this so that police can investigate and prevent any crime.`;
          break;
      }
      complaints.push({
        text,
        city: city.name,
        lat: coords.lat,
        lng: coords.lng,
      });
    }

    // Keep only Tamil Nadu cases — drop any non-TN entries (e.g. hand-written
    // complaints from Delhi, Mumbai, Bengaluru, etc.) so the dataset is TN-only.
    const tnCityNames = new Set(tnCities.map(c => c.name));
    const beforeCount = complaints.length;
    const tnOnly = complaints.filter(c => tnCityNames.has(c.city));
    complaints.length = 0;
    complaints.push(...tnOnly);
    console.log(`[Seed] Filtered to ${complaints.length}/${beforeCount} Tamil Nadu cases.`);


    // Resolve inspector list for assignment
    const inspectorList = memory.inspectors || [];

    const statuses = ['open', 'open', 'open', 'in_progress', 'in_progress', 'resolved'];

    // Process complaints in batches to keep concurrency bounded.
    // Bulk demo seeding runs through the FAST path (ML model + mock) even in
    // LIVE mode, so 500+ cases seed in minutes instead of hours (each LIVE
    // case fires ~5 Gemini calls). Real complaint submissions still use Gemini.
    const prevMockMode = process.env.MOCK_MODE;
    process.env.MOCK_MODE = 'true';
    try {
    const BATCH_SIZE = 3;
    let seeded = 0;
    for (let batchStart = 0; batchStart < complaints.length; batchStart += BATCH_SIZE) {
      const batch = complaints.slice(batchStart, batchStart + BATCH_SIZE);
      console.log(`[Seed] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(complaints.length / BATCH_SIZE)}: cases ${batchStart + 1}-${Math.min(batchStart + BATCH_SIZE, complaints.length)}`);
      const results = await Promise.allSettled(
        batch.map((c, bi) => {
          const i = batchStart + bi;
          return (async () => {
            const intake = await runIntakeAgent(c.text);
            const { classification, modelVersion } = await runClassificationAgent(c.text, intake);
            const severity = await runSeverityAgent(c.text, intake, classification);
            const triage = await runTriageAgent(c.text, intake, classification, severity);
            const intelligence = await runIntelligenceAgent(c.text, intake, classification, severity);
            const summary = await runSummaryAgent(c.text, intake, classification, severity, triage, intelligence);

            const hoursAgo = Math.floor(Math.random() * 72);
            const createdAt = new Date(Date.now() - hoursAgo * 3600000).toISOString();
            const id = `CID-2024-${String(1000 + i).padStart(4, '0')}`;

            // Assign inspector by matching the case city to an inspector's station
            const districtInspector = inspectorList.find(i =>
              i.station && c.city && i.station.toLowerCase().includes(c.city.toLowerCase())
            );
            const assignedInspector = districtInspector ? districtInspector.id : (inspectorList[i % inspectorList.length]?.id || null);

            await addCase({
              id, createdAt,
              status: statuses[Math.floor(Math.random() * statuses.length)],
              complaintText: c.text, city: c.city,
              lat: c.lat + (Math.random() - 0.5) * 0.05,
              lng: c.lng + (Math.random() - 0.5) * 0.05,
              intake, classification, severity, triage, intelligence, summary,
              agentProcessed: true, modelVersion: modelVersion || null,
              inspectorId: assignedInspector,
              assignedAt: assignedInspector ? new Date(Date.now() - Math.floor(Math.random() * 48) * 3600000).toISOString() : null,
              inspectorNotes: assignedInspector ? `Case received and reviewed. ${['Visiting scene to collect evidence.', 'Interviewed witnesses at the spot.', 'Coordinating with forensic team for sample collection.', 'Monitoring CCTV footage from nearby cameras.', 'Contacted the complainant for further details.', ''][i % 6]}` : null,
            });

            await addActivity('Intake Agent', `Processed case ${1000 + i}`, id);
            await addActivity('Classification Agent', `Classified as ${classification?.primary_type}`, id);
            await addActivity('Severity Agent', `Severity: ${severity?.severity_label} (${severity?.severity_score}/10)`, id);
            await addActivity('Triage Agent', `Routed to ${triage?.department?.split('(')[0].trim()}`, id);
            await addActivity('Intelligence Agent', `Risk: ${intelligence?.geo_risk_level} Zone`, id);
            await addActivity('Summary Agent', `Briefing generated for ${summary?.case_title}`, id);
            if (assignedInspector) {
              const insp = inspectorList.find(i => i.id === assignedInspector);
              await addActivity('Inspector', `${insp?.name || 'Inspector'} assigned to this case`, id);
            }
            seeded++;
          })();
        })
      );
      let rej = 0;
      results.forEach(r => { if (r.status === 'rejected') rej++; });
      console.log(`[Seed] Batch done: ${results.length - rej}/${results.length} succeeded, ${rej} failed`);
    }

    if (seeded > 0) await bumpProcessedCounts(seeded);
    console.log(`[Store] Seeded ${seeded} demo cases (fast path).`);
    } finally {
      process.env.MOCK_MODE = prevMockMode; // restore LIVE mode for real submissions
    }
  }

  async function bumpProcessedCounts(n) {
    if (!backend) {
      Object.keys(memory.agentStats).forEach(a => { memory.agentStats[a].processed += n; });
      return;
    }
    try {
      for (const [name, s] of Object.entries(DEFAULT_AGENT_STATS)) {
        await backend.query(
          `INSERT INTO agent_stats (agent, processed, avg_time, color)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent) DO UPDATE SET
             processed = agent_stats.processed + $2`,
          [name, n, s.avgTime, s.color]
        );
      }
    } catch (err) { fallback(err, 'bumpProcessedCounts'); }
  }

  function generateId() {
    const year = new Date().getFullYear();
    return `CID-${year}-${crypto.randomBytes(4).toString('hex')}`;
  }

  return {
    addActivity,
    getActivity,
    recordAgentRun,
    setAgentStatus,
    getAgentStats,
    addCase,
    getCaseById,
    getAllCases,
    countCases,
    updateCaseStatus,
    getDashboardStats,
    seedDemoData,
    generateId,
    saveModelVersion,
    getCurrentModel,
    getModelHistory,
    getModelVersionStats,
    getInspectors,
    getInspectorById,
    assignInspectorToCase,
    updateInspectorNotes,
    markCaseHandled,
    createInspector,
    isPersistent: () => !!backend,
  };
}

/* ============================================================
   Lazy singleton — resolves the backend once at first use so
   routes can call getStore() at any time.
   ============================================================ */
let instancePromise = null;

function getStore() {
  if (!instancePromise) {
    instancePromise = (async () => {
      const ok = await db.init();
      return createStore(ok ? db : null);
    })();
  }
  return instancePromise;
}

module.exports = { createStore, getStore, DEFAULT_AGENT_STATS };