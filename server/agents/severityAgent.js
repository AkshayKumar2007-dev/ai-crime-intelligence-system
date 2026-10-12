const { runAgent } = require('../geminiClient');

const SYSTEM_PROMPT = `You are the Severity Assessment Agent in a police crime intelligence system.
Your job is to assess the urgency and severity of the reported crime.

Consider: threat to human life, ongoing vs past incident, vulnerability of victim, weapons involved, scale of crime.

Output JSON schema:
{
  "severity_score": "integer 1-10 (10 = most severe)",
  "severity_label": "string - one of: CRITICAL, HIGH, MEDIUM, LOW",
  "sla_hours": "number - response SLA in hours (CRITICAL=1, HIGH=4, MEDIUM=24, LOW=72)",
  "threat_to_life": "boolean",
  "ongoing_incident": "boolean",
  "reasoning": "string - 2-3 sentence explanation of score",
  "escalate_to_senior": "boolean"
}`;

async function runSeverityAgent(complaintText, intakeData, classificationData) {
  const input = { complaint: complaintText, entities: intakeData, classification: classificationData };
  const mock = scoreSeverityMock(classificationData);
  return await runAgent('SeverityAgent', SYSTEM_PROMPT, input, mock);
}

function scoreSeverityMock(cls) {
  const highSeverity = ['Murder', 'Kidnapping', 'Sexual Harassment', 'Arson'];
  const medHighSeverity = ['Assault', 'Robbery', 'Hit & Run', 'Extortion', 'Drug Trafficking'];
  const medSeverity = ['Theft', 'Domestic Violence', 'Fraud'];

  let score, label, sla, life, escalate;

  if (highSeverity.includes(cls?.primary_type)) {
    score = Math.floor(Math.random() * 2) + 9; // 9-10
    label = 'CRITICAL'; sla = 1; life = true; escalate = true;
  } else if (medHighSeverity.includes(cls?.primary_type)) {
    score = Math.floor(Math.random() * 2) + 7; // 7-8
    label = 'HIGH'; sla = 4; life = false; escalate = false;
  } else if (medSeverity.includes(cls?.primary_type)) {
    score = Math.floor(Math.random() * 2) + 5; // 5-6
    label = 'MEDIUM'; sla = 24; life = false; escalate = false;
  } else {
    score = Math.floor(Math.random() * 2) + 3; // 3-4
    label = 'LOW'; sla = 72; life = false; escalate = false;
  }

  const reasoningMap = {
    CRITICAL: 'This crime poses an immediate threat to human life or personal safety. Incident requires immediate police response and senior officer notification. Delay in response could result in irreversible harm.',
    HIGH: 'This is a serious crime with significant impact on the victim and public safety. Priority response within 4 hours is warranted. Evidence preservation is time-sensitive.',
    MEDIUM: 'This crime involves property or financial harm without immediate life threat. Standard investigation procedure applies with 24-hour response window.',
    LOW: 'This is a non-urgent complaint with no immediate safety risk. Can be handled through normal administrative channels within 72 hours.'
  };

  return {
    severity_score: Math.min(score, 10),
    severity_label: label,
    sla_hours: sla,
    threat_to_life: life,
    ongoing_incident: Math.random() > 0.7,
    reasoning: reasoningMap[label],
    escalate_to_senior: escalate
  };
}

module.exports = { runSeverityAgent };
