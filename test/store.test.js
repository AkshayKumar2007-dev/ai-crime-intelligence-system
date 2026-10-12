/* ============================================================
   Store tests — run the SQL against pg-mem (in-memory Postgres
   emulation) to verify the schema and all store operations
   without needing a live PostgreSQL server.

   Run with: npm test
   ============================================================ */
const { test } = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { createStore, DEFAULT_AGENT_STATS } = require('../server/store');
const { SCHEMA } = require('../server/db');

function createPgBackend() {
  const memDb = newDb();
  const pg = memDb.adapters.createPg();
  const pool = new pg.Pool();
  return {
    query: (text, params) => pool.query(text, params),
    pool,
  };
}

async function createDbStore() {
  const backend = createPgBackend();
  // Apply schema one statement at a time (pg-mem safe)
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
    await backend.query(stmt);
  }
  return createStore(backend);
}

const SAMPLE_CASE = {
  id: 'CID-2024-9999',
  createdAt: '2026-09-05T10:00:00.000Z',
  status: 'open',
  complaintText: 'A gold chain was snatched near Connaught Place.',
  reporterName: 'Test User',
  reporterPhone: '+91 99999 99999',
  city: 'Delhi',
  lat: 28.6329,
  lng: 77.2195,
  intake: { entities: { city: 'Delhi' }, incident_summary: 'Chain snatching' },
  classification: { primary_type: 'Theft', subcategory: 'Street Robbery', ipc_sections: ['379'] },
  severity: { severity_label: 'CRITICAL', severity_score: 9, sla_hours: 1 },
  triage: { department: 'Local Police Station', priority_queue: 'IMMEDIATE' },
  intelligence: { geo_risk_level: 'RED', repeat_offender_likelihood: 0.8 },
  summary: { case_title: 'CRITICAL Theft — Immediate Review Required' },
  agentProcessed: true,
  totalProcessingMs: 2699,
};

test('activity log round-trips through PostgreSQL', async () => {
  const store = await createDbStore();
  const entry = await store.addActivity('Intake Agent', 'Starting intake', 'CID-1');
  assert.ok(entry.id);
  assert.strictEqual(entry.agent, 'Intake Agent');
  assert.strictEqual(entry.caseId, 'CID-1');
  assert.strictEqual(entry.color, '#00d4ff');

  const feed = await store.getActivity(10);
  assert.strictEqual(feed.length, 1);
  assert.strictEqual(feed[0].action, 'Starting intake');
  assert.strictEqual(typeof feed[0].timestamp, 'string');
  assert.ok(!isNaN(new Date(feed[0].timestamp).getTime()));
});

test('activity log is ordered newest-first with limit', async () => {
  const store = await createDbStore();
  for (let i = 1; i <= 5; i++) {
    await store.addActivity('Agent', `action ${i}`, `CID-${i}`);
  }
  const feed = await store.getActivity(3);
  assert.strictEqual(feed.length, 3);
  assert.strictEqual(feed[0].action, 'action 5');
  assert.strictEqual(feed[2].action, 'action 3');
});

test('recordAgentRun upserts agent stats (processed, avg time)', async () => {
  const store = await createDbStore();
  await store.recordAgentRun('Intake Agent', 400);
  await store.recordAgentRun('Intake Agent', 600);

  const stats = await store.getAgentStats();
  assert.strictEqual(stats['Intake Agent'].processed, 2);
  assert.strictEqual(stats['Intake Agent'].avgTime, 500); // (400 + 600) / 2
  // Other agents keep their defaults
  assert.strictEqual(stats['Summary Agent'].processed, 0);
  assert.strictEqual(stats['Summary Agent'].color, '#ff3b5c');
  assert.strictEqual(Object.keys(stats).length, 6);
});

test('addCase / getCaseById round-trip JSONB agent outputs', async () => {
  const store = await createDbStore();
  await store.addCase(SAMPLE_CASE);

  const c = await store.getCaseById('CID-2024-9999');
  assert.ok(c);
  assert.strictEqual(c.complaintText, SAMPLE_CASE.complaintText);
  assert.strictEqual(c.classification.primary_type, 'Theft');
  assert.deepStrictEqual(c.classification.ipc_sections, ['379']);
  assert.strictEqual(c.severity.severity_label, 'CRITICAL');
  assert.strictEqual(c.intelligence.geo_risk_level, 'RED');
  assert.strictEqual(c.summary.case_title, 'CRITICAL Theft — Immediate Review Required');
  assert.strictEqual(c.totalProcessingMs, 2699);
  assert.strictEqual(typeof c.createdAt, 'string');

  const missing = await store.getCaseById('CID-NOPE');
  assert.strictEqual(missing, null);
});

test('getAllCases returns all cases newest-first; countCases works', async () => {
  const store = await createDbStore();
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-1', createdAt: '2026-09-04T10:00:00.000Z' });
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-2', createdAt: '2026-09-05T10:00:00.000Z' });

  const all = await store.getAllCases();
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].id, 'CID-2'); // newest first
  assert.strictEqual(await store.countCases(), 2);
});

test('updateCaseStatus persists and returns the updated case', async () => {
  const store = await createDbStore();
  await store.addCase(SAMPLE_CASE);

  const updated = await store.updateCaseStatus('CID-2024-9999', 'in_progress');
  assert.strictEqual(updated.status, 'in_progress');
  assert.strictEqual(updated.id, 'CID-2024-9999');

  const again = await store.getCaseById('CID-2024-9999');
  assert.strictEqual(again.status, 'in_progress');
});

test('getDashboardStats aggregates severity/status/crime types', async () => {
  const store = await createDbStore();
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-1', status: 'open', createdAt: '2026-09-05T10:00:00.000Z' });
  await store.addCase({
    ...SAMPLE_CASE,
    id: 'CID-2',
    status: 'resolved',
    createdAt: '2026-09-05T12:00:00.000Z',
    classification: { primary_type: 'Cybercrime', subcategory: 'Online Fraud', ipc_sections: ['66D'] },
    severity: { severity_label: 'MEDIUM', severity_score: 5, sla_hours: 24 },
  });

  const stats = await store.getDashboardStats();
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.open, 1);
  assert.strictEqual(stats.resolved, 1);
  assert.strictEqual(stats.critical, 1); // CID-1 is CRITICAL
  assert.deepStrictEqual(stats.crimeTypeCounts, { Theft: 1, Cybercrime: 1 });
  assert.strictEqual(stats.hourlyData.length, 24);
  // hourly buckets use the server's local timezone
  const h1 = new Date('2026-09-05T10:00:00.000Z').getHours();
  const h2 = new Date('2026-09-05T12:00:00.000Z').getHours();
  assert.strictEqual(stats.hourlyData[h1], 1);
  assert.strictEqual(stats.hourlyData[h2], 1);
});

test('seedDemoData skips when cases already exist', async () => {
  const store = await createDbStore();
  await store.addCase(SAMPLE_CASE);
  const before = await store.countCases();
  // Would run the 6-agent pipeline if it didn't guard — must return early
  await store.seedDemoData();
  const after = await store.countCases();
  assert.strictEqual(before, 1);
  assert.strictEqual(after, 1);
});

test('in-memory fallback store exposes the same API', async () => {
  const store = createStore(null);
  assert.strictEqual(store.isPersistent(), false);

  await store.addActivity('Severity Agent', 'Assessing severity', 'CID-1');
  const feed = await store.getActivity(10);
  assert.strictEqual(feed.length, 1);

  await store.recordAgentRun('Severity Agent', 200);
  const stats = await store.getAgentStats();
  assert.strictEqual(stats['Severity Agent'].processed, 1);

  await store.addCase(SAMPLE_CASE);
  assert.strictEqual((await store.getCaseById('CID-2024-9999')).city, 'Delhi');
  await store.updateCaseStatus('CID-2024-9999', 'closed');
  assert.strictEqual((await store.getCaseById('CID-2024-9999')).status, 'closed');

  const dash = await store.getDashboardStats();
  assert.strictEqual(dash.total, 1);
  assert.strictEqual(dash.critical, 1);
});

test('generateId produces unique, well-formed ids', async () => {
  const store = createStore(null);
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(store.generateId());
  assert.strictEqual(ids.size, 50);
  [...ids].forEach(id => assert.match(id, /^CID-\d{4}-[a-z0-9]{6,8}$/));
});

test('saveModelVersion persists model metadata to PostgreSQL', async () => {
  const store = await createDbStore();
  const saved = await store.saveModelVersion({
    version: 1,
    classes: ['Theft', 'Fraud'],
    vocabSize: 1200,
    nClasses: 2,
    accuracy: 0.94,
    trainSamples: 146,
    testSamples: 37,
    trainedAt: '2026-09-06T00:00:00.000Z',
    model: { weights: [[1, 2], [3, 4]] },
  });
  assert.ok(saved.id);
  assert.strictEqual(saved.version, 1);
  assert.strictEqual(saved.classes.length, 2);
  assert.strictEqual(saved.vocabSize, 1200);
  assert.strictEqual(saved.nClasses, 2);
  assert.strictEqual(saved.accuracy, 0.94);
  assert.strictEqual(saved.trainSamples, 146);
  assert.strictEqual(saved.testSamples, 37);
});

test('getCurrentModel returns the latest saved version', async () => {
  const store = await createDbStore();
  await store.saveModelVersion({ version: 1, classes: ['A'], vocabSize: 100, nClasses: 1, accuracy: 0.5, trainSamples: 10, testSamples: 2, trainedAt: '2026-01-01T00:00:00.000Z', model: {} });
  await store.saveModelVersion({ version: 2, classes: ['A', 'B'], vocabSize: 200, nClasses: 2, accuracy: 0.7, trainSamples: 20, testSamples: 4, trainedAt: '2026-09-06T00:00:00.000Z', model: {} });

  const current = await store.getCurrentModel();
  assert.ok(current);
  assert.strictEqual(current.version, 2);
  assert.strictEqual(current.accuracy, 0.7);
  assert.strictEqual(current.nClasses, 2);
  assert.strictEqual(current.classes.length, 2);
  assert.strictEqual(typeof current.createdAt, 'string');
});

test('getCurrentModel returns null when no model saved', async () => {
  const store = await createDbStore();
  const current = await store.getCurrentModel();
  assert.strictEqual(current, null);
});

test('getModelHistory returns versions newest-first', async () => {
  const store = await createDbStore();
  await store.saveModelVersion({ version: 1, classes: ['A'], vocabSize: 100, nClasses: 1, accuracy: 0.5, trainSamples: 10, testSamples: 2, trainedAt: '2026-01-01T00:00:00.000Z', model: {} });
  await store.saveModelVersion({ version: 2, classes: ['A', 'B'], vocabSize: 200, nClasses: 2, accuracy: 0.7, trainSamples: 20, testSamples: 4, trainedAt: '2026-09-06T00:00:00.000Z', model: {} });
  await store.saveModelVersion({ version: 3, classes: ['A', 'B', 'C'], vocabSize: 300, nClasses: 3, accuracy: 0.85, trainSamples: 30, testSamples: 6, trainedAt: '2026-09-07T00:00:00.000Z', model: {} });

  const history = await store.getModelHistory(10);
  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].version, 3);
  assert.strictEqual(history[1].version, 2);
  assert.strictEqual(history[2].version, 1);
});

test('in-memory fallback store persists model versions', async () => {
  const store = createStore(null);
  assert.strictEqual(store.isPersistent(), false);

  const saved = await store.saveModelVersion({ version: 1, classes: ['Theft'], vocabSize: 500, nClasses: 1, accuracy: 0.8, trainSamples: 80, testSamples: 20, trainedAt: '2026-09-06T00:00:00.000Z', model: { weights: [] } });
  assert.ok(saved.id);

  const current = await store.getCurrentModel();
  assert.ok(current);
  assert.strictEqual(current.version, 1);
  assert.strictEqual(current.accuracy, 0.8);

  const history = await store.getModelHistory();
  assert.strictEqual(history.length, 1);
});

test('model JSON round-trips through PostgreSQL JSONB', async () => {
  const store = await createDbStore();
  const modelJson = { weights: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]], bias: [0.1, 0.2], vocab: { theft: 1, fraud: 2 } };
  await store.saveModelVersion({ version: 1, classes: ['Theft', 'Fraud'], vocabSize: 2, nClasses: 2, accuracy: 0.9, trainSamples: 100, testSamples: 20, trainedAt: '2026-09-06T00:00:00.000Z', model: modelJson });

  const current = await store.getCurrentModel();
  assert.deepStrictEqual(current.model, modelJson);
});

test('addCase stores modelVersion and it round-trips', async () => {
  const store = await createDbStore();
  const mvId = 'MLV-2026-abc1234';
  await store.addCase({ ...SAMPLE_CASE, modelVersion: mvId });

  const c = await store.getCaseById('CID-2024-9999');
  assert.strictEqual(c.modelVersion, mvId);
});

test('addCase without modelVersion stores null', async () => {
  const store = await createDbStore();
  await store.addCase(SAMPLE_CASE);

  const c = await store.getCaseById('CID-2024-9999');
  assert.strictEqual(c.modelVersion, null);
});

test('getModelVersionStats aggregates cases by model version', async () => {
  const store = await createDbStore();
  const mv1 = 'MLV-v1-aaa';
  const mv2 = 'MLV-v2-bbb';
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-1', modelVersion: mv1, classification: { primary_type: 'Theft' } });
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-2', modelVersion: mv1, classification: { primary_type: 'Fraud' } });
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-3', modelVersion: mv2, classification: { primary_type: 'Theft' } });
  await store.addCase({ ...SAMPLE_CASE, id: 'CID-4', modelVersion: null, classification: { primary_type: 'Assault' } });

  const stats = await store.getModelVersionStats();
  assert.ok(stats[mv1]);
  assert.strictEqual(stats[mv1].count, 2);
  assert.strictEqual(stats[mv1].crimeTypes.Theft, 1);
  assert.strictEqual(stats[mv1].crimeTypes.Fraud, 1);

  assert.ok(stats[mv2]);
  assert.strictEqual(stats[mv2].count, 1);
  assert.strictEqual(stats[mv2].crimeTypes.Theft, 1);

  assert.ok(stats['none']);
  assert.strictEqual(stats['none'].count, 1);
  assert.strictEqual(stats['none'].crimeTypes.Assault, 1);
});

test('in-memory fallback store supports modelVersion on cases', async () => {
  const store = createStore(null);
  assert.strictEqual(store.isPersistent(), false);

  await store.addCase({ ...SAMPLE_CASE, modelVersion: 'MLV-mem-1' });
  const c = await store.getCaseById('CID-2024-9999');
  assert.strictEqual(c.modelVersion, 'MLV-mem-1');

  const stats = await store.getModelVersionStats();
  assert.ok(stats['MLV-mem-1']);
  assert.strictEqual(stats['MLV-mem-1'].count, 1);
});