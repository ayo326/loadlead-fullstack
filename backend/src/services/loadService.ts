import { Load, LoadStatus, TrailerType } from '../types';
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
        equipmentType: data.equipmentType!,
        loadSize: data.loadSize || 'FULL',
        totalWeightLbs: data.totalWeightLbs!,
        length: data.length,
        width: data.width,
        height: data.height,
        
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
        minMcMaturityDays: data.minMcMaturityDays || config.app.minMcMaturity,
        minCargoInsurance: data.minCargoInsurance || 100000,
        minLiabilityInsurance: data.minLiabilityInsurance || 1000000,
        requiredEndorsements: data.requiredEndorsements || [],
        experienceRequired: data.experienceRequired || 0,
        
        // Broadcast Settings
        broadcastRadiusMiles: data.broadcastRadiusMiles || config.app.broadcastRadius,
        offerTtlMinutes: data.offerTtlMinutes || config.app.offerTtl,
        offeredDriverCount: 0,
        
        createdAt: now,
        updatedAt: now,
      };
      
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
    } catch (error) {
      Logger.error('Update load error', error);
      throw error;
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
        'status-createdAt-index',
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
