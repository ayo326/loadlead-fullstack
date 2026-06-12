import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000/api",
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use((config) => {
      const token = this.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor to handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Clear token and redirect to login
          this.clearToken();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  private getToken(): string | null {
    return localStorage.getItem('token');
  }

  private setToken(token: string): void {
    localStorage.setItem('token', token);
  }

  private clearToken(): void {
    localStorage.removeItem('token');
  }

  private async request(path: string, config: AxiosRequestConfig = {}) {
    const response = await this.client.request({
      url: path,
      ...config,
    });
    return response.data;
  }

  // Auth endpoints
  async signup(email: string, password: string, role: string) {
    const response = await this.client.post('/auth/signup', { email, password, role });
    if (response.data.token) {
      this.setToken(response.data.token);
    }
    return response.data;
  }

  async login(email: string, password: string) {
    const response = await this.client.post('/auth/login', { email, password });
    if (response.data.token) {
      this.setToken(response.data.token);
    }
    return response.data;
  }

  async getMe() {
    const response = await this.client.get('/auth/me');
    return response.data;
  }

  logout() {
    this.clearToken();
  }

  // Driver endpoints
  async createDriverProfile(data: any) {
    const response = await this.client.post('/driver/profile', data);
    return response.data;
  }

  async getDriverProfile() {
    const response = await this.client.get('/driver/profile');
    return response.data;
  }

  async updateDriverProfile(data: any) {
    const response = await this.client.put('/driver/profile', data);
    return response.data;
  }

  async updateDriverLocation(lat: number, lng: number, city: string = '', state: string = '') {
    const response = await this.client.post('/driver/location', { lat, lng, city, state });
    return response.data;
  }

  async updateDriverLoadStatus(currentLoadLbs: number) {
    const response = await this.client.post('/driver/load-status', { currentLoadLbs });
    return response.data;
  }

  async getDriverLoadboard() {
    const response = await this.client.get('/driver/loadboard');
    return response.data;
  }

  async getDriverOffer(loadId: string) {
    const response = await this.client.get(`/driver/offers/${loadId}`);
    return response.data;
  }

  async acceptOffer(loadId: string) {
    const response = await this.client.post(`/driver/offers/${loadId}/accept`);
    return response.data;
  }

  async declineOffer(loadId: string) {
    const response = await this.client.post(`/driver/offers/${loadId}/decline`);
    return response.data;
  }

  async getDriverActiveLoads() {
    const response = await this.client.get('/driver/active-loads');
    return response.data;
  }

  // Shipper endpoints
  async createShipperProfile(data: any) {
    const response = await this.client.post('/shipper/profile', data);
    return response.data;
  }

  async getShipperProfile() {
    const response = await this.client.get('/shipper/profile');
    return response.data;
  }

  async updateShipperProfile(data: any) {
    const response = await this.client.put('/shipper/profile', data);
    return response.data;
  }

  async requestShipperAdmin() {
    const response = await this.client.post('/shipper/admin-request');
    return response.data;
  }

  async createLoadDraft(data: any) {
    const response = await this.client.post('/shipper/loads/draft', data);
    return response.data;
  }

  async submitLoad(loadId: string) {
    const response = await this.client.post(`/shipper/loads/${loadId}/submit`);
    return response.data;
  }

  async getShipperLoads() {
    const response = await this.client.get('/shipper/loads');
    return response.data;
  }

  async getLoad(loadId: string) {
    const response = await this.client.get(`/shipper/loads/${loadId}`);
    return response.data;
  }

  async updateLoad(loadId: string, data: any) {
    const response = await this.client.put(`/shipper/loads/${loadId}`, data);
    return response.data;
  }

  async cancelLoad(loadId: string) {
    const response = await this.client.delete(`/shipper/loads/${loadId}`);
    return response.data;
  }

  // Admin endpoints
  async getDrivers(status?: string) {
    const response = await this.client.get('/admin/drivers', {
      params: status ? { status } : undefined,
    });
    return response.data;
  }

  async getDriver(driverId: string) {
    const response = await this.client.get(`/admin/drivers/${driverId}`);
    return response.data;
  }

  async verifyDriver(driverId: string) {
    const response = await this.client.post(`/admin/drivers/${driverId}/verify`);
    return response.data;
  }

  async suspendDriver(driverId: string) {
    const response = await this.client.post(`/admin/drivers/${driverId}/suspend`);
    return response.data;
  }

  async getShipperAdminRequests() {
    const response = await this.client.get('/admin/shippers/admin-requests');
    return response.data;
  }

  async approveShipperAdmin(shipperId: string) {
    const response = await this.client.post(`/admin/shippers/${shipperId}/approve-admin`);
    return response.data;
  }

  async revokeShipperAdmin(shipperId: string) {
    const response = await this.client.post(`/admin/shippers/${shipperId}/revoke-admin`);
    return response.data;
  }

  async getAdminLoads(status?: string) {
    const response = await this.client.get('/admin/loads', {
      params: status ? { status } : undefined,
    });
    return response.data;
  }

  async getAdminLoad(loadId: string) {
    const response = await this.client.get(`/admin/loads/${loadId}`);
    return response.data;
  }

  async updateLoadStatus(loadId: string, status: string) {
    const response = await this.client.put(`/admin/loads/${loadId}/status`, { status });
    return response.data;
  }

  // Receiver endpoints
  async createReceiverProfile(data: any) {
    const response = await this.client.post('/receiver/profile', data);
    return response.data;
  }

  async getReceiverProfile() {
    const response = await this.client.get('/receiver/profile');
    return response.data;
  }

  async updateReceiverProfile(data: any) {
    const response = await this.client.put('/receiver/profile', data);
    return response.data;
  }

  async getIncomingLoads() {
    const response = await this.client.get('/receiver/incoming');
    return response.data;
  }

  async getShipperLoadTracking(loadId: string) {
    return this.request(`/shipper/loads/${loadId}/tracking`, { method: 'GET' });
  }

  async getAdminLoadTracking(loadId: string) {
    return this.request(`/admin/loads/${loadId}/tracking`, { method: 'GET' });
  }

}

export const api = new ApiClient();
export default api;
