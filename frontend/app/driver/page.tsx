'use client';

import React from 'react';
import DriverActiveLoadPanel from '@/components/DriverActiveLoadPanel';

export default function DriverPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">Driver Dashboard</h1>
        
        {/* This is the panel we just created */}
        <DriverActiveLoadPanel />
        
        <div className="mt-6 grid gap-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Available Tasks</h2>
            <p className="text-gray-600 text-sm">
              Your queue is up to date. New loads will appear here as they are assigned.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
