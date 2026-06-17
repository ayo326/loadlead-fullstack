import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveMode, rawModeEnvValue, isLive } from '../../../src/services/integrations/modeResolver';

const ENV_VARS = ['APP_ENV', 'DIDIT_ENV', 'FMCSA_MODE', 'MAPS_MODE', 'EMAIL_MODE', 'PUSH_MODE'];
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
});

describe('resolveMode', () => {
  it('in production, always returns live for every integration regardless of env vars', () => {
    process.env.APP_ENV = 'production';
    process.env.FMCSA_MODE = 'stub';
    process.env.EMAIL_MODE = 'test';
    expect(resolveMode('didit')).toBe('live');
    expect(resolveMode('fmcsa')).toBe('live');
    expect(resolveMode('maps')).toBe('live');
    expect(resolveMode('email')).toBe('live');
    expect(resolveMode('push')).toBe('live');
  });

  it('outside production, uses safe defaults when env vars are unset', () => {
    process.env.APP_ENV = 'staging';
    expect(resolveMode('didit')).toBe('sandbox');
    expect(resolveMode('fmcsa')).toBe('stub');
    expect(resolveMode('maps')).toBe('stub');
    expect(resolveMode('email')).toBe('test');
    expect(resolveMode('push')).toBe('capture');
  });

  it('outside production, an explicit env var overrides the default', () => {
    process.env.APP_ENV = 'staging';
    process.env.FMCSA_MODE = 'live';
    expect(resolveMode('fmcsa')).toBe('live');
  });

  it('rawModeEnvValue reads the literal env var, unaffected by production lock', () => {
    process.env.APP_ENV = 'production';
    process.env.FMCSA_MODE = 'stub';
    expect(rawModeEnvValue('fmcsa')).toBe('stub');
    expect(rawModeEnvValue('email')).toBeUndefined();
  });

  it('isLive matches resolveMode against the live value', () => {
    process.env.APP_ENV = 'staging';
    expect(isLive('didit')).toBe(false);
    process.env.DIDIT_ENV = 'live';
    expect(isLive('didit')).toBe(true);
  });
});
