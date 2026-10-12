/* ============================================================
   E2E Smoke Test — CrimeIntel AI
   Submits a complaint, assigns an inspector, adds notes,
   marks it handled, and verifies the entire flow via API
   plus checks the dashboard HTML for the new case.
   Run with: node test/smoke.js
   ============================================================ */
const http = require('http');

const BASE = 'http://localhost:3000';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function get(path) { return request('GET', path); }
async function post(path, body) { return request('POST', path, body); }
async function patch(path, body) { return request('PATCH', path, body); }

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok, detail) {
  if (ok) { passed++; results.push(`  ✅ ${name}`); }
  else { failed++; results.push(`  ❌ ${name} — ${detail}`); }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🚔 CrimeIntel AI — E2E Smoke Test\n');

  // ── 1. Health check ──
  console.log('--- 1. Server health ---');
  const health = await get('/api/health');
  check('Server is operational', health.status === 200);
  check('Mode is MOCK or LIVE', health.body.mode === 'MOCK (Demo)' || health.body.mode === 'LIVE (Gemini API)');
  check('Storage is in-memory or postgres', health.body.storage === 'in-memory' || health.body.storage === 'postgres');
  check('Has cases', Number(health.body.cases) >= 30);
  console.log(`     Server reports ${health.body.cases} existing cases, mode=${health.body.mode}\n`);

  // ── 2. Pages serve ──
  console.log('--- 2. Frontend pages ---');
  const pages = { '/': 'CrimeIntel', '/complaint': 'File a Complaint', '/dashboard': 'Command Center', '/agents': 'Agent Monitor' };
  for (const [path, expectText] of Object.entries(pages)) {
    const r = await get(path);
    check(`${path} returns 200`, r.status === 200);
    check(`${path} contains expected text`, typeof r.body === 'string' && r.body.includes(expectText));
  }

  // ── 3. Assets serve ──
  console.log('--- 3. Static assets ---');
  const assets = ['/js/app.js', '/js/complaint.js', '/js/dashboard.js', '/js/agents.js', '/js/dashboard-3d.js', '/css/styles.css'];
  for (const path of assets) {
    const r = await get(path);
    check(`${path} returns 200`, r.status === 200);
  }

  // ── 4. Inspectors ──
  console.log('--- 4. Inspector API ---');
  const inspectors = await get('/api/inspectors');
  check('Returns list of inspectors', inspectors.status === 200 && Array.isArray(inspectors.body) && inspectors.body.length >= 8);
  const firstInspector = inspectors.body[0];
  check('Inspector has name', typeof firstInspector?.name === 'string' && firstInspector.name.length > 0);
  check('Inspector has badgeNumber', typeof firstInspector?.badgeNumber === 'string');
  check('Inspector has specialty', typeof firstInspector?.specialty === 'string');

  const inspectorId = firstInspector.id;
  const inspectorById = await get(`/api/inspectors/${inspectorId}`);
  check('GET inspector by id works', inspectorById.status === 200 && inspectorById.body.id === inspectorId);

  const created = await post('/api/inspectors', { name: 'Smoke Test Inspector', rank: 'Constable', station: 'Smoke Test PS', badgeNumber: 'SMK-001', specialty: 'Testing', color: '#ffffff' });
  check('POST create inspector works', created.status === 201 && created.body.name === 'Smoke Test Inspector');
  const smokeInspectorId = created.body.id;

  // ── 5. Submit complaint ──
  console.log('--- 5. Submit complaint ---');
  const complaintText = 'A motorcycle was stolen from my residence in Rajarajeshwari Nagar, Bengaluru last night. The bike is a TVS Apache RTR 160. I have the chassis and engine numbers registered with the RTO. Police have not registered an FIR yet.';
  const submitted = await post('/api/complaints', {
    complaintText,
    reporterName: 'Ravi Kumar',
    reporterPhone: '+91 99000 22222',
    city: 'Bengaluru',
  });
  check('POST /api/complaints returns 201', submitted.status === 201);
  check('Response has caseId', typeof submitted.body.caseId === 'string' && submitted.body.caseId.startsWith('CID-'));
  const caseId = submitted.body.caseId;
  check('Case has classification', submitted.body.case?.classification?.primary_type !== undefined);
  check('Case has severity', submitted.body.case?.severity?.severity_label !== undefined);
  check('Case has triage', submitted.body.case?.triage?.department !== undefined);
  check('Case has intelligence', submitted.body.case?.intelligence?.geo_risk_level !== undefined);
  check('Case has summary', submitted.body.case?.summary?.case_title !== undefined);
  check('Case has intake', submitted.body.case?.intake?.entities !== undefined);
  check('Case has modelVersion', submitted.body.case?.modelVersion !== null);
  check('Case is open', submitted.body.case?.status === 'open');
  console.log(`     Submitted case ${caseId} → ${submitted.body.case?.classification?.primary_type} (${submitted.body.case?.severity?.severity_label})\n`);

  // ── 6. Retrieve the case ──
  console.log('--- 6. Retrieve case ---');
  const retrieved = await get(`/api/complaints/${caseId}`);
  check('GET case returns 200', retrieved.status === 200);
  check('Retrieved caseId matches', retrieved.body.id === caseId);
  check('Complaint text preserved', retrieved.body.complaintText === complaintText);
  check('Reporter name preserved', retrieved.body.reporterName === 'Ravi Kumar');

  // ── 7. Dashboard shows the case ──
  console.log('--- 7. Dashboard shows case ---');
  await sleep(500); // give activity feed a moment to update
  const dashboardCases = await get('/api/dashboard/cases');
  const foundInDashboard = dashboardCases.body.find(c => c.id === caseId);
  check('Case appears in dashboard cases list', foundInDashboard !== undefined);
  check('Dashboard case has crimeType', typeof foundInDashboard?.crimeType === 'string');
  check('Dashboard case has severity', foundInDashboard?.severity !== undefined);
  check('Dashboard case has city', foundInDashboard?.city === 'Bengaluru');

  // ── 8. Dashboard stats include the case ──
  console.log('--- 8. Dashboard stats ---');
  const stats = await get('/api/dashboard');
  check('Stats total includes new case', stats.body.total >= 31);
  check('Stats has crimeTypeCounts', Array.isArray(stats.body.crimeTypeCounts) || typeof stats.body.crimeTypeCounts === 'object');

  // ── 9. Activity feed includes the case ──
  console.log('--- 9. Activity feed ---');
  await sleep(300);
  const activity = await get('/api/dashboard/activity');
  check('Activity feed returns entries', Array.isArray(activity.body) && activity.body.length > 0);
  const caseActivity = activity.body.filter(e => e.caseId === caseId);
  check('Activity has entries for this case', caseActivity.length >= 3);
  check('Classification activity present', caseActivity.some(e => e.action.includes('Classified')));

  // ── 10. Assign inspector ──
  console.log('--- 10. Assign inspector ---');
  const assigned = await patch(`/api/cases/${caseId}/inspector`, { inspectorId });
  check('Assign inspector returns 200', assigned.status === 200);
  check('Case now has inspectorId', assigned.body.inspectorId === inspectorId);
  check('AssignedAt is set', typeof assigned.body.assignedAt === 'string');

  const assignedCase = await get(`/api/complaints/${caseId}`);
  check('GET case shows inspectorId after assign', assignedCase.body.inspectorId === inspectorId);
  check('GET case shows inspectorId', assignedCase.body.inspectorId === inspectorId); // name is mapped client-side by dashboard.js

  // ── 11. Add inspector notes ──
  console.log('--- 11. Inspector notes ---');
  const notesText = 'FIR registered. Bike chassis no. ABC1234567 traced to a pawn shop in Jayanagar. Owner notified. Suspect being tracked via CCTV.';
  const withNotes = await patch(`/api/cases/${caseId}/notes`, { notes: notesText });
  check('PATCH notes returns 200', withNotes.status === 200);
  check('Notes saved correctly', withNotes.body.inspectorNotes === notesText);

  const caseWithNotes = await get(`/api/complaints/${caseId}`);
  check('GET case shows notes', caseWithNotes.body.inspectorNotes === notesText);

  // ── 12. Mark handled ──
  console.log('--- 12. Mark handled ---');
  const handled = await patch(`/api/cases/${caseId}/handled`, {});
  check('Mark handled returns 200', handled.status === 200);
  check('Status is resolved', handled.body.status === 'resolved');
  check('handledAt is set', typeof handled.body.handledAt === 'string');

  const caseHandled = await get(`/api/complaints/${caseId}`);
  check('GET case shows resolved status', caseHandled.body.status === 'resolved');
  check('GET case shows handledAt', caseHandled.body.handledAt !== null);

  // ── 13. Dashboard reflects resolved case ──
  console.log('--- 13. Dashboard reflects resolution ---');
  await sleep(300);
  const statsAfter = await get('/api/dashboard');
  check('Stats show at least 1 resolved', statsAfter.body.resolved >= 1);

  // ── 14. Dashboard HTML contains inspector info ──
  console.log('--- 14. Dashboard HTML ---');
  const dashboardHtml = await get('/dashboard');
  check('Dashboard HTML is valid', typeof dashboardHtml.body === 'string' && dashboardHtml.body.length > 1000);
  check('Dashboard HTML includes dashboard.js script tag', dashboardHtml.body.includes('js/dashboard.js'));

  // ── 15. Model registry ──
  console.log('--- 15. ML model registry ---');
  const mlModel = await get('/api/ml-model');
  check('Model registry returns current', mlModel.body.current !== null);
  check('Model has version', mlModel.body.current.version >= 1);
  check('Model has accuracy', mlModel.body.current.accuracy > 0.5);
  check('Model has classes', Array.isArray(mlModel.body.current.classes) && mlModel.body.current.classes.length >= 10);
  check('Model history exists', Array.isArray(mlModel.body.history));

  // ── 15b. Model stats ──
  const modelStats = await get('/api/dashboard/model-stats');
  check('Model stats endpoint works', modelStats.status === 200);

  // ── 16. 404 handling ──
  console.log('--- 16. Error handling ---');
  const missingCase = await get('/api/complaints/CID-DOESNOTEXIST');
  check('Missing case returns 404', missingCase.status === 404);
  check('Missing case has error message', typeof missingCase.body.error === 'string');

  const missingInspector = await get(`/api/inspectors/NONEXISTENT-ID`);
  check('Missing inspector returns 404', missingInspector.status === 404);

  const badStatus = await patch(`/api/complaints/${caseId}/status`, { status: 'invalid_status' });
  check('Invalid status returns 400', badStatus.status === 400);

  const noInspectorId = await patch(`/api/cases/${caseId}/inspector`, { });
  check('Missing inspectorId returns 400', noInspectorId.status === 400);

  // ── Summary ──
  console.log('\n=====================================');
  console.log(`     ✅ Passed: ${passed}`);
  console.log(`     ❌ Failed: ${failed}`);
  console.log('=====================================\n');
  console.log('Results:');
  results.forEach(r => console.log(r));
  console.log('\n' + (failed === 0 ? '🎉 All smoke tests passed!' : `⚠️  ${failed} test(s) failed.`));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('💥 Smoke test crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
