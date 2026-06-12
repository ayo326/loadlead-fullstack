'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { TrailerType } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RouteMapPanel } from '@/components/RouteMapPanel';
import { formatCurrency } from '@/lib/utils';
import BillOfLadingNonNegotiable from '@/components/BillOfLadingNonNegotiable';

function buildAddress(parts: Array<string | undefined | null>) {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')
    .trim();
}

function buildCityState(city?: string, state?: string) {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (!c && !s) return undefined;
  return [c, s].filter(Boolean).join(', ');
}

export default function CreateLoadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // route preview
  const [estimatedMiles, setEstimatedMiles] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    equipmentType: TrailerType.DRY_VAN as any,
    totalWeightLbs: '',
    pickupCity: '',
    pickupState: '',
    pickupZip: '',
    pickupAddress: '',
    pickupDate: '',
    pickupTime: '',
    deliveryCity: '',
    deliveryState: '',
    deliveryZip: '',
    deliveryAddress: '',
    deliveryDate: '',
    deliveryTime: '',
    rateAmount: '',
    commodityDescription: '',
    broadcastRadiusMiles: '50',
    minMcMaturityDays: '90',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const pickupMapText = useMemo(() => {
    return buildAddress([
      formData.pickupAddress,
      buildCityState(formData.pickupCity, formData.pickupState),
      formData.pickupZip,
    ]);
  }, [formData.pickupAddress, formData.pickupCity, formData.pickupState, formData.pickupZip]);

  const deliveryMapText = useMemo(() => {
    return buildAddress([
      formData.deliveryAddress,
      buildCityState(formData.deliveryCity, formData.deliveryState),
      formData.deliveryZip,
    ]);
  }, [formData.deliveryAddress, formData.deliveryCity, formData.deliveryState, formData.deliveryZip]);

  const showMap = Boolean(pickupMapText);
  const hasDelivery = Boolean(deliveryMapText);

  const originLabel = buildCityState(formData.pickupCity, formData.pickupState);
  const destinationLabel = buildCityState(formData.deliveryCity, formData.deliveryState);

  const ratePerMile = useMemo(() => {
    const n = Number(formData.rateAmount);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [formData.rateAmount]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Only estimate when both ends exist
      if (!pickupMapText || !deliveryMapText) {
        if (!cancelled) setEstimatedMiles(null);
        return;
      }

      try {
        const url =
          `/api/maps/estimate?originText=${encodeURIComponent(pickupMapText)}` +
          `&destinationText=${encodeURIComponent(deliveryMapText)}`;
        const res = await fetch(url);
        const data = await res.json();

        const miles = data && typeof data.totalMiles === 'number' ? data.totalMiles : null;
        if (!cancelled) setEstimatedMiles(miles);
      } catch {
        if (!cancelled) setEstimatedMiles(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [pickupMapText, deliveryMapText]);

  const estTotal = useMemo(() => {
    if (!ratePerMile || !estimatedMiles || estimatedMiles <= 0) return undefined;
    return ratePerMile * estimatedMiles;
  }, [ratePerMile, estimatedMiles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api.createLoadDraft({
        ...formData,
        totalWeightLbs: parseInt(formData.totalWeightLbs || '0', 10),
        rateAmount: parseFloat(formData.rateAmount || '0'),
        broadcastRadiusMiles: parseInt(formData.broadcastRadiusMiles || '50', 10),
        minMcMaturityDays: parseInt(formData.minMcMaturityDays || '90', 10),
        pickupDate: formData.pickupDate ? new Date(formData.pickupDate).getTime() : Date.now(),
        deliveryDate: formData.deliveryDate ? new Date(formData.deliveryDate).getTime() : Date.now(),
        // backend will enrich later (and your My Loads page already backfills)
        pickupLat: 0,
        pickupLng: 0,
        deliveryLat: 0,
        deliveryLng: 0,
        totalMiles: 0,
      });

      await api.submitLoad(response.load.loadId);

      alert('Load created and broadcast successfully!');
      router.push('/shipper/loads');
    } catch (error: any) {
      const data = error?.response?.data;
      const msg =
        data?.error ||
        data?.message ||
        (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg).join('\n') : null) ||
        error?.message ||
        'Failed to create load';

      console.error('Create load failed:', data || error);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">Create New Load</h1>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Pickup */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Pickup Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input className="border rounded-lg p-3" name="pickupAddress" placeholder="Pickup Address" value={formData.pickupAddress} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="pickupCity" placeholder="Pickup City" value={formData.pickupCity} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="pickupState" placeholder="Pickup State" value={formData.pickupState} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="pickupZip" placeholder="Pickup Zip" value={formData.pickupZip} onChange={handleChange} />
                <input className="border rounded-lg p-3" type="date" name="pickupDate" value={formData.pickupDate} onChange={handleChange} />
                <input className="border rounded-lg p-3" type="time" name="pickupTime" value={formData.pickupTime} onChange={handleChange} />
              </div>
            </div>

            {/* Delivery */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Delivery Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input className="border rounded-lg p-3" name="deliveryAddress" placeholder="Delivery Address" value={formData.deliveryAddress} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="deliveryCity" placeholder="Delivery City" value={formData.deliveryCity} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="deliveryState" placeholder="Delivery State" value={formData.deliveryState} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="deliveryZip" placeholder="Delivery Zip" value={formData.deliveryZip} onChange={handleChange} />
                <input className="border rounded-lg p-3" type="date" name="deliveryDate" value={formData.deliveryDate} onChange={handleChange} />
                <input className="border rounded-lg p-3" type="time" name="deliveryTime" value={formData.deliveryTime} onChange={handleChange} />
              </div>

              {/* Route preview card sits UNDER Delivery Info and ABOVE Rate & Commodity */}
              {showMap && (
                <div className="mt-5">
                  <RouteMapPanel
                    actor="shipper"
                    loadId={undefined}
                    originText={pickupMapText}
                    destinationText={hasDelivery ? deliveryMapText : undefined}
                    originLabel={originLabel}
                    destinationLabel={destinationLabel}
                    distanceMiles={estimatedMiles ?? undefined}
                    ratePerMile={ratePerMile}
                    startCollapsed={false}
                  />
                  

            {/*__LL_BOL__*/}
            <div className="mt-6">
              <BillOfLadingNonNegotiable
                startCollapsed={true}
                load={{
                  pickupAddress: formData.pickupAddress,
                  pickupCity: formData.pickupCity,
                  pickupState: formData.pickupState,
                  pickupZip: formData.pickupZip,
                  deliveryAddress: formData.deliveryAddress,
                  deliveryCity: formData.deliveryCity,
                  deliveryState: formData.deliveryState,
                  deliveryZip: formData.deliveryZip,
                  referenceNumber: '',
                  totalWeightLbs: Number(formData.totalWeightLbs || 0),
                  // totalMiles is handled by your existing map logic; BOL shows blanks if unknown.
                }}
              />
            </div>
<div className="mt-2 text-sm text-gray-600">
                    {estimatedMiles ? (
                      <span>
                        Estimated: <span className="font-semibold">{estimatedMiles.toFixed(1)} mi</span>
                        {ratePerMile ? (
                          <>
                            {' '}• Rate: <span className="font-semibold">{formatCurrency(ratePerMile)}/mi</span>
                          </>
                        ) : null}
                        {estTotal ? (
                          <>
                            {' '}• Total: <span className="font-semibold">{formatCurrency(estTotal)}</span>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span>Enter pickup + delivery to estimate distance.</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Rate & Commodity */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Rate & Commodity</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input className="border rounded-lg p-3" name="rateAmount" placeholder="Rate (per mile)" value={formData.rateAmount} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="totalWeightLbs" placeholder="Total Weight (lbs)" value={formData.totalWeightLbs} onChange={handleChange} />
                <textarea className="border rounded-lg p-3 md:col-span-2" name="commodityDescription" placeholder="Commodity Description" value={formData.commodityDescription} onChange={handleChange} />
              </div>
            </div>

            {/* Broadcast settings */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Broadcast Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input className="border rounded-lg p-3" name="broadcastRadiusMiles" placeholder="Broadcast Radius (miles)" value={formData.broadcastRadiusMiles} onChange={handleChange} />
                <input className="border rounded-lg p-3" name="minMcMaturityDays" placeholder="Min MC Maturity (days)" value={formData.minMcMaturityDays} onChange={handleChange} />
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating…' : 'Create & Broadcast'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => router.push('/shipper/loads')}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}