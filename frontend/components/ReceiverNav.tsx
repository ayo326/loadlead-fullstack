'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

const items = [
  { href: '/receiver', label: 'Dashboard' },
  { href: '/receiver/shipments', label: 'Shipments' },
  { href: '/receiver/documents', label: 'Documents' },
  { href: '/receiver/profile', label: 'Profile' },
];

export default function ReceiverNav() {
  const pathname = usePathname();

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={[
                'px-4 py-2 rounded-xl text-sm border',
                active ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
              ].join(' ')}
            >
              {it.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
