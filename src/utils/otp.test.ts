import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { MemoryStore } from '../db/database.ts';
import {
  generateOtpCode,
  generateTokenCode,
  hashIdentity,
  hashOtp,
  hashToken,
  maskToken,
  signTokenPayload,
} from './crypto.ts';

describe('OTP challenges & token revocation (Tier 1 #2, Tier 2 #4)', () => {
  let store: MemoryStore;
  const identityHmac = hashIdentity('42101-1234567-1');

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
  });

  it('accepts a valid hashed OTP once and rejects reuse', async () => {
    const otp = generateOtpCode();
    await store.createOtpChallenge({
      identityHmac,
      otpHash: hashOtp(identityHmac, otp),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      maxAttempts: 3,
    });

    const first = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, otp));
    assert.equal(first.ok, true);

    const reuse = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, otp));
    assert.equal(reuse.ok, false);
    assert.equal(reuse.reason, 'NO_CHALLENGE');
  });

  it('rejects wrong OTP and locks after 3 failed attempts', async () => {
    const otp = '123456';
    await store.createOtpChallenge({
      identityHmac,
      otpHash: hashOtp(identityHmac, otp),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      maxAttempts: 3,
    });

    const a1 = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, '000001'));
    assert.equal(a1.ok, false);
    assert.equal(a1.reason, 'INVALID_OTP');

    const a2 = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, '000002'));
    assert.equal(a2.ok, false);
    assert.equal(a2.reason, 'INVALID_OTP');

    const a3 = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, '000003'));
    assert.equal(a3.ok, false);
    assert.equal(a3.reason, 'ATTEMPTS_EXCEEDED');

    // Even the real OTP is now rejected because max attempts were exceeded
    const a4 = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, otp));
    assert.equal(a4.ok, false);
    assert.equal(a4.reason, 'NO_CHALLENGE');
  });

  it('rejects an expired OTP challenge', async () => {
    const otp = '654321';
    await store.createOtpChallenge({
      identityHmac,
      otpHash: hashOtp(identityHmac, otp),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      maxAttempts: 3,
    });

    const res = await store.verifyAndConsumeOtp(identityHmac, hashOtp(identityHmac, otp));
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'EXPIRED');
  });

  it('revokes an active token and prevents subsequent redemption', async () => {
    const code = generateTokenCode();
    const tokenHash = hashToken(code);
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const created = await store.createToken({
      tokenHash,
      maskedToken: maskToken(code),
      identityHmac,
      organizationId: 'hbl-digital',
      organizationName: 'HBL Digital',
      category: 'AGE_18_PLUS',
      purpose: 'Account Opening',
      proofResult: '18+ Verified',
      signature: signTokenPayload({
        tokenHash,
        organizationId: 'hbl-digital',
        purpose: 'Account Opening',
        category: 'AGE_18_PLUS',
        proofResult: '18+ Verified',
        expiresAt,
      }),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt,
      redeemedAt: null,
      revokedAt: null,
    });

    const revoked = await store.revokeTokenIfActive(
      created.id,
      identityHmac,
      new Date().toISOString()
    );
    assert.ok(revoked);
    assert.equal(revoked.status, 'REVOKED');

    const redeemAttempt = await store.redeemTokenIfActive(
      tokenHash,
      new Date().toISOString()
    );
    assert.equal(redeemAttempt, null);
  });
});
