const { runAgent } = require('../geminiClient');

const SYSTEM_PROMPT = `You are the Intake Agent in a police crime intelligence system.
Your job is to parse a raw citizen complaint and extract structured information.

Output JSON schema:
{
  "entities": {
    "location": "string - specific address or area mentioned",
    "city": "string - city name",
    "date_time": "string - when the incident occurred",
    "persons_involved": ["array of persons mentioned (victim, suspect descriptions)"],
    "evidence_mentioned": ["array of evidence clues mentioned"],
    "vehicle": "string or null - any vehicle mentioned"
  },
  "incident_summary": "string - 1-2 sentence factual summary",
  "confidence_score": "number 0-1 - confidence in extraction quality",
  "missing_information": ["list of important details not provided"]
}`;

async function runIntakeAgent(complaintText) {
  const mock = {
    entities: {
      location: extractLocation(complaintText),
      city: extractCity(complaintText),
      date_time: extractDateTime(complaintText),
      persons_involved: ["Complainant", "Unknown suspect"],
      evidence_mentioned: ["Witness account"],
      vehicle: null
    },
    incident_summary: `Incident reported: "${complaintText.substring(0, 120)}..."`,
    confidence_score: 0.82,
    missing_information: ["Exact time of incident", "Suspect physical description", "Contact of witnesses"]
  };

  return await runAgent('IntakeAgent', SYSTEM_PROMPT, complaintText, mock);
}

function extractLocation(text) {
  const locations = ['MG Road', 'Connaught Place', 'Bandra', 'Koramangala', 'Sector 18', 'Lajpat Nagar', 'Juhu Beach', 'Cyber Hub', 'Salt Lake', 'T Nagar'];
  const found = locations.find(l => text.toLowerCase().includes(l.toLowerCase()));
  return found || 'Location mentioned in complaint';
}

function extractCity(text) {
  const cities = ['Delhi', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow'];
  const found = cities.find(c => text.toLowerCase().includes(c.toLowerCase()));
  return found || 'Delhi';
}

function extractDateTime(text) {
  if (text.toLowerCase().includes('yesterday')) return 'Yesterday evening';
  if (text.toLowerCase().includes('morning')) return 'This morning';
  if (text.toLowerCase().includes('night') || text.toLowerCase().includes('midnight')) return 'Last night';
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = { runIntakeAgent };
