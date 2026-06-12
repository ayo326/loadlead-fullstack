// ============================================
// TYPE DEFINITIONS
// ============================================

export enum UserRole {
  ADMIN = 'ADMIN',
  SHIPPER = 'SHIPPER',
  DRIVER = 'DRIVER',
  RECEIVER = 'RECEIVER'
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION'
}

export enum DriverStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  VERIFIED = 'VERIFIED',
  SUSPENDED = 'SUSPENDED',
  OFFLINE = 'OFFLINE',
  AVAILABLE = 'AVAILABLE'
}

export enum LoadStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  OFFERED = 'OFFERED',
  BOOKED = 'BOOKED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED'
}

export enum OfferStatus {
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED'
}

export enum TrailerType {
  DRY_VAN = 'DRY_VAN',
  REEFER = 'REEFER',
  FLATBED = 'FLATBED',
  STEP_DECK = 'STEP_DECK',
  BOX_TRUCK = 'BOX_TRUCK'
}

export enum CDLClass {
  A = 'A',
  B = 'B',
  C = 'C'
}

export interface User {
  userId: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;

  // Accounts schema integration
  accountId?: string;
  profileType?: 'ADMIN' | 'CARRIER' | 'SHIPPER' | 'DRIVER' | 'RECEIVER';
  phone?: string;

  createdAt: number;
  updatedAt: number;
}

export interface Account {
  accountId: string;
  profileType: 'ADMIN' | 'CARRIER' | 'SHIPPER' | 'DRIVER' | 'RECEIVER';
  email: string;
  phone?: string;
  status: UserStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Organization {
  orgId: string;
  legalName: string;
  dba?: string;
  orgType?: string;
  dotNumber?: string;
  mcNumber?: string;
  mcIssueDate?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface CarrierProfile {
  carrierId: string;
  orgId?: string;
  carrierType?: string;
  operatingAuthorityStatus?: string;
  safetyRating?: string;
  operatingRegions?: string[];
}

export interface InsurancePolicy {
  policyId: string;
  carrierId: string;
  provider: string;
  policyNumber: string;
  autoLiabilityAmount: number;
  cargoCoverageAmount: number;
  expirationDate: number;
}

export interface Driver {
  driverId: string;
  userId: string;
  status: DriverStatus;

  // DriverProfiles schema integration
  carrierId?: string;
  driverType?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  dob?: number;
  medicalCertExpiration?: number;
  mcIssueDate?: number;

  // Identity
  legalName: string;
  phone: string;
  licenseNumber: string;
  licenseState: string;
  cdlClass: CDLClass;
  endorsements: string[];
  experienceYears: number;

  // Equipment
  truckMake: string;
  truckModel: string;
  truckYear: number;
  truckVIN: string;
  trailerType: TrailerType;
  trailerLength: number;
  trailerWidth: number;
  trailerHeight: number;
  maxCapacityLbs: number;
  currentLoadLbs: number;
  specialEquipment: string[];

  // Authority & Insurance
  mcNumber: string;
  dotNumber: string;
  authorityStartDate: number;
  cargoInsuranceAmount: number;
  liabilityInsuranceAmount: number;
  insuranceCertificate?: string;
  w9Form?: string;

  // InsurancePolicies schema integration
  insurancePolicyId?: string;
  insuranceProvider?: string;
  policyNumber?: string;
  autoLiabilityAmount?: number;
  cargoCoverageAmount?: number;
  policyExpirationDate?: number;

  // Compliance
  vehicleRegistration?: string;
  inspectionCertificate?: string;
  eldCompliant: boolean;
  hosAvailableHours: number;

  // Location
  currentCity: string;
  currentState: string;
  currentLat: number;
  currentLng: number;
  geohash: string;
  lastLocationUpdate: number;

  createdAt: number;
  updatedAt: number;
}

export interface Shipper {
  shipperId: string;
  userId: string;

  // Existing + organizations
  companyName: string;
  companyAddress: string;
  legalName?: string;
  dba?: string;
  orgType?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  mcNumber?: string;
  dotNumber?: string;
  mcIssueDate?: number;

  contactName: string;
  contactPhone: string;
  contactEmail: string;

  // ShipperProfiles schema integration
  orgId?: string;
  freightTypes?: string[];
  avgMonthlyVolume?: number;
  preferredEquipment?: string[];
  billingTerms?: string;

  // CarrierProfiles schema integration
  carrierType?: string;
  operatingAuthorityStatus?: string;
  safetyRating?: string;
  operatingRegions?: string[];

  isShipperAdmin: boolean;
  shipperAdminStatus: 'NONE' | 'PENDING' | 'APPROVED';
  defaultBroadcastRadius: number;
  defaultMinMcMaturity: number;
  createdAt: number;
  updatedAt: number;
}

export interface Receiver {
  receiverId: string;
  userId: string;

  // ReceiverProfiles schema integration
  orgId?: string;
  appointmentRequired?: boolean;
  dockType?: string;

  facilityName: string;
  facilityAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  receivingHours: Record<string, string>;
  specialInstructions?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Load {
  loadId: string;
  shipperId: string;
  status: LoadStatus;

  // Load Basics
  referenceNumber: string;
  equipmentType: TrailerType;
  loadSize: 'FULL' | 'PARTIAL' | 'LTL';
  totalWeightLbs: number;
  length?: number;
  width?: number;
  height?: number;

  // Pickup
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  pickupDate: number;
  pickupTime: string;
  pickupType: 'FCFS' | 'APPOINTMENT' | 'LIVE_LOAD' | 'DROP_HOOK';
  pickupInstructions?: string;

  // Delivery
  deliveryCity: string;
  deliveryState: string;
  deliveryZip: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  deliveryDate: number;
  deliveryTime: string;
  deliveryType: 'LIVE_UNLOAD' | 'DROP_HOOK';
  deliveryInstructions?: string;
  receiverId?: string;

  // Route
  totalMiles: number;
  deadheadMiles?: number;

  // Rate
  rateAmount: number;
  rateType: 'PER_MILE' | 'FLAT_RATE';
  paymentTerms: 'QUICK_PAY' | 'FACTORING' | 'NET_30';
  detentionPay?: number;
  layoverPay?: number;

  // Commodity
  commodityDescription: string;
  palletCount?: number;
  stackable: boolean;
  fragile: boolean;
  highValue: boolean;
  hazmat: boolean;
  hazmatClass?: string;
  temperatureMin?: number;
  temperatureMax?: number;

  // Requirements
  minMcMaturityDays: number;
  minCargoInsurance: number;
  minLiabilityInsurance: number;
  requiredEndorsements: string[];
  experienceRequired: number;

  // Broadcast Settings
  broadcastRadiusMiles: number;
  offerTtlMinutes: number;
  offeredDriverCount: number;

  // Assignment
  assignedDriverId?: string;
  assignedAt?: number;

  createdAt: number;
  updatedAt: number;
}

export interface Offer {
  loadId: string;
  driverId: string;
  status: OfferStatus;
  createdAt: number;
  expiresAt: number;
  driverDistanceMiles: number;
  acceptedAt?: number;
  declinedAt?: number;
}

// ============================================
// BILL OF LADING TYPES
// ============================================

export interface BOLParty {
  name: string;
  attn?: string;
  phone?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface BOLCommodity {
  pkgs: number;
  hazmat: boolean;
  description: string;
  weight: number;
  weightUnit: 'LBS' | 'KGS';
  freightClass?: string;
  nmfcCode?: string;
  volume?: number;
}

export interface BOLSignature {
  signedBy: string;
  signatureData: string; // base64 canvas PNG
  signedAt: string;      // ISO 8601 timestamp
  location?: string;
  ipAddress?: string;
}

export interface BOLTimelineEvent {
  event: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  location?: string;
  notes?: string;
}

export interface BOLWMSIntegration {
  enabled: boolean;
  wmsProvider?: string;
  warehouseCode?: string;
  dockDoor?: string;
  appointmentTime?: string;
  poNumber?: string;
  soNumber?: string;
  receiptNumber?: string;
  webhookUrl?: string;
  externalBolId?: string;
  syncedAt?: string;
}

export type BOLStatus = 'DRAFT' | 'ISSUED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'DISPUTED';

export interface BillOfLading {
  bolId: string;
  bolNumber: string;  // BOL-YYYYMMDD-XXXX (human readable)
  loadId: string;
  createdBy: string;  // userId of shipper
  updatedAt: string;
  issuedAt: string;
  issuedLocation?: string;

  // References
  shipperNumber?: string;   // Shipper's internal ref
  proNumber?: string;       // Carrier PRO number
  scac?: string;            // Standard Carrier Alpha Code

  // Parties (auto-populated from profiles)
  consignor: BOLParty;  // FROM - Shipper
  consignee: BOLParty;  // TO - Receiver
  carrier: {
    name: string;
    carrierNumber?: string;
    route?: string;
    scac?: string;
    mcNumber?: string;
    dotNumber?: string;
    driverName?: string;
    trailerNumber?: string;
    emergencyPhone?: string;
  };

  // Origin handling options
  originLiftGate: boolean;
  originInsidePickup: boolean;
  pickupHours?: string;

  // Destination handling options
  destinationLiftGate: boolean;
  destinationInsideDelivery: boolean;
  deliveryHours?: string;

  specialInstructions?: string;
  customsInstructions?: string;

  // Commodities (the freight table rows)
  commodities: BOLCommodity[];

  // Declared value (liability)
  declaredValue?: number;
  declaredValueUnit?: string;

  // Financial
  freightChargesPrepaid: boolean;
  codAmount?: number;
  codFee?: number;
  totalCharges?: number;
  remitCODTo?: BOLParty;

  // Status
  status: BOLStatus;

  // Three signatures with full timestamps
  shipperSignature?: BOLSignature;    // Consignor certification
  carrierSignature?: BOLSignature;    // Carrier pickup certification
  consigneeSignature?: BOLSignature;  // Delivery receipt

  // Carrier certification extras
  pieceCount?: number;
  trailerNumber?: string;

  // Delivery exceptions/damage notes
  deliveryExceptions?: string;

  // Audit timeline
  timeline: BOLTimelineEvent[];

  // WMS integration tail (future)
  wmsIntegration: BOLWMSIntegration;
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: UserRole;
  };
}
