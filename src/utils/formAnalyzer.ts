import {
  FormFieldAnalysis,
  FormFieldInput,
  FormPrivacyAnalysis,
  MinimizedFieldSuggestion,
  SensitiveCategory,
} from '../types.ts';

const NON_LOCATION_ADDRESS_REGEX = /\b(email|e-mail|web|url|ip|mac|wallet|crypto|phone|mobile|cell|fax)\b/i;
const BIOMETRIC_PII_REGEX =
  /\b(biometric|fingerprint|thumbprint|face\s*scan|iris|retina|selfie\s*with\s*id|cnic\s*(photo|scan|image|copy|upload|front|back)|id\s*(photo|scan|upload))\b/i;
const GOVERNMENT_ID_REGEX =
  /\b(cnic|national\s*id|nicop|poc|b-?form|passport|driving\s*licen[cs]e|ssn|tax\s*id|ntn|id\s*card|id\s*number|identity\s*number|dob|date\s*of\s*birth|birth\s*date)\b/i;
const LOCATION_PII_REGEX =
  /\b(address|permanent|residence|residential|home\s*location|street|postal\s*code|zip\s*code|domicile|city\s*of\s*birth)\b/i;

/**
 * Classifies a form field label into a privacy risk category.
 * Excludes email/phone/web/URL/IP addresses from LOCATION_PII.
 */
export function detectSensitiveCategory(label: string): SensitiveCategory {
  const clean = label.trim();
  if (!clean) return 'STANDARD';

  if (BIOMETRIC_PII_REGEX.test(clean)) {
    return 'BIOMETRIC_PII';
  }
  if (GOVERNMENT_ID_REGEX.test(clean)) {
    return 'GOVERNMENT_ID';
  }
  if (!NON_LOCATION_ADDRESS_REGEX.test(clean) && LOCATION_PII_REGEX.test(clean)) {
    return 'LOCATION_PII';
  }
  return 'STANDARD';
}

function getRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 85) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 35) return 'HIGH';
  return 'CRITICAL';
}

function analyzeSingleField(field: FormFieldInput): FormFieldAnalysis {
  const category = detectSensitiveCategory(field.label);
  const typeLower = field.type.toLowerCase();

  // File upload for ID/CNIC is also biometric/document PII
  const effectiveCategory: SensitiveCategory =
    category === 'STANDARD' && typeLower === 'file' && /id|cnic|document|scan/i.test(field.label)
      ? 'BIOMETRIC_PII'
      : category;

  switch (effectiveCategory) {
    case 'BIOMETRIC_PII':
      return {
        ...field,
        category: 'BIOMETRIC_PII',
        riskPoints: 30,
        reason: 'Collects raw identity document scans or biometric data, creating high breach liability.',
        recommendation: 'Remove document/biometric collection and request a BasItna Identity Verified token.',
      };
    case 'GOVERNMENT_ID':
      return {
        ...field,
        category: 'GOVERNMENT_ID',
        riskPoints: 25,
        reason: 'Collects raw government ID or Date of Birth directly in form storage.',
        recommendation: 'Replace with a single-use BasItna proof token (Identity Verified or 18+ Verified).',
      };
    case 'LOCATION_PII':
      return {
        ...field,
        category: 'LOCATION_PII',
        riskPoints: 15,
        reason: 'Collects physical home or permanent address PII unnecessary for digital verification.',
        recommendation: 'Omit unless physical shipping is strictly required.',
      };
    default:
      return {
        ...field,
        category: 'STANDARD',
        riskPoints: 0,
        reason: 'Low-risk operational field with minimal identity exposure.',
        recommendation: 'Safe to retain if operationally required.',
      };
  }
}

export function buildMinimizedSuggestion(
  analyzedFields: FormFieldAnalysis[]
): MinimizedFieldSuggestion[] {
  const suggestions: MinimizedFieldSuggestion[] = [];
  let addedProofToken = false;
  let needsAgeProof = false;
  let needsIdentityProof = false;

  for (const field of analyzedFields) {
    if (field.category === 'GOVERNMENT_ID' || field.category === 'BIOMETRIC_PII') {
      if (/\b(dob|date\s*of\s*birth|birth\s*date|age|18\+)\b/i.test(field.label)) {
        needsAgeProof = true;
      } else {
        needsIdentityProof = true;
      }
      if (!addedProofToken) {
        addedProofToken = true;
        suggestions.push({
          label: 'BasItna Verification Token',
          type: 'text',
          required: true,
          replaces: field.label,
          category: 'STANDARD',
        });
      }
      continue;
    }

    if (field.category === 'LOCATION_PII') {
      // Minimize physical address unless explicitly shipping/delivery
      if (/\b(shipping|delivery)\b/i.test(field.label)) {
        suggestions.push({
          label: field.label,
          type: field.type,
          required: false,
          category: 'LOCATION_PII',
        });
      }
      continue;
    }

    suggestions.push({
      label: field.label,
      type: field.type,
      required: field.required,
      category: 'STANDARD',
    });
  }

  if (addedProofToken) {
    const tokenItem = suggestions.find((s) => s.label === 'BasItna Verification Token');
    if (tokenItem) {
      const proofs: string[] = [];
      if (needsIdentityProof) proofs.push('Identity Verified');
      if (needsAgeProof) proofs.push('18+ Verified');
      tokenItem.label = `BasItna Proof Token (${proofs.join(' + ') || 'Identity Verified'})`;
    }
  }

  return suggestions;
}

export function analyzeFormLocally(
  fields: FormFieldInput[],
  formTitle = 'Untitled Registration Form'
): FormPrivacyAnalysis {
  const analyzedFields = fields.map(analyzeSingleField);
  const totalPenalty = analyzedFields.reduce((sum, f) => sum + f.riskPoints, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));
  const riskLevel = getRiskLevel(score);

  const minimizedFormSuggestion = buildMinimizedSuggestion(analyzedFields);
  const minimizedPenalty = minimizedFormSuggestion.reduce((sum, item) => {
    const cat = detectSensitiveCategory(item.label);
    if (cat === 'BIOMETRIC_PII') return sum + 30;
    if (cat === 'GOVERNMENT_ID') return sum + 25;
    if (cat === 'LOCATION_PII') return sum + 15;
    return sum;
  }, 0);
  const projectedScore = Math.max(0, Math.min(100, 100 - minimizedPenalty));
  const projectedRiskLevel = getRiskLevel(projectedScore);

  const sensitiveCount = analyzedFields.filter((f) => f.category !== 'STANDARD').length;
  const summary =
    sensitiveCount === 0
      ? 'This form follows data minimization principles and collects no high-risk CNIC or residential PII.'
      : `Detected ${sensitiveCount} sensitive field${sensitiveCount === 1 ? '' : 's'} exposing raw identity or location data. Replacing them with a BasItna proof token raises the privacy score from ${score} to ${projectedScore}.`;

  return {
    formTitle,
    score,
    riskLevel,
    summary,
    source: 'local',
    fields: analyzedFields,
    minimizedFormSuggestion,
    projectedScore,
    projectedRiskLevel,
  };
}
