import { describe, expect, it } from 'vitest';
// Sonda temporária do ruleset: verde, num ramo defasado da main.
describe('sonda do ruleset', () => {
  it('passa', () => { expect(1).toBe(1); });
});
