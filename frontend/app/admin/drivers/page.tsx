'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function AdminDriversPage() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDrivers();
      setDrivers(res.drivers || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load drivers');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Drivers</h1>
          <p className="text-sm text-gray-600">Review and manage driver accounts.</p>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {drivers.length === 0 ? (
        <Card><p className="p-4 text-sm text-gray-600">No drivers found.</p></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drivers.map((d) => (
            <Card key={d.driverId || d.userId}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{d.legalName || 'Unnamed Driver'}</p>
                  <p className="text-xs text-gray-600">{d.email || d.phone || 'No contact'}</p>
                  <p className="text-xs text-gray-500 mt-1">Status: {d.status || 'UNKNOWN'}</p>
                </div>
                {d.driverId && (
                  <Link href={`/admin/drivers/${d.driverId}`} className="text-sm text-blue-600 hover:underline">
                    View
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
