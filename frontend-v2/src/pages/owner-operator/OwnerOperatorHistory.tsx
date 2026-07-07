import { useEffect, useState } from "react";
import { LoadHistoryList } from "@/components/LoadHistoryList";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function OwnerOperatorHistory() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getOwnerOperatorHistory()
      .then((res) => setItems(res.loads ?? []))
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
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Load History</h1>
        <p className="text-sm text-muted-foreground">Loads accepted by your fleet - booked, in transit, and delivered</p>
      </div>
      <LoadHistoryList
        items={items}
        emptyText="No load history yet. Loads accepted by your fleet drivers will appear here."
        loadDetailHref={(load) => `/owner-operator/loads/${load.loadId}`}
      />
    </div>
  );
}
