/* ============================================================
   Case → Inspector routes
   Mounted at /api/cases
   PATCH /api/cases/:id/inspector → assign inspector
   PATCH /api/cases/:id/notes    → update inspector notes
   PATCH /api/cases/:id/handled  → mark case handled + resolved
   ============================================================ */
const express = require('express');
const router = express.Router();
const { getStore } = require('../store');

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

// PATCH /api/cases/:id/notes — update inspector notes
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
    const final = await store.updateCaseStatus(req.params.id, 'resolved');
    res.json(final);
  } catch (err) {
    console.error('[Mark Handled] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
