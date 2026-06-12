import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { DriverLocationGate } from '@/components/DriverLocationGate';

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <DriverLocationGate>
            {children}
          </DriverLocationGate>
        </main>
      </div>
    </div>
  );
}
