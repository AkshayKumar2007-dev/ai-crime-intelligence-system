const { runAgent } = require('../geminiClient');

const SYSTEM_PROMPT = `You are the Intelligence Analysis Agent in a police crime intelligence system.
Your job is to identify patterns, hotspot risks, and intelligence flags from the complaint.

Output JSON schema:
{
  "pattern_flags": ["array of identified patterns or modus operandi clues"],
  "hotspot_risk": "string - one of: HIGH, MEDIUM, LOW - risk of this area being a crime hotspot",
  "repeat_offender_likelihood": "number 0-1 - probability this involves a repeat offender",
  "organized_crime_indicator": "boolean",
  "similar_case_pattern": "string - description of similar crime patterns seen",
  "intelligence_notes": "string - analyst notes on broader crime intelligence relevance",
  "recommended_surveillance": "boolean",
  "geo_risk_level": "string - one of: RED, ORANGE, YELLOW, GREEN"
}`;

async function runIntelligenceAgent(complaintText, intakeData, classificationData, severityData) {
  const input = { complaint: complaintText, entities: intakeData, classification: classificationData, severity: severityData };
  const mock = intelligenceMock(classificationData, intakeData);
  return await runAgent('IntelligenceAgent', SYSTEM_PROMPT, input, mock);
}

function intelligenceMock(cls, intake) {
  const highRiskTypes = ['Murder', 'Kidnapping', 'Drug Trafficking', 'Extortion', 'Arson'];
  const organizedTypes = ['Drug Trafficking', 'Extortion', 'Cybercrime', 'Kidnapping', 'Fraud'];
  const isHigh = highRiskTypes.includes(cls?.primary_type);
  const isOrganized = organizedTypes.includes(cls?.primary_type);

  const patternsByType = {
    'Theft': ['Chain snatching pattern common in evening hours', 'Suspects operate in pairs near crowded markets', 'Similar incidents reported in adjacent localities'],
    'Cybercrime': ['Phishing SMS pattern matches known cybercriminal network', 'Bank OTP fraud spike in region', 'IP routing through VPN proxies detected in similar cases'],
    'Drug Trafficking': ['Trafficking route matches known corridor', 'Modus operandi matches interstate gang activity', 'Vehicle registration pattern suggests network'],
    'Fraud': ['Common 419 scam pattern detected', 'Similar fraudulent business registration seen in 3 other cases', 'Cheque bouncing pattern linked to financial fraud ring'],
    'Assault': ['Road rage pattern common in area', 'Suspect description matches 2 prior complaint witnesses', 'Incident timing matches known gang territory dispute'],
    'Murder': ['Weapon type matches previous unsolved homicide', 'Victim profile matches targeted killings pattern', 'Geographic clustering suggests serial activity'],
    'Kidnapping': ['Ransom demand matches interstate gang script', 'Vehicle description matches kidnapping in adjacent district', 'High-value target profiling detected'],
    'Sexual Harassment': ['Perpetrator pattern matches repeat offender profile', 'Location is known harassment hotspot', 'Modus operandi matches 3 prior unreported incidents'],
    'Domestic Violence': ['Repeat complaint from same household', 'Escalation pattern indicates high danger risk', 'Prior NCW complaint on record'],
    'Hit & Run': ['CCTV coverage available at intersection', 'Vehicle description matches stolen vehicle report', 'Driver profile matches drunk-driving offender database'],
    'Arson': ['Timing suggests business rivalry motive', 'Accelerant pattern matches arsonist MO from 2 cases', 'Insurance fraud investigation recommended'],
    'Extortion': ['Demand pattern matches extortion ring operating in city', 'Phone number used matches prior extortion complaints', 'Organized crime nexus suspected'],
  };

  const patterns = patternsByType[cls?.primary_type] || ['Pattern analysis pending further data', 'No clear MO match found in current database', 'Recommend standard investigation protocol'];

  return {
    pattern_flags: patterns,
    hotspot_risk: isHigh ? 'HIGH' : Math.random() > 0.5 ? 'MEDIUM' : 'LOW',
    repeat_offender_likelihood: isOrganized ? 0.78 : Math.random() * 0.5 + 0.1,
    organized_crime_indicator: isOrganized,
    similar_case_pattern: `${cls?.primary_type} incidents have increased 23% in this zone over the last 30 days. Similar MO detected in 3-4 recent cases.`,
    intelligence_notes: `This case warrants cross-referencing with state-level crime database. ${isOrganized ? 'Potential organized crime network involvement — recommend intelligence cell notification.' : 'No immediate network links detected but monitoring advised.'}`,
    recommended_surveillance: isHigh || isOrganized,
    geo_risk_level: isHigh ? 'RED' : isOrganized ? 'ORANGE' : 'YELLOW'
  };
}

module.exports = { runIntelligenceAgent };
