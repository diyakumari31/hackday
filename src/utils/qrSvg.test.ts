import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateQrMatrix } from './qrSvg.ts';

describe('generateQrMatrix (Tier 3 #10)', () => {
  it('generates a valid square QR matrix for BasItna tokens', () => {
    const matrix = generateQrMatrix('BI-Z2WL-9K4P');
    assert.equal(matrix.length, 21);
    assert.equal(matrix[0].length, 21);
    // Top-left finder pattern corner must be dark
    assert.equal(matrix[0][0], true);
    assert.equal(matrix[6][6], true);
    assert.equal(matrix[1][1], false);
  });

  it('scales cleanly to Version 2/3 for JSON token payloads', () => {
    const payload = JSON.stringify({ t: 'BI-Z2WL-9K4P', o: 'hbl-digital', p: 'Account Opening' });
    const matrix = generateQrMatrix(payload);
    assert.ok(matrix.length >= 29);
    assert.equal(matrix.length, matrix[0].length);
  });
});
