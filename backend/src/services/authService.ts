import { User, UserRole, SELF_SIGNUP_ROLES, UserStatus, OrgCapability, OrgRole, Organization, OrgMembership } from '../types';
import { OrgService, assertCapabilities } from './orgService';
import { Database } from '../config/database';
import { docClient } from '../config/aws';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
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

  static async signup(
    email: string,
    password: string,
    role: UserRole,
    orgParams?: {
      legalName: string;
      capabilities: OrgCapability[];
      dba?: string;
      dotNumber?: string;
      mcNumber?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    },
    profile?: { firstName?: string; lastName?: string; phone?: string },
    /**
     * Set by routes/auth.ts when the beta gate ran and the request passed.
     * The presence of this object is the signal that we're in BETA_MODE
     * and a cohort tag should be stamped on the new user. When absent,
     * the new user is a regular (post-launch) signup.
     */
    betaContext?: {
      invitedVia: 'INVITE' | 'ALLOWLIST';
      invitationToken?: string;
      cohort: string;
    },
  ): Promise<{ user: User; token: string; orgId?: string }> {
    try {
      // SEC-C1: hard server-side allowlist. Even if the route validator were
      // bypassed, self-signup must never mint a privileged (ADMIN/CARRIER_ADMIN)
      // account. Carrier admins come through the dedicated /signup/carrier path.
      if (!SELF_SIGNUP_ROLES.includes(role)) {
        throw new AppError('Invalid role', 400);
      }

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
      const firstName = profile?.firstName?.trim();
      const lastName  = profile?.lastName?.trim();
      const fullName  = [firstName, lastName].filter(Boolean).join(' ') || undefined;
      const user: StoredUser = {
        userId,
        email,
        password: hashedPassword,
        passwordHash: hashedPassword,
        role,
        status: UserStatus.PENDING_VERIFICATION,
        firstName,
        lastName,
        fullName,
        phone: profile?.phone?.trim(),
        // Beta cohort stamping. If we're under BETA_MODE the caller has
        // already validated the gate (invite OR allowlist) and passes us
        // betaContext; we just persist the audit trail on the user row.
        // After BETA_MODE flips off these fields persist on existing users
        // for cohort separation but stop affecting auth.
        betaUser: betaContext ? true : undefined,
        cohort: betaContext?.cohort,
        invitedVia: betaContext?.invitedVia,
        createdAt: now,
        updatedAt: now,
      };

      await Database.putItem(config.dynamodb.usersTable, user);

      // If an invitation token brought them in, consume it (idempotent;
      // self-signup branch since orgId is absent on these invites).
      if (betaContext?.invitationToken) {
        try {
          const { OrgInvitationService } = await import('./orgService');
          await OrgInvitationService.acceptInvitation(betaContext.invitationToken, userId);
        } catch (err) {
          Logger.warn(`Could not consume beta invite token for ${email}: ${(err as Error).message}`);
        }
      }

      const token = Helpers.generateToken({ userId, email, role });
      const safeUser = this.sanitizeUser(user);

      Logger.info(`User signed up: ${email} with role ${role}${betaContext ? ` (beta, ${betaContext.invitedVia}, cohort=${betaContext.cohort})` : ''}`);

      // Auto-create organisation if org params provided (non-DRIVER, non-ADMIN roles)
      let orgId: string | undefined;
      if (orgParams && role !== UserRole.ADMIN) {
        try {
          const { org } = await OrgService.createOrg({
            ...orgParams,
            ownerId: userId,
            ownerRole: role,
          });
          orgId = org.orgId;
        } catch (orgErr) {
          Logger.error('Auto-create org failed (non-fatal)', orgErr);
        }
      }

      return { user: safeUser, token, orgId };
    } catch (error) {
      Logger.error('Signup error', error);
      throw error;
    }
  }

  /**
   * Carrier signup - a dedicated, atomic path. Creates User(CARRIER_ADMIN) +
   * Organization(capabilities=[CARRIER]) + OrgMembership(OWNER, ACTIVE) in a
   * single DynamoDB TransactWriteItems call: either all three rows exist or
   * none do. Deliberately separate from the generic signup() above, which
   * creates the org as a best-effort second step (catches and logs org
   * creation failure as non-fatal) - that is NOT atomic and is intentionally
   * left alone for the four existing personas. Carrier signup needs the
   * stronger guarantee because a User with no Organization is a carrier
   * admin who can never resolve a carrier of record, and an Organization
   * with no OWNER membership is unmanageable.
   */
  static async signupCarrierAdmin(params: {
    email: string;
    password: string;
    legalName: string;
    dba?: string;
    mcNumber?: string;
    dotNumber?: string;
    /** See signup() - same semantics, set by routes/auth.ts when the
     *  beta gate passes the request. */
    betaContext?: {
      invitedVia: 'INVITE' | 'ALLOWLIST';
      invitationToken?: string;
      cohort: string;
    };
  }): Promise<{ user: User; token: string; orgId: string }> {
    const existingUsers = await Database.query<StoredUser>(
      config.dynamodb.usersTable,
      'email-index',
      '#email = :email',
      { '#email': 'email' },
      { ':email': params.email },
    );
    if (existingUsers.length > 0) {
      throw new AppError('Email already registered', 400);
    }

    // Capability exclusivity enforced server-side before the transaction is
    // even built - a Carrier signup always passes exactly [CARRIER], but
    // this call is what would catch a future code path trying to sneak
    // SHIPPER in alongside it.
    assertCapabilities([OrgCapability.CARRIER]);

    const userId = Helpers.generateId('user');
    const orgId = Helpers.generateId('org');
    const membershipId = Helpers.generateId('mbr');
    const now = Helpers.getCurrentTimestamp();
    const hashedPassword = await Helpers.hashPassword(params.password);

    const user: StoredUser = {
      userId,
      email: params.email,
      password: hashedPassword,
      passwordHash: hashedPassword,
      role: UserRole.CARRIER_ADMIN,
      status: UserStatus.PENDING_VERIFICATION,
      // Beta cohort stamping - symmetric with signup() above. Set only
      // when the route layer passes us betaContext (i.e. BETA_MODE is on
      // AND the gate accepted this request).
      betaUser: params.betaContext ? true : undefined,
      cohort: params.betaContext?.cohort,
      invitedVia: params.betaContext?.invitedVia,
      createdAt: now,
      updatedAt: now,
    };

    const org: Organization = {
      orgId,
      legalName: params.legalName,
      dba: params.dba,
      capabilities: [OrgCapability.CARRIER],
      mcNumber: params.mcNumber,
      dotNumber: params.dotNumber,
      ownerId: userId,
      suspended: false,
      createdAt: now,
      updatedAt: now,
    };

    const membership: OrgMembership = {
      membershipId,
      orgId,
      userId,
      orgRole: OrgRole.OWNER,
      userRole: UserRole.CARRIER_ADMIN,
      status: 'ACTIVE',
      joinedAt: now,
    };

    try {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.dynamodb.usersTable,
              Item: user,
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
          {
            Put: {
              TableName: config.dynamodb.orgsTable,
              Item: org,
              ConditionExpression: 'attribute_not_exists(orgId)',
            },
          },
          {
            Put: {
              TableName: config.dynamodb.membershipsTable,
              Item: membership,
              ConditionExpression: 'attribute_not_exists(membershipId)',
            },
          },
        ],
      }));
    } catch (error) {
      Logger.error('Carrier signup transaction failed - rolled back, zero rows created', error);
      throw new AppError('Could not create carrier account. Please try again.', 500);
    }

    // Consume the beta invitation token if one brought the carrier in.
    // Idempotent - multiple consumes are safe (acceptInvitation rejects
    // already-accepted tokens). Self-signup branch of acceptInvitation
    // since these carrier invites have no orgId (the org is being created
    // here, in the same call).
    if (params.betaContext?.invitationToken) {
      try {
        const { OrgInvitationService } = await import('./orgService');
        await OrgInvitationService.acceptInvitation(params.betaContext.invitationToken, userId);
      } catch (err) {
        Logger.warn(`Could not consume beta invite token for carrier ${params.email}: ${(err as Error).message}`);
      }
    }

    const token = Helpers.generateToken({ userId, email: params.email, role: UserRole.CARRIER_ADMIN });
    Logger.info(`Carrier admin signed up: ${params.email}, org ${orgId}${params.betaContext ? ` (beta, ${params.betaContext.invitedVia}, cohort=${params.betaContext.cohort})` : ''}`);

    return { user: this.sanitizeUser(user), token, orgId };
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
