const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Models tried in order — the free tier rotates availability, so we fall back
const GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

async function callGeminiWithRetry(prompt, maxAttempts = 3) {
  let lastErr;
  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: 'application/json' },
        });
        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text());
      } catch (err) {
        lastErr = err;
        const msg = err.message || '';
        // 404 = model unavailable for this key, try next model immediately
        if (msg.includes('404')) break;
        // 429/503 = throttled/high demand — back off and retry same model
        if (msg.includes('429') || msg.includes('503')) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }
        // Other errors — try next model
        break;
      }
    }
  }
  throw lastErr;
}

async function runAgent(agentName, systemPrompt, userInput, mockData) {
  // Use mock mode if MOCK_MODE=true or no API key set
  if (process.env.MOCK_MODE === 'true' || !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400)); // simulate latency
    return mockData;
  }

  try {
    const prompt = `${systemPrompt}\n\nInput:\n${typeof userInput === 'string' ? userInput : JSON.stringify(userInput, null, 2)}\n\nRespond ONLY with valid JSON matching the specified output schema.`;
    return await callGeminiWithRetry(prompt);
  } catch (err) {
    console.error(`[${agentName}] Error:`, err.message);
    return mockData; // fallback to mock on error
  }
}

module.exports = { runAgent, callGeminiWithRetry };
