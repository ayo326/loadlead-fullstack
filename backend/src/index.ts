import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import config from './config/environment';
import { errorHandler } from './middleware/errorHandler';
import Logger from './utils/logger';

// Import routes
import authRoutes from './routes/auth';
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
const app: Application = express();

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// API index + health (handy for browser checks)
app.get('/api', (_req, res) => {
  res.json({
    ok: true,
    routes: ['/api/health','/api/auth','/api/driver','/api/shipper','/api/admin','/api/receiver']
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});


app.get('/api', (_req, res) => {
  res.json({
    ok: true,
    routes: ['/api/health','/api/auth','/api/driver','/api/shipper','/api/admin','/api/receiver']
  });
});


// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/shipper', shipperRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/receiver', receiverRoutes);
app.use('/api/bol', bolRoutes);
app.use('/api/notifications', notificationRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Start server
// Elastic Beanstalk injects PORT=8080; local dev defaults to 4000
const PORT = Number(process.env.PORT) || config.port || 4000;


// Local dev worker: expire offers + rebroadcast queued loads (every 30s)
if ((process.env.NODE_ENV || 'development') !== 'production') {
  setInterval(async () => {
    try {
      await BroadcastService.rebroadcastExpiredLoads();
      // uncomment if you want to see it running:
      // console.log('[worker] rebroadcastExpiredLoads tick');
    } catch (e) {
      console.error('[worker] rebroadcastExpiredLoads error', e);
    }
  }, 30_000);
}


// Dev worker: expire offers + rebroadcast queued OPEN loads
if ((process.env.NODE_ENV || 'development') !== 'production') {
  setInterval(async () => {
    try {
      await BroadcastService.rebroadcastExpiredLoads();
    } catch (e) {
      console.error('[rebroadcast worker] error', e);
    }
  }, 30_000);
}


app.use('/api/maps', mapsRouter);
app.use('/api/org', orgRoutes);

app.listen(PORT, () => {
  Logger.info(`Server running on port ${PORT}`);
  Logger.info(`Environment: ${config.nodeEnv}`);
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