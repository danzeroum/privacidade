import { describe, expect, it } from 'vitest';
// Sonda inerte do ruleset (a). Passa de propósito e é removida em seguida.
describe('sonda a', () => {
  it('passa', () => { expect(1).toBe(1); });
});
