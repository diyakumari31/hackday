import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { createStore, Store } from './src/db/database.ts';
import {
  AuditEntry,
  CitizenActivityResponse,
  CitizenBlockedAttempt,
  CitizenOrgSummary,
  CitizenTokenActivityItem,
  FormFieldInput,
  FormPrivacyAnalysis,
  LiveEvent,
  OrganizationStatsResponse,
  ProofCategory,
  VerificationResult,
} from './src/types.ts';
import { getConfig } from './src/utils/config.ts';
import {
  clampTtlHours,
  countStoredCnics,
  deriveSubjectId,
  generateOtpCode,
  generateTokenCode,
  hashIdentity,
  hashOrgApiKey,
  hashOtp,
  hashToken,
  maskCnic,
  maskToken,
  normalizeCnic,
  safeEqualHex,
  signTokenPayload,
  signWalletSession,
  verifyTokenSignature,
  verifyWalletSession,
  verifyWithNadra,
} from './src/utils/crypto.ts';
import { analyzeFormLocally } from './src/utils/formAnalyzer.ts';

// --- Simple Sliding-Window Rate Limiter ---
const rateBuckets = new Map<string, number[]>();

function rateLimit(bucketName: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${bucketName}:${ip}`;
    const now = Date.now();
    const history = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (history.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
      return;
    }
    history.push(now);
    rateBuckets.set(key, history);
    next();
  };
}

// --- Server-Sent Events (SSE) Live Feed ---
const sseClients = new Set<Response>();

function broadcastLiveEvent(event: Omit<LiveEvent, 'id' | 'timestamp'>): void {
  const payload: LiveEvent = {
    ...event,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const serialized = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(serialized);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sanitizeAuditForPublic(entry: AuditEntry & { tokenHash?: string }): AuditEntry {
  const { tokenHash: _th, identityHmac: _ih, ...rest } = entry;
  return rest;
}

async function analyzeWithGeminiOrLocal(
  fields: FormFieldInput[],
  formTitle: string
): Promise<FormPrivacyAnalysis> {
  const local = analyzeFormLocally(fields, formTitle);
  const { geminiApiKey, geminiModel } = getConfig();
  if (!geminiApiKey) {
    return local;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: [
        'Analyze this digital registration form for Pakistani CNIC and PII over-collection.',
        'Form Title: ' + formTitle,
        'Fields: ' + JSON.stringify(fields),
        'Local baseline analysis: ' + JSON.stringify({ score: local.score, fields: local.fields }),
        'Provide a concise 1-2 sentence executive privacy summary explaining the risk and how replacing CNIC/DOB/address fields with BasItna proof tokens improves compliance.',
      ].join('\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
          },
          required: ['summary'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as { summary?: string };
    if (parsed.summary && parsed.summary.trim().length > 10) {
      return {
        ...local,
        summary: parsed.summary.trim(),
        source: 'gemini',
      };
    }
  } catch (err) {
    console.warn('Gemini form analysis fallback triggered:', err instanceof Error ? err.message : err);
  }

  return local;
}

export async function createApp(providedStore?: Store) {
  const config = getConfig();
  const store = providedStore ?? (await createStore());
  const app = express();

  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  // Production security headers & HTTPS enforcement
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      const proto = req.header('x-forwarded-proto');
      if (proto && proto !== 'https') {
        res.redirect(301, `https://${req.header('host')}${req.originalUrl}`);
        return;
      }
    }
    next();
  });

  // Periodic expired-token purge (>24h past expiry)
  const purgeInterval = setInterval(() => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    store.purgeExpiredTokens(cutoff).catch(() => {});
  }, 60 * 60 * 1000);
  purgeInterval.unref();

  function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (config.demoMode && !config.adminApiKey) {
      next();
      return;
    }
    if (!config.adminApiKey) {
      res.status(403).json({ error: 'Inspection endpoints are disabled in production without ADMIN_API_KEY.' });
      return;
    }
    const supplied = req.header('x-admin-key')?.trim() || '';
    if (supplied !== config.adminApiKey) {
      res.status(401).json({ error: 'Invalid or missing x-admin-key.' });
      return;
    }
    next();
  }

  // --- Health ---
  app.get('/api/health', async (_req: Request, res: Response) => {
    const [tokens, auditLogs] = await Promise.all([store.listTokens(), store.getAuditLogs()]);
    const rawCnicStored = countStoredCnics({ tokens, auditLogs });
    res.json({
      ok: true,
      storageMode: store.mode,
      demoMode: config.demoMode,
      rawCnicStored,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Organizations ---
  app.get('/api/organizations', async (_req: Request, res: Response) => {
    const orgs = await store.getOrganizations();
    res.json({
      organizations: orgs.map(({ apiKeyHash: _h, ...rest }) => rest),
    });
  });

  // --- Live SSE Feed (Tier 1 #3) ---
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // --- Tier 1 #2: Mock OTP Request ---
  app.post(
    '/api/otp/request',
    rateLimit('otp-request', 20, 60_000),
    async (req: Request, res: Response) => {
      try {
        const rawCnic = String(req.body?.cnic || '');
        const normalized = normalizeCnic(rawCnic);
        const nadra = verifyWithNadra(normalized);
        if (!nadra.found) {
          res.status(404).json({
            error: 'CNIC not found in mock NADRA registry. Try demo CNIC 42101-1234567-1 or 35201-9988776-3.',
          });
          return;
        }

        const identityHmac = hashIdentity(normalized);
        // In production, replace this mock SMS OTP with NADRA biometric / OTP verification via a licensed NADRA partner.
        const otp = generateOtpCode();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        await store.createOtpChallenge({
          identityHmac,
          otpHash: hashOtp(identityHmac, otp),
          expiresAt,
          maxAttempts: 3,
        });

        await store.addAuditLog({
          action: 'OTP_REQUESTED',
          status: 'OTP_REQUESTED',
          tokenMasked: '-',
          identityHmac,
          details: `OTP challenge dispatched for ${maskCnic(normalized)} (valid 5m, max 3 attempts).`,
        });

        res.json({
          ok: true,
          maskedCnic: maskCnic(normalized),
          expiresInSeconds: 300,
          ...(config.demoMode ? { demoOtp: otp } : {}),
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid CNIC.' });
      }
    }
  );

  // --- Issue Proof Token ---
  app.post(
    '/api/tokens/issue',
    rateLimit('tokens-issue', 30, 60_000),
    async (req: Request, res: Response) => {
      try {
        const rawCnic = String(req.body?.cnic || '');
        const otp = String(req.body?.otp || '').trim();
        const organizationId = String(req.body?.organizationId || 'hbl-digital').trim();
        const purpose = String(req.body?.purpose || 'Account Opening').trim();
        const category = String(req.body?.category || 'IDENTITY_VERIFIED') as ProofCategory;
        const requestedTtl =
          req.body?.ttlHours !== undefined ? Number(req.body.ttlHours) : 1;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const institutionType =
          typeof req.body?.institutionType === 'string' ? req.body.institutionType.trim() : '';

        if (category !== 'IDENTITY_VERIFIED' && category !== 'AGE_18_PLUS') {
          res.status(400).json({ error: 'Invalid proof category.' });
          return;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.status(400).json({ error: 'Invalid email address format.' });
          return;
        }

        const normalized = normalizeCnic(rawCnic);
        const identityHmac = hashIdentity(normalized);

        if (!otp || !/^\d{6}$/.test(otp)) {
          res.status(400).json({ error: 'A 6-digit OTP is required. Click "Send OTP" first.' });
          return;
        }

        const org = await store.getOrganizationById(organizationId);
        if (!org) {
          res.status(404).json({ error: 'Unknown target organization.' });
          return;
        }
        if (!purpose || !org.allowedPurposes.includes(purpose)) {
          res.status(400).json({
            error: `Purpose "${purpose}" is not permitted for ${org.name}. Allowed: ${org.allowedPurposes.join(', ')}`,
          });
          return;
        }

        const otpOutcome = await store.verifyAndConsumeOtp(
          identityHmac,
          hashOtp(identityHmac, otp)
        );
        if (!otpOutcome.ok) {
          await store.addAuditLog({
            action: 'TOKEN_ISSUE_OTP_FAILED',
            status: 'OTP_FAILED',
            tokenMasked: '-',
            identityHmac,
            organizationId: org.id,
            organizationName: org.name,
            purpose,
            details: otpOutcome.message || 'OTP verification failed.',
          });
          res.status(401).json({ error: otpOutcome.message || 'OTP verification failed.' });
          return;
        }

        const nadra = verifyWithNadra(normalized);
        if (!nadra.found || !nadra.isAlive) {
          await store.addAuditLog({
            action: 'TOKEN_ISSUE_REJECTED',
            status: 'REJECTED',
            tokenMasked: '-',
            identityHmac,
            organizationId: org.id,
            organizationName: org.name,
            purpose,
            details: 'NADRA verification failed (not found or inactive status).',
          });
          res.status(403).json({
            error: 'Citizen record could not be verified as active in NADRA registry.',
          });
          return;
        }

        if (category === 'AGE_18_PLUS' && !nadra.is18Plus) {
          await store.addAuditLog({
            action: 'TOKEN_ISSUE_REJECTED',
            status: 'REJECTED',
            tokenMasked: '-',
            identityHmac,
            organizationId: org.id,
            organizationName: org.name,
            purpose,
            details: '18+ proof refused: NADRA check returned under-18.',
          });
          res.status(403).json({
            error: 'Refused: citizen does not meet the 18+ age requirement for an 18+ Verified proof.',
          });
          return;
        }

        const ttlHours = clampTtlHours(requestedTtl);
        const tokenCode = generateTokenCode();
        const tokenHash = hashToken(tokenCode);
        const maskedToken = maskToken(tokenCode);
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
        const proofResult = category === 'AGE_18_PLUS' ? '18+ Verified' : 'Identity Verified';

        const signature = signTokenPayload({
          tokenHash,
          organizationId: org.id,
          purpose,
          category,
          proofResult,
          expiresAt,
        });

        const record = await store.createToken({
          tokenHash,
          maskedToken,
          identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          category,
          purpose,
          proofResult,
          signature,
          status: 'ACTIVE',
          createdAt,
          expiresAt,
          redeemedAt: null,
          revokedAt: null,
        });

        await store.addAuditLog({
          action: 'TOKEN_ISSUED',
          status: 'ISSUED',
          tokenMasked: maskedToken,
          tokenHash,
          identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          details: `Issued ${proofResult} proof for ${org.name} (${purpose}), valid ${Math.round(ttlHours * 60)} min.`,
        });

        broadcastLiveEvent({
          type: 'ISSUED',
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          status: 'ISSUED',
          maskedToken,
          proofResult,
        });

        res.status(201).json({
          id: record.id,
          token: tokenCode,
          maskedToken,
          organizationId: org.id,
          organizationName: org.name,
          category,
          purpose,
          proofResult,
          ttlHours,
          createdAt,
          expiresAt,
          // Echoed back locally only; never stored, logged, or sent to organization
          details: {
            maskedCnic: maskCnic(normalized),
            ...(email ? { email } : {}),
            ...(institutionType ? { institutionType } : {}),
          },
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to issue token.' });
      }
    }
  );

  // --- Verify Proof Token ---
  app.post(
    '/api/tokens/verify',
    rateLimit('tokens-verify', 60, 60_000),
    async (req: Request, res: Response) => {
      const tokenCode = String(req.body?.token || '').trim().toUpperCase();
      const organizationId = String(req.body?.organizationId || '').trim();
      const purpose = String(req.body?.purpose || '').trim();
      const orgApiKey = req.header('x-org-key')?.trim() || '';

      const org = await store.getOrganizationById(organizationId);
      if (!org || !orgApiKey || !safeEqualHex(org.apiKeyHash, hashOrgApiKey(orgApiKey))) {
        const result: VerificationResult = {
          valid: false,
          status: 'UNAUTHORIZED',
          message: 'Invalid organization ID or x-org-key.',
        };
        res.status(401).json(result);
        return;
      }

      if (!tokenCode) {
        res.status(400).json({
          valid: false,
          status: 'INVALID',
          message: 'Verification token is required.',
        } satisfies VerificationResult);
        return;
      }

      const tokenHash = hashToken(tokenCode);
      const masked = maskToken(tokenCode);
      const record = await store.getTokenByHash(tokenHash);

      if (!record) {
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_REJECTED',
          status: 'REJECTED',
          tokenMasked: masked,
          tokenHash,
          organizationId: org.id,
          organizationName: org.name,
          purpose: purpose || undefined,
          details: `${org.name} presented unknown token ${masked} — rejected.`,
        });
        broadcastLiveEvent({
          type: 'REJECTED',
          organizationId: org.id,
          organizationName: org.name,
          purpose: purpose || 'Unspecified',
          status: 'INVALID',
          maskedToken: masked,
        });
        res.status(404).json({
          valid: false,
          status: 'INVALID',
          message: 'Token not found or invalid.',
        } satisfies VerificationResult);
        return;
      }

      const sigOk = verifyTokenSignature(
        {
          tokenHash: record.tokenHash,
          organizationId: record.organizationId,
          purpose: record.purpose,
          category: record.category,
          proofResult: record.proofResult,
          expiresAt: record.expiresAt,
        },
        record.signature
      );

      if (!sigOk) {
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_FLAGGED',
          status: 'FLAGGED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose: purpose || undefined,
          details: `Someone at ${org.name} tried to use a tampered token signature — blocked.`,
        });
        broadcastLiveEvent({
          type: 'FLAGGED',
          organizationId: org.id,
          organizationName: org.name,
          purpose: purpose || 'Unspecified',
          status: 'INVALID',
          maskedToken: record.maskedToken,
        });
        res.status(400).json({
          valid: false,
          status: 'INVALID',
          message: 'Token HMAC signature verification failed.',
        } satisfies VerificationResult);
        return;
      }

      if (record.status === 'REVOKED') {
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_REVOKED',
          status: 'REJECTED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose: purpose || record.purpose,
          details: `${org.name} attempted to use revoked token ${record.maskedToken} — blocked.`,
        });
        broadcastLiveEvent({
          type: 'REJECTED',
          organizationId: org.id,
          organizationName: org.name,
          purpose: purpose || record.purpose,
          status: 'REVOKED',
          maskedToken: record.maskedToken,
        });
        res.status(400).json({
          valid: false,
          status: 'REVOKED',
          message: 'This proof token was revoked by the citizen.',
        } satisfies VerificationResult);
        return;
      }

      // Audience binding check (Wrong Organization -> FLAGGED)
      if (record.organizationId !== org.id) {
        const attemptedPurpose = purpose || 'verification';
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_FLAGGED_WRONG_ORG',
          status: 'FLAGGED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose: attemptedPurpose,
          details: `Someone at ${org.name} tried to use your token for ${attemptedPurpose} — blocked (audience bound to ${record.organizationName}).`,
        });
        broadcastLiveEvent({
          type: 'FLAGGED',
          organizationId: org.id,
          organizationName: org.name,
          purpose: attemptedPurpose,
          status: 'WRONG_ORG',
          maskedToken: record.maskedToken,
        });
        res.status(403).json({
          valid: false,
          status: 'WRONG_ORG',
          message: `Audience mismatch: this token is bound to ${record.organizationName}, not ${org.name}.`,
        } satisfies VerificationResult);
        return;
      }

      // Purpose binding check (Wrong Purpose or Disallowed Purpose -> FLAGGED)
      if (!purpose || !org.allowedPurposes.includes(purpose) || record.purpose !== purpose) {
        const attemptedPurpose = purpose || 'unspecified purpose';
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_FLAGGED_WRONG_PURPOSE',
          status: 'FLAGGED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose: attemptedPurpose,
          details: `Someone at ${org.name} tried to use your token for ${attemptedPurpose} — blocked (bound to ${record.purpose}).`,
        });
        broadcastLiveEvent({
          type: 'FLAGGED',
          organizationId: org.id,
          organizationName: org.name,
          purpose: attemptedPurpose,
          status: 'WRONG_PURPOSE',
          maskedToken: record.maskedToken,
        });
        res.status(403).json({
          valid: false,
          status: 'WRONG_PURPOSE',
          message: `Purpose mismatch: token was issued for "${record.purpose}", cannot be used for "${attemptedPurpose}".`,
        } satisfies VerificationResult);
        return;
      }

      if (record.status === 'REDEEMED') {
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_FLAGGED_REPLAY',
          status: 'FLAGGED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          details: `Someone at ${org.name} tried to replay your already-redeemed token for ${purpose} — blocked.`,
        });
        broadcastLiveEvent({
          type: 'FLAGGED',
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          status: 'REDEEMED',
          maskedToken: record.maskedToken,
        });
        res.status(409).json({
          valid: false,
          status: 'REDEEMED',
          message: 'Single-use token already redeemed (replay blocked).',
        } satisfies VerificationResult);
        return;
      }

      if (record.status === 'EXPIRED') {
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_EXPIRED',
          status: 'REJECTED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          details: `${org.name} presented expired token ${record.maskedToken} — rejected.`,
        });
        broadcastLiveEvent({
          type: 'REJECTED',
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          status: 'EXPIRED',
          maskedToken: record.maskedToken,
        });
        res.status(410).json({
          valid: false,
          status: 'EXPIRED',
          message: 'Token has expired.',
        } satisfies VerificationResult);
        return;
      }

      const redeemedAt = new Date().toISOString();
      const redeemed = await store.redeemTokenIfActive(record.tokenHash, redeemedAt);
      if (!redeemed) {
        await store.addAuditLog({
          action: 'TOKEN_VERIFY_FLAGGED_REPLAY',
          status: 'FLAGGED',
          tokenMasked: record.maskedToken,
          tokenHash: record.tokenHash,
          identityHmac: record.identityHmac,
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          details: `Someone at ${org.name} tried to replay your token for ${purpose} — blocked.`,
        });
        broadcastLiveEvent({
          type: 'FLAGGED',
          organizationId: org.id,
          organizationName: org.name,
          purpose,
          status: 'REDEEMED',
          maskedToken: record.maskedToken,
        });
        res.status(409).json({
          valid: false,
          status: 'REDEEMED',
          message: 'Token already redeemed.',
        } satisfies VerificationResult);
        return;
      }

      const subjectId = deriveSubjectId(redeemed.identityHmac, org.id);

      await store.addAuditLog({
        action: 'TOKEN_VERIFIED',
        status: 'VERIFIED',
        tokenMasked: redeemed.maskedToken,
        tokenHash: redeemed.tokenHash,
        identityHmac: redeemed.identityHmac,
        organizationId: org.id,
        organizationName: org.name,
        purpose,
        details: `${org.name} verified ${redeemed.proofResult} for ${purpose} (subjectId: ${subjectId}).`,
      });

      broadcastLiveEvent({
        type: 'REDEEMED',
        organizationId: org.id,
        organizationName: org.name,
        purpose,
        status: 'VERIFIED',
        maskedToken: redeemed.maskedToken,
        proofResult: redeemed.proofResult,
      });

      res.json({
        valid: true,
        status: 'VERIFIED',
        message: `${redeemed.proofResult} confirmed for ${org.name} (${purpose}). Zero raw CNIC data exposed.`,
        category: redeemed.category,
        proofResult: redeemed.proofResult,
        purpose: redeemed.purpose,
        organizationId: org.id,
        organizationName: org.name,
        issuedAt: redeemed.createdAt,
        expiresAt: redeemed.expiresAt,
        redeemedAt,
        subjectId,
      } satisfies VerificationResult);
    }
  );

  // --- Tier 1 #1: Citizen Activity Wallet ---
  app.post(
    '/api/citizen/activity',
    rateLimit('citizen-activity', 40, 60_000),
    async (req: Request, res: Response) => {
      try {
        const rawCnic = String(req.body?.cnic || '');
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
        const walletSession =
          typeof req.body?.walletSession === 'string' ? req.body.walletSession.trim() : '';

        const normalized = normalizeCnic(rawCnic);
        const identityHmac = hashIdentity(normalized);

        let activeSessionToken = walletSession;
        if (walletSession && verifyWalletSession(walletSession, identityHmac)) {
          // Valid unlocked wallet session
        } else if (otp) {
          if (!/^\d{6}$/.test(otp)) {
            res.status(400).json({ error: 'A valid 6-digit OTP is required.' });
            return;
          }
          const outcome = await store.verifyAndConsumeOtp(
            identityHmac,
            hashOtp(identityHmac, otp)
          );
          if (!outcome.ok) {
            await store.addAuditLog({
              action: 'ACTIVITY_OTP_FAILED',
              status: 'OTP_FAILED',
              tokenMasked: '-',
              identityHmac,
              details: outcome.message || 'Activity wallet OTP failed.',
            });
            res.status(401).json({ error: outcome.message || 'Invalid or expired OTP.' });
            return;
          }
          activeSessionToken = signWalletSession(identityHmac);
        } else {
          res.status(401).json({ error: 'OTP verification is required to view token activity.' });
          return;
        }

        const [tokens, audits] = await Promise.all([
          store.getTokensByIdentity(identityHmac),
          store.getAuditLogsByIdentity(identityHmac),
        ]);

        const flaggedOrRejectedAudits = audits.filter(
          (a) => a.status === 'FLAGGED' || a.status === 'REJECTED'
        );

        const items: CitizenTokenActivityItem[] = tokens.map((t) => {
          const matchedAttempts: CitizenBlockedAttempt[] = flaggedOrRejectedAudits
            .filter(
              (a) =>
                (a.tokenHash && a.tokenHash === t.tokenHash) ||
                (!a.tokenHash && a.tokenMasked === t.maskedToken)
            )
            .map((a) => ({
              id: a.id,
              timestamp: a.timestamp,
              organizationId: a.organizationId,
              organizationName: a.organizationName,
              purpose: a.purpose,
              details: a.details,
              status: a.status,
            }));

          return {
            id: t.id,
            maskedToken: t.maskedToken,
            organizationId: t.organizationId,
            organizationName: t.organizationName,
            category: t.category,
            purpose: t.purpose,
            proofResult: t.proofResult,
            status: t.status,
            createdAt: t.createdAt,
            expiresAt: t.expiresAt,
            redeemedAt: t.redeemedAt,
            revokedAt: t.revokedAt,
            blockedAttempts: matchedAttempts,
          };
        });

        const flaggedAlerts: CitizenBlockedAttempt[] = audits
          .filter((a) => a.status === 'FLAGGED')
          .map((a) => ({
            id: a.id,
            timestamp: a.timestamp,
            organizationId: a.organizationId,
            organizationName: a.organizationName,
            purpose: a.purpose,
            details: a.details,
            status: a.status,
          }));

        const orgMap = new Map<string, CitizenOrgSummary>();
        for (const t of items) {
          const existing = orgMap.get(t.organizationId) ?? {
            organizationId: t.organizationId,
            organizationName: t.organizationName,
            totalTokens: 0,
            redeemedCount: 0,
            activeCount: 0,
            flaggedCount: 0,
            lastActivityAt: t.createdAt,
          };
          existing.totalTokens += 1;
          if (t.status === 'REDEEMED') existing.redeemedCount += 1;
          if (t.status === 'ACTIVE') existing.activeCount += 1;
          existing.flaggedCount += t.blockedAttempts.filter((b) => b.status === 'FLAGGED').length;
          if (t.createdAt > existing.lastActivityAt) {
            existing.lastActivityAt = t.createdAt;
          }
          orgMap.set(t.organizationId, existing);
        }

        const organizations = Array.from(orgMap.values()).sort((a, b) =>
          b.lastActivityAt.localeCompare(a.lastActivityAt)
        );

        const response: CitizenActivityResponse = {
          maskedCnic: maskCnic(normalized),
          walletSession: activeSessionToken,
          summary: {
            totalTokens: items.length,
            activeTokens: items.filter((i) => i.status === 'ACTIVE').length,
            redeemedTokens: items.filter((i) => i.status === 'REDEEMED').length,
            expiredTokens: items.filter((i) => i.status === 'EXPIRED').length,
            revokedTokens: items.filter((i) => i.status === 'REVOKED').length,
            blockedAttempts: flaggedAlerts.length,
            organizationsCount: organizations.filter((o) => o.redeemedCount > 0 || o.totalTokens > 0)
              .length,
          },
          flaggedAlerts,
          organizations,
          tokens: items,
        };

        res.json(response);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request.' });
      }
    }
  );

  // --- Tier 2 #4: Revoke Token ---
  app.post(
    '/api/tokens/revoke',
    rateLimit('tokens-revoke', 30, 60_000),
    async (req: Request, res: Response) => {
      try {
        const rawCnic = String(req.body?.cnic || '');
        const tokenCode = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
        const tokenId = typeof req.body?.tokenId === 'string' ? req.body.tokenId.trim() : '';
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
        const walletSession =
          typeof req.body?.walletSession === 'string' ? req.body.walletSession.trim() : '';

        if (!tokenCode && !tokenId) {
          res.status(400).json({ error: 'Either token or tokenId is required.' });
          return;
        }

        const normalized = normalizeCnic(rawCnic);
        const identityHmac = hashIdentity(normalized);

        if (walletSession && verifyWalletSession(walletSession, identityHmac)) {
          // Verified via active unlocked wallet session
        } else if (otp) {
          const outcome = await store.verifyAndConsumeOtp(
            identityHmac,
            hashOtp(identityHmac, otp)
          );
          if (!outcome.ok) {
            res.status(401).json({ error: outcome.message || 'Invalid or expired OTP.' });
            return;
          }
        } else {
          res.status(401).json({ error: 'Valid OTP is required to revoke a token.' });
          return;
        }

        const target = tokenId
          ? await store.getTokenById(tokenId)
          : await store.getTokenByHash(hashToken(tokenCode));

        if (!target || target.identityHmac !== identityHmac) {
          res.status(404).json({ error: 'Token not found for this citizen identity.' });
          return;
        }

        if (target.status !== 'ACTIVE') {
          res.status(409).json({
            error: `Cannot revoke token because its status is already ${target.status}.`,
          });
          return;
        }

        const revokedAt = new Date().toISOString();
        const revoked = await store.revokeTokenIfActive(target.id, identityHmac, revokedAt);
        if (!revoked) {
          res.status(409).json({ error: 'Token is no longer active.' });
          return;
        }

        await store.addAuditLog({
          action: 'TOKEN_REVOKED',
          status: 'REVOKED',
          tokenMasked: revoked.maskedToken,
          tokenHash: revoked.tokenHash,
          identityHmac,
          organizationId: revoked.organizationId,
          organizationName: revoked.organizationName,
          purpose: revoked.purpose,
          details: `Citizen revoked active token ${revoked.maskedToken} for ${revoked.organizationName}.`,
        });

        broadcastLiveEvent({
          type: 'REVOKED',
          organizationId: revoked.organizationId,
          organizationName: revoked.organizationName,
          purpose: revoked.purpose,
          status: 'REVOKED',
          maskedToken: revoked.maskedToken,
        });

        res.json({
          ok: true,
          id: revoked.id,
          maskedToken: revoked.maskedToken,
          status: 'REVOKED',
          revokedAt,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to revoke token.' });
      }
    }
  );

  // --- Tier 2 #7: Organization Stats Dashboard ---
  app.get('/api/organizations/:id/stats', async (req: Request, res: Response) => {
    const orgId = String(req.params.id || '').trim();
    const orgApiKey = req.header('x-org-key')?.trim() || '';
    const org = await store.getOrganizationById(orgId);

    if (!org || !orgApiKey || !safeEqualHex(org.apiKeyHash, hashOrgApiKey(orgApiKey))) {
      res.status(401).json({ error: 'Invalid organization ID or x-org-key.' });
      return;
    }

    const audits = await store.getAuditLogsByOrganization(org.id);
    const byPurposeMap = new Map<
      string,
      { purpose: string; redeemed: number; rejected: number; flagged: number }
    >();

    let redeemedCount = 0;
    let rejectedCount = 0;
    let flaggedCount = 0;
    let issuedCount = 0;

    for (const a of audits) {
      const p = a.purpose || 'General';
      const entry = byPurposeMap.get(p) ?? {
        purpose: p,
        redeemed: 0,
        rejected: 0,
        flagged: 0,
      };
      if (a.status === 'VERIFIED') {
        redeemedCount += 1;
        entry.redeemed += 1;
      } else if (a.status === 'REJECTED') {
        rejectedCount += 1;
        entry.rejected += 1;
      } else if (a.status === 'FLAGGED') {
        flaggedCount += 1;
        entry.flagged += 1;
      } else if (a.status === 'ISSUED') {
        issuedCount += 1;
      }
      if (a.status === 'VERIFIED' || a.status === 'REJECTED' || a.status === 'FLAGGED') {
        byPurposeMap.set(p, entry);
      }
    }

    const stats: OrganizationStatsResponse = {
      organizationId: org.id,
      organizationName: org.name,
      redeemedCount,
      rejectedCount,
      flaggedCount,
      issuedCount,
      byPurpose: Array.from(byPurposeMap.values()),
      recentEvents: audits.slice(0, 10).map(sanitizeAuditForPublic),
    };

    res.json(stats);
  });

  // --- Form Privacy Analyzer ---
  app.post(
    '/api/analyze-form',
    rateLimit('analyze-form', 30, 60_000),
    async (req: Request, res: Response) => {
      const formTitle = String(req.body?.formTitle || 'Untitled Registration Form').slice(0, 120);
      const rawFields = Array.isArray(req.body?.fields) ? req.body.fields : [];
      if (rawFields.length === 0) {
        res.status(400).json({ error: 'At least one form field is required.' });
        return;
      }
      const fields: FormFieldInput[] = rawFields.slice(0, 30).map((f: unknown, idx: number) => {
        const obj = (f ?? {}) as Record<string, unknown>;
        return {
          id: String(obj.id || `field-${idx + 1}`),
          label: String(obj.label || '').trim().slice(0, 120),
          type: String(obj.type || 'text').trim().slice(0, 32),
          required: Boolean(obj.required),
        };
      });

      const analysis = await analyzeWithGeminiOrLocal(fields, formTitle);
      res.json(analysis);
    }
  );

  // --- Admin / Database Inspection ---
  app.get('/api/tokens/list', requireAdmin, async (_req: Request, res: Response) => {
    const tokens = await store.listTokens();
    res.json({
      tokens: tokens.map(({ signature: _s, ...rest }) => rest),
    });
  });

  app.get('/api/audit-logs', requireAdmin, async (_req: Request, res: Response) => {
    const logs = await store.getAuditLogs();
    res.json({
      auditLogs: logs.map(sanitizeAuditForPublic),
    });
  });

  app.get('/api/database/dump', requireAdmin, async (_req: Request, res: Response) => {
    const [organizations, tokens, auditLogs] = await Promise.all([
      store.getOrganizations(),
      store.listTokens(),
      store.getAuditLogs(),
    ]);
    const sanitizedOrgs = organizations.map(({ apiKeyHash: _h, demoApiKey: _d, ...o }) => o);
    const sanitizedLogs = auditLogs.map(sanitizeAuditForPublic);
    const dump = {
      storageMode: store.mode,
      organizations: sanitizedOrgs,
      tokens,
      auditLogs: sanitizedLogs,
    };
    res.json({
      ...dump,
      rawCnicStored: countStoredCnics(dump),
    });
  });

  app.post('/api/reset', requireAdmin, async (_req: Request, res: Response) => {
    await store.reset();
    res.json({ ok: true, message: 'Store reset to clean state.' });
  });

  return { app, store, config };
}

// Start server when run directly
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  createApp()
    .then(async ({ app, config }) => {
      if (!config.isProduction) {
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        });
        app.use(vite.middlewares);
      } else {
        const distDir = path.resolve(process.cwd(), 'dist');
        app.use(express.static(distDir));
        app.get('*', (_req, res) => {
          const indexHtml = path.join(distDir, 'index.html');
          if (fs.existsSync(indexHtml)) {
            res.sendFile(indexHtml);
          } else {
            res.status(404).send('Build artifacts not found.');
          }
        });
      }

      app.listen(config.port, '0.0.0.0', () => {
        console.log(
          `BasItna server listening on http://localhost:${config.port} (mode=${config.nodeEnv}, demo=${config.demoMode})`
        );
      });
    })
    .catch((err) => {
      console.error('Failed to start BasItna server:', err);
      process.exit(1);
    });
}
