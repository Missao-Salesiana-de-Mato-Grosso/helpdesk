import { describe, expect, it } from 'vitest';
import { APP_NAME, ApiErrorCode } from './index.js';

describe('shared', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('Help Desk MSMT');
  });

  it('uses the code string as its own value', () => {
    for (const [key, value] of Object.entries(ApiErrorCode)) {
      expect(value).toBe(key);
    }
  });
});
