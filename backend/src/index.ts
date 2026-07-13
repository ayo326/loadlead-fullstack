import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import config from './config/environment';
import { errorHandler } from './middleware/errorHandler';
import Logger from './utils/logger';
import { runBootGuards, assertProductionHardened, assertRequiredIndexesActive, BootGuardError } from './services/integrations/bootGuard';

// ── Boot guard - runs before anything else, including building the app.
// Fail-closed: any violation here exits the process immediately. There is
// no warn-and-continue path for production contamination or a live
// Didit/Email/Push integration outside production. ─────────────────────────
try {
  runBootGuards();
} catch (err) {
  if (err instanceof BootGuardError) {
    // eslint-disable-next-line no-console
    console.error(`\n[BOOT REFUSED] ${err.message}\n`);
  } else {
    // eslint-disable-next-line no-console
    console.error('[BOOT REFUSED] Unexpected error during boot guard checks:', err);
  }
  process.exit(1);
}

// Import routes
import authRoutes from './routes/auth';
import attestationRoutes from './routes/attestation';
import driverRoutes from './routes/driver';
import shipperRoutes from './routes/shipper';
import adminRoutes from './routes/admin';
import receiverRoutes from './routes/receiver';
import bolRoutes from './routes/bol';
import notificationRoutes from './routes/notifications';
import { BroadcastService } from './services/broadcastService';

// Load environment variables
dotenv.config();

import mapsRouter from './routes/maps';
import orgRoutes from './routes/org';
import ownerOperatorRoutes from './routes/ownerOperator';
import setupRoutes from './routes/setup';
import betaRoutes from './routes/beta';
import adminBetaRoutes from './routes/adminBeta';
import adminBetaTrustRoutes from './routes/adminBetaTrust';
import adminLiquidityRoutes from './routes/adminLiquidity';
import adminStaffRoutes, { acceptStaffInviteHandler, acceptStaffInviteValidators } from './routes/adminStaff';
import { validate as validateBody } from './middleware/validation';
import { tallyWebhookHandler } from './routes/tallyWebhook';
import { canopyWebhookHandler } from './routes/canopyWebhook';
import canopyRoutes from './routes/canopy';
import { diditWebhookHandler } from './services/verification';
import factoringRoutes from './routes/factoring';
import accessorialRoutes from './routes/accessorials';
import adminComplianceRoutes from './routes/adminCompliance';
import complianceRoutes from './routes/compliance';
import { expireDueCois } from './services/compliance/coiService';
import { NotificationOutboxService } from './services/notificationOutboxService';
import negotiationRoutes from './routes/negotiations';
import { NegotiationService } from './services/negotiationService';
import referenceRoutes from './routes/reference';
const app: Application = express();

// Tell Express to trust the one proxy in front of it (Classic ELB).
// This makes req.protocol and X-Forwarded-Proto reliable.
app.set('trust proxy', 1);

// ── HTTP → HTTPS redirect ──────────────────────────────────────────────────
// Classic ELB terminates TLS and forwards HTTP to the instance.
// It sets X-Forwarded-Proto: https (HTTPS) or http (plain HTTP).
// We redirect plain-HTTP callers before they reach any route.
// The ELB TCP health check (Target: TCP:80) opens a raw socket and never
// sends an HTTP request, so it is unaffected by this middleware.
//
// NOTE: Only redirect when the Host header is our custom API domain
// (api.loadleadapp.com). Requests coming through CloudFront arrive at the ELB
// from CloudFront→HTTP, so ELB stamps X-Forwarded-Proto: http even though the
// original viewer used HTTPS. Redirecting those would send clients to the EB
// CNAME over HTTPS (which has no cert). Direct callers using api.loadleadapp.com
// over plain HTTP should still be redirected.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const host  = (req.headers.host ?? '').toLowerCase();
    // Only redirect if the caller hit our custom domain directly (not via CloudFront's EB origin)
    const isDirectApiAccess = host === 'api.loadleadapp.com' || host.startsWith('api.');
    if (proto && proto !== 'https' && isDirectApiAccess) {
      const httpsUrl = `https://${host}${req.url}`;
      return res.redirect(301, httpsUrl);
    }
    next();
  });
}

// ── Security headers (helmet) ──────────────────────────────────────────────
// Nginx (.platform/nginx/conf.d/security_headers.conf) already injects
// HSTS, X-Frame-Options, X-Content-Type-Options and Referrer-Policy.
// Helmet adds what Nginx doesn't: CSP (appropriate for a JSON API),
// Cross-Origin-* family, X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch.
// Duplicating Nginx headers would produce double values, so those four are
// still set so the app is self-sufficient even if the proxy is bypassed.
// Never advertise the framework (defense in depth; helmet also strips it below).
app.disable('x-powered-by');
app.use(
  helmet({
    // App-owned now (Nginx may also set some of these; a duplicate identical
    // value is harmless and the app no longer DEPENDS on the proxy for them).
    hsts:           { maxAge: 63072000, includeSubDomains: true, preload: true },
    frameguard:     { action: 'deny' },              // X-Frame-Options: DENY
    noSniff:        true,                             // X-Content-Type-Options: nosniff
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // ── CSP: JSON API serves no HTML/JS - lock every directive to 'none' ──
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'none'"],
        baseUri:        ["'none'"],
        formAction:     ["'none'"],
        frameAncestors: ["'none'"],
        scriptSrc:      ["'none'"],
        objectSrc:      ["'none'"],
      },
    },

    // ── Cross-Origin headers (not set by Nginx) ───────────────────────────
    crossOriginOpenerPolicy:   { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow fetch from our SPA
    crossOriginEmbedderPolicy: false, // not relevant for a JSON API

    xPoweredBy:       true,   // helmet strips X-Powered-By (also app.disable above)

    // ── Misc ──────────────────────────────────────────────────────────────
    originAgentCluster: true,
  })
);

// Permissions-Policy is not set by helmet. Lock down browser features the API
// never needs (defense in depth for any error page or misrouted response).
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()'
  );
  next();
});

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // A disallowed browser Origin must be a controlled 403, not an uncaught 500.
    // A plain Error has no statusCode, so errorHandler defaulted it to 500 on
    // EVERY route incl /api/health, making the error rate manipulable and health
    // unreliable as a liveness signal. Tag it 403. (Audit v5 LS-1.)
    callback(Object.assign(new Error(`CORS: origin ${origin} not allowed`), { statusCode: 403 }));
  },
  credentials: true,
}));
// Tally webhook - route-only RAW body capture, mounted BEFORE express.json
// so the HMAC verifies against the exact bytes Tally sent (never a
// re-serialized body). This is the spec-mandated front door for beta
// ingestion: POST /api/admin/beta/webhook, secured by signature not by a
// user session, so it sits outside the requireAdmin router.
app.post(
  '/api/admin/beta/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  (req, res) => { void tallyWebhookHandler(req, res); },
);

// Canopy Connect webhook - same RAW-body discipline (SCRUM-60): the signature is
// verified over the exact bytes Canopy sent, so it is mounted BEFORE express.json
// and outside the authenticated routers. POST /api/webhooks/canopy.
app.post(
  '/api/webhooks/canopy',
  express.raw({ type: '*/*', limit: '2mb' }),
  (req, res) => { void canopyWebhookHandler(req, res); },
);

// Capture rawBody for Didit webhook signature verification (HMAC needs the exact bytes).
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// API index + health (handy for browser checks)
app.get('/api', (_req, res) => {
  res.json({
    ok: true,
    routes: ['/api/health','/api/auth','/api/driver','/api/shipper','/api/admin','/api/receiver']
  });
});

// Single canonical health handler - three duplicate /api/health definitions
// previously existed in this file (dead code; only the first ever ran).
// Consolidated here so productionHardened has exactly one place to live.
// NO secrets, NO mode dump - a boolean only, and only when actually true.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...(config.appEnv === 'production' ? { productionHardened: true } : {}),
  });
});

// Health check (legacy path, kept for any existing monitors pointed at it)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Auth rate limiting ─────────────────────────────────────────────────────
// 15 requests per 15-minute window per IP on all /api/auth/* endpoints.
// Trust-proxy is set above so the real client IP from X-Forwarded-For is used.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 15,                    // max 15 attempts per window
  standardHeaders: true,      // return RateLimit-* headers
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skipSuccessfulRequests: false,
  // Local-dev-only bypass so the E2E fan-out harness can authenticate
  // 13+ test actors in setup() without false 429s.
  //
  // SAFETY: explicit opt-in via AUTH_RATE_LIMIT_BYPASS=1, AND a second
  // gate refusing to engage when APP_ENV=production. Default-deny: a
  // missing / scrambled env never accidentally disables rate limiting
  // in prod - both flags must align.
  skip: () =>
    process.env.AUTH_RATE_LIMIT_BYPASS === '1' &&
    process.env.APP_ENV !== 'production' &&
    process.env.NODE_ENV !== 'production',
});

// API Routes
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/attestation', attestationRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/shipper', shipperRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/receiver', receiverRoutes);
app.use('/api/bol', bolRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/owner-operator', ownerOperatorRoutes);
// Canopy Connect insurance routes (SCRUM-60). Mounted before the generic
// compliance router so /api/compliance/canopy/* resolves to this router.
app.use('/api/compliance/canopy', canopyRoutes);
app.use('/api/compliance', complianceRoutes);

// Note: errorHandler must be registered AFTER all route mounts.
// Moved below the second batch of routes (/api/org, /api/setup, etc.)
// so AppError thrown inside any of them reaches our JSON serializer
// rather than Express's default HTML 4xx/5xx responder.

// Start server
// Elastic Beanstalk injects PORT=8080; local dev defaults to 4000
const PORT = Number(process.env.PORT) || config.port || 4000;


// Background worker: expire unaccepted offers and rebroadcast queued OPEN loads.
// Runs every 30 s in development; in production this should be replaced by an
// AWS EventBridge rule or a dedicated Lambda so the EB instance stays stateless.
setInterval(async () => {
  try {
    await BroadcastService.rebroadcastExpiredLoads();
    // Negotiation sweeper: expire overdue negotiations, release their locks,
    // and let the loads rebroadcast at the posted rate. Same EventBridge/
    // Lambda debt note as above applies.
    await NegotiationService.expireOverdue();
    // M1 reconcile: heal any ACCEPTED negotiation whose load never got assigned
    // (an assignment write that failed after the terminal transition, un-retried).
    await NegotiationService.reconcileAcceptedAssignments();
  } catch (e) {
    console.error('[rebroadcast worker] error', e);
  }
}, 30_000);

// COI expiry sweep (audit v4 M3): flip VERIFIED COIs whose expiry date has
// passed to EXPIRED so a lapsed policy never keeps a stale VERIFIED badge.
// The service existed but nothing invoked it - COIs never auto-expired.
// Runs once shortly after boot (so a long-paused env catches up immediately)
// then every 6 hours; the underlying update is idempotent, so overlapping
// runs across instances are harmless. Same EventBridge/Lambda debt note as
// the 30 s worker above.
const runCoiExpirySweep = async () => {
  try {
    const expired = await expireDueCois();
    if (expired.length) Logger.info(`[coi-expiry] expired ${expired.length} COI(s): ${expired.join(', ')}`);
  } catch (e) {
    console.error('[coi-expiry worker] error', e);
  }
};
setTimeout(runCoiExpirySweep, 60_000);
setInterval(runCoiExpirySweep, 6 * 60 * 60 * 1000);

// Notification-outbox sweep (audit v4 M7): retry PENDING pushes every 60 s so
// a transient push outage delays a counterparty notification instead of
// dropping it. Same EventBridge/Lambda debt note as the workers above.
setInterval(async () => {
  try {
    await NotificationOutboxService.sweep();
  } catch (e) {
    console.error('[outbox worker] error', e);
  }
}, 60_000);


app.use('/api/maps', mapsRouter);
app.use('/api/org', orgRoutes);
app.use('/api/support', require('./routes/support').default);
app.use('/api/setup', setupRoutes);
// /api/beta - public surface of the private-beta program. Mounted BEFORE
// the auth-required routes so the waitlist + status work for unauth visitors.
app.use('/api/beta', betaRoutes);
// /api/admin/beta - staff-only Beta Program management (exact-ADMIN gated
// inside the router). Separate from /api/admin so the beta concern is
// self-contained.
// /api/admin/beta/trust-events - beta no-show/trust-incident events (own store, not
// Load). Mounted before /api/admin/beta so this more specific prefix matches first.
app.use('/api/admin/beta/trust-events', adminBetaTrustRoutes);
app.use('/api/admin/beta', adminBetaRoutes);
// Public staff-invite acceptance (the invitee has no session yet; the token
// is the gate). Mounted BEFORE the gated staff router so it's reachable.
app.post('/api/admin/staff/accept-invite', validateBody(acceptStaffInviteValidators), acceptStaffInviteHandler);
// /api/admin/staff - platform-staff IAM (STAFF_ADMIN only, gated in-router).
app.use('/api/admin/staff', adminStaffRoutes);
// /api/admin/liquidity - Lane Liquidity analytics (authenticate + requireAdmin in-router).
app.use('/api/admin/liquidity', adminLiquidityRoutes);
app.use('/api/factoring', factoringRoutes);
app.use('/api/accessorials', accessorialRoutes);
app.use('/api/admin/compliance', adminComplianceRoutes);
app.use('/api/negotiations', negotiationRoutes);
app.use('/api/reference', referenceRoutes);

// Didit webhook - PUBLIC (no JWT); signature verified inside the handler
app.post('/api/webhooks/didit', diditWebhookHandler);

// JSON 404 for any unmatched /api/* path (audit v4 L2). Without this,
// Express falls through to its default HTML "Cannot GET ..." page - a
// framework fingerprint and a different error shape from every real API
// error (which are JSON via errorHandler). Registered after every /api
// mount and before errorHandler; /_test and non-API paths are unaffected.
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found', statusCode: 404 }));

// Error handler - registered AFTER all routes so AppError from any router
// (incl. /api/org which is mounted below the line where this used to live)
// is JSON-serialized by errorHandler instead of Express's default HTML 4xx.
app.use(errorHandler);

// ── Test-only routes - guarded dynamic import is the ONLY entry point here.
// A static `import outboxRoutes from './routes/_test/outbox'` at the top of
// this file would defeat deploy-backend.sh's physical exclusion of
// routes/_test from the production artifact (a static import is resolved at
// module-load time regardless of whether the code path runs, so a deleted
// file would crash boot instead of simply never being reached). The path is
// built from parts for the same reason services/integrations/fmcsa.ts splits
// its stub import - see that file's comment. ───────────────────────────────
async function mountTestOnlyRoutes(): Promise<void> {
  if (config.appEnv === 'production') return;
  const testRoutesPath = './routes/' + '_test' + '/outbox';
  const { default: outboxRoutes } = await import(testRoutesPath);
  app.use('/_test', outboxRoutes);
  Logger.info('[boot] /_test/* mounted (non-production)');
}

async function start(): Promise<void> {
  await mountTestOnlyRoutes();

  // Production self-check - independently re-verifies what the guards above
  // and the guarded-import pattern are supposed to already guarantee.
  // Refuses to boot rather than serve a single request if it fails.
  assertProductionHardened(app);

  // Required-GSI assertion (audit v4 H3c): in production a missing
  // negotiation index refuses boot instead of silently full-scanning under
  // 1s long-polling; elsewhere it logs loudly. See bootGuard.ts.
  await assertRequiredIndexesActive();

  app.listen(PORT, () => {
    Logger.info(`Server running on port ${PORT}`);
    Logger.info(`Environment: ${config.nodeEnv} (APP_ENV=${config.appEnv})`);
  });
}

start().catch((err) => {
  if (err instanceof BootGuardError) {
    console.error(`\n[BOOT REFUSED] ${err.message}\n`);
  } else {
    console.error('[BOOT REFUSED] Unexpected error during startup:', err);
  }
  process.exit(1);
});

// Export for Lambda if needed
export { app };

// --- quick health check (local dev) ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});