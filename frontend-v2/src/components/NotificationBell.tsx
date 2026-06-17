/**
 * NotificationBell — header bell that opens an inbox popover.
 *
 * Polls /api/notifications/inbox/unread-count every 60s for the badge.
 * On open, fetches the most recent 50 notifications. Clicking a notification
 * marks it read and navigates to its url (if any).
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface NotificationItem {
  notificationId: string;
  title: string;
  body: string;
  url?: string;
  read: boolean;
  createdAt: number;
  kind: string;
}

function timeAgo(ts: number) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Poll unread count
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const { count } = await api.getUnreadCount();
        if (!cancelled) setUnread(count);
      } catch { /* silently ignore — bell stays at last known count */ }
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function openInbox() {
    setOpen(o => !o);
    if (!open) {
      setLoading(true);
      try {
        const { notifications } = await api.getNotifications();
        setItems(notifications);
      } catch { /* keep last known */ }
      finally { setLoading(false); }
    }
  }

  async function clickItem(n: NotificationItem) {
    setOpen(false);
    if (!n.read) {
      try { await api.markNotificationRead(n.notificationId); } catch {/* non-blocking */}
      setUnread(c => Math.max(0, c - 1));
    }
    if (n.url) {
      // Use react-router for in-app links, full reload for external
      try {
        const u = new URL(n.url, window.location.origin);
        if (u.origin === window.location.origin) navigate(u.pathname + u.search);
        else window.location.href = n.url;
      } catch { window.location.href = n.url; }
    }
  }

  async function markAll() {
    try {
      await api.markAllRead();
      setItems(items.map(i => ({ ...i, read: true })));
      setUnread(0);
    } catch { /* ignore */ }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <Button variant="ghost" size="icon" className="relative" onClick={openInbox} aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 rounded-full bg-accent text-[10px] font-semibold text-accent-foreground flex items-center justify-center px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-primary hover:underline flex items-center gap-1">
                <CheckCheck className="h-3 w-3" />Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-[420px]">
            {loading ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                <Bell className="h-6 w-6 mx-auto mb-2 opacity-40" />
                Nothing here yet.
              </div>
            ) : (
              items.map(n => (
                <button
                  key={n.notificationId}
                  onClick={() => clickItem(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors ${n.read ? "" : "bg-primary/[0.03]"}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p className={`text-sm ${n.read ? "font-medium" : "font-semibold"}`}>{n.title}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
