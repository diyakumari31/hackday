import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../../server.ts';
import { MemoryStore } from '../db/database.ts';
import { countStoredCnics } from './crypto.ts';

describe('BasItna API end-to-end flows', () => {
  let server: http.Server;
  let baseUrl: string;
  let store: MemoryStore;

  before(async () => {
    store = new MemoryStore();
    const { app } = await createApp(store);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  beforeEach(async () => {
    await store.reset();
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
  });

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  it('executes full citizen -> OTP -> issue -> HBL verify -> replay flagged -> wrong org flagged -> minor refused -> health rawCnicStored=0', async () => {
    // 1. Request OTP for adult persona 42101-1234567-1
    const otpRes = await api('/api/otp/request', {
      method: 'POST',
      body: JSON.stringify({ cnic: '42101-1234567-1' }),
    });
    assert.equal(otpRes.status, 200);
    assert.ok(otpRes.body.demoOtp);
    assert.equal(otpRes.body.maskedCnic, '42101-*******-1');

    // 2. Issue 18+ token for HBL Digital
    const issueRes = await api('/api/tokens/issue', {
      method: 'POST',
      body: JSON.stringify({
        cnic: '42101-1234567-1',
        otp: otpRes.body.demoOtp,
        organizationId: 'hbl-digital',
        purpose: 'Account Opening',
        category: 'AGE_18_PLUS',
        ttlHours: 0.25,
        email: 'student@lums.edu.pk',
        institutionType: 'University',
      }),
    });
    assert.equal(issueRes.status, 201);
    const token = issueRes.body.token as string;
    assert.match(token, /^BI-/);

    // 3. Verify at HBL Digital -> VERIFIED + pairwise subjectId
    const verifyRes = await api('/api/tokens/verify', {
      method: 'POST',
      headers: { 'x-org-key': 'basitna-demo-key-hbl-digital' },
      body: JSON.stringify({
        token,
        organizationId: 'hbl-digital',
        purpose: 'Account Opening',
      }),
    });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.valid, true);
    assert.equal(verifyRes.body.status, 'VERIFIED');
    assert.match(verifyRes.body.subjectId, /^[0-9a-f]{16}$/);

    // 4. Replay same token -> REDEEMED & FLAGGED
    const replayRes = await api('/api/tokens/verify', {
      method: 'POST',
      headers: { 'x-org-key': 'basitna-demo-key-hbl-digital' },
      body: JSON.stringify({
        token,
        organizationId: 'hbl-digital',
        purpose: 'Account Opening',
      }),
    });
    assert.equal(replayRes.status, 409);
    assert.equal(replayRes.body.status, 'REDEEMED');

    // 5. Wrong org tries to use token -> WRONG_ORG & FLAGGED, no subjectId
    const wrongOrgRes = await api('/api/tokens/verify', {
      method: 'POST',
      headers: { 'x-org-key': 'basitna-demo-key-jazzcash' },
      body: JSON.stringify({
        token,
        organizationId: 'jazzcash',
        purpose: 'KYC Verification',
      }),
    });
    assert.equal(wrongOrgRes.status, 403);
    assert.equal(wrongOrgRes.body.status, 'WRONG_ORG');
    assert.equal(wrongOrgRes.body.subjectId, undefined);

    // 6. Citizen checks My Activity with fresh OTP -> sees token + 2 FLAGGED alerts + org summary
    const otp2 = await api('/api/otp/request', {
      method: 'POST',
      body: JSON.stringify({ cnic: '42101-1234567-1' }),
    });
    const activityRes = await api('/api/citizen/activity', {
      method: 'POST',
      body: JSON.stringify({ cnic: '42101-1234567-1', otp: otp2.body.demoOtp }),
    });
    assert.equal(activityRes.status, 200);
    assert.equal(activityRes.body.summary.totalTokens, 1);
    assert.equal(activityRes.body.summary.redeemedTokens, 1);
    assert.equal(activityRes.body.summary.blockedAttempts, 2);
    assert.equal(activityRes.body.flaggedAlerts.length, 2);
    assert.equal(activityRes.body.tokens[0].blockedAttempts.length, 2);
    assert.equal(activityRes.body.organizations.length, 1);

    // 7. Minor persona (35201-9988776-3) refused for 18+
    const minorOtp = await api('/api/otp/request', {
      method: 'POST',
      body: JSON.stringify({ cnic: '35201-9988776-3' }),
    });
    const minorIssue = await api('/api/tokens/issue', {
      method: 'POST',
      body: JSON.stringify({
        cnic: '35201-9988776-3',
        otp: minorOtp.body.demoOtp,
        organizationId: 'hbl-digital',
        purpose: 'Account Opening',
        category: 'AGE_18_PLUS',
      }),
    });
    assert.equal(minorIssue.status, 403);

    // 8. Health and dump report rawCnicStored === 0
    const health = await api('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.rawCnicStored, 0);

    const dump = await api('/api/database/dump');
    assert.equal(dump.status, 200);
    assert.equal(dump.body.rawCnicStored, 0);
    assert.equal(countStoredCnics(dump.body), 0);
  });

  it('revokes an active token via /api/tokens/revoke and blocks verification with REVOKED', async () => {
    const otp1 = await api('/api/otp/request', {
      method: 'POST',
      body: JSON.stringify({ cnic: '42101-1234567-1' }),
    });
    const issue = await api('/api/tokens/issue', {
      method: 'POST',
      body: JSON.stringify({
        cnic: '42101-1234567-1',
        otp: otp1.body.demoOtp,
        organizationId: 'hbl-digital',
        purpose: 'KYC Verification',
        category: 'IDENTITY_VERIFIED',
      }),
    });
    assert.equal(issue.status, 201);

    const otp2 = await api('/api/otp/request', {
      method: 'POST',
      body: JSON.stringify({ cnic: '42101-1234567-1' }),
    });
    const revoke = await api('/api/tokens/revoke', {
      method: 'POST',
      body: JSON.stringify({
        token: issue.body.token,
        cnic: '42101-1234567-1',
        otp: otp2.body.demoOtp,
      }),
    });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.status, 'REVOKED');

    const verify = await api('/api/tokens/verify', {
      method: 'POST',
      headers: { 'x-org-key': 'basitna-demo-key-hbl-digital' },
      body: JSON.stringify({
        token: issue.body.token,
        organizationId: 'hbl-digital',
        purpose: 'KYC Verification',
      }),
    });
    assert.equal(verify.status, 400);
    assert.equal(verify.body.status, 'REVOKED');
  });
});
