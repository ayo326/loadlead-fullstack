import { useEffect, useState } from "react";
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
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Fleet Analytics</h1>
        <p className="text-sm text-muted-foreground">Earnings, miles, and performance across your fleet</p>
      </div>
      <AnalyticsView items={items} />
    </div>
  );
}
