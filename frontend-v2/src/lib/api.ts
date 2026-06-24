// In development the Vite proxy rewrites /api → http://localhost:4000
// In production VITE_API_URL is set to https://api.loadleadapp.com
const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";

// Auth uses httpOnly cookies — the browser sends ll_token automatically.
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
  signup: (email: string, password: string, role: string, orgParams?: Record<string, any>,
          profile?: { firstName?: string; lastName?: string; phone?: string }) =>
    request<{ token: string; user: { userId: string; email: string; role: string }; orgId?: string }>(
      "POST", "/auth/signup", { email, password, role, orgParams, ...profile }
    ),

  // Dedicated atomic carrier signup — separate endpoint from the generic
  // signup() above (see backend AuthService.signupCarrierAdmin). Does not
  // share a code path with the four existing personas.
  signupCarrier: (params: { email: string; password: string; legalName: string; dba?: string; mcNumber?: string; dotNumber?: string }) =>
    request<{ token: string; user: { userId: string; email: string; role: string }; orgId: string }>(
      "POST", "/auth/signup/carrier", params
    ),

  login: (email: string, password: string) =>
    request<{ token: string; user: { userId: string; email: string; role: string } }>(
      "POST", "/auth/login", { email, password }
    ),

  me: () => request<{ user: { userId: string; email: string; role: string } }>("GET", "/auth/me"),
  logout: () => request<{ message: string }>("POST", "/auth/logout"),

  // Driver
  getDriverProfile: () => request<{ driver: any }>("GET", "/driver/profile"),
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
  /** POST /api/org/:orgId/drivers — direct driver onboarding (CARRIER orgs only) */
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
  // Dashboard + settings — independent per persona, same canonical shape
  getCarrierDashboard: (orgId: string) =>
    request<any>("GET", `/org/${orgId}/dashboard`),
  getOoDashboard: () =>
    request<any>("GET", `/owner-operator/dashboard`),
  getCarrierSettings: (orgId: string) =>
    request<any>("GET", `/org/${orgId}/settings`),
  getOoSettings: () =>
    request<any>("GET", `/owner-operator/settings`),
  // Verification — both gates: company authority (FMCSA/KYB) and personal IDV
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
};
