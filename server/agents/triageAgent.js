const { runAgent } = require('../geminiClient');

const SYSTEM_PROMPT = `You are the Triage Agent in a police crime intelligence system.
Your job is to route the complaint to the correct police department and recommend resource allocation.

Output JSON schema:
{
  "department": "string - primary department (e.g. Local Police Station, CID, Cyber Cell, Anti-Narcotics, Crime Against Women Cell, Traffic Police, Special Branch, Economic Offenses Wing)",
  "unit": "string - specific unit within department",
  "priority_queue": "string - one of: IMMEDIATE, URGENT, NORMAL, DEFERRED",
  "recommended_officers": "integer - number of officers to assign",
  "action_items": ["array of 3-5 immediate action steps for the assigned officers"],
  "notify_agencies": ["array of other agencies to notify, e.g. Ambulance, Fire Brigade, Hospital"],
  "estimated_resolution_days": "integer"
}`;

const DEPT_MAP = {
  'Murder': { dept: 'Criminal Investigation Department (CID)', unit: 'Homicide Unit', queue: 'IMMEDIATE', officers: 6, agencies: ['Forensics', 'Ambulance', 'Medical Examiner'], days: 30 },
  'Kidnapping': { dept: 'Special Branch', unit: 'Anti-Kidnapping Cell', queue: 'IMMEDIATE', officers: 8, agencies: ['Intelligence Bureau', 'State CID'], days: 7 },
  'Cybercrime': { dept: 'Cyber Cell', unit: 'Digital Forensics Unit', queue: 'URGENT', officers: 2, agencies: ['Interpol Liaison', 'Bank Fraud Cell'], days: 14 },
  'Drug Trafficking': { dept: 'Anti-Narcotics Division', unit: 'Narcotics Control Bureau Liaison', queue: 'URGENT', officers: 5, agencies: ['NCB', 'Customs'], days: 21 },
  'Fraud': { dept: 'Economic Offenses Wing', unit: 'Financial Crimes Unit', queue: 'NORMAL', officers: 2, agencies: ['ED', 'Income Tax'], days: 30 },
  'Sexual Harassment': { dept: 'Crime Against Women Cell', unit: 'Mahila Thana', queue: 'IMMEDIATE', officers: 4, agencies: ['Victim Support Center', 'Medical'], days: 14 },
  'Domestic Violence': { dept: 'Crime Against Women Cell', unit: 'Domestic Violence Response Team', queue: 'URGENT', officers: 3, agencies: ['Social Welfare', 'Shelter Home'], days: 7 },
  'Assault': { dept: 'Local Police Station', unit: 'Law & Order Division', queue: 'URGENT', officers: 3, agencies: ['Medical'], days: 10 },
  'Arson': { dept: 'Local Police Station', unit: 'Special Crimes Unit', queue: 'IMMEDIATE', officers: 5, agencies: ['Fire Brigade', 'Forensics'], days: 21 },
  'Hit & Run': { dept: 'Traffic Police', unit: 'Accident Investigation Squad', queue: 'URGENT', officers: 3, agencies: ['Ambulance', 'NHAI'], days: 14 },
  'Theft': { dept: 'Local Police Station', unit: 'Property Crimes Unit', queue: 'NORMAL', officers: 2, agencies: [], days: 21 },
  'Extortion': { dept: 'Special Branch', unit: 'Organized Crime Unit', queue: 'URGENT', officers: 4, agencies: ['Intelligence Bureau'], days: 14 },
};

const ACTION_ITEMS = {
  IMMEDIATE: ['Dispatch patrol units to scene immediately', 'Secure and cordon the crime scene', 'Collect and preserve all physical evidence', 'Record statements from witnesses on site', 'Brief senior officer and file FIR within 1 hour'],
  URGENT: ['Assign lead investigator within 1 hour', 'Conduct preliminary site visit and evidence survey', 'File FIR and initiate case file', 'Identify and contact key witnesses', 'Submit progress report within 4 hours'],
  NORMAL: ['Acknowledge receipt and assign case number', 'Schedule victim interview within 24 hours', 'Collect documented evidence from complainant', 'Begin preliminary investigation', 'Provide case update within 3 days'],
  DEFERRED: ['Log complaint in system', 'Schedule officer visit within 72 hours', 'Request additional information from complainant', 'Assign to beat constable for follow-up'],
};

async function runTriageAgent(complaintText, intakeData, classificationData, severityData) {
  const input = { complaint: complaintText, entities: intakeData, classification: classificationData, severity: severityData };
  const mock = triageMock(classificationData, severityData);
  return await runAgent('TriageAgent', SYSTEM_PROMPT, input, mock);
}

function triageMock(cls, sev) {
  const mapped = DEPT_MAP[cls?.primary_type] || {
    dept: 'Local Police Station', unit: 'General Duty', queue: 'NORMAL', officers: 2, agencies: [], days: 15
  };
  const queue = sev?.severity_label === 'CRITICAL' ? 'IMMEDIATE' :
    sev?.severity_label === 'HIGH' ? 'URGENT' :
    sev?.severity_label === 'MEDIUM' ? 'NORMAL' : 'DEFERRED';

  return {
    department: mapped.dept,
    unit: mapped.unit,
    priority_queue: queue,
    recommended_officers: mapped.officers,
    action_items: ACTION_ITEMS[queue],
    notify_agencies: mapped.agencies,
    estimated_resolution_days: mapped.days
  };
}

module.exports = { runTriageAgent };
