import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

export function Countdown({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(expiresAt - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(expiresAt - Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const expired = remaining <= 0;
  const totalSeconds = Math.max(0, Math.floor(remaining / 1000));
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  const color = expired ? "text-destructive" : totalSeconds < 300 ? "text-warning" : "text-primary";
  return (
    <div className={`inline-flex items-center gap-1.5 font-mono text-sm font-semibold ${color}`}>
      <Clock className="h-3.5 w-3.5" />
      {expired ? "EXPIRED" : `${m}:${s}`}
    </div>
  );
}