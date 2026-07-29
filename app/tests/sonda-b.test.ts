import { describe, expect, it } from 'vitest';
// Sonda inerte do ruleset (b). Passa de propósito e é removida em seguida.
describe('sonda b', () => {
  it('passa', () => { expect(1).toBe(1); });
});
