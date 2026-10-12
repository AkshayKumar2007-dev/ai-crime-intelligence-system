const express = require('express');
const router = express.Router();
const { getStore } = require('../store');

// GET /api/dashboard — Dashboard stats
router.get('/', async (req, res) => {
  const store = await getStore();
  res.json(await store.getDashboardStats());
});

// GET /api/dashboard/cases — All cases for map + table
router.get('/cases', async (req, res) => {
  const store = await getStore();
  const cases = await store.getAllCases();
  res.json(cases.map(c => ({
    id: c.id,
    createdAt: c.createdAt,
    status: c.status,
    city: c.city,
    lat: c.lat,
    lng: c.lng,
    crimeType: c.classification?.primary_type || 'Unknown',
    crimeIcon: c.classification?.crime_icon || '📋',
    severity: c.severity?.severity_label || 'MEDIUM',
    severityScore: c.severity?.severity_score || 5,
    department: c.triage?.department || 'Local Police Station',
    geoRisk: c.intelligence?.geo_risk_level || 'YELLOW',
    caseTitle: c.summary?.case_title || `Case ${c.id}`,
    subcategory: c.classification?.subcategory || '',
  })));
});

// GET /api/dashboard/activity — Agent activity log
router.get('/activity', async (req, res) => {
  const store = await getStore();
  res.json(await store.getActivity(50));
});

// GET /api/dashboard/agents — Agent stats
router.get('/agents', async (req, res) => {
  const store = await getStore();
  res.json(await store.getAgentStats());
});

// GET /api/dashboard/model-stats — Per-model-version classification counts
router.get('/model-stats', async (req, res) => {
  const store = await getStore();
  res.json(await store.getModelVersionStats());
});

module.exports = router;