import React from 'react';
import RoleGate from '@/components/auth/RoleGate';
import { UserRole } from '@/types';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export default function ReceiverLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate roles={[UserRole.RECEIVER]}>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-8 bg-slate-900/40">
            <div className="max-w-6xl mx-auto space-y-2 mb-6">
              <h1 className="text-2xl font-bold text-white">Receiver</h1>
              <p className="text-sm text-slate-300">Track inbound deliveries, documents, and status updates.</p>
            </div>
            {children}
          </main>
        </div>
      </div>
    </RoleGate>
  );
}
