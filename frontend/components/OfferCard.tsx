'use client';

import React from 'react';
import { LoadWithOffer } from '@/types';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Countdown } from './ui/Countdown';
import { formatCurrency, formatWeight, formatDistance, formatDate } from '@/lib/utils';
import { RouteMapPanel } from './RouteMapPanel';

interface OfferCardProps {
  loadWithOffer: LoadWithOffer;
  onAccept: () => void;
  onDecline: () => void;
}

export const OfferCard: React.FC<OfferCardProps> = ({ loadWithOffer, onAccept, onDecline }) => {
  const { load, offer } = loadWithOffer;

  return (
    <Card>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{load.referenceNumber}</h3>
          <p className="text-sm text-gray-600">{load.equipmentType.replace('_', ' ')}</p>
        </div>
        <Countdown expiresAt={offer.expiresAt} />
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
        originLabel={`${load.pickupCity}, ${load.pickupState}`}
        destinationLabel={`${load.deliveryCity}, ${load.deliveryState}`}
        distanceMiles={load.totalMiles}
        ratePerMile={load.rateAmount}
      />
      <div className="border-t pt-4 mb-4">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Weight</p>
            <p className="font-semibold">{formatWeight(load.totalWeightLbs)}</p>
          </div>
          <div>
            <p className="text-gray-500">Distance</p>
            <p className="font-semibold">{formatDistance(load.totalMiles)}</p>
          </div>
          <div>
            <p className="text-gray-500">Your Distance</p>
            <p className="font-semibold">{formatDistance(offer.driverDistanceMiles)}</p>
          </div>
          <div>
            <p className="text-gray-500">Rate</p>
            <p className="font-semibold text-green-600">{formatCurrency(load.rateAmount)}</p>
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm text-gray-700 mb-3">{load.commodityDescription}</p>
        <div className="flex gap-3">
          <Button variant="success" className="flex-1" onClick={onAccept}>
            Accept Load
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onDecline}>
            Decline
          </Button>
        </div>
      </div>
    </Card>
  );
};
