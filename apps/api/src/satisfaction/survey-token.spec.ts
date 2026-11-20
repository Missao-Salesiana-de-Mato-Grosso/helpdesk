// Spec docs/specs/T40-csat.md — token e links da avaliação.
import { hashSurveyToken, newSurveyToken, surveyScoreUrl, surveyUrl } from './survey-token.js';

describe('token da avaliação (T40)', () => {
  it('CT-01 / RN-14 token base64url de 32 bytes; o hash é o SHA-256 em hex', () => {
    const { token, hash } = newSurveyToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSurveyToken(token)).toBe(hash);
    expect(newSurveyToken().token).not.toBe(token);
  });

  it('CT-01 / RN-07 o token vai no fragmento; a nota, na query antes dele', () => {
    expect(surveyUrl('http://portal.test', 'abc')).toBe('http://portal.test/avaliar#abc');
    expect(surveyUrl('http://portal.test/', 'abc')).toBe('http://portal.test/avaliar#abc');
    expect(surveyScoreUrl('http://portal.test/avaliar#abc', 4)).toBe(
      'http://portal.test/avaliar?nota=4#abc',
    );
  });
});
