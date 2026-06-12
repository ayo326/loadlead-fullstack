'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export default function CarrierDashboard() {
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState({
    draftLoads: 0,
    openLoads: 0,
    bookedLoads: 0,
  });
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [profileData, loadsData] = await Promise.all([
        api.getShipperProfile(),
        api.getShipperLoads(),
      ]);

      setProfile(profileData.shipper);

      const loads = loadsData.loads || [];
      setStats({
        draftLoads: loads.filter((l: any) => l.status === 'DRAFT').length,
        openLoads: loads.filter((l: any) => l.status === 'OPEN').length,
        bookedLoads: loads.filter((l: any) => l.status === 'BOOKED').length,
      });
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestAdmin = async () => {
    try {
      setRequesting(true);
      await api.requestShipperAdmin();
      await loadData();
      alert('Request submitted. An admin must approve it.');
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.response?.data?.message || 'Failed to request admin privileges');
    } finally {
      setRequesting(false);
    }
  };

  if (loading) return <div className="flex justify-center items-center h-screen">Loading...</div>;

  const adminStatus = profile?.shipperAdminStatus || 'NONE';
  const isAdmin = !!profile?.isShipperAdmin;

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Carrier Dashboard</h1>

      <Card className="mb-6">
        <h3 className="text-xl font-semibold mb-2">Carrier Admin Privileges</h3>
        <p className="text-gray-600 mb-4">
          Status: <span className="font-semibold">{adminStatus}</span>
          {isAdmin ? ' (Approved)' : ''}
        </p>

        {adminStatus === 'NONE' && (
          <Button onClick={requestAdmin} disabled={requesting}>
            {requesting ? 'Requesting...' : 'Request Admin Privileges'}
          </Button>
        )}

        {adminStatus === 'PENDING' && (
          <div className="text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-3">
            Your request is pending admin approval.
          </div>
        )}

        {adminStatus === 'APPROVED' && (
          <div className="text-green-700 bg-green-50 border border-green-200 rounded p-3">
            Approved. You have elevated privileges.
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Draft Loads</p>
              <p className="text-3xl font-bold text-gray-600">{stats.draftLoads}</p>
            </div>
            <div className="text-4xl">📝</div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Open Loads</p>
              <p className="text-3xl font-bold text-blue-600">{stats.openLoads}</p>
            </div>
            <div className="text-4xl">📢</div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Booked Loads</p>
              <p className="text-3xl font-bold text-green-600">{stats.bookedLoads}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="text-xl font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/shipper/loads/create">
            <Button className="w-full">Create New Load</Button>
          </Link>
          <Link href="/shipper/loads">
            <Button variant="secondary" className="w-full">View Loads</Button>
          </Link>
          <Link href="/shipper/profile">
            <Button variant="secondary" className="w-full">Edit Profile</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
