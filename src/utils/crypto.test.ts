import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampTtlHours,
  countStoredCnics,
  deriveSubjectId,
  generateTokenCode,
  hashIdentity,
  hashToken,
  maskCnic,
  maskToken,
  normalizeCnic,
  signTokenPayload,
  verifyTokenSignature,
  verifyWithNadra,
} from './crypto.ts';

describe('crypto & identity primitives', () => {
  it('normalizes and masks CNIC without exposing middle digits', () => {
    const normalized = normalizeCnic('4210112345671');
    assert.equal(normalized, '42101-1234567-1');
    assert.equal(maskCnic(normalized), '42101-*******-1');
    assert.throws(() => normalizeCnic('12345'));
  });

  it('produces deterministic identity HMAC regardless of dash formatting', () => {
    assert.equal(hashIdentity('4210112345671'), hashIdentity('42101-1234567-1'));
  });

  it('derives pairwise pseudonymous subjectId scoped per organization (Tier 2 #6)', () => {
    const idHmac = hashIdentity('42101-1234567-1');
    const otherHmac = hashIdentity('61101-5544332-9');

    const hbl1 = deriveSubjectId(idHmac, 'hbl-digital');
    const hbl2 = deriveSubjectId(idHmac, 'hbl-digital');
    const jazz = deriveSubjectId(idHmac, 'jazzcash');
    const hblOtherPerson = deriveSubjectId(otherHmac, 'hbl-digital');

    assert.equal(hbl1.length, 16);
    assert.match(hbl1, /^[0-9a-f]{16}$/);
    assert.equal(hbl1, hbl2, 'Same identity + same org must produce identical subjectId');
    assert.notEqual(hbl1, jazz, 'Same identity + different org must produce different subjectId');
    assert.notEqual(hbl1, hblOtherPerson, 'Different identity + same org must differ');
  });

  it('generates BI-XXXX-XXXX CSPRNG tokens and verifies HMAC signatures', () => {
    const code = generateTokenCode();
    assert.match(code, /^BI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.ok(maskToken(code).endsWith('-****'));

    const payload = {
      tokenHash: hashToken(code),
      organizationId: 'hbl-digital',
      purpose: 'Account Opening',
      category: 'AGE_18_PLUS' as const,
      proofResult: '18+ Verified',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };

    const sig = signTokenPayload(payload);
    assert.equal(verifyTokenSignature(payload, sig), true);
    assert.equal(
      verifyTokenSignature({ ...payload, organizationId: 'jazzcash' }, sig),
      false
    );
  });

  it('clamps TTL hours between 1 minute and 24 hours', () => {
    assert.equal(clampTtlHours(72), 24);
    assert.equal(clampTtlHours(0), 1 / 60);
    assert.equal(clampTtlHours(0.25), 0.25);
    assert.equal(clampTtlHours(1), 1);
  });

  it('enforces mock NADRA registry boundaries', () => {
    const adult = verifyWithNadra('42101-1234567-1');
    assert.deepEqual(adult, { found: true, isAlive: true, is18Plus: true });

    const minor = verifyWithNadra('35201-9988776-3');
    assert.deepEqual(minor, { found: true, isAlive: true, is18Plus: false });

    const deceased = verifyWithNadra('37405-1122334-5');
    assert.deepEqual(deceased, { found: true, isAlive: false, is18Plus: true });

    const unknown = verifyWithNadra('99999-9999999-9');
    assert.deepEqual(unknown, { found: false, isAlive: false, is18Plus: false });
  });

  it('scans stored objects for accidental raw CNIC leakage', () => {
    assert.equal(
      countStoredCnics({
        tokens: [{ maskedToken: 'BI-Z2WL-****', identityHmac: 'abc123' }],
      }),
      0
    );
    assert.equal(
      countStoredCnics({
        tokens: [{ raw: '42101-1234567-1' }],
      }),
      1
    );
  });
});
