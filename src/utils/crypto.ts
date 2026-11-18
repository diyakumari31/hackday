import crypto from 'node:crypto';
import { ProofCategory } from '../types.ts';
import { getConfig } from './config.ts';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hmacSha256(key: string | Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function deriveSubKey(purpose: string): Buffer {
  const { hmacSecret } = getConfig();
  return crypto.createHmac('sha256', hmacSecret).update(`basitna:${purpose}`).digest();
}

export function normalizeCnic(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 13) {
    throw new Error('Invalid CNIC format. Expected 13 digits (e.g. 42101-1234567-1).');
  }
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export function maskCnic(cnic: string): string {
  const normalized = normalizeCnic(cnic);
  return `${normalized.slice(0, 5)}-*******-${normalized.slice(-1)}`;
}

export function hashIdentity(cnic: string): string {
  const normalized = normalizeCnic(cnic);
  return hmacSha256(deriveSubKey('identity'), normalized);
}

/**
 * Derives a pairwise pseudonymous subject ID scoped to a single organization.
 * The same citizen receives the same subjectId at the same org, but a completely
 * different, unlinkable subjectId at every other org.
 */
export function deriveSubjectId(identityHmac: string, organizationId: string): string {
  return hmacSha256(deriveSubKey('identity'), `${identityHmac}|${organizationId}`).slice(0, 16);
}

export function generateTokenCode(): string {
  const bytes = crypto.randomBytes(8);
  let chars = '';
  for (let i = 0; i < 8; i++) {
    chars += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return `BI-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export function maskToken(tokenCode: string): string {
  const trimmed = tokenCode.trim().toUpperCase();
  const parts = trimmed.split('-');
  if (parts.length === 3 && parts[0] === 'BI') {
    return `BI-${parts[1]}-****`;
  }
  if (trimmed.length <= 4) return '****';
  return `${trimmed.slice(0, Math.max(4, trimmed.length - 4))}****`;
}

export function hashToken(tokenCode: string): string {
  return hmacSha256(deriveSubKey('token'), tokenCode.trim().toUpperCase());
}

export function hashOrgApiKey(apiKey: string): string {
  return hmacSha256(deriveSubKey('org-api'), apiKey.trim());
}

export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(identityHmac: string, otp: string): string {
  return hmacSha256(deriveSubKey('otp'), `${identityHmac}|${otp.trim()}`);
}

export function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface TokenSignaturePayload {
  tokenHash: string;
  organizationId: string;
  purpose: string;
  category: ProofCategory;
  proofResult: string;
  expiresAt: string;
}

export function signTokenPayload(payload: TokenSignaturePayload): string {
  const canonical = [
    payload.tokenHash,
    payload.organizationId,
    payload.purpose,
    payload.category,
    payload.proofResult,
    payload.expiresAt,
  ].join('|');
  return hmacSha256(deriveSubKey('signature'), canonical);
}

export function verifyTokenSignature(
  payload: TokenSignaturePayload,
  signature: string
): boolean {
  const expected = signTokenPayload(payload);
  return safeEqualHex(expected, signature);
}

export function signWalletSession(identityHmac: string, ttlMs = 15 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs;
  const sig = hmacSha256(deriveSubKey('wallet-session'), `${identityHmac}|${expiresAt}`);
  return `${identityHmac}.${expiresAt}.${sig}`;
}

export function verifyWalletSession(
  token: string,
  expectedIdentityHmac: string
): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [identityHmac, expStr, sig] = parts;
  if (identityHmac !== expectedIdentityHmac) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expectedSig = hmacSha256(deriveSubKey('wallet-session'), `${identityHmac}|${exp}`);
  return safeEqualHex(expectedSig, sig);
}

export function clampTtlHours(requestedHours?: number): number {
  const minHours = 1 / 60; // 1 minute
  const maxHours = 24; // 24 hours
  if (typeof requestedHours !== 'number' || !Number.isFinite(requestedHours)) {
    return 1;
  }
  return Math.min(maxHours, Math.max(minHours, requestedHours));
}

export interface NadraVerificationResponse {
  found: boolean;
  isAlive: boolean;
  is18Plus: boolean;
}

const MOCK_NADRA_REGISTRY: Record<string, { isAlive: boolean; is18Plus: boolean }> = {
  '42101-1234567-1': { isAlive: true, is18Plus: true },
  '35201-9988776-3': { isAlive: true, is18Plus: false },
  '61101-5544332-9': { isAlive: true, is18Plus: true },
  '37405-1122334-5': { isAlive: false, is18Plus: true },
};

/**
 * Mock NADRA verification gateway behind a single boundary function.
 * Never exposes name, DOB, address, or raw CNIC — only existence, alive status, and 18+ status.
 */
export function verifyWithNadra(cnic: string): NadraVerificationResponse {
  const normalized = normalizeCnic(cnic);
  const record = MOCK_NADRA_REGISTRY[normalized];
  if (!record) {
    return { found: false, isAlive: false, is18Plus: false };
  }
  return {
    found: true,
    isAlive: record.isAlive,
    is18Plus: record.is18Plus,
  };
}

const RAW_CNIC_REGEX = /\b\d{5}-?\d{7}-?\d\b/g;
const SENSITIVE_KEY_NAMES = new Set(['cnic', 'rawcnic', 'dob', 'dateofbirth', 'fullname']);

/**
 * Audits any stored data structure to verify zero raw CNICs, DOBs, or names are persisted.
 */
export function countStoredCnics(data: unknown): number {
  let count = 0;

  function visit(node: unknown, keyName?: string): void {
    if (node == null) return;

    if (typeof node === 'string') {
      if (keyName && SENSITIVE_KEY_NAMES.has(keyName.toLowerCase())) {
        if (!node.includes('*') && node.trim().length > 0) {
          count += 1;
          return;
        }
      }
      const matches = node.match(RAW_CNIC_REGEX);
      if (matches) {
        count += matches.length;
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, k);
      }
    }
  }

  visit(data);
  return count;
}
