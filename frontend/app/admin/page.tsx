'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export default function ShipperDashboard() {
  const [stats, setStats] = useState({
    pendingDrivers: 0,
    openLoads: 0,
    pendingCarrierRequests: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [drivers, loads, carrierRequests] = await Promise.all([
        api.getDrivers('PENDING_VERIFICATION'),
        api.getAdminLoads('OPEN'),
        api.getShipperAdminRequests(),
      ]);

      setStats({
        pendingDrivers: drivers.drivers?.length || 0,
        openLoads: loads.loads?.length || 0,
        pendingCarrierRequests: carrierRequests.requests?.length || 0,
      });
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Shipper Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Pending Drivers</p>
              <p className="text-3xl font-bold text-yellow-600">{stats.pendingDrivers}</p>
            </div>
            <div className="text-4xl">⏳</div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Open Loads</p>
              <p className="text-3xl font-bold text-blue-600">{stats.openLoads}</p>
            </div>
            <div className="text-4xl">📦</div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Carrier Requests</p>
              <p className="text-3xl font-bold text-purple-600">{stats.pendingCarrierRequests}</p>
            </div>
            <div className="text-4xl">📝</div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">System Status</p>
              <p className="text-xl font-bold text-green-600">Active</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="text-xl font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/admin/drivers">
            <Button className="w-full">Review Drivers</Button>
          </Link>
          <Link href="/admin/shippers">
            <Button className="w-full">Review Carriers</Button>
          </Link>
          <Link href="/admin/loads">
            <Button className="w-full">View All Loads</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
