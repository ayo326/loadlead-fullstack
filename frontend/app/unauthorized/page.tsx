'use client';

import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
      <div className="max-w-md w-full bg-white border rounded-xl p-6">
        <h1 className="text-2xl font-bold mb-2">Unauthorized</h1>
        <p className="text-gray-600 mb-6">
          You don’t have permission to view that dashboard.
        </p>
        <Link href="/" className="text-blue-600 hover:text-blue-800">
          Go home
        </Link>
      </div>
    </div>
  );
}
