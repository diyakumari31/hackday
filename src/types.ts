export type TabId = 'citizen' | 'organization' | 'analyzer' | 'inspector' | 'activity';

export type ProofCategory = 'IDENTITY_VERIFIED' | 'AGE_18_PLUS';

export type TokenStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';

export type AuditStatus =
  | 'ISSUED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'REVOKED'
  | 'FLAGGED'
  | 'OTP_REQUESTED'
  | 'OTP_FAILED';

export type VerificationStatus =
  | 'VERIFIED'
  | 'EXPIRED'
  | 'REDEEMED'
  | 'INVALID'
  | 'REVOKED'
  | 'WRONG_ORG'
  | 'WRONG_PURPOSE'
  | 'UNAUTHORIZED';

export type SensitiveCategory =
  | 'STANDARD'
  | 'LOCATION_PII'
  | 'GOVERNMENT_ID'
  | 'BIOMETRIC_PII';

export type InstitutionType =
  | 'School'
  | 'College'
  | 'University'
  | 'Undergraduate'
  | 'Postgraduate';

export interface Organization {
  id: string;
  name: string;
  sector: string;
  description: string;
  allowedPurposes: string[];
  apiKeyHash: string;
  demoApiKey?: string;
}

export interface TokenRecord {
  id: string;
  tokenCode: string;
  tokenHash: string;
  maskedToken: string;
  identityHmac: string;
  organizationId: string;
  organizationName: string;
  category: ProofCategory;
  purpose: string;
  proofResult: string;
  signature: string;
  status: TokenStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  status: AuditStatus;
  tokenMasked: string;
  identityHmac?: string;
  organizationId?: string;
  organizationName?: string;
  purpose?: string;
  details: string;
}

export interface OtpChallenge {
  id: string;
  identityHmac: string;
  otpHash: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  used: boolean;
  createdAt: string;
}

export interface VerificationResult {
  valid: boolean;
  status: VerificationStatus;
  message: string;
  category?: ProofCategory;
  proofResult?: string;
  purpose?: string;
  organizationId?: string;
  organizationName?: string;
  issuedAt?: string;
  expiresAt?: string;
  redeemedAt?: string;
  subjectId?: string;
}

export interface CitizenBlockedAttempt {
  id: string;
  timestamp: string;
  organizationId?: string;
  organizationName?: string;
  purpose?: string;
  details: string;
  status: AuditStatus;
}

export interface CitizenTokenActivityItem {
  id: string;
  maskedToken: string;
  organizationId: string;
  organizationName: string;
  category: ProofCategory;
  purpose: string;
  proofResult: string;
  status: TokenStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
  blockedAttempts: CitizenBlockedAttempt[];
}

export interface CitizenOrgSummary {
  organizationId: string;
  organizationName: string;
  totalTokens: number;
  redeemedCount: number;
  activeCount: number;
  flaggedCount: number;
  lastActivityAt: string;
}

export interface CitizenActivityResponse {
  maskedCnic: string;
  walletSession: string;
  summary: {
    totalTokens: number;
    activeTokens: number;
    redeemedTokens: number;
    expiredTokens: number;
    revokedTokens: number;
    blockedAttempts: number;
    organizationsCount: number;
  };
  flaggedAlerts: CitizenBlockedAttempt[];
  organizations: CitizenOrgSummary[];
  tokens: CitizenTokenActivityItem[];
}

export interface OrganizationStatsResponse {
  organizationId: string;
  organizationName: string;
  redeemedCount: number;
  rejectedCount: number;
  flaggedCount: number;
  issuedCount: number;
  byPurpose: Array<{
    purpose: string;
    redeemed: number;
    rejected: number;
    flagged: number;
  }>;
  recentEvents: AuditEntry[];
}

export interface LiveEvent {
  id: string;
  type: 'ISSUED' | 'REDEEMED' | 'REJECTED' | 'REVOKED' | 'FLAGGED';
  organizationId: string;
  organizationName: string;
  purpose: string;
  status: string;
  maskedToken: string;
  timestamp: string;
  proofResult?: string;
}

export interface FormFieldInput {
  id: string;
  label: string;
  type: string;
  required: boolean;
}

export interface FormFieldAnalysis {
  id: string;
  label: string;
  type: string;
  required: boolean;
  category: SensitiveCategory;
  riskPoints: number;
  reason: string;
  recommendation: string;
}

export interface MinimizedFieldSuggestion {
  label: string;
  type: string;
  required: boolean;
  replaces?: string;
  category: SensitiveCategory;
}

export interface FormPrivacyAnalysis {
  formTitle: string;
  score: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: string;
  source: 'gemini' | 'local';
  fields: FormFieldAnalysis[];
  minimizedFormSuggestion: MinimizedFieldSuggestion[];
  projectedScore: number;
  projectedRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
