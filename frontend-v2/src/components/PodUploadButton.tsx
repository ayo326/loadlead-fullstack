/**
 * PodUploadButton - inline POD submission for the history list.
 *
 * Available for loads in BOOKED / IN_TRANSIT only. Uses the existing
 * presigned URL flow: request a URL, PUT the file directly to S3, then POST
 * the key to /loads/:id/pod.
 */

import { useRef, useState } from "react";
import { Camera, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

interface PodUploadButtonProps {
  loadId: string;
  loadStatus: string;
  size?: "sm" | "default";
}

export function PodUploadButton({ loadId, loadStatus, size = "sm" }: PodUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const eligible = loadStatus === "BOOKED" || loadStatus === "IN_TRANSIT";
  if (!eligible) return null;

  function pickFile() {
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only JPEG, PNG, or WebP images.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 8MB or smaller.");
      return;
    }

    setBusy(true);
    try {
      // H9 phase 3: presigned POST. Post the policy fields, then the file LAST.
      // S3 rejects the upload if it violates the size/type policy.
      const { url, fields, key } = await api.getPodUploadUrl(loadId, file.type);
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      form.append("file", file);
      const post = await fetch(url, { method: "POST", body: form });
      if (!post.ok) throw new Error("Upload failed");

      await api.submitPOD(loadId, { photoKey: key });
      setSubmitted(true);
      toast.success("Proof of delivery uploaded.");
    } catch (e: any) {
      toast.error(e.message ?? "Could not upload POD.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />POD sent
      </span>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={onFile}
        className="hidden"
      />
      <Button size={size} variant="outline" onClick={pickFile} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Camera className="h-3.5 w-3.5 mr-1.5" />}
        POD
      </Button>
    </>
  );
}
