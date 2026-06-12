'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { user } = useAuth();

  const getNavItems = (): NavItem[] => {
    switch (user?.role) {
      case UserRole.ADMIN:
        return [
          { href: '/admin', label: 'Dashboard', icon: '📊' },
          { href: '/admin/drivers', label: 'Drivers', icon: '🚚' },
          { href: '/admin/shippers', label: 'Shippers', icon: '🏢' },
          { href: '/admin/shipper-admin-requests', label: 'Shipper Admin Requests', icon: '📝' },
          { href: '/admin/loads', label: 'Loads', icon: '📦' },
          { href: '/admin/profile', label: 'Profile', icon: '⚙️' },
        ];
      case UserRole.SHIPPER:
        return [
          { href: '/shipper', label: 'Dashboard', icon: '📊' },
          { href: '/shipper/loads', label: 'Loads', icon: '📦' },
          { href: '/shipper/loads/create', label: 'Create Load', icon: '➕' },
          { href: '/shipper/profile', label: 'Profile', icon: '👤' },
        ];
      case UserRole.DRIVER:
        return [
          { href: '/driver', label: 'Dashboard', icon: '📊' },
          { href: '/driver/loadboard', label: 'Available Loads', icon: '📋' },
          { href: '/driver/active-loads', label: 'Active Loads', icon: '🚛' },
          { href: '/driver/profile', label: 'Profile', icon: '👤' },
        ];
      case UserRole.RECEIVER:
        return [
          { href: '/receiver', label: 'Dashboard', icon: '📊' },
          { href: '/receiver/shipments', label: 'Incoming Loads', icon: '📥' },
          { href: '/receiver/documents', label: 'Documents', icon: '📄' },
          { href: '/receiver/profile', label: 'Profile', icon: '👤' },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 border-r border-slate-800 min-h-screen">
      <nav className="p-4 space-y-2">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-all border ${
                active
                  ? 'bg-slate-700 border-slate-600 text-white shadow-sm'
                  : 'border-transparent text-slate-200 hover:bg-slate-800 hover:border-slate-700'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};
