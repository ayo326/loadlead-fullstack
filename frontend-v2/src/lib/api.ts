// In development the Vite proxy rewrites /api → http://localhost:4000
// In production VITE_API_URL is set to https://api.loadleadapp.com
const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";

function getToken() {
  return localStorage.getItem("ll_token");
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? `${method} ${path} failed (${res.status})`);
  return json as T;
}

export const api = {
  // Auth
  signup: (email: string, password: string, role: string) =>
    request<{ token: string; user: { userId: string; email: string; role: string } }>(
      "POST", "/auth/signup", { email, password, role }
    ),

  login: (email: string, password: string) =>
    request<{ token: string; user: { userId: string; email: string; role: string } }>(
      "POST", "/auth/login", { email, password }
    ),

  me: () => request<{ user: { userId: string; email: string; role: string } }>("GET", "/auth/me"),

  // Driver
  getDriverProfile: () => request<{ driver: any }>("GET", "/driver/profile"),
  getDriverLoadboard: () => request<{ loads: any[] }>("GET", "/driver/loadboard"),
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
  forgotPassword: (email: string) => request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => request("POST", "/auth/reset-password", { token, password }),

  // Push notifications
  getVapidKey: () => request<{ publicKey: string }>("GET", "/notifications/vapid-key"),
  subscribePush: (subscription: any) => request("POST", "/notifications/subscribe", { subscription }),
  unsubscribePush: () => request("DELETE", "/notifications/subscribe"),

  // Driver location
  updateDriverLocation: (lat: number, lng: number, city: string, state: string) =>
    request("POST", "/driver/location", { lat, lng, city, state }),
  reverseGeocode: (lat: number, lng: number) =>
    request<{ city: string; state: string }>("GET", `/maps/reverse-geocode?lat=${lat}&lng=${lng}`),

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
};
