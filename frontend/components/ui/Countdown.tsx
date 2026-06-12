'use client';

import React, { useState, useEffect } from 'react';
import { calculateTimeRemaining } from '@/lib/utils';

interface CountdownProps {
  expiresAt: number;
  onExpire?: () => void;
}

export const Countdown: React.FC<CountdownProps> = ({ expiresAt, onExpire }) => {
  const [timeRemaining, setTimeRemaining] = useState(calculateTimeRemaining(expiresAt));

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining(expiresAt);
      setTimeRemaining(remaining);
      
      if (remaining.minutes === 0 && remaining.seconds === 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const isUrgent = timeRemaining.minutes < 5;

  return (
    <div
      className={`inline-flex items-center px-3 py-1 rounded-full font-semibold ${
        isUrgent ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
      }`}
    >
      <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
      {timeRemaining.minutes}:{timeRemaining.seconds.toString().padStart(2, '0')}
    </div>
  );
};
