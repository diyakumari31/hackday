import crypto from 'node:crypto';
import { Pool } from 'pg';
import {
  AuditEntry,
  AuditStatus,
  Organization,
  OtpChallenge,
  TokenRecord,
  TokenStatus,
} from '../types.ts';
import { getConfig } from '../utils/config.ts';
import { hashOrgApiKey, safeEqualHex } from '../utils/crypto.ts';

export interface VerifyOtpOutcome {
  ok: boolean;
  reason?: 'NO_CHALLENGE' | 'EXPIRED' | 'ATTEMPTS_EXCEEDED' | 'INVALID_OTP';
  message?: string;
}

export interface Store {
  readonly mode: 'memory' | 'postgres';
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;

  getOrganizations(): Promise<Organization[]>;
  getOrganizationById(id: string): Promise<Organization | null>;

  createOtpChallenge(challenge: Omit<OtpChallenge, 'id' | 'attempts' | 'used' | 'createdAt'>): Promise<OtpChallenge>;
  verifyAndConsumeOtp(identityHmac: string, otpHash: string): Promise<VerifyOtpOutcome>;

  createToken(record: Omit<TokenRecord, 'id' | 'tokenCode'>): Promise<TokenRecord>;
  getTokenByHash(tokenHash: string): Promise<TokenRecord | null>;
  getTokenById(id: string): Promise<TokenRecord | null>;
  redeemTokenIfActive(tokenHash: string, redeemedAt: string): Promise<TokenRecord | null>;
  revokeTokenIfActive(tokenId: string, identityHmac: string, revokedAt: string): Promise<TokenRecord | null>;
  getTokensByIdentity(identityHmac: string): Promise<TokenRecord[]>;
  listTokens(): Promise<TokenRecord[]>;
  purgeExpiredTokens(olderThanIso: string): Promise<number>;

  addAuditLog(entry: Omit<AuditEntry, 'id' | 'timestamp'> & { tokenHash?: string }): Promise<AuditEntry & { tokenHash?: string }>;
  getAuditLogs(): Promise<Array<AuditEntry & { tokenHash?: string }>>;
  getAuditLogsByIdentity(identityHmac: string): Promise<Array<AuditEntry & { tokenHash?: string }>>;
  getAuditLogsByOrganization(organizationId: string): Promise<Array<AuditEntry & { tokenHash?: string }>>;
}

interface SeedOrgDef {
  id: string;
  name: string;
  sector: string;
  description: string;
  allowedPurposes: string[];
  demoKey: string;
}

const SEED_ORGANIZATIONS: SeedOrgDef[] = [
  {
    id: 'hbl-digital',
    name: 'HBL Digital',
    sector: 'Banking & FinTech',
    description: 'Digital banking onboarding and age-compliant financial product verification.',
    allowedPurposes: ['Account Opening', 'KYC Verification', 'Age-Restricted Product'],
    demoKey: 'basitna-demo-key-hbl-digital',
  },
  {
    id: 'jazzcash',
    name: 'JazzCash Wallet',
    sector: 'Mobile Payments',
    description: 'Biometric-free mobile wallet tier upgrades using single-use CNIC proofs.',
    allowedPurposes: ['Wallet Tier Upgrade', 'KYC Verification'],
    demoKey: 'basitna-demo-key-jazzcash',
  },
  {
    id: 'hec-portal',
    name: 'HEC Student Portal',
    sector: 'Higher Education',
    description: 'University admission and scholarship eligibility verification without raw CNIC scans.',
    allowedPurposes: ['Scholarship Eligibility', 'University Admissions'],
    demoKey: 'basitna-demo-key-hec-portal',
  },
  {
    id: 'daraz-pay',
    name: 'Daraz Pay & Checkout',
    sector: 'E-Commerce',
    description: 'Age-restricted checkout and high-value order verification.',
    allowedPurposes: ['Age-Restricted Product', 'COD Fraud Prevention'],
    demoKey: 'basitna-demo-key-daraz-pay',
  },
];

function buildSeedOrgs(): Organization[] {
  const { demoMode } = getConfig();
  return SEED_ORGANIZATIONS.map((o) => ({
    id: o.id,
    name: o.name,
    sector: o.sector,
    description: o.description,
    allowedPurposes: [...o.allowedPurposes],
    apiKeyHash: hashOrgApiKey(o.demoKey),
    ...(demoMode ? { demoApiKey: o.demoKey } : {}),
  }));
}

export function computeEffectiveTokenStatus(token: {
  status: TokenStatus;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}): TokenStatus {
  if (token.revokedAt || token.status === 'REVOKED') return 'REVOKED';
  if (token.redeemedAt || token.status === 'REDEEMED') return 'REDEEMED';
  if (Date.now() > new Date(token.expiresAt).getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export class MemoryStore implements Store {
  readonly mode = 'memory' as const;
  private organizations: Organization[] = [];
  private tokens: Array<Omit<TokenRecord, 'tokenCode'>> = [];
  private auditLogs: Array<AuditEntry & { tokenHash?: string }> = [];
  private otpChallenges: OtpChallenge[] = [];

  async init(): Promise<void> {
    this.organizations = buildSeedOrgs();
  }

  async close(): Promise<void> {
    // No-op for in-memory store
  }

  async reset(): Promise<void> {
    this.organizations = buildSeedOrgs();
    this.tokens = [];
    this.auditLogs = [];
    this.otpChallenges = [];
  }

  async getOrganizations(): Promise<Organization[]> {
    return this.organizations.map((o) => ({ ...o, allowedPurposes: [...o.allowedPurposes] }));
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    const found = this.organizations.find((o) => o.id === id);
    return found ? { ...found, allowedPurposes: [...found.allowedPurposes] } : null;
  }

  async createOtpChallenge(
    challenge: Omit<OtpChallenge, 'id' | 'attempts' | 'used' | 'createdAt'>
  ): Promise<OtpChallenge> {
    // Invalidate older unused challenges for the same identity
    for (const existing of this.otpChallenges) {
      if (existing.identityHmac === challenge.identityHmac && !existing.used) {
        existing.used = true;
      }
    }
    const created: OtpChallenge = {
      id: crypto.randomUUID(),
      identityHmac: challenge.identityHmac,
      otpHash: challenge.otpHash,
      expiresAt: challenge.expiresAt,
      attempts: 0,
      maxAttempts: challenge.maxAttempts,
      used: false,
      createdAt: new Date().toISOString(),
    };
    this.otpChallenges.push(created);
    return { ...created };
  }

  async verifyAndConsumeOtp(identityHmac: string, otpHash: string): Promise<VerifyOtpOutcome> {
    const candidates = this.otpChallenges
      .filter((c) => c.identityHmac === identityHmac && !c.used)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const latest = candidates[0];
    if (!latest) {
      return {
        ok: false,
        reason: 'NO_CHALLENGE',
        message: 'No active OTP found. Please request a fresh OTP.',
      };
    }

    if (Date.now() > new Date(latest.expiresAt).getTime()) {
      latest.used = true;
      return {
        ok: false,
        reason: 'EXPIRED',
        message: 'OTP has expired (5 minute limit). Please request a new OTP.',
      };
    }

    if (latest.attempts >= latest.maxAttempts) {
      latest.used = true;
      return {
        ok: false,
        reason: 'ATTEMPTS_EXCEEDED',
        message: 'Maximum OTP attempts exceeded. Please request a new OTP.',
      };
    }

    latest.attempts += 1;

    if (!safeEqualHex(latest.otpHash, otpHash)) {
      if (latest.attempts >= latest.maxAttempts) {
        latest.used = true;
        return {
          ok: false,
          reason: 'ATTEMPTS_EXCEEDED',
          message: 'Maximum OTP attempts exceeded. Please request a new OTP.',
        };
      }
      return {
        ok: false,
        reason: 'INVALID_OTP',
        message: `Incorrect OTP. ${latest.maxAttempts - latest.attempts} attempt(s) remaining.`,
      };
    }

    latest.used = true;
    return { ok: true };
  }

  async createToken(record: Omit<TokenRecord, 'id' | 'tokenCode'>): Promise<TokenRecord> {
    const created: Omit<TokenRecord, 'tokenCode'> = {
      ...record,
      id: crypto.randomUUID(),
    };
    this.tokens.unshift(created);
    return { ...created, tokenCode: '' };
  }

  async getTokenByHash(tokenHash: string): Promise<TokenRecord | null> {
    const found = this.tokens.find((t) => t.tokenHash === tokenHash);
    if (!found) return null;
    return {
      ...found,
      tokenCode: '',
      status: computeEffectiveTokenStatus(found),
    };
  }

  async getTokenById(id: string): Promise<TokenRecord | null> {
    const found = this.tokens.find((t) => t.id === id);
    if (!found) return null;
    return {
      ...found,
      tokenCode: '',
      status: computeEffectiveTokenStatus(found),
    };
  }

  async redeemTokenIfActive(tokenHash: string, redeemedAt: string): Promise<TokenRecord | null> {
    const found = this.tokens.find((t) => t.tokenHash === tokenHash);
    if (!found) return null;
    const effective = computeEffectiveTokenStatus(found);
    if (effective !== 'ACTIVE') return null;

    found.status = 'REDEEMED';
    found.redeemedAt = redeemedAt;
    return { ...found, tokenCode: '' };
  }

  async revokeTokenIfActive(
    tokenId: string,
    identityHmac: string,
    revokedAt: string
  ): Promise<TokenRecord | null> {
    const found = this.tokens.find(
      (t) => t.id === tokenId && t.identityHmac === identityHmac
    );
    if (!found) return null;
    const effective = computeEffectiveTokenStatus(found);
    if (effective !== 'ACTIVE') return null;

    found.status = 'REVOKED';
    found.revokedAt = revokedAt;
    return { ...found, tokenCode: '' };
  }

  async getTokensByIdentity(identityHmac: string): Promise<TokenRecord[]> {
    return this.tokens
      .filter((t) => t.identityHmac === identityHmac)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => ({
        ...t,
        tokenCode: '',
        status: computeEffectiveTokenStatus(t),
      }));
  }

  async listTokens(): Promise<TokenRecord[]> {
    return this.tokens
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => ({
        ...t,
        tokenCode: '',
        status: computeEffectiveTokenStatus(t),
      }));
  }

  async purgeExpiredTokens(olderThanIso: string): Promise<number> {
    const cutoff = new Date(olderThanIso).getTime();
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((t) => new Date(t.expiresAt).getTime() >= cutoff);
    return before - this.tokens.length;
  }

  async addAuditLog(
    entry: Omit<AuditEntry, 'id' | 'timestamp'> & { tokenHash?: string }
  ): Promise<AuditEntry & { tokenHash?: string }> {
    const created: AuditEntry & { tokenHash?: string } = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(created);
    return { ...created };
  }

  async getAuditLogs(): Promise<Array<AuditEntry & { tokenHash?: string }>> {
    return this.auditLogs.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async getAuditLogsByIdentity(
    identityHmac: string
  ): Promise<Array<AuditEntry & { tokenHash?: string }>> {
    return this.auditLogs
      .filter((l) => l.identityHmac === identityHmac)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async getAuditLogsByOrganization(
    organizationId: string
  ): Promise<Array<AuditEntry & { tokenHash?: string }>> {
    return this.auditLogs
      .filter((l) => l.organizationId === organizationId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

export class PgStore implements Store {
  readonly mode = 'postgres' as const;
  private pool: Pool;

  constructor(databaseUrl: string, ssl: boolean) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sector TEXT NOT NULL,
        description TEXT NOT NULL,
        allowed_purposes JSONB NOT NULL,
        api_key_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        masked_token TEXT NOT NULL,
        identity_hmac TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        organization_name TEXT NOT NULL,
        category TEXT NOT NULL,
        purpose TEXT NOT NULL,
        proof_result TEXT NOT NULL,
        signature TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        redeemed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );

      ALTER TABLE tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_tokens_identity_hmac ON tokens (identity_hmac, created_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        token_masked TEXT NOT NULL,
        token_hash TEXT,
        identity_hmac TEXT,
        organization_id TEXT,
        organization_name TEXT,
        purpose TEXT,
        details TEXT NOT NULL
      );

      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS token_hash TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS identity_hmac TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS organization_name TEXT;

      CREATE INDEX IF NOT EXISTS idx_audit_identity_hmac ON audit_logs (identity_hmac, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_org_id ON audit_logs (organization_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS otp_challenges (
        id TEXT PRIMARY KEY,
        identity_hmac TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_otp_identity ON otp_challenges (identity_hmac, created_at DESC);
    `);

    await this.seedOrganizations();
  }

  private async seedOrganizations(): Promise<void> {
    const orgs = buildSeedOrgs();
    for (const org of orgs) {
      await this.pool.query(
        `
        INSERT INTO organizations (id, name, sector, description, allowed_purposes, api_key_hash)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          sector = EXCLUDED.sector,
          description = EXCLUDED.description,
          allowed_purposes = EXCLUDED.allowed_purposes,
          api_key_hash = EXCLUDED.api_key_hash
        `,
        [
          org.id,
          org.name,
          org.sector,
          org.description,
          JSON.stringify(org.allowedPurposes),
          org.apiKeyHash,
        ]
      );
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async reset(): Promise<void> {
    await this.pool.query('TRUNCATE TABLE tokens, audit_logs, otp_challenges');
    await this.seedOrganizations();
  }

  private mapOrgRow(row: Record<string, unknown>): Organization {
    const { demoMode } = getConfig();
    const id = String(row.id);
    const seed = SEED_ORGANIZATIONS.find((s) => s.id === id);
    return {
      id,
      name: String(row.name),
      sector: String(row.sector),
      description: String(row.description),
      allowedPurposes: Array.isArray(row.allowed_purposes)
        ? (row.allowed_purposes as string[])
        : JSON.parse(String(row.allowed_purposes)),
      apiKeyHash: String(row.api_key_hash),
      ...(demoMode && seed ? { demoApiKey: seed.demoKey } : {}),
    };
  }

  private mapTokenRow(row: Record<string, unknown>): TokenRecord {
    const base = {
      id: String(row.id),
      tokenCode: '',
      tokenHash: String(row.token_hash),
      maskedToken: String(row.masked_token),
      identityHmac: String(row.identity_hmac),
      organizationId: String(row.organization_id),
      organizationName: String(row.organization_name),
      category: String(row.category) as TokenRecord['category'],
      purpose: String(row.purpose),
      proofResult: String(row.proof_result),
      signature: String(row.signature),
      status: String(row.status) as TokenStatus,
      createdAt: new Date(String(row.created_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      redeemedAt: row.redeemed_at ? new Date(String(row.redeemed_at)).toISOString() : null,
      revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    };
    return {
      ...base,
      status: computeEffectiveTokenStatus(base),
    };
  }

  private mapAuditRow(row: Record<string, unknown>): AuditEntry & { tokenHash?: string } {
    return {
      id: String(row.id),
      timestamp: new Date(String(row.timestamp)).toISOString(),
      action: String(row.action),
      status: String(row.status) as AuditStatus,
      tokenMasked: String(row.token_masked),
      ...(row.token_hash ? { tokenHash: String(row.token_hash) } : {}),
      ...(row.identity_hmac ? { identityHmac: String(row.identity_hmac) } : {}),
      ...(row.organization_id ? { organizationId: String(row.organization_id) } : {}),
      ...(row.organization_name ? { organizationName: String(row.organization_name) } : {}),
      ...(row.purpose ? { purpose: String(row.purpose) } : {}),
      details: String(row.details),
    };
  }

  async getOrganizations(): Promise<Organization[]> {
    const res = await this.pool.query('SELECT * FROM organizations ORDER BY name ASC');
    return res.rows.map((r) => this.mapOrgRow(r));
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    const res = await this.pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
    return res.rows[0] ? this.mapOrgRow(res.rows[0]) : null;
  }

  async createOtpChallenge(
    challenge: Omit<OtpChallenge, 'id' | 'attempts' | 'used' | 'createdAt'>
  ): Promise<OtpChallenge> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await this.pool.query(
      'UPDATE otp_challenges SET used = TRUE WHERE identity_hmac = $1 AND used = FALSE',
      [challenge.identityHmac]
    );
    await this.pool.query(
      `
      INSERT INTO otp_challenges (id, identity_hmac, otp_hash, expires_at, attempts, max_attempts, used, created_at)
      VALUES ($1, $2, $3, $4, 0, $5, FALSE, $6)
      `,
      [
        id,
        challenge.identityHmac,
        challenge.otpHash,
        challenge.expiresAt,
        challenge.maxAttempts,
        createdAt,
      ]
    );
    return {
      id,
      identityHmac: challenge.identityHmac,
      otpHash: challenge.otpHash,
      expiresAt: challenge.expiresAt,
      attempts: 0,
      maxAttempts: challenge.maxAttempts,
      used: false,
      createdAt,
    };
  }

  async verifyAndConsumeOtp(identityHmac: string, otpHash: string): Promise<VerifyOtpOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `
        SELECT * FROM otp_challenges
        WHERE identity_hmac = $1 AND used = FALSE
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
        `,
        [identityHmac]
      );
      const row = res.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return {
          ok: false,
          reason: 'NO_CHALLENGE',
          message: 'No active OTP found. Please request a fresh OTP.',
        };
      }

      const expiresAt = new Date(String(row.expires_at)).getTime();
      if (Date.now() > expiresAt) {
        await client.query('UPDATE otp_challenges SET used = TRUE WHERE id = $1', [row.id]);
        await client.query('COMMIT');
        return {
          ok: false,
          reason: 'EXPIRED',
          message: 'OTP has expired (5 minute limit). Please request a new OTP.',
        };
      }

      const attempts = Number(row.attempts);
      const maxAttempts = Number(row.max_attempts);
      if (attempts >= maxAttempts) {
        await client.query('UPDATE otp_challenges SET used = TRUE WHERE id = $1', [row.id]);
        await client.query('COMMIT');
        return {
          ok: false,
          reason: 'ATTEMPTS_EXCEEDED',
          message: 'Maximum OTP attempts exceeded. Please request a new OTP.',
        };
      }

      const nextAttempts = attempts + 1;
      const matches = safeEqualHex(String(row.otp_hash), otpHash);

      if (!matches) {
        const lock = nextAttempts >= maxAttempts;
        await client.query(
          'UPDATE otp_challenges SET attempts = $1, used = $2 WHERE id = $3',
          [nextAttempts, lock, row.id]
        );
        await client.query('COMMIT');
        if (lock) {
          return {
            ok: false,
            reason: 'ATTEMPTS_EXCEEDED',
            message: 'Maximum OTP attempts exceeded. Please request a new OTP.',
          };
        }
        return {
          ok: false,
          reason: 'INVALID_OTP',
          message: `Incorrect OTP. ${maxAttempts - nextAttempts} attempt(s) remaining.`,
        };
      }

      await client.query(
        'UPDATE otp_challenges SET attempts = $1, used = TRUE WHERE id = $2',
        [nextAttempts, row.id]
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async createToken(record: Omit<TokenRecord, 'id' | 'tokenCode'>): Promise<TokenRecord> {
    const id = crypto.randomUUID();
    await this.pool.query(
      `
      INSERT INTO tokens (
        id, token_hash, masked_token, identity_hmac, organization_id, organization_name,
        category, purpose, proof_result, signature, status, created_at, expires_at, redeemed_at, revoked_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `,
      [
        id,
        record.tokenHash,
        record.maskedToken,
        record.identityHmac,
        record.organizationId,
        record.organizationName,
        record.category,
        record.purpose,
        record.proofResult,
        record.signature,
        record.status,
        record.createdAt,
        record.expiresAt,
        record.redeemedAt,
        record.revokedAt,
      ]
    );
    return { ...record, id, tokenCode: '' };
  }

  async getTokenByHash(tokenHash: string): Promise<TokenRecord | null> {
    const res = await this.pool.query('SELECT * FROM tokens WHERE token_hash = $1', [tokenHash]);
    return res.rows[0] ? this.mapTokenRow(res.rows[0]) : null;
  }

  async getTokenById(id: string): Promise<TokenRecord | null> {
    const res = await this.pool.query('SELECT * FROM tokens WHERE id = $1', [id]);
    return res.rows[0] ? this.mapTokenRow(res.rows[0]) : null;
  }

  async redeemTokenIfActive(tokenHash: string, redeemedAt: string): Promise<TokenRecord | null> {
    const res = await this.pool.query(
      `
      UPDATE tokens
      SET status = 'REDEEMED', redeemed_at = $2
      WHERE token_hash = $1
        AND status = 'ACTIVE'
        AND redeemed_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > NOW()
      RETURNING *
      `,
      [tokenHash, redeemedAt]
    );
    return res.rows[0] ? this.mapTokenRow(res.rows[0]) : null;
  }

  async revokeTokenIfActive(
    tokenId: string,
    identityHmac: string,
    revokedAt: string
  ): Promise<TokenRecord | null> {
    const res = await this.pool.query(
      `
      UPDATE tokens
      SET status = 'REVOKED', revoked_at = $3
      WHERE id = $1
        AND identity_hmac = $2
        AND status = 'ACTIVE'
        AND redeemed_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > NOW()
      RETURNING *
      `,
      [tokenId, identityHmac, revokedAt]
    );
    return res.rows[0] ? this.mapTokenRow(res.rows[0]) : null;
  }

  async getTokensByIdentity(identityHmac: string): Promise<TokenRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM tokens WHERE identity_hmac = $1 ORDER BY created_at DESC',
      [identityHmac]
    );
    return res.rows.map((r) => this.mapTokenRow(r));
  }

  async listTokens(): Promise<TokenRecord[]> {
    const res = await this.pool.query('SELECT * FROM tokens ORDER BY created_at DESC');
    return res.rows.map((r) => this.mapTokenRow(r));
  }

  async purgeExpiredTokens(olderThanIso: string): Promise<number> {
    const res = await this.pool.query('DELETE FROM tokens WHERE expires_at < $1', [olderThanIso]);
    return res.rowCount ?? 0;
  }

  async addAuditLog(
    entry: Omit<AuditEntry, 'id' | 'timestamp'> & { tokenHash?: string }
  ): Promise<AuditEntry & { tokenHash?: string }> {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    await this.pool.query(
      `
      INSERT INTO audit_logs (
        id, timestamp, action, status, token_masked, token_hash,
        identity_hmac, organization_id, organization_name, purpose, details
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        id,
        timestamp,
        entry.action,
        entry.status,
        entry.tokenMasked,
        entry.tokenHash ?? null,
        entry.identityHmac ?? null,
        entry.organizationId ?? null,
        entry.organizationName ?? null,
        entry.purpose ?? null,
        entry.details,
      ]
    );
    return { ...entry, id, timestamp };
  }

  async getAuditLogs(): Promise<Array<AuditEntry & { tokenHash?: string }>> {
    const res = await this.pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200');
    return res.rows.map((r) => this.mapAuditRow(r));
  }

  async getAuditLogsByIdentity(
    identityHmac: string
  ): Promise<Array<AuditEntry & { tokenHash?: string }>> {
    const res = await this.pool.query(
      'SELECT * FROM audit_logs WHERE identity_hmac = $1 ORDER BY timestamp DESC LIMIT 200',
      [identityHmac]
    );
    return res.rows.map((r) => this.mapAuditRow(r));
  }

  async getAuditLogsByOrganization(
    organizationId: string
  ): Promise<Array<AuditEntry & { tokenHash?: string }>> {
    const res = await this.pool.query(
      'SELECT * FROM audit_logs WHERE organization_id = $1 ORDER BY timestamp DESC LIMIT 200',
      [organizationId]
    );
    return res.rows.map((r) => this.mapAuditRow(r));
  }
}

export async function createStore(): Promise<Store> {
  const config = getConfig();
  const store: Store = config.databaseUrl
    ? new PgStore(config.databaseUrl, config.pgSsl)
    : new MemoryStore();
  await store.init();
  return store;
}
