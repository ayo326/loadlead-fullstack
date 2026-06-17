import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkCarrierAuthority } from '../../../src/services/integrations/fmcsa';
import { SEEDED_TEST_IDS } from '../../../src/services/integrations/stubs/fmcsaStub';

const ENV_VARS = ['APP_ENV', 'FMCSA_MODE', 'FMCSA_WEBKEY'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('checkCarrierAuthority — stub mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'staging';
    process.env.FMCSA_MODE = 'stub';
  });

  it('returns true for a seeded active DOT number', async () => {
    expect(await checkCarrierAuthority(undefined, SEEDED_TEST_IDS.ACTIVE_DOT)).toBe(true);
  });

  it('returns false for a seeded inactive DOT number', async () => {
    expect(await checkCarrierAuthority(undefined, SEEDED_TEST_IDS.INACTIVE_DOT)).toBe(false);
  });

  it('returns false for a seeded inactive MC number', async () => {
    expect(await checkCarrierAuthority(SEEDED_TEST_IDS.INACTIVE_MC, undefined)).toBe(false);
  });

  it('defaults to true (active) for an unseeded number', async () => {
    expect(await checkCarrierAuthority('MC-9999999', undefined)).toBe(true);
  });

  it('never calls fetch in stub mode', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await checkCarrierAuthority(undefined, SEEDED_TEST_IDS.ACTIVE_DOT);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('checkCarrierAuthority — live mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'staging';
    process.env.FMCSA_MODE = 'live';
  });

  it('treats the check as passing (with a warning) when FMCSA_WEBKEY is unset', async () => {
    expect(await checkCarrierAuthority(undefined, '1234567')).toBe(true);
  });

  it('calls the real QCMobile endpoint shape and parses an active carrier correctly', async () => {
    process.env.FMCSA_WEBKEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ carrier: { allowToOperate: 'Y', outOfServiceDate: null } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await checkCarrierAuthority(undefined, '1234567');
    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('mobile.fmcsa.dot.gov');
  });

  it('parses an inactive/out-of-service carrier as false', async () => {
    process.env.FMCSA_WEBKEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ carrier: { allowToOperate: 'N', outOfServiceDate: '2024-01-01' } }] }),
    }));
    expect(await checkCarrierAuthority(undefined, '1234567')).toBe(false);
  });

  it('returns false on a non-ok HTTP response', async () => {
    process.env.FMCSA_WEBKEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkCarrierAuthority(undefined, '1234567')).toBe(false);
  });
});
