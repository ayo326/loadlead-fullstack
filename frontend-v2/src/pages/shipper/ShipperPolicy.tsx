import { useEffect, useState } from "react";
import { Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * Shipper policy authoring. A shipper writes a policy by typing rich text or
 * uploading a file. Editing creates a NEW version (prior versions are never
 * mutated). The current policy is snapshotted onto a load at acceptance and the
 * hauler signs it.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ShipperPolicy() {
  const [current, setCurrent] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"TEXT" | "FILE">("TEXT");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    api
      .getCurrentShipperPolicy()
      .then((r) => setCurrent(r.policy))
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      if (mode === "TEXT") {
        if (!text.trim()) {
          toast.error("Enter your policy text.");
          return;
        }
        await api.saveShipperPolicy({ sourceType: "TEXT", richText: text });
      } else {
        if (!file) {
          toast.error("Attach a policy file.");
          return;
        }
        const fileBase64 = await fileToBase64(file);
        await api.saveShipperPolicy({ sourceType: "FILE", fileBase64 });
      }
      toast.success("Policy saved as a new version.");
      setText("");
      setFile(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Shipper policy</h1>
        <p className="text-sm text-muted-foreground">
          Your standing policy is attached to each load at acceptance and signed by the carrier. Editing creates a new version; prior versions are preserved.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
        <FileText className="h-4 w-4 text-primary" />
        <div className="text-sm">
          {current ? (
            <>
              Current policy: <span className="font-semibold">version {current.version}</span> ({current.sourceType})
            </>
          ) : (
            <span className="text-muted-foreground">No policy yet. Loads proceed without one until you add it.</span>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "TEXT" ? "default" : "outline"} onClick={() => setMode("TEXT")}>
            Type it
          </Button>
          <Button size="sm" variant={mode === "FILE" ? "default" : "outline"} onClick={() => setMode("FILE")}>
            Upload a file
          </Button>
        </div>

        {mode === "TEXT" ? (
          <textarea
            className="w-full min-h-[220px] rounded-md border bg-background p-3 text-sm"
            placeholder="Write your carrier policy here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        )}

        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save new version"}
        </Button>
      </div>
    </div>
  );
}
