'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';

export default function RoleGate({
  roles,
  children,
}: {
  roles: UserRole[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    if (!roles.includes(user.role)) {
      router.replace('/unauthorized');
      return;
    }
  }, [user, loading, roles, router]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) return null;
  if (!roles.includes(user.role)) return null;

  return <>{children}</>;
}
