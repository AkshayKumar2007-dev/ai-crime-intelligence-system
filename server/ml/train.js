#!/usr/bin/env node
/* ============================================================
   Retrain the ML classifier and write server/ml/model.json.
   Usage: npm run train:ml
   ============================================================ */
const { train } = require('./classifier');

const epochs = parseInt(process.argv[2], 10) || 150;
const start = Date.now();
const { metrics } = train({ epochs });
console.log(`[ML] Training completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log(`[ML] metrics:`, metrics);