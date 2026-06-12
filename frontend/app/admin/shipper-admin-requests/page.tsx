'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function ShipperAdminRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getShipperAdminRequests();
      setRequests(res.requests || []);
    } catch (e) {
      console.error(e);
      alert('Failed to load shipper admin requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (shipperId: string) => {
    try {
      await api.approveShipperAdmin(shipperId);
      await load();
      alert('Approved');
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Approve failed');
    }
  };

  const revoke = async (shipperId: string) => {
    try {
      await api.revokeShipperAdmin(shipperId);
      await load();
      alert('Revoked');
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Revoke failed');
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Shipper Admin Requests</h1>

      {requests.length === 0 ? (
        <Card>
          <p className="text-gray-600">No pending requests.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((s) => (
            <Card key={s.shipperId}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-lg">{s.companyName}</div>
                  <div className="text-gray-600 text-sm">{s.contactName} • {s.contactEmail}</div>
                  <div className="text-gray-600 text-sm">Status: <span className="font-semibold">{s.shipperAdminStatus}</span></div>
                  <div className="text-gray-600 text-sm">Shipper ID: {s.shipperId}</div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => approve(s.shipperId)}>Approve</Button>
                  <Button variant="secondary" onClick={() => revoke(s.shipperId)}>Revoke</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
