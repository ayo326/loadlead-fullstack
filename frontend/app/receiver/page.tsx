import React from 'react';

export default function ReceiverDashboardPage() {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-xs text-gray-500 mb-1">Inbound Shipments</p>
          <p className="text-2xl font-semibold">0</p>
          <p className="text-sm text-gray-600 mt-2">No inbound shipments yet.</p>
        </div>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-xs text-gray-500 mb-1">Arriving Today</p>
          <p className="text-2xl font-semibold">0</p>
          <p className="text-sm text-gray-600 mt-2">ETA will appear once loads are assigned.</p>
        </div>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-xs text-gray-500 mb-1">Documents</p>
          <p className="text-2xl font-semibold">0</p>
          <p className="text-sm text-gray-600 mt-2">Bills of Lading and PODs.</p>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Upcoming Deliveries</h2>
          <span className="text-xs text-gray-500">Receiver view</span>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Origin</th>
                <th className="py-2 pr-4">Destination</th>
                <th className="py-2 pr-4">ETA</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-4 text-gray-600" colSpan={5}>
                  No deliveries yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
