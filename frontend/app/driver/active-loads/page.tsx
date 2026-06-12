'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Load } from '@/types';
import { LoadCard } from '@/components/LoadCard';
import { Button } from '@/components/ui/Button';

export default function ActiveLoadsPage() {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActiveLoads();
  }, []);

  const loadActiveLoads = async () => {
    try {
      const response = await api.getDriverActiveLoads();
      setLoads(response.loads || []);
    } catch (error) {
      console.error('Failed to load active loads:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Active Loads</h1>
        <Button variant="secondary" onClick={loadActiveLoads}>
          Refresh
        </Button>
      </div>

      {loads.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-xl text-gray-600">No active loads</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loads.map((load) => (
            <LoadCard key={load.loadId} load={load} />
          ))}
        </div>
      )}
    </div>
  );
}
