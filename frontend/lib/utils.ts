import { formatDistanceToNow, format } from 'date-fns';

export const formatDate = (timestamp: number): string => {
  return format(new Date(timestamp), 'MMM dd, yyyy');
};

export const formatDateTime = (timestamp: number): string => {
  return format(new Date(timestamp), 'MMM dd, yyyy HH:mm');
};

export const formatTimeAgo = (timestamp: number): string => {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export const formatWeight = (lbs: number): string => {
  return `${lbs.toLocaleString()} lbs`;
};

export const formatDistance = (miles: number): string => {
  return `${miles.toFixed(1)} mi`;
};

export const calculateTimeRemaining = (expiresAt: number): { minutes: number; seconds: number } => {
  const now = Date.now();
  const diff = expiresAt - now;
  
  if (diff <= 0) {
    return { minutes: 0, seconds: 0 };
  }
  
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  return { minutes, seconds };
};

export const isExpired = (expiresAt: number): boolean => {
  return Date.now() > expiresAt;
};
