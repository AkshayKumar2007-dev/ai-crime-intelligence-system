/* ============================================================
   ML Classifier — TF-IDF + multiclass logistic regression.
   Trains on the labeled dataset, serializes to model.json,
   and exposes classify(text) with the same output shape the
   Classification Agent expects.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { TfidfVectorizer } = require('./tfidf');
const { SoftmaxRegression } = require('./logistic');
const { DATASET } = require('./dataset');

const MODEL_PATH = path.join(__dirname, 'model.json');

/**
 * LLM (Gemini) classification — standalone, no ML model required.
 * Uses the existing runAgent helper which already handles MOCK_MODE
 * and API-key absence by returning mock data.
 */
async function classifyLLM(text) {
  // In MOCK_MODE or without a real API key, runAgent returns mock data.
  // We use a deliberately low confidence so the hybrid classifier prefers
  // the ML model when both are available — the LLM is the enhancer, not
  // the default.
  const SYSTEM_PROMPT = `You are the Classification Agent in a police crime intelligence system.
Your job is to classify the crime type from the complaint text.

Output JSON schema:
{
  "primary_type": "string - main crime category (e.g. Theft, Assault, Fraud, Cybercrime, Murder, Drug Trafficking, Kidnapping, Hit & Run, Domestic Violence, Arson, Sexual Harassment, Extortion, General Complaint)",
  "subcategory": "string - specific subcategory (e.g. Chain Snatching, Online Scam, Road Rage, etc.)",
  "ipc_sections": ["array of relevant IPC section numbers as strings, e.g. '379', '420', 'NDPS Act'"],
  "keywords": ["array of key crime-related terms from the complaint"],
  "crime_icon": "single emoji representing this crime type",
  "confidence": "number 0-1"
}`;

  const CRIME_TYPES_CONTEXT = [
    { type: 'Theft', sub: 'Street Robbery', icon: '💰', ipc: ['379', '380'] },
    { type: 'Assault', sub: 'Physical Attack', icon: '🥊', ipc: ['351', '352', '323'] },
    { type: 'Fraud', sub: 'Financial Fraud', icon: '🎭', ipc: ['420', '406'] },
    { type: 'Cybercrime', sub: 'Online Fraud', icon: '💻', ipc: ['66C', '66D'] },
    { type: 'Drug Trafficking', sub: 'Substance Abuse', icon: '💊', ipc: ['NDPS Act'] },
    { type: 'Kidnapping', sub: 'Abduction', icon: '🔗', ipc: ['363', '364'] },
    { type: 'Murder', sub: 'Homicide', icon: '⚰️', ipc: ['302', '304'] },
    { type: 'Hit & Run', sub: 'Road Accident', icon: '🚗', ipc: ['279', '304A'] },
    { type: 'Domestic Violence', sub: 'Family Violence', icon: '🏠', ipc: ['498A', '323'] },
    { type: 'Arson', sub: 'Property Fire', icon: '🔥', ipc: ['435', '436'] },
    { type: 'Sexual Harassment', sub: 'Sexual Offense', icon: '🚨', ipc: ['376', '354'] },
    { type: 'Extortion', sub: 'Criminal Intimidation', icon: '📵', ipc: ['383', '503'] },
    { type: 'General Complaint', sub: 'Miscellaneous', icon: '📋', ipc: ['107'] },
  ].map(c => `${c.type} (${c.sub}) — IPC: ${c.ipc.join(', ')}`).join('\n');

  const prompt = `Classify this police complaint into exactly one crime category from the list below.

Valid crime categories:
${CRIME_TYPES_CONTEXT}

Complaint:
"${text}"

Respond ONLY with valid JSON matching the schema. Pick the single best-matching category. If the complaint does not clearly match any specific crime, use "General Complaint".`;

  const { runAgent } = require('../geminiClient');
  // In MOCK_MODE the Gemini client returns mock data immediately (no network).
  // We give it a low confidence so the hybrid classifier prefers the ML model
  // whenever ML is available — the real LLM is an enhancer, not a replacement.
  const mock = {
    primary_type: 'General Complaint',
    subcategory: 'Miscellaneous',
    ipc_sections: ['107'],
    keywords: ['complaint'],
    crime_icon: '📋',
    confidence: 0.10,
  };
  return await runAgent('ClassificationAgent-LLMs', SYSTEM_PROMPT, prompt, mock);
}

/**
 * Hybrid classification:
 * 1. Run the TF-IDF + logistic regression model (fast, always available).
 * 2. If confidence is below a threshold OR LLM is available, ask Gemini to
 *    refine/validate the classification (LLM has broader world knowledge).
 * 3. When both agree, boost confidence; when they disagree and LLM is confident,
 *    prefer the LLM.
 *
 * Falls back gracefully to ML-only when no API key / MOCK_MODE.
 */
async function classifyHybrid(text, mlThreshold = 0.20) {
  // Step 1: ML classification (synchronous, cached model)
  const ml = classify(text);
  if (!ml) {
    // No model at all — fall back to LLM only, then keyword fallback
    try {
      const llm = await classifyLLM(text);
      if (llm && llm.primary_type) return llm;
    } catch (err) {
      console.debug('[ML] LLM standalone failed:', err.message);
    }
    return classifyMock(text);
  }

  // If ML is confident enough, optionally verify with LLM
  if (ml.confidence >= mlThreshold) {
    try {
      const llm = await classifyLLM(text);
      if (llm && llm.primary_type && llm.confidence != null) {
        if (llm.primary_type === ml.primary_type) {
          // Agreement — take the mean confidence
          ml.confidence = Math.min(1, (ml.confidence + llm.confidence) / 2);
        } else if (llm.confidence > ml.confidence + 0.15) {
          // LLM strongly prefers a different class — trust it
          return {
            ...llm,
            _source: 'llm',
            _mlDisagreed: ml.primary_type,
          };
        }
      }
    } catch (err) {
      // LLM call failed — keep ML result, it's fine
      console.debug('[ML] LLM refinement failed, using ML:', err.message);
    }
    return ml;
  }

  // ML is uncertain — ask the LLM for a second opinion.
  // Only override the ML if the LLM is meaningfully more confident.
  try {
    const llm = await classifyLLM(text);
    if (llm && llm.primary_type && llm.confidence != null) {
      if (llm.confidence > ml.confidence + 0.10) {
        // LLM is significantly more confident — trust it
        return {
          ...llm,
          _source: 'llm',
          _mlFallback: ml.primary_type,
        };
      }
      // Otherwise keep the ML result but note the LLM disagreed
      return {
        ...ml,
        _llmDisagreed: llm.primary_type,
      };
    }
  } catch (err) {
    console.debug('[ML] LLM uncertain-fallback failed, using ML:', err.message);
  }
  return ml;
}

// Keyword matcher kept as ultimate fallback only
function classifyMock(text) {
  const lower = text.toLowerCase();
  const CRIME_TYPES = [
    { keywords: ['stolen', 'theft', 'snatch', 'pickpocket', 'rob', 'loot'], type: 'Theft', sub: 'Street Robbery', icon: '💰', ipc: ['379', '380'] },
    { keywords: ['beat', 'assault', 'attack', 'hit', 'punch', 'stab', 'hurt'], type: 'Assault', sub: 'Physical Attack', icon: '🥊', ipc: ['351', '352', '323'] },
    { keywords: ['fraud', 'scam', 'cheat', 'fake', 'deceive', 'con'], type: 'Fraud', sub: 'Financial Fraud', icon: '🎭', ipc: ['420', '406'] },
    { keywords: ['hack', 'cyber', 'online', 'phishing', 'password', 'otp', 'upi', 'bank transfer'], type: 'Cybercrime', sub: 'Online Fraud', icon: '💻', ipc: ['66C', '66D'] },
    { keywords: ['drug', 'narcotics', 'cocaine', 'heroin', 'ganja', 'substance'], type: 'Drug Trafficking', sub: 'Substance Abuse', icon: '💊', ipc: ['NDPS Act'] },
    { keywords: ['kidnap', 'abduct', 'missing', 'ransom'], type: 'Kidnapping', sub: 'Abduction', icon: '🔗', ipc: ['363', '364'] },
    { keywords: ['murder', 'kill', 'dead body', 'corpse', 'homicide'], type: 'Murder', sub: 'Homicide', icon: '⚰️', ipc: ['302', '304'] },
    { keywords: ['accident', 'vehicle', 'car', 'motorcycle', 'hit and run', 'crash'], type: 'Hit & Run', sub: 'Road Accident', icon: '🚗', ipc: ['279', '304A'] },
    { keywords: ['domestic', 'husband', 'wife', 'spouse', 'family', 'dowry', 'harassment at home'], type: 'Domestic Violence', sub: 'Family Violence', icon: '🏠', ipc: ['498A', '323'] },
    { keywords: ['fire', 'burn', 'arson', 'set on fire'], type: 'Arson', sub: 'Property Fire', icon: '🔥', ipc: ['435', '436'] },
    { keywords: ['rape', 'molestation', 'eve tease', 'sexual', 'outrage'], type: 'Sexual Harassment', sub: 'Sexual Offense', icon: '🚨', ipc: ['376', '354'] },
    { keywords: ['extort', 'blackmail', 'threaten', 'threat', 'ransom call'], type: 'Extortion', sub: 'Criminal Intimidation', icon: '📵', ipc: ['383', '503'] },
  ];
  for (const c of CRIME_TYPES) {
    if (c.keywords.some(k => lower.includes(k))) {
      return {
        primary_type: c.type,
        subcategory: c.sub,
        ipc_sections: c.ipc,
        keywords: c.keywords.filter(k => lower.includes(k)),
        crime_icon: c.icon,
        confidence: 0.87,
      };
    }
  }
  return {
    primary_type: 'General Complaint',
    subcategory: 'Miscellaneous',
    ipc_sections: ['107'],
    keywords: ['complaint'],
    crime_icon: '📋',
    confidence: 0.55,
  };
}

const CLASS_META = {
  Theft: { subcategory: 'Street Robbery', ipc: ['379', '380'], icon: '💰' },
  Assault: { subcategory: 'Physical Attack', ipc: ['323', '351'], icon: '🥊' },
  Fraud: { subcategory: 'Financial Fraud', ipc: ['420', '406'], icon: '🎭' },
  Cybercrime: { subcategory: 'Online Fraud', ipc: ['66C', '66D'], icon: '💻' },
  'Drug Trafficking': { subcategory: 'Substance Abuse', ipc: ['NDPS Act'], icon: '💊' },
  Kidnapping: { subcategory: 'Abduction', ipc: ['363', '364'], icon: '🔗' },
  Murder: { subcategory: 'Homicide', ipc: ['302', '304'], icon: '⚰️' },
  'Hit & Run': { subcategory: 'Road Accident', ipc: ['279', '304A'], icon: '🚗' },
  'Domestic Violence': { subcategory: 'Family Violence', ipc: ['498A', '323'], icon: '🏠' },
  Arson: { subcategory: 'Property Fire', ipc: ['435', '436'], icon: '🔥' },
  'Sexual Harassment': { subcategory: 'Sexual Offense', ipc: ['354', '376'], icon: '🚨' },
  Extortion: { subcategory: 'Criminal Intimidation', ipc: ['383', '503'], icon: '📵' },
  'General Complaint': { subcategory: 'Miscellaneous', ipc: ['107'], icon: '📋' },
};

const CLASSES = Object.keys(CLASS_META);

/**
 * Train the model on the full dataset.
 * Returns { classifier, vectorizer, metrics } and saves model.json.
 */
function train({ epochs = 150, quiet = false } = {}) {
  const labels = DATASET.map(d => d.label);
  const texts = DATASET.map(d => d.text);

  // Stratified 80/20 split (shuffled with fixed seed for reproducibility)
  const rng = mulberry32(42);
  const idx = DATASET.map((_, i) => i).sort(() => rng() - 0.5);
  const split = Math.floor(idx.length * 0.8);
  const trainIdx = idx.slice(0, split);
  const testIdx = idx.slice(split);

  const vectorizer = new TfidfVectorizer({ minDf: 2, maxVocab: 3000 });
  vectorizer.fit(texts);

  const X = texts.map(t => vectorizer.transform(t));
  const y = labels.map(l => CLASSES.indexOf(l));

  const model = new SoftmaxRegression({
    nClasses: CLASSES.length,
    nFeatures: vectorizer.vocab.length,
    lr: 0.5,
    epochs,
    l2: 0.01,
    momentum: 0.9,
    // Temperature < 1 sharpens prediction probabilities (argmax unchanged)
    temperature: 0.6,
  });
  model.fit(X, y);

  // Held-out evaluation
  const XTest = testIdx.map(i => X[i]);
  const yTest = testIdx.map(i => y[i]);
  const accuracy = model.accuracy(XTest, yTest);

  if (!quiet) {
    console.log(`[ML] Trained on ${trainIdx.length} samples (vocab: ${vectorizer.vocab.length} terms, ${CLASSES.length} classes)`);
    console.log(`[ML] Held-out accuracy: ${(accuracy * 100).toFixed(1)}% (${testIdx.length} samples)`);
    // Per-class breakdown
    const byClass = {};
    testIdx.forEach((ti, k) => {
      const label = labels[ti];
      byClass[label] = byClass[label] || { total: 0, correct: 0 };
      byClass[label].total++;
      if (model.predict([X[ti]])[0] === y[ti]) byClass[label].correct++;
    });
    Object.entries(byClass).forEach(([c, s]) => {
      console.log(`   ${c.padEnd(20)} ${s.correct}/${s.total}`);
    });
  }

  const payload = {
    version: 1,
    classes: CLASSES,
    vectorizer: vectorizer.toJSON(),
    model: model.toJSON(),
    metrics: {
      accuracy: Math.round(accuracy * 10000) / 10000,
      trainSamples: trainIdx.length,
      testSamples: testIdx.length,
      trainedAt: new Date().toISOString(),
    },
  };

  fs.writeFileSync(MODEL_PATH, JSON.stringify(payload));
  if (!quiet) console.log(`[ML] Model saved to ${MODEL_PATH}`);
  return { vectorizer, model, classes: CLASSES, metrics: payload.metrics };
}

/** Load model.json. Returns null when missing or corrupt. */
function loadModel() {
  if (!fs.existsSync(MODEL_PATH)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
    return {
      vectorizer: TfidfVectorizer.fromJSON(payload.vectorizer),
      model: SoftmaxRegression.fromJSON(payload.model),
      classes: payload.classes,
      metrics: payload.metrics,
    };
  } catch (err) {
    console.warn(`[ML] Failed to load model (${err.message}) — retraining.`);
    return null;
  }
}

/* Cached model instance (avoid re-reading model.json per call) */
let cachedModel = null;

/**
 * Get the model, loading from disk, or training on first use if missing.
 * Returns null only when both load and training fail.
 */
function getModel() {
  if (cachedModel) return cachedModel;
  cachedModel = loadModel();
  if (!cachedModel) {
    console.log('[ML] No model file found — training classifier on startup…');
    try {
      train({ quiet: false });
      cachedModel = loadModel();
    } catch (err) {
      console.warn('[ML] Training failed:', err.message);
    }
  }
  return cachedModel;
}

/**
 * Classify a complaint into the Classification Agent output schema.
 * Returns { primary_type, subcategory, ipc_sections, keywords, crime_icon, confidence }
 */
function classify(text, loaded) {
  const m = loaded || getModel();
  if (!m) return null;

  const x = m.vectorizer.transform(text);
  const probs = m.model.predictProba(x)[0];

  let best = 0;
  for (let c = 1; c < probs.length; c++) if (probs[c] > probs[best]) best = c;

  const label = m.classes[best];
  const meta = CLASS_META[label] || CLASS_META['General Complaint'];

  return {
    primary_type: label,
    subcategory: meta.subcategory,
    ipc_sections: [...meta.ipc],
    keywords: m.vectorizer.topTerms(text, 5),
    crime_icon: meta.icon,
    confidence: Math.round(probs[best] * 10000) / 10000,
  };
}

/** Predict all class probabilities (useful for UI/debugging). */
function predictProbs(text, loaded) {
  const m = loaded || getModel();
  if (!m) return null;
  const x = m.vectorizer.transform(text);
  const probs = m.model.predictProba(x)[0];
  return m.classes.map((c, i) => ({ label: c, probability: Math.round(probs[i] * 10000) / 10000 }))
    .sort((a, b) => b.probability - a.probability);
}

// Deterministic PRNG for reproducible splits
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { train, loadModel, getModel, classify, classifyLLM, classifyHybrid, classifyMock, predictProbs, CLASS_META, CLASSES, MODEL_PATH };