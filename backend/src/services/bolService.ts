import { v4 as uuidv4 } from 'uuid';
import { Database } from '../config/database';
import config from '../config/environment';
import {
  BillOfLading, BOLStatus, BOLSignature, BOLTimelineEvent,
  BOLParty, BOLCommodity, BOLWMSIntegration, Driver, Shipper, Receiver, Load
} from '../types';

const TABLE = config.dynamodb.bolTable;

function generateBolNumber(): string {
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `BOL-${ymd}-${rand}`;
}

export class BOLService {

  /** Create a new BOL from a load + auto-populated party data */
  static async createBOL(params: {
    loadId: string;
    createdBy: string;
    shipper: Shipper;
    load: Load;
    driver?: Driver;
    receiver?: Receiver;
    extraFields?: Partial<BillOfLading>;
  }): Promise<BillOfLading> {
    const { loadId, createdBy, shipper, load, driver, receiver, extraFields } = params;

    const consignor: BOLParty = {
      name: shipper.companyName || shipper.legalName || '',
      attn: shipper.contactName,
      phone: shipper.contactPhone,
      address: shipper.companyAddress,
      city: shipper.city || load.pickupCity,
      state: shipper.state || load.pickupState,
      zip: shipper.zip || load.pickupZip,
    };

    const consignee: BOLParty = receiver ? {
      name: receiver.facilityName,
      attn: receiver.contactName,
      phone: receiver.contactPhone,
      address: receiver.facilityAddress,
      city: load.deliveryCity,
      state: load.deliveryState,
      zip: load.deliveryZip,
    } : {
      name: '',
      address: load.deliveryAddress,
      city: load.deliveryCity,
      state: load.deliveryState,
      zip: load.deliveryZip,
    };

    const carrier = driver ? {
      name: driver.legalName || driver.fullName || '',
      mcNumber: driver.mcNumber,
      dotNumber: driver.dotNumber,
      driverName: driver.fullName || driver.legalName,
      trailerNumber: driver.truckVIN,
      emergencyPhone: driver.phone,
    } : { name: '' };

    // Build commodity rows from load data
    const commodities: BOLCommodity[] = [{
      pkgs: 1,
      hazmat: false,
      description: (load as any).commodityDescription || (load as any).freightDescription || 'General Freight',
      weight: load.totalWeightLbs,
      weightUnit: 'LBS',
      freightClass: (load as any).freightClass,
      nmfcCode: (load as any).nmfcCode,
      volume: (load as any).volume,
    }];

    const now = new Date().toISOString();
    const bol: BillOfLading = {
      bolId: uuidv4(),
      bolNumber: generateBolNumber(),
      loadId,
      createdBy,
      issuedAt: now,
      updatedAt: now,
      issuedLocation: `${load.pickupCity}, ${load.pickupState}`,
      consignor,
      consignee,
      carrier,
      originLiftGate: false,
      originInsidePickup: false,
      destinationLiftGate: false,
      destinationInsideDelivery: false,
      pickupHours: load.pickupTime,
      deliveryHours: (load as any).deliveryTime,
      specialInstructions: load.pickupInstructions,
      commodities,
      freightChargesPrepaid: true,
      totalCharges: (load as any).rate,
      status: 'ISSUED',
      timeline: [{
        event: 'BOL_CREATED',
        timestamp: now,
        actor: createdBy,
        actorRole: 'SHIPPER',
        notes: `BOL ${generateBolNumber()} issued for load ${loadId}`,
      }],
      wmsIntegration: { enabled: false },
      ...extraFields,
    };

    // Re-generate bolNumber consistently
    bol.bolNumber = generateBolNumber();
    bol.timeline[0].notes = `BOL ${bol.bolNumber} issued for load ${loadId}`;

    await Database.putItem(TABLE, bol);
    return bol;
  }

  /** Get BOL by bolId */
  static async getBOLById(bolId: string): Promise<BillOfLading | null> {
    return Database.getItem<BillOfLading>(TABLE, { bolId });
  }

  /** Get BOL by loadId */
  static async getBOLByLoadId(loadId: string): Promise<BillOfLading | null> {
    const results = await Database.query<BillOfLading>(
      TABLE, 'loadId-index',
      '#loadId = :loadId',
      { '#loadId': 'loadId' },
      { ':loadId': loadId }
    );
    return results[0] || null;
  }

  /** Apply a signature to the BOL */
  static async sign(bolId: string, role: 'SHIPPER' | 'DRIVER' | 'RECEIVER', signature: BOLSignature, actorId: string): Promise<BillOfLading> {
    const bol = await BOLService.getBOLById(bolId);
    if (!bol) throw new Error('BOL not found');

    const now = new Date().toISOString();
    const updates: Partial<BillOfLading> = { updatedAt: now };
    let event = '';
    let newStatus: BOLStatus = bol.status;

    if (role === 'SHIPPER') {
      updates.shipperSignature = signature;
      event = 'SHIPPER_SIGNED';
      newStatus = 'ISSUED';
    } else if (role === 'DRIVER') {
      updates.carrierSignature = signature;
      event = 'CARRIER_SIGNED_PICKUP';
      newStatus = 'PICKED_UP';
    } else if (role === 'RECEIVER') {
      updates.consigneeSignature = signature;
      event = 'CONSIGNEE_SIGNED_DELIVERY';
      newStatus = 'DELIVERED';
    }

    updates.status = newStatus;

    // Append to timeline
    const timelineEntry: BOLTimelineEvent = {
      event,
      timestamp: now,
      actor: actorId,
      actorRole: role,
      location: signature.location,
    };
    updates.timeline = [...bol.timeline, timelineEntry];

    await Database.updateItem(TABLE, { bolId }, updates);
    return { ...bol, ...updates };
  }

  /** Update BOL fields (shipper can edit before carrier signs) */
  static async updateBOL(bolId: string, updates: Partial<BillOfLading>, actorId: string): Promise<BillOfLading> {
    const bol = await BOLService.getBOLById(bolId);
    if (!bol) throw new Error('BOL not found');
    if (bol.carrierSignature) throw new Error('BOL cannot be modified after carrier signature');

    const now = new Date().toISOString();
    const safeUpdates = { ...updates, updatedAt: now };

    const timelineEntry: BOLTimelineEvent = {
      event: 'BOL_UPDATED',
      timestamp: now,
      actor: actorId,
      actorRole: 'SHIPPER',
    };
    safeUpdates.timeline = [...bol.timeline, timelineEntry];

    await Database.updateItem(TABLE, { bolId }, safeUpdates);
    return { ...bol, ...safeUpdates };
  }

  /** Update WMS integration fields */
  static async updateWMS(bolId: string, wmsData: Partial<BOLWMSIntegration>, actorId: string): Promise<BillOfLading> {
    const bol = await BOLService.getBOLById(bolId);
    if (!bol) throw new Error('BOL not found');

    const now = new Date().toISOString();
    const wmsIntegration = { ...bol.wmsIntegration, ...wmsData, syncedAt: now };

    const timelineEntry: BOLTimelineEvent = {
      event: 'WMS_INTEGRATION_UPDATED',
      timestamp: now,
      actor: actorId,
      actorRole: 'RECEIVER',
      notes: `WMS provider: ${wmsData.wmsProvider || bol.wmsIntegration.wmsProvider}`,
    };

    await Database.updateItem(TABLE, { bolId }, {
      wmsIntegration,
      updatedAt: now,
      timeline: [...bol.timeline, timelineEntry],
    });

    return { ...bol, wmsIntegration, updatedAt: now };
  }

  /** Mark disputed */
  static async disputeBOL(bolId: string, reason: string, actorId: string, actorRole: string): Promise<BillOfLading> {
    const bol = await BOLService.getBOLById(bolId);
    if (!bol) throw new Error('BOL not found');

    const now = new Date().toISOString();
    const timelineEntry: BOLTimelineEvent = {
      event: 'BOL_DISPUTED',
      timestamp: now,
      actor: actorId,
      actorRole,
      notes: reason,
    };

    await Database.updateItem(TABLE, { bolId }, {
      status: 'DISPUTED' as BOLStatus,
      deliveryExceptions: reason,
      updatedAt: now,
      timeline: [...bol.timeline, timelineEntry],
    });

    return { ...bol, status: 'DISPUTED', deliveryExceptions: reason };
  }

  /** List all BOLs by status (admin) */
  static async getBOLsByStatus(status: BOLStatus): Promise<BillOfLading[]> {
    return Database.query<BillOfLading>(
      TABLE, 'status-index',
      '#status = :status',
      { '#status': 'status' },
      { ':status': status }
    );
  }
}
