const { classifyHybrid } = require('../ml/classifier');
const { runAgent } = require('../geminiClient');
const { getStore } = require('../store');

const SYSTEM_PROMPT = `You are the Classification Agent in a police crime intelligence system.
Your job is to classify the crime type from the complaint text and extracted entities.

Output JSON schema:
{
  "primary_type": "string - main crime category (e.g. Theft, Assault, Fraud, Cybercrime, Murder, Robbery, Kidnapping, Drug Trafficking, Domestic Violence, Hit & Run, Vandalism, Sexual Harassment, Extortion, Arson, Missing Person)",
  "subcategory": "string - specific subcategory (e.g. Chain Snatching, Online Scam, Road Rage, etc.)",
  "ipc_sections": ["array of relevant IPC section numbers as strings, e.g. '379', '420'"],
  "keywords": ["array of key crime-related terms from the complaint"],
  "crime_icon": "single emoji representing this crime type",
  "confidence": "number 0-1"
}`;

/**
 * Run the classification agent and return both the classification result
 * and the model version that produced it.
 * Returns { classification, modelVersion }
 */
async function runClassificationAgent(complaintText, intakeData) {
  const input = { complaint: complaintText, extracted_entities: intakeData };

  // Hybrid ML + LLM classification.
  // - In demo/MOCK_MODE: TF-IDF model classifies immediately (no network call).
  // - With a real Gemini API key: ML classifies first; if confidence is low the
  //   LLM refines it; if the LLM strongly disagrees it overrides the ML.
  const classification = await classifyHybrid(complaintText);

  // Strip internal source-tracking fields before passing to downstream agents
  const clean = {
    primary_type: classification.primary_type,
    subcategory: classification.subcategory,
    ipc_sections: classification.ipc_sections,
    keywords: classification.keywords || [],
    crime_icon: classification.crime_icon,
    confidence: classification.confidence != null ? classification.confidence : 0.5,
  };

  const enriched = await runAgent('ClassificationAgent', SYSTEM_PROMPT, input, clean);

  // Attach the model version that produced this classification
  let modelVersion = null;
  try {
    const store = await getStore();
    const current = await store.getCurrentModel();
    if (current) modelVersion = current.id;
  } catch (e) { /* store may not be ready */ }

  return { classification: enriched, modelVersion };
}

module.exports = { runClassificationAgent };
