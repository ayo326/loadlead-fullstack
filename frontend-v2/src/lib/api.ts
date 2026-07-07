// In development the Vite proxy rewrites /api → http://localhost:4000
// In production VITE_API_URL is set to https://api.loadleadapp.com
const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";

// ─── Beta Program types (mirror backend BetaApplication / allowlist) ────────
export interface BetaScoreBreakdown {
  volume: number; segmentFit: number; geography: number;
  laneOverlap: number; pain: number; tools: number; responsiveness: number;
}
export interface BetaApplicationRow {
  applicationId: string;
  responseId: string;
  side: "SHIPPER" | "CARRIER" | "BOTH";
  fullName: string;
  workEmail: string;
  phone?: string;
  company?: string;
  region?: string;
  texasFocus: "MOSTLY" | "PARTLY" | "OUTSIDE";
  sideSpecificData: { shipper?: Record<string, any>; carrier?: Record<string, any> };
  commitment: { realFreight: boolean; feedbackCall: boolean; contactPref?: string };
  status: "NEW" | "QUALIFIED" | "DISQUALIFIED" | "WAITLISTED" | "ADMITTED" | "INVITED" | "ONBOARDED";
  autoFlags: string[];
  score?: number;
  scoreBreakdown?: BetaScoreBreakdown;
  cohort?: string;
  wave?: string;
  notes?: { authorStaffId: string; text: string; createdAt: number }[];
  createdAt: number;
  updatedAt: number;
}
export interface LaneOverlap {
  applicationId: string; fullName: string; company?: string;
  side: string; sharedLaneTokens: string[]; bothTexas: boolean;
}
export type BalanceState = "EMPTY" | "NEED_CARRIERS" | "NEED_SHIPPERS" | "SKEWED" | "BALANCED";
export interface SideCounts { shippers: number; carriers: number; both: number; }
export interface CohortBalance {
  admitted: SideCounts;          // BOTH double-counts toward shippers + carriers
  pipeline: SideCounts;          // QUALIFIED, not yet admitted
  seatsFilled: number;           // distinct admitted apps (BOTH counts once)
  cohortCap: number;
  ratioTarget: string;
  measuring: "admitted" | "pipeline";
  balanceState: BalanceState;
  skewedTo: "shippers" | "carriers" | null;
  currentCohort: string;
}
export interface AllowlistEntry {
  allowlistId: string; type: "EMAIL" | "DOMAIN"; value: string;
  addedByStaffId: string; reason?: string; active: boolean; createdAt: number;
}
export interface WaitlistRow {
  waitlistId: string; email: string; name?: string;
  personaInterest?: string; source: string; status: string; createdAt: number;
}

// ─── Platform-staff IAM types (separate enum from carrier-org OrgRole) ──────
export type PlatformRole = "STAFF_ADMIN" | "STAFF_MANAGER" | "STAFF_SUPERVISOR" | "STAFF_TEAM_LEAD";
export interface StaffMember {
  userId: string; email: string; fullName?: string;
  platformRole: PlatformRole; status: "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION"; createdAt: number;
}
export interface PendingStaffInvite {
  token: string; email: string; platformRole: PlatformRole;
  invitedBy: string; expiresAt: number; createdAt: number;
}

// ─── Load negotiation (mirror backend negotiationService) ───────────────────
export interface NegotiationView {
  negotiationId: string; loadId: string;
  status: "ENGAGED" | "PENDING_SHIPPER" | "PENDING_HAULER" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  display: string; actions: string[];
  rateBasis: "PER_MILE" | "FLAT_TOTAL";
  postedRatePerMileCents: number | null;
  postedLinehaulCents: number;
  currentOfferRatePerMileCents: number | null;
  currentOfferTotalCents: number | null;
  currentOfferParty: "HAULER" | "SHIPPER" | null;
  roundCount: number; secondsRemaining: number; deadlineAt: number; updatedAt: number;
  agreedRatePerMileCents: number | null; agreedLinehaulCents: number | null;
}
export type NegotiationOfferAmount = { ratePerMileCents: number } | { totalCents: number };
export interface NegotiationOfferRow {
  negOfferId: string; negotiationId: string; party: "HAULER" | "SHIPPER";
  action: string; ratePerMileCents?: number; createdAt: number;
}

// ─── Compliance / oversight layer (mirror backend services) ─────────────────
// Separate axis from PlatformRole: a compliance grant is required in addition to
// the ADMIN role. The server enforces every surface; these types drive the UI.
export type ComplianceRole = "DISPUTE_ADMIN" | "LEGAL_ADMIN" | "LAW_ENFORCEMENT_LIAISON";
export interface ComplianceMe {
  userId: string; email: string;
  complianceRoles: ComplianceRole[];
  platformRole: PlatformRole | null;
  isStaffAdmin: boolean;
}
export type DiscrepancySeverity = "INFO" | "WARN" | "CRITICAL";
export interface DiscrepancyFinding {
  code: string; severity: DiscrepancySeverity; message: string; refs: string[];
}
export type AdjudicationAction = "UPHOLD" | "REVERSE" | "ADJUST" | "ESCALATE";
export type AdjudicationTargetType = "CHARGE_DISPUTE" | "RECOURSE_BUYBACK" | "DISCREPANCY";
export interface Adjudication {
  adjudicationId: string; targetType: AdjudicationTargetType; targetId: string;
  invoiceId?: string; carrierId?: string; action: AdjudicationAction; reason: string;
  actorId: string; compensatingOutcomeId?: string; at: number;
}
export interface LegalHoldEvent {
  holdId: string; entityType: string; entityId: string;
  eventType: "PLACE" | "RELEASE"; reason: string; authorityRef?: string;
  actorId: string; at: number; seq?: number;
}
export interface CaseFileManifestEntry { kind: string; id: string; contentHash: string; }
export interface CaseFileItem extends CaseFileManifestEntry { content: unknown; }
export interface CaseFile {
  subjectType: string; subjectId: string; assembledAt: number;
  manifest: CaseFileManifestEntry[]; items: CaseFileItem[];
}
export interface CaseFileIntegrity { ok: boolean; gaps: string[]; }
export type LERequestType = "SUBPOENA" | "COURT_ORDER" | "WARRANT" | "GARNISHMENT" | "LEVY" | "LIEN" | "OTHER";
export interface LEScopeEntity { entityType: string; entityId: string; }
export interface LERequestIntake {
  recordId: string; requestId: string; kind: "INTAKE"; type: LERequestType;
  issuingAuthority: string; receivedDate: string; describedScope: string;
  scopeEntities: LEScopeEntity[]; validityReviewStatus: "PENDING_REVIEW";
  nonDisclosure: boolean; nonDisclosureBasis?: string; actorId: string; at: number;
}
export interface CounselSignOff {
  recordId: string; requestId: string; kind: "COUNSEL_SIGNOFF"; counselId: string;
  validityDetermination: "VALID" | "INVALID" | "VALID_IN_PART"; note?: string; actorId: string; at: number;
}
export interface DisclosureRecord {
  disclosureId: string; requestId: string; recipient: string;
  recordRefs: string[]; actorId: string; at: number;
}
export interface PayoutIntercept {
  interceptId: string; requestId: string; targetType: "CARRIER" | "INVOICE"; targetId: string;
  carrierId: string; instrumentRef: string; amountCents?: number; percentageBps?: number;
  priority: number; instruction: "HOLD" | "REDIRECT"; redirectTo?: string;
  status: string; supersedesInterceptId?: string; actorId: string; at: number;
}
export interface AdminAuditEntry {
  auditId: string; actorId: string; actorRole: string; action: string;
  targetRefs?: string[]; reason?: string; authorityRef?: string; at: number;
}

// Auth uses httpOnly cookies - the browser sends ll_token automatically.
// `credentials: 'include'` is required for cross-origin cookie delivery.
// We no longer read from / write to localStorage for auth tokens.
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? json?.error ?? `${method} ${path} failed (${res.status})`);
  return json as T;
}

export const api = {
  // Auth
  // inviteToken is forwarded to the backend's requireBetaGate when the
  // app is under BETA_MODE - the gate uses it (or the allowlist) to
  // decide whether to admit the signup. When BETA_MODE is off the gate
  // ignores it and the field is harmless.
  signup: (email: string, password: string, role: string, orgParams?: Record<string, any>,
          profile?: { firstName?: string; lastName?: string; phone?: string },
          inviteToken?: string) =>
    request<{ token: string; user: { userId: string; email: string; role: string }; orgId?: string }>(
      "POST", "/auth/signup", { email, password, role, orgParams, inviteToken, ...profile }
    ),

  // Dedicated atomic carrier signup - separate endpoint from the generic
  // signup() above (see backend AuthService.signupCarrierAdmin). Does not
  // share a code path with the four existing personas.
  signupCarrier: (params: { email: string; password: string; legalName: string; dba?: string; mcNumber?: string; dotNumber?: string; inviteToken?: string }) =>
    request<{ token: string; user: { userId: string; email: string; role: string }; orgId: string }>(
      "POST", "/auth/signup/carrier", params
    ),

  // Private-beta surface (public, no auth)
  beta: {
    status: () =>
      request<{ betaMode: boolean; currentCohort: string; tallyConnected: boolean; fleetCarrierPersonaEnabled?: boolean }>(
        "GET", "/beta/status"
      ),
    joinWaitlist: (params: { email: string; name?: string; personaInterest?: string }) =>
      request<{ ok: boolean; waitlistId: string; message: string }>(
        "POST", "/beta/waitlist", params
      ),
  },

  // Beta Program admin (exact-ADMIN; all under /api/admin/beta)
  adminBeta: {
    listApplications: (filter?: { status?: string; side?: string; wave?: string }) => {
      const qs = new URLSearchParams(
        Object.entries(filter ?? {}).filter(([, v]) => v) as [string, string][]
      ).toString();
      return request<{ applications: BetaApplicationRow[]; count: number }>(
        "GET", `/admin/beta/applications${qs ? `?${qs}` : ""}`
      );
    },
    getApplication: (id: string) =>
      request<{ application: BetaApplicationRow; laneOverlaps: LaneOverlap[] }>(
        "GET", `/admin/beta/applications/${id}`
      ),
    // The submitted Tally intake for an email (allowlist/waitlist drawer).
    getApplicationByEmail: (email: string) =>
      request<{ application: BetaApplicationRow | null }>(
        "GET", `/admin/beta/applications/by-email/${encodeURIComponent(email)}`
      ),
    score: (id: string, scores: { segmentFit?: number; laneOverlap?: number; pain?: number; responsiveness?: number }) =>
      request<{ application: BetaApplicationRow }>(
        "PUT", `/admin/beta/applications/${id}/score`, scores
      ),
    addNote: (id: string, text: string) =>
      request<{ ok: boolean }>("POST", `/admin/beta/applications/${id}/notes`, { text }),
    admit: (id: string, params?: { wave?: string; userRoleOverride?: string }) =>
      request<{ ok: boolean; invitationToken: string; acceptUrl: string; cohort: string; userRole: string }>(
        "POST", `/admin/beta/applications/${id}/admit`, params ?? {}
      ),
    waitlistApplication: (id: string) =>
      request<{ ok: boolean }>("POST", `/admin/beta/applications/${id}/waitlist`),
    cohortBalance: (wave?: string) =>
      request<CohortBalance>("GET", `/admin/beta/cohort-balance${wave ? `?wave=${wave}` : ""}`),
    listAllowlist: () =>
      request<{ entries: AllowlistEntry[] }>("GET", "/admin/beta/allowlist"),
    addAllowlist: (params: { type: "EMAIL" | "DOMAIN"; value: string; reason?: string }) =>
      request<{ entry: AllowlistEntry }>("POST", "/admin/beta/allowlist", params),
    removeAllowlist: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/admin/beta/allowlist/${id}`),
    listWaitlist: () =>
      request<{ entries: WaitlistRow[] }>("GET", "/admin/beta/waitlist"),
    promoteWaitlist: (id: string, params: { userRole: string; wave?: string }) =>
      request<{ ok: boolean; invitationToken: string; acceptUrl: string }>(
        "POST", `/admin/beta/waitlist/${id}/promote`, params
      ),
  },

  login: (email: string, password: string) =>
    request<{ token: string; user: { userId: string; email: string; role: string } }>(
      "POST", "/auth/login", { email, password }
    ),

  me: () => request<{ user: { userId: string; email: string; role: string; platformRole?: PlatformRole } }>("GET", "/auth/me"),

  // Platform-staff IAM (STAFF_ADMIN only; server 403s lower tiers)
  adminStaff: {
    list: () => request<{ staff: StaffMember[] }>("GET", "/admin/staff"),
    invite: (email: string, platformRole: PlatformRole) =>
      request<{ ok: boolean; token: string; acceptUrl: string; email: string; platformRole: PlatformRole }>(
        "POST", "/admin/staff/invite", { email, platformRole }),
    changeRole: (userId: string, platformRole: PlatformRole) =>
      request<{ ok: boolean; member: StaffMember }>("PUT", `/admin/staff/${userId}/role`, { platformRole }),
    deactivate: (userId: string) =>
      request<{ ok: boolean }>("POST", `/admin/staff/${userId}/deactivate`),
    reactivate: (userId: string) =>
      request<{ ok: boolean }>("POST", `/admin/staff/${userId}/reactivate`),
    listInvites: () => request<{ invites: PendingStaffInvite[] }>("GET", "/admin/staff/invites"),
    revokeInvite: (token: string) =>
      request<{ ok: boolean }>("DELETE", `/admin/staff/invites/${token}`),
    // PUBLIC - the invitee has no session yet; the token is the gate.
    acceptInvite: (params: { token: string; password?: string; fullName?: string }) =>
      request<{ ok: boolean; userId: string; platformRole: PlatformRole }>(
        "POST", "/admin/staff/accept-invite", params),
  },

  // Compliance / oversight console - all under /api/admin/compliance.
  // Each call is gated server-side by the specific compliance role (grants are
  // STAFF_ADMIN). `me` grants nothing; it only tells the UI which tabs to show.
  adminCompliance: {
    me: () => request<ComplianceMe>("GET", "/admin/compliance/me"),

    // Grants (STAFF_ADMIN)
    getGrants: (userId: string) =>
      request<{ userId: string; roles: ComplianceRole[] }>("GET", `/admin/compliance/grants/${encodeURIComponent(userId)}`),
    grant: (userId: string, role: ComplianceRole) =>
      request<{ grant: any }>("POST", "/admin/compliance/grants", { userId, role }),
    revoke: (userId: string, role: ComplianceRole) =>
      request<{ grant: any }>("DELETE", `/admin/compliance/grants/${encodeURIComponent(userId)}/${role}`),

    // Disputes (DISPUTE_ADMIN)
    discrepancies: (loadId: string) =>
      request<{ loadId: string; findings: DiscrepancyFinding[]; count: number }>(
        "GET", `/admin/compliance/discrepancies/${encodeURIComponent(loadId)}`),
    adjudicate: (params: {
      targetType: AdjudicationTargetType; targetId: string;
      action: AdjudicationAction; reason: string;
      invoiceId?: string; carrierId?: string;
      compensation?: { amountCents: number; note?: string };
    }) => request<{ adjudication: Adjudication }>("POST", "/admin/compliance/adjudicate", params),

    // Legal holds + case file + audit (LEGAL_ADMIN)
    listHolds: (filter?: { entityType?: string; entityId?: string }) => {
      const qs = new URLSearchParams(
        Object.entries(filter ?? {}).filter(([, v]) => v) as [string, string][]
      ).toString();
      return request<{ holds: LegalHoldEvent[] }>("GET", `/admin/compliance/holds${qs ? `?${qs}` : ""}`);
    },
    placeHold: (params: { entityType: string; entityId: string; reason: string; authorityRef?: string }) =>
      request<{ hold: LegalHoldEvent }>("POST", "/admin/compliance/holds", params),
    releaseHold: (params: { entityType: string; entityId: string; reason: string; authorityRef?: string }) =>
      request<{ hold: LegalHoldEvent }>("POST", "/admin/compliance/holds/release", params),
    caseFile: (loadId: string) =>
      request<{ caseFile: CaseFile; integrity: CaseFileIntegrity }>(
        "GET", `/admin/compliance/case-file/${encodeURIComponent(loadId)}`),
    audit: (filter?: { targetRef?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (filter?.targetRef) q.set("targetRef", filter.targetRef);
      if (filter?.limit) q.set("limit", String(filter.limit));
      const qs = q.toString();
      return request<{ entries: AdminAuditEntry[]; count: number }>("GET", `/admin/compliance/audit${qs ? `?${qs}` : ""}`);
    },

    // Law enforcement + intercepts (LAW_ENFORCEMENT_LIAISON, counsel-gated)
    intake: (params: {
      type: LERequestType; issuingAuthority: string; receivedDate: string;
      describedScope: string; scopeEntities: LEScopeEntity[];
      nonDisclosure?: boolean; nonDisclosureBasis?: string;
    }) => request<{ intake: LERequestIntake }>("POST", "/admin/compliance/le/requests", params),
    getRequest: (requestId: string) =>
      request<{ intake: LERequestIntake; signOffs: CounselSignOff[]; counselSignedOff: boolean; disclosures: DisclosureRecord[] }>(
        "GET", `/admin/compliance/le/requests/${encodeURIComponent(requestId)}`),
    counselSignOff: (requestId: string, params: {
      counselId: string; validityDetermination: "VALID" | "INVALID" | "VALID_IN_PART"; note?: string;
    }) => request<{ signOff: CounselSignOff }>(
      "POST", `/admin/compliance/le/requests/${encodeURIComponent(requestId)}/counsel-signoff`, params),
    disclose: (requestId: string, params: { recipient: string; recordRefs: string[] }) =>
      request<{ disclosure: DisclosureRecord }>(
        "POST", `/admin/compliance/le/requests/${encodeURIComponent(requestId)}/disclose`, params),
    createIntercept: (params: {
      requestId: string; targetType: "CARRIER" | "INVOICE"; targetId: string; carrierId: string;
      instrumentRef: string; amountCents?: number; percentageBps?: number; priority?: number;
      instruction: "HOLD" | "REDIRECT"; redirectTo?: string;
    }) => request<{ intercept: PayoutIntercept }>("POST", "/admin/compliance/intercepts", params),
    listIntercepts: (invoiceId: string, carrierId: string) =>
      request<{ intercepts: PayoutIntercept[] }>(
        "GET", `/admin/compliance/intercepts?invoiceId=${encodeURIComponent(invoiceId)}&carrierId=${encodeURIComponent(carrierId)}`),
  },

  // Load negotiation (engage/bid/counter). Rates are integer cents per mile.
  negotiation: {
    // driverId is optional and hauler-side only: omit it to act as your own
    // driver (self-haul); pass a fleet/org driverId to negotiate on behalf of
    // that driver (a dispatcher / carrier-admin / fleet owner-operator).
    engage: (loadId: string, driverId?: string) =>
      request<{ negotiation: NegotiationView }>("POST", `/negotiations/loads/${loadId}/engage`, driverId ? { driverId } : undefined),
    forLoad: (loadId: string) =>
      request<{ negotiation: NegotiationView | null; offers?: NegotiationOfferRow[]; underNegotiation?: boolean }>(
        "GET", `/negotiations/loads/${loadId}`),
    acceptLoad: (id: string, driverId?: string) => request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/accept-load`, driverId ? { driverId } : undefined),
    bid: (id: string, amount: NegotiationOfferAmount, driverId?: string) =>
      request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/bid`, { ...amount, ...(driverId ? { driverId } : {}) }),
    counter: (id: string, amount: NegotiationOfferAmount, driverId?: string) =>
      request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/counter`, { ...amount, ...(driverId ? { driverId } : {}) }),
    accept: (id: string, driverId?: string) => request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/accept`, driverId ? { driverId } : undefined),
    reject: (id: string, driverId?: string) => request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/reject`, driverId ? { driverId } : undefined),
    shipperCounter: (id: string, amount: NegotiationOfferAmount) =>
      request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/shipper/counter`, amount),
    // Long poll: resolves when the negotiation changes past `since` (or ~25s).
    events: (loadId: string, since: number) =>
      request<{ changed: boolean; negotiation?: NegotiationView }>(
        "GET", `/negotiations/loads/${loadId}/events?since=${since}`),
    shipperAccept: (id: string) => request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/shipper/accept`),
    shipperReject: (id: string) => request<{ negotiation: NegotiationView }>("POST", `/negotiations/${id}/shipper/reject`),
  },

  logout: () => request<{ message: string }>("POST", "/auth/logout"),

  // Driver
  getDriverProfile: () => request<{ driver: any }>("GET", "/driver/profile"),
  getDriverIdv: () => request<{ verification: any }>("GET", "/driver/verification/idv"),
  submitDriverIdv: () => request<{ verification: any }>("POST", "/driver/verification/idv"),
  getDriverAffiliation: () =>
    request<{
      status: "AFFILIATED" | "UNAFFILIATED" | "NO_PROFILE";
      carrier: { entityType: string; entityId: string; name?: string } | null;
    }>("GET", "/driver/affiliation"),
  getDriverLoadboard: () => request<{ loads: any[] }>("GET", "/driver/loadboard"),
  getDriverHistory: () => request<{ loads: any[] }>("GET", "/driver/history"),
  getDriverOffer: (loadId: string) => request<{ offer: any; load: any }>("GET", `/driver/offers/${loadId}`),
  acceptOffer: (loadId: string) => request<{ message: string }>("POST", `/driver/offers/${loadId}/accept`),
  declineOffer: (loadId: string) => request<{ message: string }>("POST", `/driver/offers/${loadId}/decline`),

  // Shipper
  getShipperProfile: () => request<{ shipper: any }>("GET", "/shipper/profile"),
  // getShipperLoads overridden below with filter support
  getShipperLoad: (loadId: string) => request<{ load: any; tracking: any }>("GET", `/shipper/loads/${loadId}`),
  createLoadDraft: (data: unknown) => request<{ load: any }>("POST", "/shipper/loads/draft", data),
  submitLoad: (loadId: string) => request<{ message: string }>("POST", `/shipper/loads/${loadId}/submit`),

  // Admin
  getAdminDrivers: (status?: string) =>
    request<{ drivers: any[] }>("GET", `/admin/drivers${status ? `?status=${status}` : ""}`),
  getAdminDriver: (driverId: string) =>
    request<{ driver: any }>("GET", `/admin/drivers/${driverId}`),
  adminVerifyDriver: (driverId: string) =>
    request<{ message: string }>("POST", `/admin/drivers/${driverId}/verify`),
  adminSuspendDriver: (driverId: string) =>
    request<{ message: string }>("POST", `/admin/drivers/${driverId}/suspend`),

  // Platform IAM overrides (LoadLead_Admin_Carrier_IAM_Spec.md §5)
  adminListOrgs: (params?: { status?: 'all' | 'active' | 'suspended'; limit?: number; cursor?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit)  q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return request<{ items: any[]; nextCursor: string | null }>(
      'GET', `/admin/orgs${qs ? `?${qs}` : ''}`);
  },
  // Phase 3: support inbox
  adminSupportListTickets: (filters?: { status?: string; assignee?: string }) => {
    const q = new URLSearchParams();
    if (filters?.status) q.set('status', filters.status);
    if (filters?.assignee) q.set('assignee', filters.assignee);
    const qs = q.toString();
    return request<{ items: any[] }>('GET', `/support/tickets${qs ? `?${qs}` : ''}`);
  },
  adminSupportTicket: (ticketId: string) =>
    request<{ ticket: any; sla: any; thread: any[] }>('GET', `/support/tickets/${ticketId}`),
  adminSupportReply: (ticketId: string, body: { bodyText?: string; bodyHtml?: string }) =>
    request<{ message: any }>('POST', `/support/tickets/${ticketId}/messages`, body),
  adminSupportPatch: (ticketId: string, patch: any) =>
    request<{ ok: true }>('PATCH', `/support/tickets/${ticketId}`, patch),
  adminSupportCreate: (body: { subject: string; requesterEmail: string; requesterName?: string; priority?: string; linkedOrgId?: string; linkedDriverId?: string }) =>
    request<{ ticket: any }>('POST', '/support/tickets', body),
  adminSupportSettings:    () => request<{ settings: any }>('GET', '/support/settings'),
  adminSupportSetSettings: (s: any) => request<{ settings: any }>('PUT', '/support/settings', s),
  adminSupportMonitor:     () => request<any>('GET', '/support/monitor'),
  adminSupportIntegrations: () => request<{
    chat:  { connected: boolean; vendor: string | null; appId:  string | null };
    phone: { connected: boolean; vendor: string | null; number: string | null };
  }>('GET', '/support/integrations'),

  // Phase 2: live fleet feed (telematics-gated)
  adminFleetFeed: () => request<{
    liveTracking: { connected: boolean; provider: string | null };
    counts: Record<string, number>;
    items: Array<{
      driverId: string;
      userId: string;
      fullName: string | null;
      status: string;
      equipment: string | null;
      currentLoadId: string | null;
      position: { lat: number; lng: number; city: string | null; state: string | null; updatedAt: number | null; source: string } | null;
    }>;
  }>('GET', '/admin/fleet/feed'),
  adminFleetDriver: (driverId: string) => request<{
    driver: any; idv: { status: string }; currentLoad: any | null;
    liveTracking: { connected: boolean; provider: string | null };
  }>('GET', `/admin/fleet/drivers/${driverId}`),

  adminSuspendOrg: (orgId: string, reason: string) =>
    request<{ ok: true }>('POST', `/admin/orgs/${orgId}/suspend`, { reason }),
  adminReinstateOrg: (orgId: string, reason: string) =>
    request<{ ok: true }>('POST', `/admin/orgs/${orgId}/reinstate`, { reason }),
  adminRevokeUserAdmin: (userId: string, reason: string) =>
    request<{ ok: true; revokedMemberships: number; suspendedOrgs: string[] }>(
      'POST', `/admin/users/${userId}/revoke-admin`, { reason }),
  getAdminLoads: (status?: string) =>
    request<{ loads: any[] }>("GET", `/admin/loads${status ? `?status=${status}` : ""}`),

  // Driver profile
  createDriverProfile: (data: unknown) => request<{ driver: any }>("POST", "/driver/profile", data),
  updateDriverProfile: (data: unknown) => request<{ driver: any }>("PUT", "/driver/profile", data),

  // Shipper profile
  createShipperProfile: (data: unknown) => request<{ shipper: any }>("POST", "/shipper/profile", data),
  updateShipperProfile: (data: unknown) => request<{ shipper: any }>("PUT", "/shipper/profile", data),

  // Receiver profile
  getReceiverProfile: () => request<{ receiver: any }>("GET", "/receiver/profile"),
  createReceiverProfile: (data: unknown) => request<{ receiver: any }>("POST", "/receiver/profile", data),
  updateReceiverProfile: (data: unknown) => request<{ receiver: any }>("PUT", "/receiver/profile", data),

  // Receiver load detail
  getReceiverLoad: (loadId: string) => request<{ load: any }>("GET", `/receiver/loads/${loadId}`),
  getReceiverIncoming: () => request<{ loads: any[] }>("GET", "/receiver/incoming"),

  // Auth extras
  updateMe: (data: { displayName?: string; phone?: string }) =>
    request<{ user: any }>("PATCH", "/auth/me", data),
  forgotPassword: (email: string) => request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => request("POST", "/auth/reset-password", { token, password }),

  // Push notifications
  getVapidKey: () => request<{ publicKey: string }>("GET", "/notifications/vapid-key"),
  subscribePush: (subscription: any) => request("POST", "/notifications/subscribe", { subscription }),
  unsubscribePush: () => request("DELETE", "/notifications/subscribe"),

  // Security (password + 2FA)
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("POST", "/auth/change-password", { currentPassword, newPassword }),
  twoFactorStatus: () => request<{ enabled: boolean }>("GET", "/auth/2fa/status"),
  twoFactorSetup:  () => request<{ secret: string; otpauthUrl: string; qrDataUrl: string }>("POST", "/auth/2fa/setup"),
  twoFactorVerify: (code: string) => request<{ enabled: true }>("POST", "/auth/2fa/verify", { code }),
  twoFactorDisable: (password: string) => request<{ enabled: false }>("POST", "/auth/2fa/disable", { password }),
  twoFactorLogin: (ticket: string, code: string) => request<{ user: any; token: string }>("POST", "/auth/2fa/login", { ticket, code }),

  // In-app notification inbox
  getNotifications: () => request<{ notifications: any[] }>("GET", "/notifications/inbox"),
  getUnreadCount:   () => request<{ count: number }>("GET", "/notifications/inbox/unread-count"),
  markNotificationRead: (id: string) => request<{ ok: true }>("POST", `/notifications/inbox/${id}/read`),
  markAllRead: () => request<{ marked: number }>("POST", "/notifications/inbox/read-all"),

  // Driver location
  updateDriverLocation: (lat: number, lng: number, city: string, state: string) =>
    request("POST", "/driver/location", { lat, lng, city, state }),
  reverseGeocode: (lat: number, lng: number) =>
    request<{ city: string; state: string }>("GET", `/maps/reverse-geocode?lat=${lat}&lng=${lng}`),

  /** Geocode a full address string → { lat, lng }. Called by PostLoad before submitting a draft. */
  geocodeAddress: (address: string) =>
    request<{ lat: number; lng: number }>("GET", `/maps/geocode?address=${encodeURIComponent(address)}`),

  /** Address suggestions as the user types. Empty list when Places is unavailable. */
  addressAutocomplete: (q: string) =>
    request<{ suggestions: { description: string; placeId: string }[] }>(
      "GET", `/maps/autocomplete?q=${encodeURIComponent(q)}`),
  /** Resolve a selected suggestion → structured address parts. */
  addressPlace: (placeId: string) =>
    request<{ street: string; city: string; state: string; zip: string; formatted: string }>(
      "GET", `/maps/place?placeId=${encodeURIComponent(placeId)}`),

  // Capacity
  checkDriverCapacity: (payload: { totalWeightLbs: number; dimLengthIn?: number; dimWidthIn?: number; dimHeightIn?: number }) =>
    request<{ zone: string; remainingWeightLbs: number; remainingVolumeCuIn: number; blockMessage?: string; warningMessage?: string }>(
      "POST", "/driver/capacity/check", payload),
  getDriverBuffer: () =>
    request<{ safetyBufferPct: number; overBufferFlag: boolean; maxCapacityLbs: number; maxOperationalLbs: number }>(
      "GET", "/driver/capacity/buffer"),
  adminSetDriverBuffer: (driverId: string, safetyBufferPct: number) =>
    request<{ message: string; overBuffer: boolean; alert?: string }>(
      "PATCH", `/admin/drivers/${driverId}/buffer`, { safetyBufferPct }),
  adminGetDriverBuffer: (driverId: string) =>
    request<{ safetyBufferPct: number; overBufferFlag: boolean; maxCapacityLbs: number; maxOperationalLbs: number; currentLoadLbs: number }>(
      "GET", `/admin/drivers/${driverId}/buffer`),

  // Headshot
  getHeadshotUploadUrl: (fileType?: string) =>
    request<{ uploadUrl: string; key: string; publicUrl: string }>("POST", "/driver/headshot/upload-url", { fileType }),

  // Proof of Delivery
  getPodUploadUrl: (loadId: string, fileType?: string) =>
    request<{ uploadUrl: string; key: string; publicUrl: string }>("POST", `/driver/loads/${loadId}/pod/upload-url`, { fileType }),
  submitPOD: (loadId: string, data: { photoKey: string; signatureData?: string; notes?: string }) =>
    request("POST", `/driver/loads/${loadId}/pod`, data),

  // Shipper load search
  getShipperLoads: (filters?: { status?: string; search?: string; date?: string }) => {
    const params = new URLSearchParams(filters as any).toString();
    return request<{ loads: any[] }>("GET", `/shipper/loads${params ? `?${params}` : ''}`);
  },

  // ── Attestation (Phase 1) ───────────────────────────────────────────────
  // Stage-aware presigned URL → client PUTs to S3 → finalize records the
  // server-computed contentHash. Only READY photos can be referenced by a
  // signature; PENDING/missing photos cause the server to reject signing.
  attestationPhotoUploadUrl: (data: {
    loadId: string;
    stage: 'ORIGIN' | 'PICKUP' | 'DELIVERY' | 'RECEIPT';
    contentType?: string;
    lat?: number; lng?: number;
    capturedAt?: string;
  }) => request<{ photoId: string; s3Key: string; uploadUrl: string; expiresIn: number }>(
    "POST", "/attestation/photos/upload-url", data,
  ),
  attestationFinalizePhoto: (photoId: string) =>
    request<{ photoId: string; contentHash: string; status: 'READY' | 'PENDING' }>(
      "POST", `/attestation/photos/${photoId}/finalize`,
    ),
  /**
   * Dispatcher path (Phase 1b): after the carrier-admin signs CARRIER_ACCEPT
   * via attestationSign({ action: 'CARRIER_ACCEPT', assignedDriverId }),
   * this endpoint executes the booking. Server cross-checks signerUserId
   * + assignedDriverId from the sig itself, so the client can't bypass.
   */
  dispatchLoad: (loadId: string) =>
    request<{ message: string; loadId: string; assignedDriverId: string; attestationSignatureId: string }>(
      "POST", `/org/loads/${loadId}/dispatch`,
    ),
  attestationSign: (data: {
    loadId: string;
    action: 'BOL_SUBMIT' | 'CARRIER_ACCEPT' | 'DRIVER_PICKUP' | 'DRIVER_DELIVER' | 'RECEIVER_CONFIRM';
    signatureType: 'typed' | 'drawn' | 'click';
    signatureData: string;
    consentGiven: true;
    photoIds?: string[];
    exceptions?: { code: 'OSD' | 'DAMAGE' | 'SHORT' | 'REFUSED' | 'OTHER'; description: string };
    actualAt?: string;
    geo?: { lat: number; lng: number };
    assignedDriverId?: string;
    // Negotiated rate to bind into a CARRIER_ACCEPT signature (cents). Send the
    // one that matches the load basis; omit for a straight claim (posted rate).
    ratePerMileCents?: number;
    totalCents?: number;
  }) => request<{
    signatureId: string;
    documentHash: string;
    signedAt: string;
    canonicalSchemaVersion: string;
    attestationVersion: string;
  }>("POST", "/attestation/sign", data),
  attestationChain: (loadId: string) => request<{
    loadId: string;
    chain: Array<{
      signatureId: string;
      action: string;
      signerUserId: string;
      signerRole: string;
      signedAt: string;
      documentHash: string;
      proofPhotoIds: string[];
      attestationVersion: string;
      canonicalSchemaVersion: string;
      exceptions?: { code: string; description: string };
    }>;
  }>("GET", `/attestation/chain/${loadId}`),

  // Bill of Lading
  getBOLByLoadId: (loadId: string) => request<{ bol: any }>("GET", `/bol/load/${loadId}`),
  getBOL: (bolId: string) => request<{ bol: any }>("GET", `/bol/${bolId}`),
  createBOL: (loadId: string, extraFields?: any) =>
    request<{ bol: any }>("POST", "/bol", { loadId, extraFields }),
  updateBOL: (bolId: string, data: any) => request<{ bol: any }>("PUT", `/bol/${bolId}`, data),
  signBOL: (bolId: string, data: { signatureData: string; signedBy: string; location?: string }) =>
    request<{ bol: any }>("POST", `/bol/${bolId}/sign`, data),
  disputeBOL: (bolId: string, reason: string) =>
    request<{ bol: any }>("POST", `/bol/${bolId}/dispute`, { reason }),
  updateBOLWMS: (bolId: string, data: any) => request<{ bol: any }>("PUT", `/bol/${bolId}/wms`, data),

  // Organisations
  createOrg: (data: {
    legalName: string;
    capabilities: string[];
    dba?: string;
    dotNumber?: string;
    mcNumber?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  }) => request<{ org: any; membership: any }>("POST", "/org", data),

  getMyOrgs: () => request<{ orgs: any[] }>("GET", "/org"),
  getOrg: (orgId: string) => request<{ org: any }>("GET", `/org/${orgId}`),
  updateOrg: (orgId: string, data: any) => request<{ ok: boolean }>("PATCH", `/org/${orgId}`, data),

  getOrgMembers: (orgId: string) => request<{ members: any[] }>("GET", `/org/${orgId}/members`),
  updateMemberRole: (orgId: string, membershipId: string, orgRole: string) =>
    request<{ ok: boolean }>("PATCH", `/org/${orgId}/members/${membershipId}`, { orgRole }),
  removeMember: (orgId: string, membershipId: string) =>
    request<{ ok: boolean }>("DELETE", `/org/${orgId}/members/${membershipId}`),

  sendInvitation: (orgId: string, data: { email: string; orgRole: string; userRole: string }) =>
    request<{ token: string; expiresAt: number }>("POST", `/org/${orgId}/invitations`, data),
  getOrgInvitations: (orgId: string) => request<{ invitations: any[] }>("GET", `/org/${orgId}/invitations`),

  // Public invite preview (no auth needed)
  getInvitationPreview: (token: string) =>
    request<{ email: string; orgRole: string; userRole: string; orgName: string; expiresAt: number; alreadyAccepted: boolean }>(
      "GET", `/org/invitations/${token}`
    ),
  acceptInvitation: (token: string) =>
    request<{ membership: any }>("POST", `/org/invitations/${token}/accept`),

  /** Revoke a pending invitation before it is accepted (spec §4.3) */
  revokeInvitation: (orgId: string, token: string) =>
    request<{ ok: boolean }>("DELETE", `/org/${orgId}/invitations/${token}`),

  /** Suspend a membership without deleting history (spec §6.4) */
  suspendMember: (orgId: string, membershipId: string) =>
    request<{ ok: boolean }>("POST", `/org/${orgId}/members/${membershipId}/suspend`),

  /** Reinstate a suspended membership */
  reinstateMember: (orgId: string, membershipId: string) =>
    request<{ ok: boolean }>("POST", `/org/${orgId}/members/${membershipId}/reinstate`),

  /** Platform Admin: suspend an entire org */
  suspendOrg: (orgId: string, reason?: string) =>
    request<{ ok: boolean; message: string }>("POST", `/org/${orgId}/suspend`, { reason }),

  /** Platform Admin: reinstate a suspended org */
  reinstateOrg: (orgId: string) =>
    request<{ ok: boolean; message: string }>("POST", `/org/${orgId}/reinstate`),

  /** Owner: set their own driver safety buffer within platform bounds (spec §5.1) */
  orgOwnerSetBuffer: (orgId: string, safetyBufferPct: number) =>
    request<{ ok: boolean; safetyBufferPct: number; message: string }>(
      "PATCH", `/org/${orgId}/buffer`, { safetyBufferPct }
    ),

  /** Get membership audit log for an org (spec §6.5) */
  getOrgAuditLog: (orgId: string) =>
    request<{ logs: any[] }>("GET", `/org/${orgId}/audit`),

  // ── Carrier-org (direct driver setup + company verification) ─────────────────
  /** POST /api/org/:orgId/drivers - direct driver onboarding (CARRIER orgs only) */
  createOrgDriver: (orgId: string, data: { email: string; legalName: string; phone?: string }) =>
    request<{ driver: any; membership: any }>("POST", `/org/${orgId}/drivers`, data),

  getOrgVerification: (orgId: string) =>
    request<{ verification: any }>("GET", `/org/${orgId}/verification`),
  submitOrgVerification: (orgId: string, data: { mcNumber?: string; dotNumber?: string }) =>
    request<{ verification: any }>("POST", `/org/${orgId}/verification/submit`, data),

  // ── Owner Operator ──────────────────────────────────────────────────────────
  getOwnerOperatorProfile: () =>
    request<{ ownerOperator: any }>("GET", "/owner-operator/profile"),
  createOwnerOperatorProfile: (data: unknown) =>
    request<{ ownerOperator: any }>("POST", "/owner-operator/profile", data),
  updateOwnerOperatorProfile: (data: unknown) =>
    request<{ ownerOperator: any }>("PUT", "/owner-operator/profile", data),
  getOwnerOperatorLoadboard: () =>
    request<{ loads: any[] }>("GET", "/owner-operator/loadboard"),
  getOwnerOperatorOffer: (loadId: string) =>
    request<{ offer: any; load: any; driverId?: string }>("GET", `/owner-operator/offers/${loadId}`),
  // Dashboard + settings - independent per persona, same canonical shape
  getCarrierDashboard: (orgId: string) =>
    request<any>("GET", `/org/${orgId}/dashboard`),
  getOoDashboard: () =>
    request<any>("GET", `/owner-operator/dashboard`),
  getCarrierSettings: (orgId: string) =>
    request<any>("GET", `/org/${orgId}/settings`),
  getOoSettings: () =>
    request<any>("GET", `/owner-operator/settings`),
  // Verification - both gates: company authority (FMCSA/KYB) and personal IDV
  getOoVerification: () => request<{ verification: any }>("GET", "/owner-operator/verification"),
  submitOoVerification: () => request<{ verification: any }>("POST", "/owner-operator/verification/submit"),
  getOoIdv: () => request<{ verification: any }>("GET", "/owner-operator/verification/idv"),
  submitOoIdv: () => request<{ verification: any }>("POST", "/owner-operator/verification/idv"),
  getOwnerOperatorHistory: () =>
    request<{ loads: any[] }>("GET", "/owner-operator/history"),
  getOwnerOperatorFleet: () =>
    request<{ drivers: any[] }>("GET", "/owner-operator/fleet"),
  removeFleetDriver: (driverId: string) =>
    request<{ ok: boolean }>("DELETE", `/owner-operator/fleet/${driverId}`),
  inviteFleetDriver: (email: string) =>
    request<{ invite: any }>("POST", "/owner-operator/fleet/invite", { email }),
  getFleetInvites: () =>
    request<{ invites: any[] }>("GET", "/owner-operator/fleet/invites"),

  // ─── Carrier payments + financing pipeline (mover-facing) ────────────────
  factoring: {
    getContact: () => request<{ contact: FactorContact | null }>("GET", "/factoring/contact"),
    saveContact: (factorName: string, factorEmail: string) =>
      request<{ contact: FactorContact }>("PUT", "/factoring/contact", { factorName, factorEmail }),
    listAssignments: () =>
      request<{ assignments: FactoringAssignmentDTO[]; count: number }>("GET", "/factoring/assignments"),
    createAssignment: (params: {
      invoiceId?: string; factorName: string; factorContact?: string;
      recourseType: "RECOURSE" | "NON_RECOURSE"; scope?: "FULL_INVOICE" | "LINEHAUL_ONLY";
      payoutDestination: string; debtorId?: string; debtorName?: string;
    }) => request<{ assignment: FactoringAssignmentDTO; notice: any }>("POST", "/factoring/assignments", params),
    releaseAssignment: (assignmentId: string) =>
      request<{ released: FactoringAssignmentDTO }>("POST", `/factoring/assignments/${assignmentId}/release`),
    getPackage: (invoiceId: string) =>
      request<{ package: InvoicePackageDTO }>("GET", `/factoring/invoices/${invoiceId}/package`),
    getPayee: (invoiceId: string) =>
      request<{ payee: { type: "CARRIER" | "FACTOR" | "PARTNER"; destination: string; reason: string } }>(
        "GET", `/factoring/invoices/${invoiceId}/payee`),
    // Two-step export: without confirmed:true returns { requiresConfirmation, manifest, recipient }.
    exportReview: (invoiceId: string, recipientEmail?: string) =>
      request<
        | { ok: true; requiresConfirmation: true; manifest: PacketManifestDTO; recipient: string }
        | { ok: false; missing: string[] }
      >("POST", "/factoring/export", { invoiceId, recipientEmail }),
    exportSend: (params: {
      invoiceId: string; recipientEmail?: string; moverReplyTo?: string; moverName?: string;
      saveContact?: { factorName: string };
    }) => request<
      | { ok: true; submission: FactoringSubmissionDTO }
      | { ok: false; missing: string[] }
    >("POST", "/factoring/export", { ...params, confirmed: true }),
    listSubmissions: () =>
      request<{ submissions: FactoringSubmissionDTO[]; count: number }>("GET", "/factoring/submissions"),
  },

  accessorials: {
    /** Prefilled terms + allowed override bounds for a freight class (no load needed). */
    rateCard: (equipmentType: string, hazmat: boolean) =>
      request<{ disclosure: AccessorialDisclosureDTO; bounds: AccessorialBoundsDTO }>(
        "GET", `/accessorials/rate-card?equipmentType=${encodeURIComponent(equipmentType)}&hazmat=${hazmat}`),
    /** Load's accessorial policy + the disclosure (single freight-class rate + terms). */
    getPolicy: (loadId: string) =>
      request<{ policy: any; disclosure: AccessorialDisclosureDTO }>("GET", `/accessorials/policy/${loadId}`),
    /** Record the e-sign policy acceptance + the detention/layover acknowledgment. */
    acceptPolicy: (loadId: string, acknowledged: boolean) =>
      request<{ acceptance: any }>("POST", `/accessorials/policy/${loadId}/accept`, {
        signatureType: "click",
        signatureData: "acknowledged detention and layover terms",
        consentGiven: true,
        acknowledged,
      }),
    listCharges: (loadId: string) =>
      request<{ charges: AccessorialChargeDTO[]; count: number }>("GET", `/accessorials/loads/${loadId}/charges`),
    compute: (loadId: string, stopId: string) =>
      request<{ charge: AccessorialChargeDTO | null }>("POST", `/accessorials/loads/${loadId}/stops/${stopId}/compute`),
    checkIn: (loadId: string, stopId: string, body?: Record<string, unknown>) =>
      request<{ event: any }>("POST", `/accessorials/loads/${loadId}/stops/${stopId}/check-in`, body ?? {}),
    checkOut: (loadId: string, stopId: string, body?: Record<string, unknown>) =>
      request<{ event: any }>("POST", `/accessorials/loads/${loadId}/stops/${stopId}/check-out`, body ?? {}),
    approve: (chargeId: string) =>
      request<{ charge: AccessorialChargeDTO }>("POST", `/accessorials/charges/${chargeId}/approve`),
    adjust: (chargeId: string, newAmountCents: number, reason?: string) =>
      request<{ charge: AccessorialChargeDTO }>("POST", `/accessorials/charges/${chargeId}/adjust`, { newAmountCents, reason }),
    dispute: (chargeId: string, reason?: string) =>
      request<{ charge: AccessorialChargeDTO }>("POST", `/accessorials/charges/${chargeId}/dispute`, { reason }),
  },
};

// ─── Carrier payments + financing DTOs ──────────────────────────────────────
export interface FactorContact { carrierId: string; factorName: string; factorEmail: string; createdAt: number; updatedAt: number; }
export interface InvoiceLineDTO {
  kind: "LINEHAUL" | "ACCESSORIAL"; chargeId?: string; accessorialType?: "DETENTION" | "LAYOVER";
  amountCents: number; factorable: boolean; reason?: string;
}
export interface InvoicePackageDTO {
  invoiceId: string; loadId: string;
  debtor: { id: string; name?: string; verified: boolean };
  mover: { id: string; verified: boolean };
  lines: InvoiceLineDTO[]; podRef?: string; rateConfRef?: string;
  activeAssignment?: FactoringAssignmentDTO | null; advanceableTotalCents: number;
}
export interface PacketManifestDTO {
  invoiceId: string; loadId: string; carrierId: string; generatedAt: number;
  sections: { name: string; kind: string; present: boolean; ref?: string }[];
  totals: { linehaulCents: number; approvedAccessorialCents: number; advanceableTotalCents: number };
}
export interface FactoringSubmissionDTO {
  submissionId: string; carrierId: string; invoiceIds: string[]; recipientEmail: string;
  manifest: PacketManifestDTO; actorId: string; status: "SENT" | "FAILED"; error?: string; sentAt: number;
}
export interface FactoringAssignmentDTO {
  assignmentId: string; carrierId: string; invoiceId?: string; accountLevel: boolean; factorName: string;
  recourseType: "RECOURSE" | "NON_RECOURSE"; scope: "FULL_INVOICE" | "LINEHAUL_ONLY";
  payoutDestination: string; status: "ACTIVE" | "RELEASED"; createdAt: number;
}
export interface AccessorialChargeDTO {
  chargeId: string; loadId: string; stopId: string; type: "DETENTION" | "LAYOVER"; status: string;
  amountCents: number; billableMinutes: number; layoverDays: number; rateClass: string;
  dwellMinutes: number; provisional: boolean;
}
export interface AccessorialDisclosureDTO {
  version: number;
  rateClass: "STANDARD" | "SPECIALIZED" | "HAZMAT";
  freeTimeMinutes: number;
  billingIncrementMinutes: number;
  detentionHourlyRateCents: number;
  layoverThresholdMinutes: number;
  layoverDailyRateCents: number;
}
export interface Bound { min: number; max: number; }
export interface AccessorialBoundsDTO {
  freeTimeMinutes: Bound;
  billingIncrementMinutes: Bound;
  detentionHourlyRateCents: Record<"STANDARD" | "SPECIALIZED" | "HAZMAT", Bound>;
  layoverThresholdMinutes: Bound;
  layoverDailyRateCents: Bound;
}
export interface ShipperAccessorialAgreementValue {
  agreed: boolean;
  override?: {
    freeTimeMinutes?: number;
    detentionHourlyRateCents?: Record<string, number>;
    layoverDailyRateCents?: number;
  };
}

/** Format integer cents as a USD string, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: number): string {
  const neg = cents < 0; const abs = Math.abs(cents);
  return `${neg ? "-" : ""}$${(Math.floor(abs / 100)).toLocaleString("en-US")}.${(abs % 100).toString().padStart(2, "0")}`;
}
