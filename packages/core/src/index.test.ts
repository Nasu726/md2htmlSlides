import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('core', () => {
  it('バージョンは semver 形式', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
