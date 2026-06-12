import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import RoleGate from '@/components/auth/RoleGate';
import { UserRole } from '@/types';

export default function ShipperLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate roles={[UserRole.ADMIN]}>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-8">{children}</main>
        </div>
      </div>
    </RoleGate>
  );
}
