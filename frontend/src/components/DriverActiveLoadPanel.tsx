'use client';

import React, { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';

type Load = any;

function money(n: number) {
  if (!isFinite(n)) return '$0.00';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function fmtDate(ms?: number) {
  if (!ms) return '';
  const d = new Date(ms);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US');
}
function addr(load: Load, kind: 'pickup' | 'delivery') {
  if (!load) return '';
  if (kind === 'pickup') {
    const a = load.pickupAddress ? `${load.pickupAddress}, ` : '';
    const z = load.pickupZip ? ` ${load.pickupZip}` : '';
    return `${a}${load.pickupCity}, ${load.pickupState}${z}`.trim();
  }
  const a = load.deliveryAddress ? `${load.deliveryAddress}, ` : '';
  const z = load.deliveryZip ? ` ${load.deliveryZip}` : '';
  return `${a}${load.deliveryCity}, ${load.deliveryState}${z}`.trim();
}

export default function DriverActiveLoadPanel() {
  const [loading, setLoading] = useState(true);
  const [load, setLoad] = useState<Load | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res: any = await api.getDriverActiveLoads();
      const loads = res?.loads || [];
      setLoad(loads?.[0] || null);
    } catch {
      setErr('Failed to load active load. Confirm backend is running on http://127.0.0.1:4000');
      setLoad(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, []);

  const rateType = String(load?.rateType || '').toUpperCase();
  const miles = Number(load?.totalMiles || 0);
  const rateAmt = Number(load?.rateAmount || 0);

  const cost = useMemo(() => {
    if (!load) return 0;
    if (rateType === 'PER_MILE') return miles * rateAmt;
    return rateAmt;
  }, [load, rateType, miles, rateAmt]);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">Your Active Load</div>
          {load ? (
            <div className="text-sm text-gray-600">
              <span className="font-medium">{load.referenceNumber}</span> • {String(load.status || '').toUpperCase()}
            </div>
          ) : (
            <div className="text-sm text-gray-600">{loading ? 'Loading…' : 'No active (BOOKED) load yet.'}</div>
          )}
          {err ? <div className="text-sm text-red-600 mt-1">{err}</div> : null}
        </div>

        <button
          type="button"
          onClick={refresh}
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {load ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Pickup</div>
              <div className="font-semibold">{addr(load, 'pickup')}</div>
              <div className="text-gray-600">{fmtDate(load.pickupDate)} • {load.pickupTime}</div>
            </div>
            <div>
              <div className="text-gray-500">Delivery</div>
              <div className="font-semibold">{addr(load, 'delivery')}</div>
              <div className="text-gray-600">{fmtDate(load.deliveryDate)} • {load.deliveryTime}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Distance</div>
              <div className="font-semibold">{miles.toFixed(1)} mi</div>
            </div>
            <div>
              <div className="text-gray-500">Rate</div>
              <div className="font-semibold text-green-700">
                {rateType === 'PER_MILE' ? `${money(rateAmt)}/mi` : money(rateAmt)}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Est Cost</div>
              <div className="font-semibold text-green-700">{money(cost)}</div>
            </div>
            <div>
              <div className="text-gray-500">Weight</div>
              <div className="font-semibold">{Number(load.totalWeightLbs || 0).toLocaleString()} lbs</div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
