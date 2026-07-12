/**
 * Carrier insurance connections store (Canopy Connect, SCRUM-60).
 *
 * DELIBERATE SEPARATION FROM THE LOAD MODEL, mirroring betaTrustEventService.
 * One row records a carrier's connection to Canopy: the pull id, any monitoring
 * id, the status, the insurer, and the source mode (widget/components/agent).
 * Every row references the carrier by id only; nothing here reads or writes the
 * Load model. The insurer-sourced policy data itself lands on the existing
 * compliance document fields (source CANOPY); this table is the connection
 * bookkeeping, not the policy record.
 *
 * The row's status is live operational state (CONNECTED/FAILED/DISCONNECTED) and
 * is updated in place, exactly like a compliance document's verificationStatus.
 * The immutable trail lives elsewhere: append-only compliance_verification_events
 * on the document, and append-only coi_crossreference_results.
 *
 * Never log the reconnect token or any Canopy secret. If a reconnect token must
 * be persisted it is envelope-encrypted (see reconnectTokenEnc) via fieldCrypto,
 * the same helper that protects the W9 TIN.
 */

import { Database } from '../../config/database';
import config from '../../config/environment';
import { Helpers } from '../../utils/helpers';
import { Logger } from '../../utils/logger';
import { queryIndexOrScan } from '../../utils/indexQuery';

export type CanopyConnectionStatus = 'CONNECTED' | 'FAILED' | 'DISCONNECTED';

/** How the pull was initiated. All three land in the identical ingestion pipeline. */
export type CanopyConnectionSource = 'widget' | 'components' | 'agent';

export interface CarrierInsuranceConnection {
  connectionId: string; // 'cxn_...'
  carrierId: string; // owner-operator operatorId (HAULER), by id only
  pullId: string; // Canopy pull id
  status: CanopyConnectionStatus;
  sourceMode: CanopyConnectionSource;
  insurerName?: string;
  /** Canopy monitoring identifier, once monitoring is enabled on the pull. */
  monitoringId?: string;
  /** Links a monitoring re-pull back to the original pull. */
  parentPullId?: string;
  /** The idempotency nonce we attached as pull metadata, echoed back by Canopy. */
  nonce?: string;
  /** Envelope-encrypted (fieldCrypto) reconnect token. Never stored in plaintext. */
  reconnectTokenEnc?: string;
  /** Set when status is FAILED or DISCONNECTED. Never contains a secret. */
  failureReason?: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export interface RecordConnectionInput {
  carrierId: string;
  pullId: string;
  status: CanopyConnectionStatus;
  sourceMode: CanopyConnectionSource;
  insurerName?: string;
  monitoringId?: string;
  parentPullId?: string;
  nonce?: string;
  reconnectTokenEnc?: string;
  failureReason?: string;
}

export class CanopyConnectionStore {
  private static get table() {
    return config.dynamodb.carrierInsuranceConnectionsTable;
  }

  /** Record a new connection row. Each pull gets its own row; never mutated on create. */
  static async record(input: RecordConnectionInput): Promise<CarrierInsuranceConnection> {
    if (!input.carrierId || !input.pullId) {
      throw new Error('carrierId and pullId are required');
    }
    const now = Helpers.getCurrentTimestamp();
    const row: CarrierInsuranceConnection = {
      connectionId: Helpers.generateId('cxn'),
      carrierId: input.carrierId,
      pullId: input.pullId,
      status: input.status,
      sourceMode: input.sourceMode,
      ...(input.insurerName ? { insurerName: input.insurerName } : {}),
      ...(input.monitoringId ? { monitoringId: input.monitoringId } : {}),
      ...(input.parentPullId ? { parentPullId: input.parentPullId } : {}),
      ...(input.nonce ? { nonce: input.nonce } : {}),
      ...(input.reconnectTokenEnc ? { reconnectTokenEnc: input.reconnectTokenEnc } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await Database.putItem(this.table, row);
    return row;
  }

  static async getByConnectionId(connectionId: string): Promise<CarrierInsuranceConnection | null> {
    return Database.getItem<CarrierInsuranceConnection>(this.table, { connectionId });
  }

  /** All connection rows for a carrier via carrierId-index, newest first. */
  static async listForCarrier(carrierId: string): Promise<CarrierInsuranceConnection[]> {
    const rows = await queryIndexOrScan<CarrierInsuranceConnection>(
      this.table,
      'carrierId-index',
      'carrierId',
      carrierId,
      () => this.scanAll(),
      'canopyConnection.listForCarrier',
    );
    return rows.filter((r) => r.carrierId === carrierId).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The current connection for a carrier: the newest row. */
  static async currentForCarrier(carrierId: string): Promise<CarrierInsuranceConnection | null> {
    return (await this.listForCarrier(carrierId))[0] ?? null;
  }

  /** Find the connection a pull belongs to (webhook path). Newest wins on dupes. */
  static async findByPullId(pullId: string): Promise<CarrierInsuranceConnection | null> {
    const rows = await queryIndexOrScan<CarrierInsuranceConnection>(
      this.table,
      'pullId-index',
      'pullId',
      pullId,
      () => this.scanAll(),
      'canopyConnection.findByPullId',
    );
    return (
      rows
        .filter((r) => r.pullId === pullId)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  }

  /**
   * Update the live status (and optional operational fields) of a connection in
   * place. Only touches operational state; nothing here is part of the immutable
   * compliance trail.
   */
  static async updateStatus(
    connectionId: string,
    patch: Partial<
      Pick<
        CarrierInsuranceConnection,
        'status' | 'insurerName' | 'monitoringId' | 'parentPullId' | 'reconnectTokenEnc' | 'failureReason'
      >
    >,
  ): Promise<void> {
    const updates: Record<string, unknown> = { updatedAt: Helpers.getCurrentTimestamp() };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) updates[k] = v;
    }
    await Database.updateItem(this.table, { connectionId }, updates);
  }

  /** Scan the store, tolerating a not-yet-created table (returns empty + warns). */
  private static async scanAll(): Promise<CarrierInsuranceConnection[]> {
    try {
      return await Database.scan<CarrierInsuranceConnection>(this.table);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(
          `CarrierInsuranceConnections table ${this.table} not found; returning empty. Apply the Terraform that creates it.`,
        );
        return [];
      }
      throw err;
    }
  }
}

export default CanopyConnectionStore;
