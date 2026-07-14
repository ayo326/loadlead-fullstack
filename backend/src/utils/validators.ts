import { body, param } from 'express-validator';
import { UserRole, SELF_SIGNUP_ROLES, TrailerType, CDLClass } from '../types';

// ── HTML sanitizer ─────────────────────────────────────────────────────────────
// Strips all HTML/SVG tags from a value before it is stored in DynamoDB.
// Defence-in-depth: prevents stored-XSS payloads even if a frontend render
// accidentally uses dangerouslySetInnerHTML or innerHTML in the future.
function stripHtml(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, '').trim();
}

export const authValidators = {
  signup: [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    // SEC-C1: only non-privileged roles may self-register. ADMIN / CARRIER_ADMIN
    // are provisioned server-side (bootstrap / dedicated carrier signup) only.
    body('role').isIn(SELF_SIGNUP_ROLES).withMessage('Invalid role'),
  ],

  login: [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
};

export const driverValidators = {
  createProfile: [
    // All fields optional so profile can be saved incrementally across tabs
    body('legalName').optional().isString(),
    body('fullName').optional().isString(),
    body('firstName').optional().isString(),
    body('lastName').optional().isString(),
    body('phone').optional().isString(),
    body('dob').optional({ checkFalsy: true }).isISO8601().withMessage('Valid DOB is required'),
    body('licenseNumber').optional().isString(),
    body('licenseState').optional({ checkFalsy: true }).isLength({ min: 2, max: 2 }).withMessage('Valid state code required'),
    body('cdlClass').optional({ checkFalsy: true }).isIn(Object.values(CDLClass)).withMessage('Valid CDL class required'),
    body('experienceYears').optional({ checkFalsy: true }).isInt({ min: 0 }).withMessage('Must be a positive number'),
    body('carrierId').optional().isString(),
    body('driverType').optional().isString(),
    body('truckMake').optional().isString(),
    body('truckModel').optional().isString(),
    body('truckYear').optional({ checkFalsy: true }).isInt({ min: 1900, max: new Date().getFullYear() + 1 }).withMessage('Valid truck year required'),
    body('truckVIN').optional({ checkFalsy: true }).isLength({ min: 17, max: 17 }).withMessage('VIN must be 17 characters'),
    body('trailerType').optional({ checkFalsy: true }).isIn(Object.values(TrailerType)).withMessage('Valid trailer type required'),
    body('maxCapacityLbs').optional({ checkFalsy: true }).isInt({ min: 0 }),
    // Loading capability attributes (spec §11.1)
    body('dockHeightCompatible').optional().isBoolean(),
    body('liftgateEquipped').optional().isBoolean(),
    body('palletJackOnboard').optional().isBoolean(),
    body('tempRangeMin').optional().isFloat().withMessage('tempRangeMin must be a number'),
    body('tempRangeMax').optional().isFloat().withMessage('tempRangeMax must be a number'),
    body('securementGear').optional().isArray(),
    // Interior dimensions
    body('interiorLengthIn').optional({ checkFalsy: true }).isNumeric(),
    body('interiorWidthIn').optional({ checkFalsy: true }).isNumeric(),
    body('interiorHeightIn').optional({ checkFalsy: true }).isNumeric(),
    body('safetyBufferPct').optional({ checkFalsy: true }).isFloat({ min: 5, max: 25 }),
    body('mcNumber').optional().isString(),
    body('dotNumber').optional().isString(),
    body('authorityStartDate').optional({ checkFalsy: true }).isISO8601(),
    body('medicalCertExpiration').optional({ checkFalsy: true }).isISO8601(),
    body('mcIssueDate').optional({ checkFalsy: true }).isISO8601(),
    body('insurancePolicyId').optional().isString(),
    body('insuranceProvider').optional().isString(),
    body('policyNumber').optional().isString(),
    body('autoLiabilityAmount').optional({ checkFalsy: true }).isInt({ min: 0 }),
    body('cargoCoverageAmount').optional({ checkFalsy: true }).isInt({ min: 0 }),
    body('policyExpirationDate').optional({ checkFalsy: true }).isISO8601(),
  ],

  updateLocation: [
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    body('city').notEmpty().withMessage('City is required'),
    body('state').isLength({ min: 2, max: 2 }).withMessage('Valid state code is required'),
  ],

  updateLoadStatus: [
    body('currentLoadLbs').isInt({ min: 0 }).withMessage('Current load must be a positive number'),
  ],
};

export const shipperValidators = {
  createProfile: [
    body('companyName').notEmpty().withMessage('Company name is required'),
    body('companyAddress').notEmpty().withMessage('Company address is required'),
    body('contactName').notEmpty().withMessage('Contact name is required'),
    body('contactPhone').notEmpty().withMessage('Contact phone is required'),
    body('contactEmail').isEmail().withMessage('Valid contact email is required'),

    // ShipperProfiles schema integration (all optional so profile can be saved incrementally)
    body('orgId').optional().isString(),
    body('freightTypes').optional().isArray(),
    body('avgMonthlyVolume').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }).withMessage('Average monthly volume must be 0 or higher'),
    body('preferredEquipment').optional().isArray(),
    body('billingTerms').optional().isString(),

    // CarrierProfiles schema integration (optional)
    body('carrierType').optional().isString(),
    body('operatingAuthorityStatus').optional().isString(),
    body('safetyRating').optional().isString(),
    body('operatingRegions').optional().isArray(),

    // Organizations schema integration (optional extras)
    body('legalName').optional().isString(),
    body('dba').optional().isString(),
    body('orgType').optional().isString(),
    body('city').optional().isString(),
    body('state').optional().isLength({ min: 2, max: 2 }),
    body('zip').optional().isString(),
    body('country').optional().isString(),
    body('mcIssueDate').optional().isISO8601(),
  ],
};

export const receiverValidators = {
  createProfile: [
    body('facilityName').notEmpty().withMessage('Facility name is required'),
    body('facilityAddress').notEmpty().withMessage('Facility address is required'),
    body('contactName').notEmpty().withMessage('Contact name is required'),
    body('contactPhone').notEmpty().withMessage('Contact phone is required'),
    body('contactEmail').isEmail().withMessage('Valid contact email is required'),

    // ReceiverProfiles schema integration
    body('orgId').notEmpty().withMessage('Organization ID is required'),
    body('receivingHours').custom((value) => {
      const type = typeof value;
      if (type === 'string' || (type === 'object' && value !== null)) return true;
      throw new Error('Receiving hours must be a string or object');
    }),
    body('appointmentRequired').isBoolean().withMessage('appointmentRequired must be true or false'),
    body('dockType').notEmpty().withMessage('Dock type is required'),
  ],

  updateProfile: [
    body('facilityName').optional().notEmpty(),
    body('facilityAddress').optional().notEmpty(),
    body('contactName').optional().notEmpty(),
    body('contactPhone').optional().notEmpty(),
    body('contactEmail').optional().isEmail(),
    body('orgId').optional().notEmpty(),
    body('receivingHours').optional().custom((value) => {
      const type = typeof value;
      if (type === 'string' || (type === 'object' && value !== null)) return true;
      throw new Error('Receiving hours must be a string or object');
    }),
    body('appointmentRequired').optional().isBoolean(),
    body('dockType').optional().notEmpty(),
  ],
};

export const loadValidators = {
  createLoad: [
    // equipmentType now optional when acceptedEquipmentTypes array is provided
    body('equipmentType').optional({ checkFalsy: true }).isIn(Object.values(TrailerType)).withMessage('Valid equipment type is required'),
    body('acceptedEquipmentTypes').optional().isArray(),
    body('acceptedEquipmentTypes.*').optional().isIn(Object.values(TrailerType)).withMessage('Each accepted equipment type must be valid'),
    body('totalWeightLbs').isInt({ min: 0 }).withMessage('Total weight must be a positive number'),
    // Facility profiles (spec §11.2)
    body('pickupFacility').optional().isObject(),
    body('pickupFacility.dockAvailable').optional().isBoolean(),
    body('pickupFacility.forkliftAvailable').optional().isBoolean(),
    body('pickupFacility.freightFormat').optional().isIn(['PALLETIZED','FLOOR_LOADED','CRATED','DRIVE_ON','LIQUID_BULK']),
    body('deliveryFacility').optional().isObject(),
    body('deliveryFacility.dockAvailable').optional().isBoolean(),
    body('deliveryFacility.forkliftAvailable').optional().isBoolean(),
    body('deliveryFacility.freightFormat').optional().isIn(['PALLETIZED','FLOOR_LOADED','CRATED','DRIVE_ON','LIQUID_BULK']),
    body('tempRequiredMin').optional({ checkFalsy: true }).isNumeric(),
    body('tempRequiredMax').optional({ checkFalsy: true }).isNumeric(),
    // Load dimensions
    body('dimLengthIn').optional({ checkFalsy: true }).isNumeric(),
    body('dimWidthIn').optional({ checkFalsy: true }).isNumeric(),
    body('dimHeightIn').optional({ checkFalsy: true }).isNumeric(),
    // Full pickup address (required so geocoding is never skipped)
    body('pickupAddress').notEmpty().withMessage('Pickup street address is required').customSanitizer(stripHtml),
    body('pickupCity').notEmpty().withMessage('Pickup city is required'),
    body('pickupState').isLength({ min: 2, max: 2 }).withMessage('Valid pickup state is required'),
    body('pickupZip').notEmpty().withMessage('Pickup zip is required'),
    body('pickupLat').isFloat({ min: -90, max: 90 }).withMessage('Pickup latitude is required - geocode the address before submitting'),
    body('pickupLng').isFloat({ min: -180, max: 180 }).withMessage('Pickup longitude is required - geocode the address before submitting'),
    body('pickupDate').isInt({ min: 0 }).withMessage('Pickup date must be a unix timestamp (ms)'),
    // Full delivery address (required so geocoding is never skipped)
    body('deliveryAddress').notEmpty().withMessage('Delivery street address is required').customSanitizer(stripHtml),
    body('deliveryCity').notEmpty().withMessage('Delivery city is required'),
    body('deliveryState').isLength({ min: 2, max: 2 }).withMessage('Valid delivery state is required'),
    body('deliveryZip').notEmpty().withMessage('Delivery zip is required'),
    body('deliveryLat').isFloat({ min: -90, max: 90 }).withMessage('Delivery latitude is required - geocode the address before submitting'),
    body('deliveryLng').isFloat({ min: -180, max: 180 }).withMessage('Delivery longitude is required - geocode the address before submitting'),
    body('deliveryDate')
      .isInt({ min: 0 }).withMessage('Delivery date must be a unix timestamp (ms)')
      .custom((val, { req }) => {
        const pickup = Number(req.body?.pickupDate);
        const delivery = Number(val);
        if (!isNaN(pickup) && delivery <= pickup) {
          throw new Error('Delivery date must be after pickup date');
        }
        return true;
      }),
    body('rateAmount').isFloat({ min: 0 }).withMessage('Rate amount must be a positive number'),
    body('minMcMaturityDays').isInt({ min: 0, max: 3650 }).withMessage('Minimum MC maturity must be between 0 and 3650 days'),
    body('commodityDescription')
      .notEmpty().withMessage('Commodity description is required')
      .customSanitizer(stripHtml),
    body('pickupInstructions').optional().customSanitizer(stripHtml),
    body('deliveryInstructions').optional().customSanitizer(stripHtml),
    body('specialInstructions').optional().customSanitizer(stripHtml),
    body('notes').optional().customSanitizer(stripHtml),
    body('broadcastRadiusMiles').isInt({ min: 1, max: 500 }).withMessage('Broadcast radius must be between 1 and 500 miles'),
  ],
};

export const offerValidators = {
  acceptOffer: [
    param('loadId').notEmpty().withMessage('Load ID is required'),
  ],

  declineOffer: [
    param('loadId').notEmpty().withMessage('Load ID is required'),
  ],
};
