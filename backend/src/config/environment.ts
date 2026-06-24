import dotenv from 'dotenv';
import path from 'path';

// Always load backend/.env (works even when running from repo root)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // APP_ENV is the deliberate, explicit environment signal — distinct from
  // NODE_ENV, which EB/npm tooling often forces to "production" for every
  // environment (dev/staging included) as a build optimization flag. Every
  // production-lockdown decision (services/integrations) keys off APP_ENV,
  // never NODE_ENV.
  appEnv: process.env.APP_ENV || 'development',

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },

  dynamodb: {
    endpoint: process.env.DYNAMODB_ENDPOINT,

    usersTable: process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users',
    driversTable: process.env.DYNAMODB_DRIVERS_TABLE || 'LoadLead_Drivers',
    shippersTable: process.env.DYNAMODB_SHIPPERS_TABLE || 'LoadLead_Shippers',
    receiversTable: process.env.DYNAMODB_RECEIVERS_TABLE || 'LoadLead_Receivers',
    loadsTable: process.env.DYNAMODB_LOADS_TABLE || 'LoadLead_Loads',
    offersTable: process.env.DYNAMODB_OFFERS_TABLE || 'LoadLead_Offers',
    bolTable: process.env.DYNAMODB_BOL_TABLE || 'LoadLead_BOL',
    orgsTable: process.env.DYNAMODB_ORGS_TABLE || 'LoadLead_Organizations',
    membershipsTable: process.env.DYNAMODB_MEMBERSHIPS_TABLE || 'LoadLead_Memberships',
    invitationsTable: process.env.DYNAMODB_INVITATIONS_TABLE || 'LoadLead_Invitations',
    // Attestation chain — append-only, IAM-deny-update/delete, attribute_not_exists Put.
    signaturesTable: process.env.DYNAMODB_SIGNATURES_TABLE || 'LoadLead_Signatures',
    // Pod photo finalize step records contentHash + stage; same DDB row as the
    // photo metadata. Same table as load attachments in the long run; isolated
    // for now so app reads stay simple.
    podPhotosTable: process.env.DYNAMODB_POD_PHOTOS_TABLE || 'LoadLead_PodPhotos',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  google: {
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  },

  app: {
    broadcastRadius: parseInt(process.env.BROADCAST_RADIUS_MILES || '50'),
    offerTtl: parseInt(process.env.OFFER_TTL_MINUTES || '15'),
    minMcMaturity: parseInt(process.env.MIN_MC_MATURITY_DAYS || '90'),
  },
};

export default config;
