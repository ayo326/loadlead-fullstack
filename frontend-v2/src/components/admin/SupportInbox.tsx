// Support inbox -- ticket list + detail panel.
//
// Lists tickets sorted by lastMessageAt with status/assignee filters and
// an SLA pill (on-track / due-soon / breached / resolved). Selecting a
// ticket opens the detail panel with the full thread, status / assignee
// controls, and a reply composer that sends via the backend (which in
// turn sends via Resend with threading headers).
//
// SLA monitor sits at the top: open count, breaching count, % within SLA,
// avg resolution minutes -- all server-aggregated.

import { useEffect, useMemo, useState } from "react";
import { Inbox, RefreshCw, Send, AlertCircle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

const SLA_COLOURS: Record<string, string> = {
  ON_TRACK: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  DUE_SOON: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  BREACHED: "bg-destructive/15 text-destructive",
  RESOLVED: "bg-muted text-muted-foreground",
};

function fmtAge(ms: number | null | undefined): string {
  if (!ms) return "-";
  const diff = Date.now() - ms;
  if (diff < 60_000)     return "just now";
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function SupportInbox() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [monitor, setMonitor] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [list, mon] = await Promise.all([
        api.adminSupportListTickets(statusFilter === "ALL" ? undefined : { status: statusFilter }),
        api.adminSupportMonitor(),
      ]);
      setTickets(list.items);
      setMonitor(mon);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const filtered = useMemo(() => tickets, [tickets]);

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden edge-attn">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Support inbox</h2>
        </div>
        <Button variant="ghost" size="sm" className="h-8" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Monitor strip */}
      {monitor && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-5 py-3 border-b border-border bg-secondary/20">
          <MonitorPill label="Open"       value={monitor.openCount} />
          <MonitorPill label="Breaching"  value={monitor.breachingCount} tone={monitor.breachingCount ? "destructive" : "muted"} />
          <MonitorPill label="% within SLA" value={monitor.percentWithinSla == null ? "-" : `${monitor.percentWithinSla}%`} />
          <MonitorPill label="Avg resolution" value={monitor.avgResolutionMinutes == null ? "-" : `${monitor.avgResolutionMinutes}m`} />
        </div>
      )}

      {/* Status pills */}
      <div className="flex flex-wrap gap-1.5 px-5 py-3 border-b border-border">
        {["ALL", "OPEN", "PENDING", "SOLVED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              statusFilter === s ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}>{s}</button>
        ))}
      </div>

      {err && (
        <div className="p-5 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      {loading && tickets.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading tickets…
        </div>
      )}

      {!loading && tickets.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No tickets yet. Inbound email to support@inbound.loadleadapp.com creates them.
        </div>
      )}

      {tickets.length > 0 && (
        <table className="w-full text-sm" aria-label="Support tickets">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
              <th className="px-5 py-2 font-medium">Subject</th>
              <th className="px-5 py-2 font-medium">Requester</th>
              <th className="px-5 py-2 font-medium">Status</th>
              <th className="px-5 py-2 font-medium">SLA</th>
              <th className="px-5 py-2 font-medium">Activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr
                key={t.ticketId}
                className="border-t border-border hover:bg-secondary/30 cursor-pointer focus-within:bg-secondary/30"
                onClick={() => setOpenId(t.ticketId)}
                onKeyDown={(e) => { if (e.key === "Enter") setOpenId(t.ticketId); }}
                tabIndex={0}
                role="button"
                aria-label={`Open ticket: ${t.subject} from ${t.requesterEmail}`}
              >
                <td className="px-5 py-2 font-medium">{t.subject}</td>
                <td className="px-5 py-2 text-muted-foreground">{t.requesterEmail}</td>
                <td className="px-5 py-2">
                  <Badge variant="outline">{t.status}</Badge>
                </td>
                <td className="px-5 py-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest ${SLA_COLOURS[t.sla.state] ?? ""}`}>
                    {t.sla.state.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-5 py-2 text-xs text-muted-foreground">{fmtAge(t.lastMessageAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId && (
        <TicketDetail
          ticketId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function MonitorPill({ label, value, tone = "muted" }: { label: string; value: any; tone?: "muted" | "destructive" }) {
  return (
    <div className="rounded-md bg-card border border-border px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${tone === "destructive" ? "text-destructive" : ""}`}>{String(value ?? "-")}</div>
    </div>
  );
}

function TicketDetail({ ticketId, onClose, onChanged }: { ticketId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const d = await api.adminSupportTicket(ticketId);
      setData(d);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load thread");
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ticketId]);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.adminSupportReply(ticketId, { bodyText: reply.trim() });
      setReply("");
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send reply");
    } finally {
      setBusy(false);
    }
  }

  async function patch(p: any) {
    setBusy(true); setErr(null);
    try {
      await api.adminSupportPatch(ticketId, p);
      await load(); onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Update failed");
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Ticket detail" className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden />
      <div className="w-full max-w-2xl bg-background border-l border-border overflow-y-auto">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">Ticket detail</div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>

        {!data && <div className="p-5 text-muted-foreground text-sm">Loading…</div>}
        {err && <div className="px-5 py-3 text-sm text-destructive">{err}</div>}

        {data && (
          <div className="p-5 space-y-5">
            <section>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Subject</div>
              <div className="font-semibold">{data.ticket.subject}</div>
              <div className="text-xs text-muted-foreground">From: {data.ticket.requesterEmail}</div>
            </section>

            <section className="flex flex-wrap gap-2 items-center">
              <Label className="text-xs">Status</Label>
              <Select value={data.ticket.status} onValueChange={(v) => patch({ status: v })}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="SOLVED">Solved</SelectItem>
                </SelectContent>
              </Select>
              <Label className="text-xs ml-3">Priority</Label>
              <Select value={data.ticket.priority} onValueChange={(v) => patch({ priority: v })}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest ${SLA_COLOURS[data.sla.state] ?? ""}`}>
                {data.sla.state.replace(/_/g, " ")}
              </span>
            </section>

            <section className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Thread</div>
              {data.thread.map((m: any) => (
                <div key={m.messageId}
                  className={`rounded-md border border-border px-3 py-2 ${m.direction === "OUTBOUND" ? "bg-primary/5" : "bg-card"}`}>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>{m.direction === "INBOUND" ? `From ${m.fromEmail}` : `To ${m.toEmail}`}</span>
                    <span>{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm mt-1 whitespace-pre-wrap">{m.bodyText ?? m.bodyHtml?.replace(/<[^>]+>/g, "") ?? ""}</div>
                </div>
              ))}
            </section>

            <section className="space-y-2 border-t border-border pt-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <MessageSquare className="h-3 w-3" /> Reply
              </div>
              <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply…" disabled={busy} />
              <div className="flex justify-end">
                <Button onClick={send} disabled={busy || !reply.trim()}>
                  <Send className="h-3.5 w-3.5 mr-1.5" /> {busy ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
