'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type ShipperRequest = {
  shipperId: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  shipperAdminStatus?: 'NONE' | 'PENDING' | 'APPROVED';
  isShipperAdmin?: boolean;
  createdAt?: number;
};

export default function AdminShippersPage() {
  const [requests, setRequests] = useState<ShipperRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getShipperAdminRequests(); // GET /api/admin/shippers/admin-requests
      setRequests(data.requests || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load shipper admin requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (shipperId: string) => {
    setActingId(shipperId);
    setError(null);
    try {
      await api.approveShipperAdmin(shipperId); // POST /api/admin/shippers/:shipperId/approve-admin
      await load();
    } catch (e: any) {
      setError(e?.message || 'Approve failed');
    } finally {
      setActingId(null);
    }
  };

  const revoke = async (shipperId: string) => {
    setActingId(shipperId);
    setError(null);
    try {
      await api.revokeShipperAdmin(shipperId); // POST /api/admin/shippers/:shipperId/revoke-admin
      await load();
    } catch (e: any) {
      setError(e?.message || 'Revoke failed');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Shippers</h1>
        <Button onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Shipper Admin Requests</h2>

        {loading ? (
          <div className="text-gray-600">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="text-gray-600">No pending requests.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Company</th>
                  <th className="py-2">Contact</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((s) => (
                  <tr key={s.shipperId} className="border-b">
                    <td className="py-2">{s.companyName || '-'}</td>
                    <td className="py-2">{s.contactName || '-'}</td>
                    <td className="py-2">{s.contactEmail || '-'}</td>
                    <td className="py-2">
                      <span className="font-medium">
                        {s.shipperAdminStatus || 'PENDING'}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => approve(s.shipperId)}
                          disabled={actingId === s.shipperId}
                        >
                          {actingId === s.shipperId ? 'Approving…' : 'Approve'}
                        </Button>

                        <Button
                          variant="secondary"
                          onClick={() => revoke(s.shipperId)}
                          disabled={actingId === s.shipperId}
                        >
                          {actingId === s.shipperId ? 'Revoking…' : 'Reject'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
