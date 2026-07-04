/**
 * Public staff-invite acceptance page. The invitee arrives via
 * /accept-staff-invite?token=… (no session). They set a password (for a new
 * account) and submit; the server creates/elevates a role=ADMIN staffer with
 * the invited tier. On success they're sent to /login. NOT public signup -
 * the token is the only way in, and it issues a staff account specifically.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

export default function AcceptStaffInvite() {
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!token) { setErr("Missing or invalid invite token."); return; }
    if (password !== confirm) { setErr("Passwords do not match."); return; }
    if (password.length < 12) { setErr("Password must be at least 12 characters."); return; }
    setBusy(true);
    try {
      await api.adminStaff.acceptInvite({ token, password, fullName: fullName.trim() || undefined });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (e: any) {
      setErr(e?.message ?? "Could not accept the invite.");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <img src="/loadlead-logo.png" alt="LoadLead" className="h-7 w-auto mb-4" draggable={false} />
        <h1 className="text-lg font-semibold text-foreground">Accept staff invitation</h1>
        <p className="text-sm text-muted-foreground mb-4">Set a password to activate your internal staff account.</p>

        {done ? (
          <div className="text-sm text-emerald-700">Account activated. Redirecting to sign in…</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="fn" className="block text-xs text-muted-foreground mb-1">Full name (optional)</label>
              <input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label htmlFor="pw" className="block text-xs text-muted-foreground mb-1">Password (min 12 chars)</label>
              <input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label htmlFor="cf" className="block text-xs text-muted-foreground mb-1">Confirm password</label>
              <input id="cf" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" />
            </div>
            {err && <div className="text-sm text-rose-700">{err}</div>}
            <button type="submit" disabled={busy}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
              {busy ? "Activating…" : "Activate account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
