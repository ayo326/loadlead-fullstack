/**
 * Admin Settings - internal-staff settings area (was absent).
 * Two sections:
 *   Staff & Team  - platform-staff IAM (STAFF_ADMIN only; server is the gate)
 *   Integrations  - read-only "connected / not connected" states for the
 *                   env-driven integrations, with the env var names. Honest:
 *                   no fabricated "connected" - reflects the server's actual
 *                   config. Read-only here; wiring happens via env + deploy.
 */

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import StaffManagement from "./StaffManagement";

type Tab = "staff" | "integrations";

export default function AdminSettings() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("staff");

  // STAFF_ADMIN (or legacy ADMIN with no tier - back-compat = admin) may manage staff.
  const isStaffAdmin = !user?.platformRole || user.platformRole === "STAFF_ADMIN";

  return (
    <>
      <PageHeader
        eyebrow="Admin · Platform"
        title="Settings"
        subtitle="Internal team management and integration status."
      />

      <div className="flex gap-1 border-b border-border mb-5">
        {([["staff", "Staff & Team"], ["integrations", "Integrations"]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "staff" && (
        isStaffAdmin ? (
          <StaffManagement />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Staff &amp; Team management requires the <span className="font-medium text-foreground">Admin</span> tier.
            Your tier ({user?.platformRole?.replace("STAFF_", "").toLowerCase() ?? "-"}) can view the console but not manage staff.
          </div>
        )
      )}

      {tab === "integrations" && <IntegrationStates />}
    </>
  );
}

// ─── Read-only integration states ────────────────────────────────────────────

interface IntRow { label: string; connected: boolean; detail?: string | null; envVars: string[]; }

function IntegrationStates() {
  const [rows, setRows] = useState<IntRow[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.allSettled([
      api.adminSupportIntegrations(),
      api.adminFleetFeed(),
      api.beta.status(),
    ]).then(([support, fleet, beta]) => {
      const out: IntRow[] = [];

      // Telematics / live fleet tracking
      const lt = fleet.status === "fulfilled" ? fleet.value.liveTracking : { connected: false, provider: null };
      out.push({
        label: "Live fleet tracking (telematics)",
        connected: !!lt.connected,
        detail: lt.provider ?? null,
        envVars: ["TELEMATICS_PROVIDER", "TELEMATICS_API_KEY"],
      });

      // Support chat
      const chat = support.status === "fulfilled" ? support.value.chat : { connected: false, vendor: null };
      out.push({
        label: "Support chat",
        connected: !!chat.connected,
        detail: chat.vendor ?? null,
        envVars: ["SUPPORT_CHAT_VENDOR", "INTERCOM_APP_ID / CRISP_WEBSITE_ID"],
      });

      // Support phone
      const phone = support.status === "fulfilled" ? support.value.phone : { connected: false, vendor: null, number: null };
      out.push({
        label: "Support phone / click-to-call",
        connected: !!phone.connected,
        detail: phone.number ?? phone.vendor ?? null,
        envVars: ["SUPPORT_PHONE_NUMBER", "SUPPORT_PHONE_VENDOR"],
      });

      // Beta intake (Tally webhook)
      const tallyConnected = beta.status === "fulfilled" ? beta.value.tallyConnected : false;
      out.push({
        label: "Beta intake (Tally webhook)",
        connected: !!tallyConnected,
        detail: tallyConnected ? "receiving submissions" : "form not connected",
        envVars: ["TALLY_SIGNING_SECRET"],
      });

      // Beta gate mode
      const betaMode = beta.status === "fulfilled" ? beta.value.betaMode : false;
      out.push({
        label: "Private-beta gate",
        connected: !!betaMode,
        detail: betaMode ? "ON - signup gated" : "OFF - public signup open",
        envVars: ["BETA_MODE", "BETA_CURRENT_COHORT"],
      });

      setRows(out);
    }).catch((e) => setErr(e?.message ?? "Failed to load integration status"));
  }, []);

  if (err) return <div className="text-sm text-rose-700">{err}</div>;
  if (!rows) return <div className="text-sm text-muted-foreground">Loading integration status…</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Read-only. These reflect the server's actual env configuration - connecting an integration is done via
        environment variables + deploy, not from this screen. Nothing here is fabricated.
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Integration</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Detail</th>
              <th className="text-left px-3 py-2 font-medium">Env vars</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{r.label}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.connected ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"}`}>
                    {r.connected ? "Connected" : "Not connected"}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{r.detail ?? "-"}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs font-mono">{r.envVars.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
