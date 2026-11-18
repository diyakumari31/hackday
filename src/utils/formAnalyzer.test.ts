import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeFormLocally, detectSensitiveCategory } from './formAnalyzer.ts';

describe('detectSensitiveCategory (Tier 0)', () => {
  it('classifies email addresses as STANDARD rather than LOCATION_PII', () => {
    assert.equal(detectSensitiveCategory('Email Address'), 'STANDARD');
    assert.equal(
      detectSensitiveCategory('Email Address (School / College / University)'),
      'STANDARD'
    );
    assert.equal(detectSensitiveCategory('E-mail Address'), 'STANDARD');
    assert.equal(detectSensitiveCategory('Website URL / Address'), 'STANDARD');
    assert.equal(detectSensitiveCategory('IP Address'), 'STANDARD');
  });

  it('classifies physical residential addresses as LOCATION_PII', () => {
    assert.equal(detectSensitiveCategory('Permanent Home Address'), 'LOCATION_PII');
    assert.equal(detectSensitiveCategory('Residential Address'), 'LOCATION_PII');
    assert.equal(detectSensitiveCategory('Street Address'), 'LOCATION_PII');
  });

  it('classifies CNIC and DOB fields as GOVERNMENT_ID', () => {
    assert.equal(detectSensitiveCategory('CNIC Number'), 'GOVERNMENT_ID');
    assert.equal(detectSensitiveCategory('Date of Birth'), 'GOVERNMENT_ID');
    assert.equal(detectSensitiveCategory('Passport Number'), 'GOVERNMENT_ID');
  });

  it('classifies CNIC photo/biometric fields as BIOMETRIC_PII', () => {
    assert.equal(detectSensitiveCategory('CNIC Front & Back Scan'), 'BIOMETRIC_PII');
    assert.equal(detectSensitiveCategory('Thumbprint Biometric'), 'BIOMETRIC_PII');
  });
});

describe('analyzeFormLocally', () => {
  it('computes lower score for risky forms and higher projected score for minimized forms', () => {
    const result = analyzeFormLocally(
      [
        { id: '1', label: 'Full Name', type: 'text', required: true },
        { id: '2', label: 'Email Address (School / College / University)', type: 'email', required: true },
        { id: '3', label: 'CNIC Number', type: 'text', required: true },
        { id: '4', label: 'Date of Birth', type: 'date', required: true },
        { id: '5', label: 'Permanent Home Address', type: 'text', required: true },
      ],
      'Student Portal Onboarding'
    );

    assert.equal(result.score, 35); // 100 - 25 - 25 - 15
    assert.equal(result.riskLevel, 'HIGH');
    assert.equal(result.projectedScore, 100);
    assert.equal(result.projectedRiskLevel, 'LOW');
    assert.ok(result.minimizedFormSuggestion.some((f) => f.label.includes('BasItna Proof Token')));
  });
});
