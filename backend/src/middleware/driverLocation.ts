import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth';
import { DriverService } from '../services/driverService';
import { AppError } from './errorHandler';

const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

export async function requireDriverLocation(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId;
    if (!userId) return next(new AppError('Unauthorized', 401));

    const driver = await DriverService.getProfileByUserId(userId);

    const hasCoords =
      driver &&
      typeof driver.currentLat === 'number' &&
      typeof driver.currentLng === 'number' &&
      driver.currentLat !== 0 &&
      driver.currentLng !== 0;

    const fresh =
      driver &&
      typeof driver.lastLocationUpdate === 'number' &&
      Date.now() - driver.lastLocationUpdate <= MAX_AGE_MS;

    if (!hasCoords || !fresh) {
      return next(
        new AppError(
          'Driver location is required. Please enable location services to continue.',
          403
        )
      );
    }

    return next();
  } catch (err) {
    return next(err as any);
  }
}
