import { User, UserRole, UserStatus } from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';

type StoredUser = User & {
  passwordHash?: string;
  password_hash?: string;
  hashedPassword?: string;
};

export class AuthService {
  private static sanitizeUser(user: StoredUser): User {
    const {
      password: _password,
      passwordHash: _passwordHash,
      password_hash: _passwordHashLegacy,
      hashedPassword: _hashedPassword,
      ...safeUser
    } = user;

    return safeUser as User;
  }

  private static extractPasswordHash(user: Partial<StoredUser> | null | undefined): string | undefined {
    if (!user) {
      return undefined;
    }

    return user.passwordHash ?? user.password ?? user.password_hash ?? user.hashedPassword;
  }

  static async signup(email: string, password: string, role: UserRole): Promise<{ user: User; token: string }> {
    try {
      const existingUsers = await Database.query<StoredUser>(
        config.dynamodb.usersTable,
        'email-index',
        '#email = :email',
        { '#email': 'email' },
        { ':email': email }
      );

      if (existingUsers.length > 0) {
        throw new AppError('Email already registered', 400);
      }

      const userId = Helpers.generateId('user');
      const hashedPassword = await Helpers.hashPassword(password);
      const now = Helpers.getCurrentTimestamp();

      // Persist both keys so old and new records authenticate reliably.
      const user: StoredUser = {
        userId,
        email,
        password: hashedPassword,
        passwordHash: hashedPassword,
        role,
        status: UserStatus.PENDING_VERIFICATION,
        createdAt: now,
        updatedAt: now,
      };

      await Database.putItem(config.dynamodb.usersTable, user);

      const token = Helpers.generateToken({ userId, email, role });
      const safeUser = this.sanitizeUser(user);

      Logger.info(`User signed up: ${email} with role ${role}`);

      return { user: safeUser, token };
    } catch (error) {
      Logger.error('Signup error', error);
      throw error;
    }
  }

  static async login(email: string, password: string): Promise<{ user: User; token: string }> {
    try {
      const users = await Database.query<StoredUser>(
        config.dynamodb.usersTable,
        'email-index',
        '#email = :email',
        { '#email': 'email' },
        { ':email': email }
      );

      if (users.length === 0) {
        throw new AppError('Invalid credentials', 401);
      }

      const user = users[0];
      let userForResponse: StoredUser = user;
      let hash = this.extractPasswordHash(user);

      // Querying by GSI can sometimes return projected items without hash fields.
      if (!hash && user.userId) {
        const fullUser = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId: user.userId });
        hash = this.extractPasswordHash(fullUser);
        if (fullUser) {
          userForResponse = fullUser;
        }
      }

      if (!hash) {
        throw new AppError('Invalid credentials', 401);
      }

      const isValidPassword = await Helpers.comparePassword(password, hash);
      if (!isValidPassword) {
        throw new AppError('Invalid credentials', 401);
      }

      if (userForResponse.status === UserStatus.SUSPENDED) {
        throw new AppError('Account is suspended', 403);
      }

      const token = Helpers.generateToken({
        userId: userForResponse.userId,
        email: userForResponse.email,
        role: userForResponse.role,
      });

      const safeUser = this.sanitizeUser(userForResponse);

      Logger.info(`User logged in: ${email}`);

      return { user: safeUser, token };
    } catch (error) {
      Logger.error('Login error', error);
      throw error;
    }
  }

  static async getUserByEmail(email: string): Promise<User | null> {
    const users = await Database.query<StoredUser>(
      config.dynamodb.usersTable,
      'email-index',
      '#email = :email',
      { '#email': 'email' },
      { ':email': email }
    );
    if (!users.length) return null;
    const full = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId: users[0].userId });
    return full ? this.sanitizeUser(full) : null;
  }

  static async getUserById(userId: string): Promise<User | null> {
    try {
      const user = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId });

      if (!user) {
        return null;
      }

      return this.sanitizeUser(user);
    } catch (error) {
      Logger.error('Get user by ID error', error);
      throw error;
    }
  }
}
