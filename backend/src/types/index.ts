// ============================================
// TYPE DEFINITIONS
// ============================================

export enum UserRole {
  ADMIN          = 'ADMIN',
  SHIPPER        = 'SHIPPER',
  DRIVER         = 'DRIVER',
  RECEIVER       = 'RECEIVER',
  OWNER_OPERATOR = 'OWNER_OPERATOR',
  /**
   * Administrator persona who runs a Carrier-capability Organization. This
   * is NOT a carrier entity role — the carrier remains the Organization
   * (capabilities includes CARRIER). A CARRIER_ADMIN manages/dispatches and
   * never hauls: no Driver profile, never resolves as carrier of record,
   * and is excluded from every accept/haul route by the existing
   * requireDriver/requireOwnerOperator role guards (it's simply not in
   * either allow-list).
   */
  CARRIER_ADMIN  = 'CARRIER_ADMIN',
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

  // Display fields collected at signup. Optional for back-compat with
  // pre-2026-06 user records that predate the profile-on-signup change.
  firstName?: string;
  lastName?: string;
  fullName?: string;

  // Platform-staff tier (only meaningful when role === ADMIN). The
  // PlatformRole enum lives in types/platformRole.ts. Stored as the
  // string value (e.g. "STAFF_ADMIN"); resolvePlatformRole() returns
  // STAFF_ADMIN when unset for back-compat with pre-Phase-1 admins.
  platformRole?: string;

  /**
   * Person-level identity verification (Didit IDV), independent of which
   * carrier parent (OO or Carrier org) governs their haul authority.
   * An Owner Operator verifies identity once and it covers their self-driver.
   */
  idvStatus?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

  /**
   * Private-beta cohort membership. Set by the beta gate at account creation;
   * never user-settable. ADMIN accounts (CLI-bootstrapped) are not part of
   * the cohort gate — these fields stay undefined for them.
   *   - betaUser=true marks the account as part of a beta cohort
   *   - cohort is the wave/group label (e.g. "wave-1")
   *   - invitedVia records HOW they got in (token vs allowlist match)
   * When BETA_MODE is flipped off, these flags persist for post-launch
   * cohort separation but stop gating login/signup.
   */
  betaUser?: boolean;
  cohort?: string;
  invitedVia?: 'INVITE' | 'ALLOWLIST';

  createdAt: number;
  updatedAt: number;
}

// ─── Beta program — gate, allowlist, waitlist, applications ─────────────────

/**
 * Runtime-editable allowlist. Adding an entry takes effect immediately — no
 * deploy. EMAIL entries match a single address; DOMAIN entries let everyone
 * at that domain self-sign-up (used for partner orgs). The beta gate consults
 * this BEFORE issuing a 403, so a domain entry covers everyone-at-`acme.com`
 * without needing per-person invites.
 *
 * `active=false` is a soft-delete; we never hard-delete so audit holds.
 */
export interface BetaAllowlistEntry {
  allowlistId: string;
  type: 'EMAIL' | 'DOMAIN';
  value: string;                // lowercased email or domain (no @ for domains)
  addedByStaffId: string;       // userId of the ADMIN who added it
  reason?: string;              // free-text, surfaced in the admin console
  active: boolean;
  createdAt: number;
  deactivatedAt?: number;
  deactivatedBy?: string;
}

/**
 * Waitlist row — captured when an unauthenticated visitor lands on the
 * private-beta page and asks to be let in. This is the next-cohort pipeline:
 * staff can promote a WAITING row to INVITED (which issues a real Invitation
 * via the existing OrgInvitation flow + allowlists the email).
 *
 * The BetaApplication pipeline (Tally-fed) ALSO uses this waitlist concept —
 * a QUALIFIED application that isn't admitted lives in WAITING state on its
 * own row, and the dashboard shows both surfaces in the same waitlist view.
 */
export interface WaitlistEntry {
  waitlistId: string;
  email: string;                // lowercased
  name?: string;
  personaInterest?: UserRole;   // 'SHIPPER' | 'CARRIER_ADMIN' | etc.
  source: 'landing' | 'application';
  status: 'WAITING' | 'INVITED';
  invitedAt?: number;
  invitedBy?: string;           // ADMIN userId
  createdAt: number;
}

/**
 * The application IS the pipeline record. Lifecycle:
 *   Tally submit → NEW → (auto-qualify) → QUALIFIED or WAITLISTED or DISQUALIFIED
 *                     → (staff scores)  → still QUALIFIED with score+breakdown
 *                     → (admit action)  → ADMITTED → INVITED → (eventual signup) → ONBOARDED
 *
 * sideSpecificData is jsonb-shaped (DynamoDB stores it as an attribute map).
 * The two branches are SHIPPER vs CARRIER fields; BOTH means we collected
 * both branches and the applicant is considered for either side per balance.
 */
export interface BetaApplication {
  applicationId: string;
  responseId: string;             // Tally response id — dedupe key
  side: 'SHIPPER' | 'CARRIER' | 'BOTH';

  // identity
  fullName: string;
  workEmail: string;              // lowercased
  phone?: string;
  company?: string;
  linkedinUrl?: string;
  region?: string;

  // The headline Texas filter, used both for hard-gate and as the Geography
  // scorecard dimension (MOSTLY=3, PARTLY=2, OUTSIDE=0).
  texasFocus: 'MOSTLY' | 'PARTLY' | 'OUTSIDE';

  /** side-branch answers; see docs/beta/Tally_Form_Guide.md for the exact fields */
  sideSpecificData: {
    shipper?: {
      companyType?: string;
      commodities?: string[];
      // Tally sends this as a band string ("Under 5", "5-20", …) or a
      // number; normalizeLoadsPerWeek() interprets either. Stored raw so
      // the original answer survives for the dashboard.
      loadsPerWeek?: number | string;
      modes?: string[];
      lanes?: string[];
      bookingMethod?: string;
      pain?: string;
    };
    carrier?: {
      mcOrDot?: string;
      // Tally sends this as a band string ("1", "2 to 5", "6 to 20", "20+").
      // Stored raw — toInt("2 to 5") would wrongly concatenate to 25.
      truckCount?: number | string;
      loadsPerWeek?: number | string;
      equipment?: string[];
      lanes?: string[];
      findMethod?: string;
      pain?: string;
    };
  };

  // commitment answers — feed the hard-gate
  commitment: {
    realFreight: boolean;
    feedbackCall: boolean;
    contactPref?: 'email' | 'phone' | 'sms';
  };

  referredBy?: string;
  source?: string;                // hidden source/UTM from the Tally form

  status: 'NEW' | 'QUALIFIED' | 'DISQUALIFIED' | 'WAITLISTED' | 'ADMITTED' | 'INVITED' | 'ONBOARDED';

  /** Auto-qualify outputs. See services/betaAutoQualify.ts */
  autoFlags: string[];            // e.g. ['carrier_no_mc_dot', 'shipper_low_volume']

  /** Staff-set scorecard. Pre-computed dimensions (Volume/Texas/Tools) are
   *  filled in on ingest; subjective dimensions (Pain, Responsiveness) are
   *  staff-edited. Total is sum, max 15. */
  score?: number;
  scoreBreakdown?: {
    volume: number;          // 0-3, auto from loadsPerWeek bands
    segmentFit: number;      // 0-3, staff
    geography: number;       // 0-3, auto from texasFocus
    laneOverlap: number;     // 0-2, staff (helper surfaces other-side applicants)
    pain: number;            // 0-2, staff
    tools: number;           // 0-1, auto from bookingMethod presence
    responsiveness: number;  // 0-1, staff
  };

  // cohort assignment (set on admit)
  cohort?: string;
  wave?: string;              // e.g. 'wave-1'
  assigneeStaffId?: string;
  notes?: { authorStaffId: string; text: string; createdAt: number }[];

  // references — NEVER duplicated, always pointers
  linkedInvitationToken?: string;     // the invite issued when admitted
  linkedUserId?: string;              // set when the applicant signs up
  linkedWaitlistId?: string;          // if also on the landing waitlist

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
 * Org roles per LoadLead_Admin_Carrier_IAM_Spec.md.
 *
 * Hierarchy (permission level):
 *   OWNER > MANAGER > DISPATCHER > ORG_DRIVER = SHIPPER_USER = RECEIVER_USER
 *
 * The previous primary admin-tier role was named ORG_ADMIN. It is RENAMED to
 * MANAGER to remove the "admin" substring entirely from tenant roles, so a
 * loose check can never collapse a tenant role into the platform ADMIN even
 * by accident. Legacy values (ORG_ADMIN, ADMIN, MEMBER, VIEWER) are accepted
 * on READ only via `normalizeOrgRole()` below; new invitations and writes
 * must use the canonical set: OWNER / MANAGER / DISPATCHER / ORG_DRIVER /
 * SHIPPER_USER / RECEIVER_USER.
 */
export enum OrgRole {
  OWNER         = 'OWNER',
  MANAGER       = 'MANAGER',
  DISPATCHER    = 'DISPATCHER',
  ORG_DRIVER    = 'ORG_DRIVER',
  SHIPPER_USER  = 'SHIPPER_USER',
  RECEIVER_USER = 'RECEIVER_USER',
  /** @deprecated read-only alias — use MANAGER on new writes */
  ORG_ADMIN     = 'ORG_ADMIN',
  /** @deprecated read-only legacy — never written, treated as MANAGER */
  ADMIN         = 'ADMIN',
  /** @deprecated read-only legacy — treated as ORG_DRIVER */
  MEMBER        = 'MEMBER',
  /** @deprecated read-only legacy — treated as RECEIVER_USER */
  VIEWER        = 'VIEWER',
}

/**
 * Normalize legacy org role values to the canonical set on read. Returns
 * the same role when already canonical. Use this anywhere a Membership
 * is loaded from storage before applying the permissions matrix.
 */
export function normalizeOrgRole(role: string | OrgRole | null | undefined): OrgRole | null {
  if (!role) return null;
  switch (role) {
    case OrgRole.ORG_ADMIN:
    case OrgRole.ADMIN:
      return OrgRole.MANAGER;
    case OrgRole.MEMBER:
      return OrgRole.ORG_DRIVER;
    case OrgRole.VIEWER:
      return OrgRole.RECEIVER_USER;
    case OrgRole.OWNER:
    case OrgRole.MANAGER:
    case OrgRole.DISPATCHER:
    case OrgRole.ORG_DRIVER:
    case OrgRole.SHIPPER_USER:
    case OrgRole.RECEIVER_USER:
      return role as OrgRole;
    default:
      return null;
  }
}

/** Roles that are considered admin-level for org permission checks. */
export const ADMIN_ORG_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.MANAGER];

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
  /**
   * Carrier-org invites carry orgId; non-org persona invites (Shipper,
   * Owner Operator, Receiver, Driver self-signup under beta) leave orgId
   * undefined. acceptInvitation() branches on this presence:
   *   - orgId set    → existing carrier-org flow: creates membership
   *   - orgId unset  → beta self-signup flow: just consumes the token,
   *                    the AuthService stamps invitedVia=INVITE on the new
   *                    user; no membership is created
   * One table, one token format, one TTL, one acceptance call — extended,
   * not duplicated.
   */
  orgId?: string;
  /** orgRole only meaningful when orgId is set */
  orgRole?: OrgRole;
  email: string;
  userRole: UserRole;
  invitedBy: string;   // userId of staff/inviter
  expiresAt: number;
  acceptedAt?: number;
  revokedAt?: number;
  revokedBy?: string;
  /** Cohort tag stamped onto the resulting user when accepted under beta */
  cohort?: string;
  /**
   * PLATFORM-STAFF invite signal. When set (e.g. "STAFF_MANAGER"), this is
   * a staff invite: acceptance creates/elevates a User with role=ADMIN +
   * this platformRole — NOT a customer/cohort account, NOT public signup.
   * Stored as the PlatformRole string value (same as User.platformRole).
   * Same table / token format / TTL / revoke path as every other invite —
   * extended, not duplicated. Mutually exclusive with orgId.
   */
  platformRole?: string;
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

  /** If set, this driver belongs to an Owner Operator's fleet */
  ownedByOperatorId?: string;
  /** True for the dedicated Driver row representing an OO personally hauling */
  isSelf?: boolean;

  createdAt: number;
  updatedAt: number;
}

// ─── Carrier-of-record resolution ───────────────────────────────────────────

/** The two kinds of carrier parent that can govern haul authority */
export enum VerificationEntityType {
  OWNER_OPERATOR = 'OWNER_OPERATOR',
  CARRIER_ORG    = 'CARRIER_ORG',
}

export interface CarrierOfRecord {
  entityType: VerificationEntityType;
  entityId: string; // operatorId | orgId — Verifications table PK
  displayName?: string;
}

// ─── Owner Operator ───────────────────────────────────────────────────────────

/**
 * Owner Operator — independent truck owner who may drive themselves and/or
 * manage a small fleet of drivers. Not part of the org/IAM system.
 */
export interface OwnerOperator {
  operatorId: string;   // primary key
  userId: string;       // FK → Users table

  // Personal / business info
  legalName: string;
  dba?: string;
  phone: string;
  email?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;

  // Authority & insurance
  mcNumber?: string;
  dotNumber?: string;
  authorityStartDate?: number;
  cargoInsuranceAmount?: number;
  liabilityInsuranceAmount?: number;
  insuranceCertificate?: string;

  // Equipment (if they drive themselves)
  cdlClass?: string;
  endorsements?: string[];
  truckMake?: string;
  truckModel?: string;
  truckYear?: number;
  truckVIN?: string;
  trailerType?: string;
  trailerLength?: number;
  maxCapacityLbs?: number;

  // Fleet
  /** driverIds of drivers assigned to this operator's fleet */
  fleetDriverIds?: string[];

  createdAt: number;
  updatedAt: number;
}

export interface FleetInvite {
  inviteId: string;
  operatorId: string;
  email: string;
  token: string;
  expiresAt: number;
  acceptedAt?: number;
  createdAt: number;
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

  // ─── Equipment + Load Type Taxonomy (spec §2–§3) ───────────────────────────
  // Orthogonal type fields. All optional during migration — existing
  // equipmentType / loadSize / commodityDescription remain authoritative
  // until the matching engine fully prefers these. New loads created via
  // the UI populate these directly.
  /** Class code from /data/taxonomy/equipment-classes.json (e.g. "R", "F", "BOX26"). */
  equipment_required?: string;
  /** "Manufacturer::Model" for the assigned unit. Asset metadata only — matching never reads it. */
  equipment_model?: string;
  /** FTL / LTL / Partial / Volume LTL. Mutually exclusive (how much of the truck). */
  mode?: LoadMode;
  /** Service level: Standard / Expedited / Hot Shot / Drayage / Final Mile / White Glove. */
  service_type?: ServiceType;
  /** Combinable characteristic flags — these mirror equipment attributes exactly. */
  characteristics?: LoadCharacteristics;
  /** Commodity code from /data/taxonomy/commodities.json. */
  commodity?: string;
  /** Multi-select accessorial codes from /data/taxonomy/accessorials.json. */
  accessorials?: string[];
  trailer_utilization?: TrailerUtilization;
  team_driver_required?: boolean;
  twic_required?: boolean;
  /** Extended status per spec §2 operational dimension. Legacy `status` stays in sync via a mapper. */
  load_status?: LoadStatusV2;

  createdAt: number;
  updatedAt: number;
}

// ─── Taxonomy-aligned type aliases (Equipment & Load Type Taxonomy spec §2) ───

export type LoadMode = 'FTL' | 'LTL' | 'PARTIAL' | 'VOLUME_LTL';
export type ServiceType = 'STANDARD' | 'EXPEDITED' | 'HOTSHOT' | 'DRAYAGE' | 'FINAL_MILE' | 'WHITE_GLOVE';
export type TemperatureMode = 'AMBIENT' | 'CHILLED' | 'FROZEN' | 'MULTI_TEMP';
export type TrailerUtilization = 'FULL' | 'PARTIAL' | 'SHARED';
export type LoadStatusV2 =
  | 'TENDERED' | 'ACCEPTED' | 'DISPATCHED' | 'IN_TRANSIT'
  | 'DELIVERED' | 'POD_RECEIVED' | 'INVOICED';

/**
 * Load characteristic flags. These are combinable on a single load and mirror
 * equipment attributes one-for-one so the matcher can do
 *   load.characteristics.temperature_required → equipment.attributes.temperature_controlled
 * Setting both `hazmat: true` and `food_grade_required: true` is rare but legal —
 * a chemical-clean food-grade tanker can satisfy both.
 */
export interface LoadCharacteristics {
  temperature_required?: boolean;
  min_temp?: number;
  max_temp?: number;
  temperature_mode?: TemperatureMode;

  hazmat?: boolean;
  hazmat_class?: string;   // "1" .. "9" from /data/taxonomy/hazmat-classes.json

  food_grade_required?: boolean;
  bulk?: boolean;
  oversized?: boolean;
  heavy_haul?: boolean;
  intermodal?: boolean;
}

export interface Offer {
  offerId: string;        // PK on LoadLead_Offers table
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

export interface PodPhoto {
  key: string;         // S3 key in loadlead-pod-uploads
  capturedAt: string;  // ISO 8601
  lat?: number;
  lng?: number;
}

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

  // Proof of Delivery — photos captured at delivery (S3 keys in loadlead-pod-uploads)
  podPhotos?: PodPhoto[];

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
