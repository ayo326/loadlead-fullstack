'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Load } from '@/types';

export default function AdminLoadsPage() {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminLoads();
      setLoads(res.loads || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load loads');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">All Loads</h1>
          <p className="text-sm text-gray-600">Manage and monitor all loads.</p>
        </div>
        <Button variant="secondary" onClick={loadData}>Refresh</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loads.length === 0 ? (
        <Card><p className="p-4 text-sm text-gray-600">No loads found.</p></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loads.map((l) => (
            <Card key={l.loadId}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{l.referenceNumber || l.loadId}</p>
                  <p className="text-xs text-gray-600">
                    {l.pickupCity}, {l.pickupState} → {l.deliveryCity}, {l.deliveryState}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Status: {l.status}</p>
                  {l.deliveryDate && (
                    <p className="text-xs text-gray-500">Delivery: {formatDate(l.deliveryDate)}</p>
                  )}
                  {l.rateAmount != null && (
                    <p className="text-xs text-gray-500">Rate: {formatCurrency(l.rateAmount)}</p>
                  )}
                </div>
                <Link href={`/admin/loads/${l.loadId}`} className="text-sm text-blue-600 hover:underline">
                  View
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
