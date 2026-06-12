'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Load } from '@/types';
import { Card } from '@/components/ui/Card';
import { RouteMapPanel } from '@/components/RouteMapPanel';
import { formatCurrency } from '@/lib/utils';
import BillOfLadingNonNegotiable from '@/components/BillOfLadingNonNegotiable';

export default function AdminLoadDetailPage({ params }: { params: { loadId: string } }) {
  const [load, setLoad] = useState<Load | null>(null);
  const [tracking, setTracking] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const res: any = await api.getAdminLoad(params.loadId);
        setLoad(res.load);
        setTracking(res.tracking || null);
      } catch (e) {
        console.error('Failed to load admin load:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [params.loadId]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!load) return <div className="p-6">Load not found.</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Load Detail</h1>

      <Card>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-gray-500">Reference</p>
            <p className="font-semibold">{load.referenceNumber}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className="font-semibold">{load.status}</p>
          </div>
          <div>
            <p className="text-gray-500">Rate</p>
            <p className="font-semibold text-green-600">{formatCurrency(load.rateAmount)}</p>
          </div>
        </div>

        <RouteMapPanel
      actor="admin"
      loadId={params.loadId}
          origin={{ lat: load.pickupLat, lng: load.pickupLng }}
          destination={{ lat: load.deliveryLat, lng: load.deliveryLng }}
          originText={
            load.pickupAddress
              ? `${load.pickupAddress}, ${load.pickupCity}, ${load.pickupState} ${load.pickupZip || ''}`.trim()
              : `${load.pickupCity}, ${load.pickupState}`
          }
          destinationText={
            load.deliveryAddress
              ? `${load.deliveryAddress}, ${load.deliveryCity}, ${load.deliveryState} ${load.deliveryZip || ''}`.trim()
              : `${load.deliveryCity}, ${load.deliveryState}`
          }
          originLabel={`${load.pickupCity}, ${load.pickupState}`}
          destinationLabel={`${load.deliveryCity}, ${load.deliveryState}`}
          distanceMiles={load.totalMiles}
          ratePerMile={typeof load.rateAmount === 'number' ? load.rateAmount : 0}
          driver={tracking?.driverLocation || null}
          etaToDelivery={tracking?.etaToDelivery || null}
        />
      

            {/*__LL_BOL__*/}
            <div className="mt-6">
              <BillOfLadingNonNegotiable startCollapsed={true} load={load} />
            </div>
</Card>
    </div>
  );
}