import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/shared/config';

describe('loadConfig TRUST_PROXY', () => {
  it('defaults to false', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('accepts a hop count and the named subnets', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });

  it('refuses true, which would let any client spoof its IP', () => {
    expect(() => loadConfig({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ TRUST_PROXY: '10.0.0.0/8' })).toThrow(/TRUST_PROXY/);
  });
});
