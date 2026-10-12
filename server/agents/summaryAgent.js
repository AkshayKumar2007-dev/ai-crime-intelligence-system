const { runAgent } = require('../geminiClient');

const SYSTEM_PROMPT = `You are the Case Summary Agent in a police crime intelligence system.
Your job is to synthesize all prior agent outputs into a concise, professional officer briefing.

Output JSON schema:
{
  "case_title": "string - short punchy case title (max 8 words)",
  "briefing": "string - 3-4 paragraph professional officer briefing covering: incident overview, entities extracted, severity assessment, intelligence flags, and recommended actions",
  "key_facts": ["array of 5 bullet-point key facts"],
  "immediate_actions": ["array of top 3 most critical immediate actions"],
  "case_tags": ["array of searchable tags for this case"],
  "officer_notes": "string - any special notes for assigned officer"
}`;

async function runSummaryAgent(complaintText, intakeData, classificationData, severityData, triageData, intelligenceData) {
  const input = {
    original_complaint: complaintText,
    intake_analysis: intakeData,
    classification: classificationData,
    severity: severityData,
    triage: triageData,
    intelligence: intelligenceData
  };
  const mock = summaryMock(complaintText, classificationData, severityData, triageData, intelligenceData);
  return await runAgent('SummaryAgent', SYSTEM_PROMPT, input, mock);
}

function summaryMock(text, cls, sev, triage, intel) {
  const crimeType = cls?.primary_type || 'Unknown Crime';
  const dept = triage?.department || 'Local Police Station';
  const severity = sev?.severity_label || 'MEDIUM';
  const score = sev?.severity_score || 5;

  return {
    case_title: `${severity} ${crimeType} — Immediate Review Required`,
    briefing: `INCIDENT OVERVIEW: A ${crimeType.toLowerCase()} complaint has been received and processed through the AI triage pipeline. The incident involves ${cls?.subcategory || crimeType} and has been assigned severity score ${score}/10 (${severity}) based on automated analysis of threat parameters and victim vulnerability.\n\nINTELLIGENCE ASSESSMENT: ${intel?.similar_case_pattern || 'Pattern analysis complete.'} The repeat offender likelihood is assessed at ${Math.round((intel?.repeat_offender_likelihood || 0.3) * 100)}%. ${intel?.organized_crime_indicator ? 'Organized crime nexus suspected — intelligence cell must be looped in.' : 'No organized crime links detected at this stage.'}\n\nROUTING DECISION: Case has been routed to ${dept} — ${triage?.unit || 'General Unit'} with ${triage?.recommended_officers || 2} officers recommended. Priority queue: ${triage?.priority_queue || 'NORMAL'}. SLA: ${sev?.sla_hours || 24} hours.\n\nRECOMMENDED ACTIONS: ${(triage?.action_items || []).slice(0, 2).join('. ')}. All assigned personnel should review the intelligence flags before site visit.`,
    key_facts: [
      `Crime Type: ${crimeType} (${cls?.subcategory || 'General'})`,
      `Severity: ${score}/10 — ${severity}`,
      `Department: ${dept}`,
      `SLA Deadline: ${sev?.sla_hours || 24} hours from case creation`,
      `Organized Crime Risk: ${intel?.organized_crime_indicator ? 'YES — Escalate' : 'No indication'}`,
    ],
    immediate_actions: (triage?.action_items || ['Investigate', 'File FIR', 'Assign officer']).slice(0, 3),
    case_tags: [crimeType, cls?.subcategory, severity, dept, intel?.geo_risk_level + ' Zone'].filter(Boolean),
    officer_notes: `${sev?.escalate_to_senior ? '⚠️ ESCALATE TO SENIOR OFFICER IMMEDIATELY. ' : ''}${intel?.recommended_surveillance ? '📡 Surveillance recommended for this location. ' : ''}Relevant IPC Sections: ${(cls?.ipc_sections || ['TBD']).join(', ')}.`
  };
}

module.exports = { runSummaryAgent };
