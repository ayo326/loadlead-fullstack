'use client';

import React from 'react';
import { Load } from '@/types';
import { Card } from './ui/Card';
import { formatCurrency, formatWeight, formatDistance, formatDate } from '@/lib/utils';
import { RouteMapPanel } from './RouteMapPanel';

interface LoadCardProps {
  load: Load;
  onClick?: () => void;
}

export const LoadCard: React.FC<LoadCardProps> = ({ load, onClick }) => {
  return (
    <Card onClick={onClick}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{load.referenceNumber}</h3>
          <p className="text-sm text-gray-600">{load.equipmentType.replace('_', ' ')}</p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            load.status === 'OPEN'
              ? 'bg-green-100 text-green-800'
              : load.status === 'BOOKED'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {load.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500">PICKUP</p>
          <p className="font-medium">{load.pickupCity}, {load.pickupState}</p>
          <p className="text-sm text-gray-600">{formatDate(load.pickupDate)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">DELIVERY</p>
          <p className="font-medium">{load.deliveryCity}, {load.deliveryState}</p>
          <p className="text-sm text-gray-600">{formatDate(load.deliveryDate)}</p>
        </div>
      </div>

      <div className="border-t pt-4 grid grid-cols-3 gap-4 text-sm">
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
  stopClickPropagation={true}
  originLabel={`${load.pickupCity}, ${load.pickupState}`}
  destinationLabel={`${load.deliveryCity}, ${load.deliveryState}`}
  distanceMiles={load.totalMiles}
  ratePerMile={load.rateAmount}
/>
    </Card>
  );
};
