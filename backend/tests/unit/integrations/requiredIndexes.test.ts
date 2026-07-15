/**
 * assertRequiredIndexesActive (audit v4 COA-3A + v6 COA-3 H8): a missing/backfilling
 * REQUIRED GSI must refuse boot IN PRODUCTION (EB keeps the last healthy version)
 * and warn-but-continue everywhere else. This pins the userId-index promotion so a
 * future regression that drops it from REQUIRED is caught here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const H = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('../../../src/config/aws', () => ({ dynamoClient: { send: H.send } }));
// Capture the command input so the mocked send can branch on TableName.
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DescribeTableCommand: class {
    input: any;
    constructor(input: any) { this.input = input; }
  },
}));

import { assertRequiredIndexesActive } from '../../../src/services/integrations/bootGuard';
import config from '../../../src/config/environment';

// The single index each REQUIRED table must expose as ACTIVE.
const REQUIRED_BY_TABLE: Record<string, string> = {
  [config.dynamodb.loadNegotiationsTable]: 'loadId-createdAt-index',
  [config.dynamodb.negotiationOffersTable]: 'negotiationId-createdAt-index',
  [config.dynamodb.loadsTable]: 'shipperId-index',
  [config.dynamodb.accessorialChargesTable]: 'loadId-index',
  [config.dynamodb.complianceDocumentsTable]: 'ownerId-index',
  [config.dynamodb.driversTable]: 'userId-index',
  [config.dynamodb.shippersTable]: 'userId-index',
  [config.dynamodb.receiversTable]: 'userId-index',
};

const healthy = (tableName: string) => {
  const idx = REQUIRED_BY_TABLE[tableName];
  return { Table: { GlobalSecondaryIndexes: idx ? [{ IndexName: idx, IndexStatus: 'ACTIVE' }] : [] } };
};

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.APP_ENV;
  H.send.mockReset();
  H.send.mockImplementation(async (cmd: any) => healthy(cmd.input.TableName));
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = savedEnv;
});

describe('assertRequiredIndexesActive - userId-index promoted to REQUIRED (COA-3 H8)', () => {
  it('passes in production when every required index (incl. userId-index) is ACTIVE', async () => {
    process.env.APP_ENV = 'production';
    await expect(assertRequiredIndexesActive()).resolves.toBeUndefined();
  });

  it('refuses to boot in production when the drivers userId-index is missing', async () => {
    process.env.APP_ENV = 'production';
    H.send.mockImplementation(async (cmd: any) =>
      cmd.input.TableName === config.dynamodb.driversTable
        ? { Table: { GlobalSecondaryIndexes: [] } }
        : healthy(cmd.input.TableName),
    );
    await expect(assertRequiredIndexesActive()).rejects.toThrow(/userId-index/);
  });

  it('refuses to boot in production when the shippers userId-index is still backfilling', async () => {
    process.env.APP_ENV = 'production';
    H.send.mockImplementation(async (cmd: any) =>
      cmd.input.TableName === config.dynamodb.shippersTable
        ? { Table: { GlobalSecondaryIndexes: [{ IndexName: 'userId-index', IndexStatus: 'CREATING' }] } }
        : healthy(cmd.input.TableName),
    );
    await expect(assertRequiredIndexesActive()).rejects.toThrow(/backfilling|CREATING/);
  });

  it('warns but does NOT throw outside production when userId-index is missing', async () => {
    process.env.APP_ENV = 'staging';
    H.send.mockImplementation(async (cmd: any) =>
      cmd.input.TableName === config.dynamodb.receiversTable
        ? { Table: { GlobalSecondaryIndexes: [] } }
        : healthy(cmd.input.TableName),
    );
    await expect(assertRequiredIndexesActive()).resolves.toBeUndefined();
  });
});
