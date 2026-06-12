'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { LoadWithOffer } from '@/types';
import { OfferCard } from '@/components/OfferCard';
import { Button } from '@/components/ui/Button';

export default function LoadboardPage() {
  const router = useRouter();
  const [loads, setLoads] = useState<LoadWithOffer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOffers();
  }, []);

  const loadOffers = async () => {
    try {
      const response = await api.getDriverLoadboard();
      setLoads(response.loads || []);
    } catch (error) {
      console.error('Failed to load offers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (loadId: string) => {
    try {
      await api.acceptOffer(loadId);
      alert('Load accepted successfully!');
      router.push('/driver/active-loads');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to accept load');
    }
  };

  const handleDecline = async (loadId: string) => {
    try {
      await api.declineOffer(loadId);
      setLoads(loads.filter(l => l.load.loadId !== loadId));
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to decline load');
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Available Loads</h1>
        <Button variant="secondary" onClick={loadOffers}>
          Refresh
        </Button>
      </div>

      {loads.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-xl text-gray-600">No available offers at the moment</p>
          <p className="text-gray-500 mt-2">Check back soon for new loads!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {loads.map((loadWithOffer) => (
            <OfferCard
              key={loadWithOffer.load.loadId}
              loadWithOffer={loadWithOffer}
              onAccept={() => handleAccept(loadWithOffer.load.loadId)}
              onDecline={() => handleDecline(loadWithOffer.load.loadId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
