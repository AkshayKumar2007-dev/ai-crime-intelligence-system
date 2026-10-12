/* ============================================================
   ML Model Registry API
   GET  /api/ml-model          → current model + history
   GET  /api/ml-model/:id      → specific version
   ============================================================ */
const { getStore } = require('../store');

async function handleGet(req, res) {
  try {
    const store = await getStore();
    const { id } = req.params;

    if (id) {
      // Specific version — re-query by scanning history
      const history = await store.getModelHistory(100);
      const entry = history.find(e => e.id === id);
      if (!entry) return res.status(404).json({ error: 'Model version not found' });
      return res.json({ model: entry });
    }

    const current = await store.getCurrentModel();
    const history = await store.getModelHistory(20);
    res.json({ current, history });
  } catch (err) {
    console.error('[ML-Model API] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = (req, res, next) => {
  // Match GET /api/ml-model and GET /api/ml-model/:id
  if (req.method === 'GET') return handleGet(req, res);
  res.status(405).json({ error: 'Method not allowed' });
};
