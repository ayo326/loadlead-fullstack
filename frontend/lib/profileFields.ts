export type ProfileRole = 'ADMIN' | 'SHIPPER' | 'DRIVER' | 'RECEIVER';

export interface ProfileFieldDefinition {
  key: string;
  label: string;
  required: boolean;
  help?: string;
}

export const PROFILE_FIELD_DEFINITIONS: Record<ProfileRole, ProfileFieldDefinition[]> = {
  ADMIN: [
    { key: 'displayName', label: 'Display Name', required: true },
    { key: 'email', label: 'Email', required: true },
    { key: 'supportEmail', label: 'Support Email', required: true },
    { key: 'defaultBroadcastRadius', label: 'Default Broadcast Radius (miles)', required: true },
    { key: 'defaultMinMcMaturity', label: 'Default Minimum MC Maturity (days)', required: true },
  ],
  SHIPPER: [
    { key: 'companyName', label: 'Company Name', required: true },
    { key: 'companyAddress', label: 'Company Address', required: true },
    { key: 'contactName', label: 'Contact Name', required: true },
    { key: 'contactPhone', label: 'Contact Phone', required: true },
    { key: 'contactEmail', label: 'Contact Email', required: true },

    // ShipperProfiles schema
    { key: 'orgId', label: 'Organization ID', required: true },
    { key: 'freightTypesCsv', label: 'Freight Types', required: true },
    { key: 'avgMonthlyVolume', label: 'Average Monthly Volume', required: true },
    { key: 'preferredEquipmentCsv', label: 'Preferred Equipment', required: true },
    { key: 'billingTerms', label: 'Billing Terms', required: true },

    // CarrierProfiles schema
    { key: 'carrierType', label: 'Carrier Type', required: false },
    { key: 'operatingAuthorityStatus', label: 'Operating Authority Status', required: false },
    { key: 'safetyRating', label: 'Safety Rating', required: false },
    { key: 'operatingRegionsCsv', label: 'Operating Regions', required: false },

    // Organizations schema (optional extras)
    { key: 'legalName', label: 'Legal Name', required: false },
    { key: 'dba', label: 'DBA', required: false },
    { key: 'orgType', label: 'Organization Type', required: false },
    { key: 'city', label: 'City', required: false },
    { key: 'state', label: 'State', required: false },
    { key: 'zip', label: 'ZIP', required: false },
    { key: 'country', label: 'Country', required: false },
    { key: 'mcIssueDate', label: 'MC Issue Date', required: false },

    { key: 'defaultBroadcastRadius', label: 'Default Broadcast Radius (miles)', required: false },
    { key: 'defaultMinMcMaturity', label: 'Default Minimum MC Maturity (days)', required: false },
  ],
  DRIVER: [
    { key: 'legalName', label: 'Full Legal Name', required: true },
    { key: 'phone', label: 'Phone', required: true },

    // DriverProfiles schema
    { key: 'carrierId', label: 'Carrier ID', required: true },
    { key: 'driverType', label: 'Driver Type', required: true },
    { key: 'fullName', label: 'Driver Full Name', required: true },
    { key: 'dob', label: 'Date of Birth', required: true },
    { key: 'medicalCertExpiration', label: 'Medical Certificate Expiration', required: true },
    { key: 'mcIssueDate', label: 'MC Issue Date', required: true },

    { key: 'licenseNumber', label: 'Driver License Number', required: true },
    { key: 'licenseState', label: 'License State (2-char)', required: true },
    { key: 'cdlClass', label: 'CDL Class', required: true },
    { key: 'experienceYears', label: 'Years of Experience', required: true },
    { key: 'truckMake', label: 'Truck Make', required: true },
    { key: 'truckModel', label: 'Truck Model', required: true },
    { key: 'truckYear', label: 'Truck Year', required: true },
    { key: 'truckVIN', label: 'VIN (17 characters)', required: true },
    { key: 'trailerType', label: 'Trailer Type', required: true },
    { key: 'maxCapacityLbs', label: 'Max Capacity (lbs)', required: true },
    { key: 'mcNumber', label: 'MC Number', required: true },
    { key: 'dotNumber', label: 'DOT Number', required: true },
    { key: 'authorityStartDate', label: 'Authority Start Date', required: true },

    // InsurancePolicies schema integration
    { key: 'insuranceProvider', label: 'Insurance Provider', required: false },
    { key: 'policyNumber', label: 'Policy Number', required: false },
    { key: 'autoLiabilityAmount', label: 'Auto Liability Amount', required: false },
    { key: 'cargoCoverageAmount', label: 'Cargo Coverage Amount', required: false },
    { key: 'policyExpirationDate', label: 'Policy Expiration Date', required: false },
  ],
  RECEIVER: [
    { key: 'facilityName', label: 'Facility Name', required: true },
    { key: 'facilityAddress', label: 'Facility Address', required: true },
    { key: 'contactName', label: 'Contact Name', required: true },
    { key: 'contactPhone', label: 'Contact Phone', required: true },
    { key: 'contactEmail', label: 'Contact Email', required: true },

    // ReceiverProfiles schema
    { key: 'orgId', label: 'Organization ID', required: true },
    { key: 'receivingHours', label: 'Receiving Hours', required: true },
    { key: 'appointmentRequired', label: 'Appointment Required', required: true },
    { key: 'dockType', label: 'Dock Type', required: true },

    { key: 'specialInstructions', label: 'Special Instructions', required: false },
  ],
};

export const REQUIRED_PROFILE_FIELDS: Record<ProfileRole, string[]> = {
  ADMIN: PROFILE_FIELD_DEFINITIONS.ADMIN.filter((f) => f.required).map((f) => f.key),
  SHIPPER: PROFILE_FIELD_DEFINITIONS.SHIPPER.filter((f) => f.required).map((f) => f.key),
  DRIVER: PROFILE_FIELD_DEFINITIONS.DRIVER.filter((f) => f.required).map((f) => f.key),
  RECEIVER: PROFILE_FIELD_DEFINITIONS.RECEIVER.filter((f) => f.required).map((f) => f.key),
};
