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
import { runBootGuards, assertProductionHardened, BootGuardError } from './services/integrations/bootGuard';

// ── Boot guard — runs before anything else, including building the app.
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
import adminStaffRoutes, { acceptStaffInviteHandler, acceptStaffInviteValidators } from './routes/adminStaff';
import { validate as validateBody } from './middleware/validation';
import { tallyWebhookHandler } from './routes/tallyWebhook';
import { diditWebhookHandler } from './services/verification';
import factoringRoutes from './routes/factoring';
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
// disabled here.
app.use(
  helmet({
    // ── Handled by Nginx → disabled to prevent duplicate headers ──────────
    hsts:           false,  // Nginx: Strict-Transport-Security (conditional on X-Forwarded-Proto)
    frameguard:     false,  // Nginx: X-Frame-Options: DENY
    noSniff:        false,  // Nginx: X-Content-Type-Options: nosniff
    referrerPolicy: false,  // Nginx: Referrer-Policy

    // ── CSP: JSON API serves no HTML/JS — lock it down completely ─────────
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'none'"],
        frameAncestors: ["'none'"],
      },
    },

    // ── Cross-Origin headers (not set by Nginx) ───────────────────────────
    crossOriginOpenerPolicy:   { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow fetch from our SPA
    crossOriginEmbedderPolicy: false, // not relevant for a JSON API

    // ── X-Powered-By (helmet v8: xPoweredBy, NOT hidePoweredBy) ──────────
    xPoweredBy:       false,  // removes 'X-Powered-By: Express'

    // ── Misc ──────────────────────────────────────────────────────────────
    originAgentCluster: true,
  })
);

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
// Tally webhook — route-only RAW body capture, mounted BEFORE express.json
// so the HMAC verifies against the exact bytes Tally sent (never a
// re-serialized body). This is the spec-mandated front door for beta
// ingestion: POST /api/admin/beta/webhook, secured by signature not by a
// user session, so it sits outside the requireAdmin router.
app.post(
  '/api/admin/beta/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  (req, res) => { void tallyWebhookHandler(req, res); },
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

// Single canonical health handler — three duplicate /api/health definitions
// previously existed in this file (dead code; only the first ever ran).
// Consolidated here so productionHardened has exactly one place to live.
// NO secrets, NO mode dump — a boolean only, and only when actually true.
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
  // in prod — both flags must align.
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
  } catch (e) {
    console.error('[rebroadcast worker] error', e);
  }
}, 30_000);


app.use('/api/maps', mapsRouter);
app.use('/api/org', orgRoutes);
app.use('/api/support', require('./routes/support').default);
app.use('/api/setup', setupRoutes);
// /api/beta — public surface of the private-beta program. Mounted BEFORE
// the auth-required routes so the waitlist + status work for unauth visitors.
app.use('/api/beta', betaRoutes);
// /api/admin/beta — staff-only Beta Program management (exact-ADMIN gated
// inside the router). Separate from /api/admin so the beta concern is
// self-contained.
app.use('/api/admin/beta', adminBetaRoutes);
// Public staff-invite acceptance (the invitee has no session yet; the token
// is the gate). Mounted BEFORE the gated staff router so it's reachable.
app.post('/api/admin/staff/accept-invite', validateBody(acceptStaffInviteValidators), acceptStaffInviteHandler);
// /api/admin/staff — platform-staff IAM (STAFF_ADMIN only, gated in-router).
app.use('/api/admin/staff', adminStaffRoutes);
app.use('/api/factoring', factoringRoutes);
app.use('/api/reference', referenceRoutes);

// Didit webhook — PUBLIC (no JWT); signature verified inside the handler
app.post('/api/webhooks/didit', diditWebhookHandler);

// Error handler — registered AFTER all routes so AppError from any router
// (incl. /api/org which is mounted below the line where this used to live)
// is JSON-serialized by errorHandler instead of Express's default HTML 4xx.
app.use(errorHandler);

// ── Test-only routes — guarded dynamic import is the ONLY entry point here.
// A static `import outboxRoutes from './routes/_test/outbox'` at the top of
// this file would defeat deploy-backend.sh's physical exclusion of
// routes/_test from the production artifact (a static import is resolved at
// module-load time regardless of whether the code path runs, so a deleted
// file would crash boot instead of simply never being reached). The path is
// built from parts for the same reason services/integrations/fmcsa.ts splits
// its stub import — see that file's comment. ───────────────────────────────
async function mountTestOnlyRoutes(): Promise<void> {
  if (config.appEnv === 'production') return;
  const testRoutesPath = './routes/' + '_test' + '/outbox';
  const { default: outboxRoutes } = await import(testRoutesPath);
  app.use('/_test', outboxRoutes);
  Logger.info('[boot] /_test/* mounted (non-production)');
}

async function start(): Promise<void> {
  await mountTestOnlyRoutes();

  // Production self-check — independently re-verifies what the guards above
  // and the guarded-import pattern are supposed to already guarantee.
  // Refuses to boot rather than serve a single request if it fails.
  assertProductionHardened(app);

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