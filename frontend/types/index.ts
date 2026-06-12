export enum UserRole {
  ADMIN = 'ADMIN',
  SHIPPER = 'SHIPPER',
  DRIVER = 'DRIVER',
  RECEIVER = 'RECEIVER'
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

export interface User {
  userId: string;
  email: string;
  role: UserRole;
  status: string;

  // Accounts schema integration
  accountId?: string;
  profileType?: 'ADMIN' | 'CARRIER' | 'SHIPPER' | 'DRIVER' | 'RECEIVER';
  phone?: string;

  createdAt: number;
  updatedAt: number;
}

export interface Driver {
  driverId: string;
  userId: string;
  status: string;

  // DriverProfiles schema integration
  carrierId?: string;
  driverType?: string;
  fullName?: string;
  dob?: number;
  medicalCertExpiration?: number;
  mcIssueDate?: number;

  legalName: string;
  phone: string;
  licenseNumber: string;
  licenseState: string;
  cdlClass: string;
  endorsements: string[];
  experienceYears: number;
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
  mcNumber: string;
  dotNumber: string;
  authorityStartDate: number;
  cargoInsuranceAmount: number;
  liabilityInsuranceAmount: number;

  // InsurancePolicies schema integration
  insurancePolicyId?: string;
  insuranceProvider?: string;
  policyNumber?: string;
  autoLiabilityAmount?: number;
  cargoCoverageAmount?: number;
  policyExpirationDate?: number;

  currentCity: string;
  currentState: string;
  currentLat: number;
  currentLng: number;
  createdAt: number;
  updatedAt: number;
}

export interface Shipper {
  shipperId: string;
  userId: string;
  companyName: string;
  companyAddress: string;
  mcNumber?: string;
  dotNumber?: string;
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

  // Organizations schema integration
  legalName?: string;
  dba?: string;
  orgType?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  mcIssueDate?: number;

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
  referenceNumber: string;
  equipmentType: TrailerType;
  loadSize: string;
  totalWeightLbs: number;
  length?: number;
  width?: number;
  height?: number;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  pickupDate: number;
  pickupTime: string;
  pickupType: string;
  pickupInstructions?: string;
  deliveryCity: string;
  deliveryState: string;
  deliveryZip: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  deliveryDate: number;
  deliveryTime: string;
  deliveryType: string;
  deliveryInstructions?: string;
  receiverId?: string;
  totalMiles: number;
  deadheadMiles?: number;
  rateAmount: number;
  rateType: string;
  paymentTerms: string;
  detentionPay?: number;
  layoverPay?: number;
  commodityDescription: string;
  palletCount?: number;
  stackable: boolean;
  fragile: boolean;
  highValue: boolean;
  hazmat: boolean;
  hazmatClass?: string;
  temperatureMin?: number;
  temperatureMax?: number;
  minMcMaturityDays: number;
  minCargoInsurance: number;
  minLiabilityInsurance: number;
  requiredEndorsements: string[];
  experienceRequired: number;
  broadcastRadiusMiles: number;
  offerTtlMinutes: number;
  offeredDriverCount: number;
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

export interface LoadWithOffer {
  load: Load;
  offer: Offer;
}
