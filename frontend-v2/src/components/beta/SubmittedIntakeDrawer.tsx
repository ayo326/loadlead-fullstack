/**
 * SubmittedIntakeDrawer - a side drawer that shows exactly what an applicant
 * submitted on the Tally beta form (https://tally.so/r/Xxglrj), opened from an
 * allowlist or waitlist row in the Beta Program dashboard.
 *
 * Allowlist and waitlist rows key by email; the full intake lives in the beta
 * applications store, so this fetches by email. When no application exists for
 * the email (e.g. a raw landing-page waitlist signup, or a row whose
 * application was removed before the store became append-only), it says so
 * plainly instead of showing a blank panel.
 */
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { api, type BetaApplicationRow } from "@/lib/api";

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="py-1.5 border-b border-border/60 last:border-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground break-words">{Array.isArray(value) ? value.join(", ") : value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-foreground mb-1">{title}</h4>
      <div className="rounded-lg border border-border px-3 py-1">{children}</div>
    </div>
  );
}

export function SubmittedIntakeDrawer({
  email,
  contextLabel,
  onClose,
}: {
  email: string | null;
  contextLabel?: string;
  onClose: () => void;
}) {
  const [app, setApp] = useState<BetaApplicationRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!email) return;
    setLoading(true); setErr(""); setApp(null);
    api.adminBeta
      .getApplicationByEmail(email)
      .then((r) => setApp(r.application))
      .catch((e) => setErr(e?.message ?? "Could not load the submission"))
      .finally(() => setLoading(false));
  }, [email]);

  const s = app?.sideSpecificData?.shipper;
  const c = app?.sideSpecificData?.carrier;

  return (
    <Sheet open={!!email} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Submitted intake</SheetTitle>
          <SheetDescription>
            {email}{contextLabel ? ` - ${contextLabel}` : ""}
          </SheetDescription>
        </SheetHeader>

        {loading && <div className="mt-6 text-sm text-muted-foreground">Loading the submission…</div>}
        {err && <div className="mt-6 text-sm text-rose-600">{err}</div>}

        {!loading && !err && !app && (
          <div className="mt-6 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No Tally application is on file for this email. This entry likely came from the private-beta
            landing page (which collects only email, name, and persona interest), or its application
            predates the append-only protection. New Tally submissions appear here in full.
          </div>
        )}

        {!loading && app && (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{app.side}</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted">{app.status}</span>
              {app.score != null && <span className="text-xs text-muted-foreground">score {app.score}/15</span>}
            </div>

            <Section title="Applicant">
              <Field label="Full name" value={app.fullName} />
              <Field label="Work email" value={app.workEmail} />
              <Field label="Phone" value={app.phone} />
              <Field label="Company" value={app.company} />
              <Field label="Region" value={app.region} />
              <Field label="Texas focus" value={app.texasFocus} />
            </Section>

            {s && (
              <Section title="Shipper answers">
                <Field label="Company type" value={s.companyType} />
                <Field label="Commodities" value={s.commodities} />
                <Field label="Loads per week" value={s.loadsPerWeek != null ? String(s.loadsPerWeek) : undefined} />
                <Field label="Modes" value={s.modes} />
                <Field label="Lanes" value={s.lanes} />
                <Field label="Booking method" value={s.bookingMethod} />
                <Field label="Biggest pain" value={s.pain} />
              </Section>
            )}

            {c && (
              <Section title="Carrier answers">
                <Field label="MC or DOT" value={c.mcOrDot} />
                <Field label="Truck count" value={c.truckCount != null ? String(c.truckCount) : undefined} />
                <Field label="Loads per week" value={c.loadsPerWeek != null ? String(c.loadsPerWeek) : undefined} />
                <Field label="Equipment" value={c.equipment} />
                <Field label="Lanes" value={c.lanes} />
                <Field label="How they find loads" value={c.findMethod} />
                <Field label="Biggest pain" value={c.pain} />
              </Section>
            )}

            <Section title="Commitment">
              <Field label="Will move real freight" value={app.commitment?.realFreight ? "Yes" : "No"} />
              <Field label="Will join a feedback call" value={app.commitment?.feedbackCall ? "Yes" : "No"} />
              <Field label="Contact preference" value={app.commitment?.contactPref} />
            </Section>

            {(app.autoFlags?.length ?? 0) > 0 && (
              <Section title="Auto flags">
                <div className="flex flex-wrap gap-1.5 py-1.5">
                  {app.autoFlags.map((f) => (
                    <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono">{f}</span>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Meta">
              <Field label="Tally response id" value={app.responseId} />
              <Field label="Submitted" value={new Date(app.createdAt).toLocaleString()} />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
