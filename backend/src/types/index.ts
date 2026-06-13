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
  // Enclosed
  DRY_VAN    = 'DRY_VAN',
  REEFER     = 'REEFER',
  BOX_TRUCK  = 'BOX_TRUCK',
  // Open-deck
  FLATBED    = 'FLATBED',
  STEP_DECK  = 'STEP_DECK',
  RGN        = 'RGN',
  CONESTOGA  = 'CONESTOGA',
  // Specialized
  TANKER     = 'TANKER',
  CAR_HAULER = 'CAR_HAULER',
  POWER_ONLY = 'POWER_ONLY',
}

export type FreightFormat = 'PALLETIZED' | 'FLOOR_LOADED' | 'CRATED' | 'DRIVE_ON' | 'LIQUID_BULK';

export interface FacilityProfile {
  dockAvailable: boolean;
  forkliftAvailable: boolean;
  freightFormat: FreightFormat;
}

/** Derived loading requirements computed from facility profiles (spec §11.3) */
export interface DerivedLoadingRequirements {
  requiresLiftgate: boolean;
  requiresPalletJack: boolean;
  requiresDockHeight: boolean;
  requiresRgnOrCarHauler: boolean;
  requiresTanker: boolean;
  notes?: string;
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

// ─── Organisation types (Orgs, Roles & Onboarding spec) ─────────────────────

export enum OrgCapability {
  CARRIER  = 'CARRIER',
  SHIPPER  = 'SHIPPER',
  RECEIVER = 'RECEIVER',
}

/**
 * Org roles per spec §3.2.
 * Hierarchy (permission level): OWNER > ORG_ADMIN > DISPATCHER > ORG_DRIVER = SHIPPER_USER = RECEIVER_USER
 * Legacy aliases MEMBER / VIEWER kept for backward-compat with older records but not accepted on new invitations.
 */
export enum OrgRole {
  OWNER         = 'OWNER',
  ORG_ADMIN     = 'ORG_ADMIN',
  DISPATCHER    = 'DISPATCHER',
  ORG_DRIVER    = 'ORG_DRIVER',
  SHIPPER_USER  = 'SHIPPER_USER',
  RECEIVER_USER = 'RECEIVER_USER',
  /** @deprecated use ORG_ADMIN */
  ADMIN  = 'ADMIN',
  /** @deprecated — not in spec; treated as ORG_DRIVER */
  MEMBER = 'MEMBER',
  /** @deprecated — not in spec; treated as RECEIVER_USER */
  VIEWER = 'VIEWER',
}

/** Roles that are considered admin-level for permission checks */
export const ADMIN_ORG_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ORG_ADMIN, OrgRole.ADMIN];

export interface Organization {
  orgId: string;
  legalName: string;
  dba?: string;
  /** Bitmask of OrgCapability values the org has enabled */
  capabilities: OrgCapability[];
  dotNumber?: string;
  mcNumber?: string;
  mcIssueDate?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  /** userId of the founding member */
  ownerId: string;
  /** Platform Admin can suspend an org, freezing all members */
  suspended?: boolean;
  suspendedAt?: number;
  suspendedBy?: string;  // userId of Platform Admin
  suspensionReason?: string;
  createdAt: number;
  updatedAt: number;
}

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED';

export interface OrgMembership {
  membershipId: string;
  orgId: string;
  userId: string;
  orgRole: OrgRole;
  /** Mirror of UserRole so membership can be filtered by role type */
  userRole: UserRole;
  /** ACTIVE (default) or SUSPENDED — suspension revokes access without deleting history (spec §6.4) */
  status: MembershipStatus;
  joinedAt: number;
  suspendedAt?: number;
  suspendedBy?: string;
}

export interface OrgInvitation {
  token: string;
  orgId: string;
  email: string;
  orgRole: OrgRole;
  userRole: UserRole;
  invitedBy: string;   // userId
  expiresAt: number;
  acceptedAt?: number;
  revokedAt?: number;
  revokedBy?: string;
  createdAt: number;
}

/** Audit log entry for membership changes (spec §6.5) */
export interface MembershipAuditLog {
  logId: string;
  orgId: string;
  targetUserId: string;
  actorUserId: string;
  actorRole: string;      // UserRole of acting user
  action: 'MEMBER_ADDED' | 'MEMBER_REMOVED' | 'ROLE_CHANGED' | 'MEMBER_SUSPENDED' | 'MEMBER_REINSTATED' | 'INVITE_SENT' | 'INVITE_ACCEPTED' | 'INVITE_REVOKED' | 'ORG_SUSPENDED' | 'ORG_REINSTATED';
  oldValue?: string;      // e.g. previous orgRole
  newValue?: string;      // e.g. new orgRole
  timestamp: number;
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

// ─── Capacity types ──────────────────────────────────────────────────────────

export type CapacityZone = 'SAFE' | 'BUFFER' | 'DANGER';

export interface CapacityCheck {
  zone: CapacityZone;
  /** Remaining bookable weight after this load (lbs) */
  remainingWeightLbs: number;
  /** Remaining bookable volume after this load (cu in) */
  remainingVolumeCuIn: number;
  /** Human-readable block message (only set in DANGER zone) */
  blockMessage?: string;
  /** Human-readable warning (only set in BUFFER zone) */
  warningMessage?: string;
}

export interface BufferAuditLog {
  logId: string;
  driverId: string;
  changedBy: string;      // userId
  changedByRole: string;
  oldBufferPct: number;
  newBufferPct: number;
  timestamp: number;
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

  // Loading capabilities (spec §11.1)
  dockHeightCompatible?: boolean;
  liftgateEquipped?: boolean;
  palletJackOnboard?: boolean;
  tempRangeMin?: number;   // °F — reefer only
  tempRangeMax?: number;   // °F — reefer only
  securementGear?: string[]; // e.g. ['TARPS','STRAPS','CHAINS']

  // Volume capacity (interior dimensions in inches)
  interiorLengthIn?: number;
  interiorWidthIn?: number;
  interiorHeightIn?: number;
  /** Derived: interiorLengthIn × interiorWidthIn × interiorHeightIn */
  usableVolumeCuIn?: number;
  /** Current onboard volume in cubic inches */
  currentVolumeCuIn?: number;

  // Safety buffer (5–25%, default 10%). Stored per equipment record.
  safetyBufferPct?: number;
  /** Set by system when tightening buffer puts existing loads over limit */
  overBufferFlag?: boolean;
  /** userId who last set the buffer (Platform Admin or org Owner per spec §5.1) */
  bufferSetBy?: string;
  /** Role of the user who last set the buffer ('ADMIN' | 'OWNER') — drives UI message */
  bufferSetByRole?: string;

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
  /** Load dimensions in inches for volume matching */
  dimLengthIn?: number;
  dimWidthIn?: number;
  dimHeightIn?: number;
  /** Derived: dimLengthIn × dimWidthIn × dimHeightIn */
  loadVolumeCuIn?: number;

  // Equipment matching (spec §11.2)
  /** One or more acceptable trailer types; driver must match at least one */
  acceptedEquipmentTypes?: TrailerType[];
  /** Temperature requirements (reefer loads) */
  tempRequiredMin?: number;
  tempRequiredMax?: number;

  // Facility profiles (spec §11.2–11.3)
  pickupFacility?: FacilityProfile;
  deliveryFacility?: FacilityProfile;
  /** System-derived hard filters computed from facility profiles */
  derivedLoadingRequirements?: DerivedLoadingRequirements;

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
