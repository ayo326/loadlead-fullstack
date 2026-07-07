import crypto from 'crypto';
import { OwnerOperator, FleetInvite, Driver } from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import { DriverService } from './driverService';
import Logger from '../utils/logger';

const OO_TABLE       = process.env.DYNAMODB_OWNER_OPERATORS_TABLE  || 'LoadLead_OwnerOperators';
const FLEET_INV_TABLE = process.env.DYNAMODB_FLEET_INVITES_TABLE   || 'LoadLead_FleetInvites';
const FLEET_TTL_HOURS = 168; // 7 days

export class OwnerOperatorService {

  static async createProfile(params: Partial<OwnerOperator> & {
    userId: string;
    legalName: string;
    phone: string;
  }): Promise<OwnerOperator> {
    const operatorId = Helpers.generateId('oo');
    const now = Helpers.getCurrentTimestamp();
    const record: OwnerOperator = {
      operatorId,
      fleetDriverIds: [],
      ...params,
      createdAt: now,
      updatedAt: now,
    };
    await Database.putItem(OO_TABLE, record);
    Logger.info(`OwnerOperator profile created: ${operatorId}`);

    // Every OO gets a "self" Driver record so they can personally haul loads
    // (spec §5, §6) - broadcast, acceptance, tracking, and POD all flow
    // through it exactly like a fleet driver, with no special-casing.
    await this.ensureSelfDriver(record);

    return record;
  }

  /**
   * Idempotent: creates the OO's self-driver if missing (also serves as a
   * lazy backfill for Owner Operators that existed before this concept).
   * The self-driver's userId === the OO's own userId, so a single
   * DriverService.getProfileByUserId(userId) lookup finds it either way.
   */
  static async ensureSelfDriver(operator: OwnerOperator): Promise<Driver> {
    const existing = await DriverService.getProfileByUserId(operator.userId);
    if (existing) return existing;

    return DriverService.createProfile(operator.userId, {
      legalName: operator.legalName,
      phone: operator.phone,
      mcNumber: operator.mcNumber,
      dotNumber: operator.dotNumber,
      cdlClass: operator.cdlClass as any,
      endorsements: operator.endorsements,
      truckMake: operator.truckMake,
      truckModel: operator.truckModel,
      truckYear: operator.truckYear,
      truckVIN: operator.truckVIN,
      trailerType: operator.trailerType as any,
      trailerLength: operator.trailerLength,
      maxCapacityLbs: operator.maxCapacityLbs,
      ownedByOperatorId: operator.operatorId,
      isSelf: true,
    });
  }

  static async getByUserId(userId: string): Promise<OwnerOperator | null> {
    const results = await Database.query<OwnerOperator>(
      OO_TABLE, 'userId-index',
      '#userId = :uid',
      { '#userId': 'userId' },
      { ':uid': userId },
    );
    return results[0] ?? null;
  }

  static async getById(operatorId: string): Promise<OwnerOperator | null> {
    return Database.getItem<OwnerOperator>(OO_TABLE, { operatorId });
  }

  static async updateProfile(operatorId: string, updates: Partial<OwnerOperator>): Promise<void> {
    // Strip key + immutable fields: callers (e.g. the Settings form) PUT the
    // whole profile back, and DynamoDB rejects SET on a key attribute
    // (operatorId), which surfaces as a 500.
    const { operatorId: _oid, userId: _uid, createdAt: _c, ...mutable } =
      updates as Partial<OwnerOperator> & Record<string, unknown>;
    await Database.updateItem(OO_TABLE, { operatorId }, {
      ...mutable,
      updatedAt: Helpers.getCurrentTimestamp(),
    });
  }

  // ── Fleet management ───────────────────────────────────────────────────────

  /** Add a driver (by driverId) to this operator's fleet */
  static async addFleetDriver(operatorId: string, driverId: string): Promise<void> {
    const op = await this.getById(operatorId);
    if (!op) throw new AppError('Owner Operator not found', 404);
    const ids = new Set(op.fleetDriverIds ?? []);
    ids.add(driverId);
    await this.updateProfile(operatorId, { fleetDriverIds: [...ids] });
  }

  /** Remove a driver from this operator's fleet */
  static async removeFleetDriver(operatorId: string, driverId: string): Promise<void> {
    const op = await this.getById(operatorId);
    if (!op) throw new AppError('Owner Operator not found', 404);
    const ids = (op.fleetDriverIds ?? []).filter(id => id !== driverId);
    await this.updateProfile(operatorId, { fleetDriverIds: ids });
  }

  // ── Fleet invites ──────────────────────────────────────────────────────────

  static async createFleetInvite(operatorId: string, email: string): Promise<FleetInvite> {
    const token = crypto.randomBytes(32).toString('hex');
    const now   = Helpers.getCurrentTimestamp();
    const invite: FleetInvite = {
      inviteId:   Helpers.generateId('finv'),
      operatorId,
      email,
      token,
      expiresAt: now + FLEET_TTL_HOURS * 60 * 60 * 1000,
      createdAt: now,
    };
    await Database.putItem(FLEET_INV_TABLE, invite);
    Logger.info(`Fleet invite created: ${invite.inviteId} for ${email}`);
    return invite;
  }

  static async getFleetInviteByToken(token: string): Promise<FleetInvite | null> {
    const results = await Database.query<FleetInvite>(
      FLEET_INV_TABLE, 'token-index',
      '#token = :token',
      { '#token': 'token' },
      { ':token': token },
    );
    return results[0] ?? null;
  }

  static async getFleetInvitesForOperator(operatorId: string): Promise<FleetInvite[]> {
    return Database.query<FleetInvite>(
      FLEET_INV_TABLE, 'operatorId-index',
      '#operatorId = :oid',
      { '#operatorId': 'operatorId' },
      { ':oid': operatorId },
    );
  }

  /**
   * Accept a fleet invite by token.
   * - Validates the token exists, hasn't expired, and hasn't been used.
   * - Adds the driver to the operator's fleetDriverIds.
   * - Marks the invite acceptedAt so it can't be reused.
   * Caller is responsible for setting ownedByOperatorId on the Driver record.
   */
  static async acceptFleetInvite(
    token: string,
    driverId: string,
  ): Promise<{ operatorId: string }> {
    const invite = await this.getFleetInviteByToken(token);
    if (!invite) throw new AppError('Invite not found or invalid', 404);
    if (invite.acceptedAt) throw new AppError('Invite has already been used', 409);
    if (invite.expiresAt < Date.now()) throw new AppError('Invite has expired', 410);

    await Promise.all([
      this.addFleetDriver(invite.operatorId, driverId),
      Database.updateItem(FLEET_INV_TABLE, { inviteId: invite.inviteId }, {
        acceptedAt: Date.now(),
        acceptedByDriverId: driverId,
      }),
    ]);

    return { operatorId: invite.operatorId };
  }
}
