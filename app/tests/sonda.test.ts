import { describe, expect, it } from 'vitest';
// Sonda temporária do ruleset: existe para ficar vermelha e ser apagada.
describe('sonda do ruleset', () => {
  it('falha de propósito', () => { expect(1).toBe(2); });
});
