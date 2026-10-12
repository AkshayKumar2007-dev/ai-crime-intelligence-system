const express = require('express');
const router = express.Router();
const { getStore } = require('../store');
const { runIntakeAgent } = require('../agents/intakeAgent');
const { runClassificationAgent } = require('../agents/classificationAgent');
const { runSeverityAgent } = require('../agents/severityAgent');
const { runTriageAgent } = require('../agents/triageAgent');
const { runIntelligenceAgent } = require('../agents/intelligenceAgent');
const { runSummaryAgent } = require('../agents/summaryAgent');

// POST /api/complaints — Submit new complaint and run all 6 agents
router.post('/', async (req, res) => {
  const store = await getStore();
  const { complaintText, reporterName, reporterPhone, city, lat, lng } = req.body;

  if (!complaintText || complaintText.trim().length < 20) {
    return res.status(400).json({ error: 'Complaint text must be at least 20 characters.' });
  }

  const caseId = store.generateId();
  const startTime = Date.now();

  try {
    // Agent 1: Intake
    store.setAgentStatus('Intake Agent', 'processing');
    await store.addActivity('Intake Agent', `Starting intake for case ${caseId}`, caseId);
    const t1 = Date.now();
    const intake = await runIntakeAgent(complaintText);
    await store.recordAgentRun('Intake Agent', Date.now() - t1);
    await store.addActivity('Intake Agent', `Entities extracted — Location: ${intake.entities?.city || 'Unknown'}`, caseId);

    // Agent 2: Classification
    store.setAgentStatus('Classification Agent', 'processing');
    await store.addActivity('Classification Agent', `Classifying crime type for ${caseId}`, caseId);
    const t2 = Date.now();
    const { classification, modelVersion } = await runClassificationAgent(complaintText, intake);
    await store.recordAgentRun('Classification Agent', Date.now() - t2);
    await store.addActivity('Classification Agent', `Classified as: ${classification.primary_type} — ${classification.subcategory}`, caseId);

    // Agent 3: Severity
    store.setAgentStatus('Severity Agent', 'processing');
    await store.addActivity('Severity Agent', `Assessing severity for ${caseId}`, caseId);
    const t3 = Date.now();
    const severity = await runSeverityAgent(complaintText, intake, classification);
    await store.recordAgentRun('Severity Agent', Date.now() - t3);
    await store.addActivity('Severity Agent', `Severity: ${severity.severity_label} (${severity.severity_score}/10) — SLA: ${severity.sla_hours}h`, caseId);

    // Agent 4: Triage
    store.setAgentStatus('Triage Agent', 'processing');
    await store.addActivity('Triage Agent', `Routing case ${caseId} to department`, caseId);
    const t4 = Date.now();
    const triage = await runTriageAgent(complaintText, intake, classification, severity);
    await store.recordAgentRun('Triage Agent', Date.now() - t4);
    await store.addActivity('Triage Agent', `Routed to: ${triage.department} — ${triage.priority_queue}`, caseId);

    // Agent 5: Intelligence
    store.setAgentStatus('Intelligence Agent', 'processing');
    await store.addActivity('Intelligence Agent', `Running intelligence analysis on ${caseId}`, caseId);
    const t5 = Date.now();
    const intelligence = await runIntelligenceAgent(complaintText, intake, classification, severity);
    await store.recordAgentRun('Intelligence Agent', Date.now() - t5);
    await store.addActivity('Intelligence Agent', `Geo Risk: ${intelligence.geo_risk_level} | Repeat Offender: ${Math.round((intelligence.repeat_offender_likelihood || 0) * 100)}%`, caseId);

    // Agent 6: Summary
    store.setAgentStatus('Summary Agent', 'processing');
    await store.addActivity('Summary Agent', `Generating officer briefing for ${caseId}`, caseId);
    const t6 = Date.now();
    const summary = await runSummaryAgent(complaintText, intake, classification, severity, triage, intelligence);
    await store.recordAgentRun('Summary Agent', Date.now() - t6);
    await store.addActivity('Summary Agent', `Briefing complete: "${summary.case_title}"`, caseId);

    const newCase = await store.addCase({
      id: caseId,
      createdAt: new Date().toISOString(),
      status: 'open',
      complaintText,
      reporterName: reporterName || 'Anonymous',
      reporterPhone: reporterPhone || 'N/A',
      city: city || intake.entities?.city || 'Unknown',
      lat: lat || null,
      lng: lng || null,
      intake,
      classification,
      severity,
      triage,
      intelligence,
      summary,
      agentProcessed: true,
      totalProcessingMs: Date.now() - startTime,
      modelVersion: modelVersion || null,
    });

    res.status(201).json({
      success: true,
      caseId,
      case: newCase
    });

  } catch (err) {
    console.error('Pipeline error:', err);
    res.status(500).json({ error: 'Agent pipeline failed: ' + err.message });
  }
});

// GET /api/complaints — List all cases
router.get('/', async (req, res) => {
  const store = await getStore();
  const { status, limit = 50 } = req.query;
  let result = await store.getAllCases();
  if (status) result = result.filter(c => c.status === status);
  res.json(result.slice(0, parseInt(limit)));
});

// GET /api/complaints/:id — Get specific case
router.get('/:id', async (req, res) => {
  const store = await getStore();
  const c = await store.getCaseById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  res.json(c);
});

// PATCH /api/complaints/:id/status — Update case status
router.patch('/:id/status', async (req, res) => {
  const store = await getStore();
  const { status } = req.body;
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updated = await store.updateCaseStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Case not found' });
  await store.addActivity('Triage Agent', `Case ${req.params.id} status updated to ${status}`, req.params.id);
  res.json(updated);
});

module.exports = router;