import { v4 as uuid } from 'uuid';
import {
  User, Driver, OwnerOperator, Organization, OrgMembership,
  UserRole, DriverStatus, OrgCapability, OrgRole, TrailerType, CDLClass,
  VerificationEntityType, CarrierOfRecord,
} from '../../src/types';
import { Verification, VerificationStatus, EntityType } from '../../src/services/verification';

const ts = () => Date.now();

export function aUser(overrides?: Partial<User>): User {
  return {
    userId: `user_${uuid()}`,
    email: `${uuid().slice(0, 8)}@test.com`,
    password: '$2a$10$fakehash',
    role: UserRole.DRIVER,
    status: 'ACTIVE' as any,
    idvStatus: 'UNVERIFIED',
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  };
}

export function aDriver(overrides?: Partial<Driver>): Driver {
  return {
    driverId: `drv_${uuid()}`,
    userId: `user_${uuid()}`,
    status: DriverStatus.AVAILABLE,
    legalName: 'Test Driver',
    phone: '555-0100',
    licenseNumber: 'DL123456',
    licenseState: 'TX',
    cdlClass: CDLClass.A,
    endorsements: [],
    experienceYears: 5,
    truckMake: 'Kenworth',
    truckModel: 'T680',
    truckYear: 2022,
    truckVIN: '1XKYD49X0XJ000001',
    trailerType: TrailerType.DRY_VAN,
    trailerLength: 53,
    trailerWidth: 102,
    trailerHeight: 110,
    maxCapacityLbs: 45000,
    currentLoadLbs: 0,
    specialEquipment: [],
    mcNumber: 'MC-123456',
    dotNumber: 'DOT-789012',
    authorityStartDate: ts() - 365 * 86400000,
    cargoInsuranceAmount: 100000,
    liabilityInsuranceAmount: 1000000,
    eldCompliant: true,
    hosAvailableHours: 11,
    currentCity: 'Dallas',
    currentState: 'TX',
    currentLat: 32.7767,
    currentLng: -96.797,
    geohash: '9vg4',
    lastLocationUpdate: ts(),
    ownedByOperatorId: undefined,
    isSelf: false,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  };
}

export function anOoSelfDriver(operatorId: string, userId: string): Driver {
  return aDriver({ ownedByOperatorId: operatorId, isSelf: true, userId });
}

export function aFleetDriver(operatorId: string): Driver {
  return aDriver({ ownedByOperatorId: operatorId, isSelf: false });
}

export function anOwnerOperator(overrides?: Partial<OwnerOperator>): OwnerOperator {
  const userId = overrides?.userId ?? `user_${uuid()}`;
  return {
    operatorId: `op_${uuid()}`,
    userId,
    legalName: 'Test OO',
    phone: '555-0200',
    fleetDriverIds: [],
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  };
}

export function anOrg(capabilities: OrgCapability[], overrides?: Partial<Organization>): Organization {
  return {
    orgId: `org_${uuid()}`,
    legalName: 'Test Org',
    capabilities,
    ownerId: `user_${uuid()}`,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  };
}

export function aMembership(orgId: string, userId: string, overrides?: Partial<OrgMembership>): OrgMembership {
  return {
    membershipId: `mbr_${uuid()}`,
    orgId,
    userId,
    orgRole: OrgRole.ORG_DRIVER,
    userRole: UserRole.DRIVER,
    status: 'ACTIVE',
    joinedAt: ts(),
    ...overrides,
  };
}

export function aVerification(entityId: string, status: VerificationStatus, overrides?: Partial<Verification>): Verification {
  return {
    entityId,
    entityType: EntityType.OWNER_OPERATOR,
    verificationStatus: status,
    fmcsaAuthorityActive: status === VerificationStatus.VERIFIED ? true : undefined,
    kybStatus: status === VerificationStatus.VERIFIED ? 'pass' : undefined,
    amlStatus: status === VerificationStatus.VERIFIED ? 'pass' : undefined,
    docsSubmittedAt: status !== VerificationStatus.UNVERIFIED ? new Date().toISOString() : undefined,
    verifiedAt: status === VerificationStatus.VERIFIED ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function anIdvVerification(userId: string, status: VerificationStatus): Verification {
  return aVerification(userId, status, {
    entityType: EntityType.DRIVER,
    idvStatus: status === VerificationStatus.VERIFIED ? 'pass' : (status === VerificationStatus.PENDING ? 'pending' : undefined),
  });
}
