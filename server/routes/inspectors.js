/* ============================================================
   Inspector API routes
   Inspectors are mock police officers that handle cases.
   GET    /api/inspectors         → list all active inspectors
   GET    /api/inspectors/:id     → single inspector
   POST   /api/inspectors         → create a new inspector (dev)
   GET    /api/cases/:id/inspector → case + assigned inspector
   PATCH  /api/cases/:id/inspector → assign inspector to case
   PATCH  /api/cases/:id/notes    → update inspector notes
   PATCH  /api/cases/:id/handled  → mark case as handled by inspector
   ============================================================ */
const express = require('express');
const router = express.Router();
const { getStore } = require('../store');

// GET /api/inspectors — list all active inspectors
router.get('/', async (req, res) => {
  try {
    const store = await getStore();
    res.json(await store.getInspectors());
  } catch (err) {
    console.error('[Inspectors] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inspectors/:id — single inspector
router.get('/:id', async (req, res) => {
  try {
    const store = await getStore();
    const inspector = await store.getInspectorById(req.params.id);
    if (!inspector) return res.status(404).json({ error: 'Inspector not found' });
    res.json(inspector);
  } catch (err) {
    console.error('[Inspector] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inspectors — create inspector (dev/admin use)
router.post('/', async (req, res) => {
  try {
    const store = await getStore();
    const inspector = await store.createInspector(req.body);
    res.status(201).json(inspector);
  } catch (err) {
    console.error('[Inspectors] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cases/:id/inspector — get case with assigned inspector
router.get('/:id/inspector', async (req, res) => {
  try {
    const store = await getStore();
    const c = await store.getCaseById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const inspector = c.inspectorId ? await store.getInspectorById(c.inspectorId) : null;
    res.json({ case: c, inspector });
  } catch (err) {
    console.error('[Case Inspector] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cases/:id/inspector — assign inspector to case
router.patch('/:id/inspector', async (req, res) => {
  try {
    const store = await getStore();
    const { inspectorId } = req.body;
    if (!inspectorId) return res.status(400).json({ error: 'inspectorId required' });
    const updated = await store.assignInspectorToCase(req.params.id, inspectorId);
    if (!updated) return res.status(404).json({ error: 'Case not found' });
    res.json(updated);
  } catch (err) {
    console.error('[Assign Inspector] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cases/:id/notes — update inspector notes on a case
router.patch('/:id/notes', async (req, res) => {
  try {
    const store = await getStore();
    const { notes } = req.body;
    if (notes === undefined) return res.status(400).json({ error: 'notes required' });
    const updated = await store.updateInspectorNotes(req.params.id, notes);
    if (!updated) return res.status(404).json({ error: 'Case not found' });
    res.json(updated);
  } catch (err) {
    console.error('[Inspector Notes] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cases/:id/handled — mark case as handled by inspector
router.patch('/:id/handled', async (req, res) => {
  try {
    const store = await getStore();
    const updated = await store.markCaseHandled(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Case not found' });
    // Also update status to resolved if not already
    const final = await store.updateCaseStatus(req.params.id, 'resolved');
    res.json(final);
  } catch (err) {
    console.error('[Mark Handled] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
