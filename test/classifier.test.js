/* ============================================================
   ML Classifier tests — verifies the trained TF-IDF + logistic
   regression model classifies complaints into the expected
   crime categories.
   ============================================================ */
const { test } = require('node:test');
const assert = require('node:assert');
const { getModel, classify, classifyLLM, classifyHybrid, predictProbs, CLASSES, CLASS_META } = require('../server/ml/classifier');

const EXAMPLES = [
  { text: 'My gold chain was snatched by two men on a motorcycle near Connaught Place yesterday evening. One suspect wore a red helmet.', expected: 'Theft' },
  { text: 'I received a call from someone posing as an SBI official asking for my OTP. I shared it and Rs 45,000 was transferred from my account.', expected: 'Cybercrime' },
  { text: 'There is a dead body found near the lake in Koramangala. I found it during my morning walk. Please come immediately.', expected: 'Murder' },
  { text: 'My husband beat me again last night and threatened to kill me. I am hiding at my neighbour house. Please help.', expected: 'Domestic Violence' },
  { text: 'Drug peddlers are operating openly near the school in Sector 18. I have seen them exchange packets near the back gate.', expected: 'Drug Trafficking' },
  { text: 'My 10-year-old daughter went missing from the market this afternoon. She was wearing a blue dress. Please find her urgently.', expected: 'Kidnapping' },
  { text: 'Unknown persons set fire to my car parked outside my house. The car is completely burnt.', expected: 'Arson' },
  { text: 'Two men came to my shop and threatened me to pay Rs 5 lakhs protection money or they will burn my shop.', expected: 'Extortion' },
  { text: 'Online job scam — I paid Rs 80,000 advance to a company for a fake job offer. Now their website and phone are shut down.', expected: 'Fraud' },
  { text: 'A man on the metro train groped me and when I shouted he ran away at Rajiv Chowk station.', expected: 'Sexual Harassment' },
  { text: 'A car crashed into my vehicle on the highway and the driver fled without stopping. I have a broken arm.', expected: 'Hit & Run' },
  { text: 'Someone has been hacking into my company server and stealing employee data. The attacker is accessing from outside India.', expected: 'Cybercrime' },
  { text: 'There is a loud music disturbance from the marriage hall near my house every night. Please look into it.', expected: 'General Complaint' },
];

test('model file loads and exposes all 13 crime classes', () => {
  const model = getModel();
  assert.ok(model, 'model should load (or train on first use)');
  assert.ok(model.vectorizer.vocab.length > 100, 'vocabulary should be non-trivial');
  assert.strictEqual(model.classes.length, 13);
  assert.deepStrictEqual(model.classes, CLASSES);
  assert.ok(model.metrics.accuracy > 0.5, 'reported held-out accuracy should be sane');
});

test('classify returns the full Classification Agent schema', () => {
  const r = classify('My gold chain was snatched by two men on a motorcycle near Connaught Place.');
  assert.ok(r);
  assert.strictEqual(typeof r.primary_type, 'string');
  assert.ok(CLASS_META[r.primary_type], 'primary_type should be a known class');
  assert.strictEqual(typeof r.subcategory, 'string');
  assert.ok(Array.isArray(r.ipc_sections) && r.ipc_sections.length > 0, 'should map to IPC sections');
  assert.ok(Array.isArray(r.keywords) && r.keywords.length > 0, 'should extract keywords');
  assert.strictEqual(typeof r.crime_icon, 'string');
  assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence must be a probability');
});

test('classifies representative complaints correctly', () => {
  const model = getModel();
  for (const ex of EXAMPLES) {
    const r = classify(ex.text, model);
    assert.strictEqual(r.primary_type, ex.expected, `expected ${ex.expected}, got ${r.primary_type} for: ${ex.text.slice(0, 60)}…`);
  }
});

test('classify is deterministic for the same input', () => {
  const a = classify('Someone stole my laptop from my house while I was away. The lock was broken.');
  const b = classify('Someone stole my laptop from my house while I was away. The lock was broken.');
  assert.deepStrictEqual(a, b);
});

test('predictProbs returns normalized probabilities', () => {
  const probs = predictProbs('A truck full of narcotics was seen near the warehouse at night.');
  assert.strictEqual(probs.length, 13);
  const sum = probs.reduce((s, p) => s + p.probability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-3, `probabilities should sum to ~1 (got ${sum})`);
  assert.ok(probs[0].probability >= probs[probs.length - 1].probability, 'should be sorted descending');
});

test('classifyLLM returns the schema even in MOCK_MODE / no API key', async () => {
  // In this environment MOCK_MODE is true (or no GEMINI_API_KEY), so the LLM
  // path returns mock data — we verify the shape is correct, not the content.
  const r = await classifyLLM('Someone stole my bike from the parking lot.');
  assert.ok(r);
  assert.strictEqual(typeof r.primary_type, 'string');
  assert.ok(CLASS_META[r.primary_type], 'should map to a known class');
  assert.strictEqual(typeof r.subcategory, 'string');
  assert.ok(Array.isArray(r.ipc_sections));
  assert.ok(Array.isArray(r.keywords));
  assert.strictEqual(typeof r.crime_icon, 'string');
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
});

test('classifyHybrid returns ML result in MOCK_MODE (fast path)', async () => {
  const r = await classifyHybrid('My gold chain was snatched by two men on a motorcycle.');
  assert.ok(r);
  assert.strictEqual(r.primary_type, 'Theft', 'ML should classify this in mock mode');
  assert.strictEqual(typeof r.subcategory, 'string');
  assert.ok(Array.isArray(r.ipc_sections) && r.ipc_sections.length > 0);
  assert.ok(typeof r.confidence === 'number' && r.confidence > 0);
});

test('classifyHybrid falls back to ML when LLM throws', async () => {
  // We can't easily force the LLM to fail without mocking internals, but we can
  // verify the hybrid path is robust: it always returns *something*.
  const r = await classifyHybrid('A completely generic noise complaint about a loud speaker.');
  assert.ok(r);
  assert.ok(typeof r.primary_type === 'string');
  assert.ok(typeof r.confidence === 'number');
});

test('classifyHybrid may attach internal _source/_ml* fields (agent strips them)', async () => {
  // classifyHybrid is allowed to attach internal tracking fields when the LLM
  // overrides the ML — callers (the Classification Agent) are responsible for
  // stripping them before downstream use. Verify the shape is still valid.
  const r = await classifyHybrid('My gold chain was snatched by two men on a motorcycle near Connaught Place.');
  assert.ok(r);
  assert.strictEqual(typeof r.primary_type, 'string');
  assert.ok(CLASS_META[r.primary_type], 'primary_type should always map to a known class');
  assert.strictEqual(typeof r.confidence, 'number');
  // Internal fields are acceptable here — the agent cleans them
  assert.ok(!r._source || r._source === 'llm', 'if _source present it must be llm');
});

test('IPC metadata exists for every class', () => {
  for (const cls of CLASSES) {
    const meta = CLASS_META[cls];
    assert.ok(meta, `missing metadata for ${cls}`);
    assert.ok(meta.ipc.length > 0, `missing IPC sections for ${cls}`);
    assert.ok(meta.icon, `missing icon for ${cls}`);
    assert.ok(meta.subcategory, `missing subcategory for ${cls}`);
  }
});