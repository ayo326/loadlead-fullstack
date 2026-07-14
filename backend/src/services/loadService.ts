import { Load, LoadStatus, TrailerType } from '../types';
import { deriveLoadingRequirements } from './equipmentService';
import { deriveOrthogonalFields } from './loadTaxonomy';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';
import { BroadcastService } from './broadcastService';
import { RoutingService } from './routingService';

export class LoadService {
  static async createDraft(shipperId: string, data: Partial<Load>): Promise<Load> {
    try {
      const loadId = Helpers.generateId('load');
      const now = Helpers.getCurrentTimestamp();
      
      const load: Load = {
        loadId,
        shipperId,
        status: LoadStatus.DRAFT,
        
        // Load Basics
        referenceNumber: data.referenceNumber || `REF-${loadId.slice(-8)}`,
        equipmentType: (data.equipmentType ?? (data.acceptedEquipmentTypes?.[0])) as TrailerType,
        acceptedEquipmentTypes: data.acceptedEquipmentTypes?.length
          ? data.acceptedEquipmentTypes
          : data.equipmentType ? [data.equipmentType] : [],
        loadSize: data.loadSize || 'FULL',
        totalWeightLbs: data.totalWeightLbs!,
        length: data.length,
        width: data.width,
        height: data.height,
        dimLengthIn: data.dimLengthIn,
        dimWidthIn: data.dimWidthIn,
        dimHeightIn: data.dimHeightIn,
        loadVolumeCuIn: (data.dimLengthIn && data.dimWidthIn && data.dimHeightIn)
          ? data.dimLengthIn * data.dimWidthIn * data.dimHeightIn : undefined,
        // Facility profiles → derive hard loading requirements at creation time
        pickupFacility: (data as any).pickupFacility,
        deliveryFacility: (data as any).deliveryFacility,
        derivedLoadingRequirements: deriveLoadingRequirements(
          (data as any).pickupFacility,
          (data as any).deliveryFacility,
        ),
        tempRequiredMin: (data as any).tempRequiredMin,
        tempRequiredMax: (data as any).tempRequiredMax,
        
        // Pickup
        pickupCity: data.pickupCity!,
        pickupState: data.pickupState!,
        pickupZip: data.pickupZip!,
        pickupAddress: data.pickupAddress!,
        pickupLat: data.pickupLat!,
        pickupLng: data.pickupLng!,
        pickupDate: typeof data.pickupDate === 'string' ? Date.parse(data.pickupDate) : data.pickupDate!,
        pickupTime: data.pickupTime!,
        pickupType: data.pickupType || 'FCFS',
        pickupInstructions: data.pickupInstructions,
        
        // Delivery
        deliveryCity: data.deliveryCity!,
        deliveryState: data.deliveryState!,
        deliveryZip: data.deliveryZip!,
        deliveryAddress: data.deliveryAddress!,
        deliveryLat: data.deliveryLat!,
        deliveryLng: data.deliveryLng!,
        deliveryDate: typeof data.deliveryDate === 'string' ? Date.parse(data.deliveryDate) : data.deliveryDate!,
        deliveryTime: data.deliveryTime!,
        deliveryType: data.deliveryType || 'LIVE_UNLOAD',
        deliveryInstructions: data.deliveryInstructions,
        receiverId: data.receiverId,
        
        // Route
        totalMiles: data.totalMiles || 0,
        deadheadMiles: data.deadheadMiles,
        
        // Rate
        rateAmount: data.rateAmount!,
        rateType: data.rateType || 'FLAT_RATE',
        paymentTerms: data.paymentTerms || 'NET_30',
        detentionPay: data.detentionPay,
        layoverPay: data.layoverPay,
        
        // Commodity
        commodityDescription: data.commodityDescription!,
        palletCount: data.palletCount,
        stackable: data.stackable || false,
        fragile: data.fragile || false,
        highValue: data.highValue || false,
        hazmat: data.hazmat || false,
        hazmatClass: data.hazmatClass,
        temperatureMin: data.temperatureMin,
        temperatureMax: data.temperatureMax,
        
        // Requirements
        minMcMaturityDays: data.minMcMaturityDays ?? config.app.minMcMaturity,
        minCargoInsurance: data.minCargoInsurance ?? 100000,
        minLiabilityInsurance: data.minLiabilityInsurance ?? 1000000,
        requiredEndorsements: data.requiredEndorsements ?? [],
        experienceRequired: data.experienceRequired ?? 0,
        
        // Broadcast Settings
        broadcastRadiusMiles: data.broadcastRadiusMiles || config.app.broadcastRadius,
        offerTtlMinutes: data.offerTtlMinutes || config.app.offerTtl,
        offeredDriverCount: 0,

        // ─── Equipment + Load Type Taxonomy (spec §2-§3) ───────────────
        // New orthogonal fields. Accept whatever the caller sent; the
        // legacy-to-canonical mapping below fills in anything missing.
        equipment_required:   data.equipment_required,
        equipment_model:      data.equipment_model,
        mode:                 data.mode,
        service_type:         data.service_type,
        characteristics:      data.characteristics,
        commodity:            data.commodity,
        accessorials:         data.accessorials,
        trailer_utilization:  data.trailer_utilization,
        team_driver_required: data.team_driver_required,
        twic_required:        data.twic_required,
        load_status:          data.load_status,

        createdAt: now,
        updatedAt: now,
      };

      // Backfill orthogonal fields from the legacy shape (equipmentType,
      // loadSize, hazmat, tempRequired*) so persisted records carry both
      // views and downstream services can read either.
      const derived = deriveOrthogonalFields(load);
      for (const k of Object.keys(derived) as (keyof typeof derived)[]) {
        if ((load as any)[k] === undefined) (load as any)[k] = derived[k];
      }

      await RoutingService.enrichLoadRoute(load);

      await Database.putItem(config.dynamodb.loadsTable, load);
      
      Logger.info(`Load draft created: ${loadId}`);
      
      // Backfill Google miles + coords if missing (so UI stops showing 0.0)
    if (load && ((!load.totalMiles || load.totalMiles <= 0) || load.pickupLat === 0 || load.pickupLng === 0 || load.deliveryLat === 0 || load.deliveryLng === 0)) {
      const patch = await RoutingService.enrichLoadRoute(load);
      if (patch) {
        Object.assign(load, patch);
        // Persist patch
        await Database.updateItem(
          config.dynamodb.loadsTable,
          { loadId },
          { ...patch, updatedAt: Date.now() }
        );
      }
    }

    return load;
    } catch (error) {
      Logger.error('Create load draft error', error);
      throw error;
    }
  }
  
  static async getLoadById(loadId: string): Promise<Load | null> {
    try {
      return await Database.getItem<Load>(config.dynamodb.loadsTable, { loadId });
    } catch (error) {
      Logger.error('Get load by ID error', error);
      throw error;
    }
  }
  
  static async updateLoad(loadId: string, updates: Partial<Load>): Promise<void> {
    try {
      const updateData = {
        ...updates,
        updatedAt: Helpers.getCurrentTimestamp(),
      };
      
      await Database.updateItem(config.dynamodb.loadsTable, { loadId }, updateData);

      Logger.info(`Load updated: ${loadId}`);
      // Phase 5: mirror assignment/delivery into hauler on-board capacity events
      // at the single load-mutation chokepoint. Best-effort; never blocks the update.
      await this.syncCapacityOnStatusChange(loadId, updates);
    } catch (error) {
      Logger.error('Update load error', error);
      throw error;
    }
  }

  /**
   * Keep hauler on-board capacity (services/haulerCapacityService) in sync with a
   * load's lifecycle: deduct the load's weight when it is assigned (BOOKED +
   * assignedDriverId), restore it when the load is delivered or cancelled.
   * Idempotent per loadId (the capacity service dedupes) and fully best-effort -
   * a capacity failure never affects the load update. The Load model is read only;
   * capacity lives in its own append-only store. Lazy requires avoid a module cycle.
   */
  private static async syncCapacityOnStatusChange(loadId: string, updates: Partial<Load>): Promise<void> {
    try {
      const status = updates.status;
      if (status !== LoadStatus.BOOKED && status !== LoadStatus.DELIVERED && status !== LoadStatus.CANCELLED) {
        return;
      }
      const { HaulerCapacityService } = require('./haulerCapacityService') as typeof import('./haulerCapacityService');
      const { DriverService } = require('./driverService') as typeof import('./driverService');
      const load = await this.getLoadById(loadId);
      const driverId = updates.assignedDriverId ?? load?.assignedDriverId;
      if (!driverId) return;
      const driver = await DriverService.getProfileById(driverId).catch(() => null);
      const carrierId = driver?.carrierId ?? driverId;

      if (status === LoadStatus.BOOKED && updates.assignedDriverId) {
        const weight = load?.totalWeightLbs ?? 0;
        if (weight > 0) await HaulerCapacityService.platformDeduct(driverId, carrierId, loadId, weight);
      } else if (status === LoadStatus.DELIVERED || status === LoadStatus.CANCELLED) {
        await HaulerCapacityService.platformRestore(driverId, carrierId, loadId);
      }
    } catch (err) {
      Logger.warn(`Capacity sync skipped for load ${loadId}: ${(err as Error)?.message ?? err}`);
    }
  }
  
  static async submitLoad(loadId: string): Promise<void> {
    try {
      const load = await this.getLoadById(loadId);
      if (!load) {
        throw new AppError('Load not found', 404);
      }
      
      if (load.status !== LoadStatus.DRAFT) {
        throw new AppError('Only draft loads can be submitted', 400);
      }
      
      // Update status to OPEN
      await this.updateLoad(loadId, { status: LoadStatus.OPEN });
      
      // Trigger broadcast
      await BroadcastService.broadcastLoad(loadId);
      
      Logger.info(`Load submitted and broadcast initiated: ${loadId}`);
    } catch (error) {
      Logger.error('Submit load error', error);
      throw error;
    }
  }
  
  static async getLoadsByShipper(shipperId: string): Promise<Load[]> {
    try {
      return await Database.query<Load>(
        config.dynamodb.loadsTable,
        'shipperId-index',
        '#shipperId = :shipperId',
        { '#shipperId': 'shipperId' },
        { ':shipperId': shipperId }
      );
    } catch (error) {
      Logger.error('Get loads by shipper error', error);
      throw error;
    }
  }
  
  static async getLoadsByStatus(status: LoadStatus): Promise<Load[]> {
    try {
      return await Database.query<Load>(
        config.dynamodb.loadsTable,
        'status-index',
        '#status = :status',
        { '#status': 'status' },
        { ':status': status }
      );
    } catch (error) {
      Logger.error('Get loads by status error', error);
      throw error;
    }
  }
  
  static async assignDriver(loadId: string, driverId: string): Promise<void> {
    try {
      const now = Helpers.getCurrentTimestamp();
      
      await this.updateLoad(loadId, {
        status: LoadStatus.BOOKED,
        assignedDriverId: driverId,
        assignedAt: now,
      });
      
      Logger.info(`Load assigned to driver: ${loadId} -> ${driverId}`);
    } catch (error) {
      Logger.error('Assign driver error', error);
      throw error;
    }
  }
  
  static async cancelLoad(loadId: string): Promise<void> {
    try {
      await this.updateLoad(loadId, { status: LoadStatus.CANCELLED });
      Logger.info(`Load cancelled: ${loadId}`);
    } catch (error) {
      Logger.error('Cancel load error', error);
      throw error;
    }
  }
  
  static async updateLoadStatus(loadId: string, status: LoadStatus): Promise<void> {
    try {
      await this.updateLoad(loadId, { status });
      Logger.info(`Load status updated: ${loadId} -> ${status}`);
    } catch (error) {
      Logger.error('Update load status error', error);
      throw error;
    }
  }

  static async getLoadsByAssignedDriver(driverId: string): Promise<Load[]> {
    const loads = await Database.scan<Load>(
      config.dynamodb.loadsTable,
      'assignedDriverId = :d',
      { ':d': driverId }
    );

    // Treat BOOKED (and optionally IN_TRANSIT) as "active"
    return (loads || []).filter((l) => l && (l.status === 'BOOKED' || l.status === 'IN_TRANSIT'));
  }


}
