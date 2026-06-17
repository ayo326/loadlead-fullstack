import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsView } from "@/components/AnalyticsView";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function OwnerOperatorAnalytics() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getOwnerOperatorHistory()
      .then(r => setItems(r.loads ?? []))
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Fleet Analytics" subtitle="Earnings, miles, and performance across your fleet" />
      <div className="max-w-5xl mx-auto p-6">
        <AnalyticsView items={items} />
      </div>
    </div>
  );
}
