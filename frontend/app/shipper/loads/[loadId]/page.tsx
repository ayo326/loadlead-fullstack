'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Load } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RouteMapPanel } from '@/components/RouteMapPanel';
import { formatCurrency, formatWeight, formatDistance, formatDate } from '@/lib/utils';
import BillOfLadingNonNegotiable from '@/components/BillOfLadingNonNegotiable';

export default function ShipperLoadDetailPage({ params }: { params: { loadId: string } }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState<any>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await api.getLoad(params.loadId);
        setLoad(res.load);
          setTracking((res as any).tracking || null);
      } catch (e) {
        console.error('Failed to load shipper load:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [params.loadId]);
  
  useEffect(() => {
    const runTracking = async () => {
      try {
        if (!load?.assignedDriverId) return;
        const t = await api.getShipperLoadTracking(params.loadId);
        setTracking(t);
      } catch (e) {
        console.error('Failed to load tracking:', e);
      }
    };
    runTracking();
  }, [params.loadId, load?.assignedDriverId]);


  if (loading) return <div className="flex justify-center items-center h-screen">Loading...</div>;
  if (!load) return <div className="p-8">Load not found.</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Load {load.referenceNumber}</h1>
        <Button variant="secondary" onClick={() => router.push('/shipper/loads')}>
          Back to Loads
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Pickup</p>
            <p className="font-semibold">{load.pickupCity}, {load.pickupState}</p>
            <p className="text-gray-600">{formatDate(load.pickupDate)} • {load.pickupTime}</p>
            <p className="text-gray-600">{load.pickupAddress}</p>
          </div>
          <div>
            <p className="text-gray-500">Delivery</p>
            <p className="font-semibold">{load.deliveryCity}, {load.deliveryState}</p>
            <p className="text-gray-600">{formatDate(load.deliveryDate)} • {load.deliveryTime}</p>
            <p className="text-gray-600">{load.deliveryAddress}</p>
          </div>
        </div>

        <div className="border-t mt-4 pt-4 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Weight</p>
            <p className="font-semibold">{formatWeight(load.totalWeightLbs)}</p>
          </div>
          <div>
            <p className="text-gray-500">Distance</p>
            <p className="font-semibold">{formatDistance(load.totalMiles)}</p>
          </div>
          <div>
            <p className="text-gray-500">Rate</p>
            <p className="font-semibold text-green-600">{formatCurrency(load.rateAmount)}</p>
          </div>
        </div>
        <RouteMapPanel
          actor="shipper"
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
          stopClickPropagation={true}
          driver={tracking?.driverLocation || null}
          etaToDelivery={tracking?.etaToDelivery || null}
          driverLat={tracking?.driver?.lat}
          driverLng={tracking?.driver?.lng}
          driverLabel={tracking?.driver?.label}
          driverUpdatedAt={tracking?.driver?.lastLocationUpdate}
          etaMinutes={tracking?.etaToDelivery?.minutes}
        />
      

            {/*__LL_BOL__*/}
            <div className="mt-6">
              <BillOfLadingNonNegotiable startCollapsed={true} load={load} />
            </div>
</Card>
    </div>
  );
}