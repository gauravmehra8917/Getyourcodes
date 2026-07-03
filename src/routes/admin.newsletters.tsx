import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Users, UserCheck, Mail, Send, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { sb } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/page-header";

export const Route = createFileRoute("/admin/newsletters")({ component: NewslettersPage });

type LogRow = {
  id: string;
  sent_at: string;
  subscribers_count: number;
  coupons_sent: number;
  successful: number;
  failed: number;
  execution_time: number;
  status: string;
  error_message: string | null;
};

function NewslettersPage() {
  const stats = useQuery({
    queryKey: ["admin-newsletter-stats"],
    queryFn: async () => {
      const [total, active, lastLog, sentAgg] = await Promise.all([
        sb.from("subscribers").select("id", { count: "exact", head: true }),
        sb.from("subscribers").select("id", { count: "exact", head: true }).eq("active", true),
        sb.from("newsletter_logs").select("sent_at").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("newsletter_logs").select("successful"),
      ]);
      const emailsSent = (sentAgg.data ?? []).reduce((n: number, r: { successful: number }) => n + (r.successful ?? 0), 0);
      return {
        total: total.count ?? 0,
        active: active.count ?? 0,
        lastSent: (lastLog.data as { sent_at: string } | null)?.sent_at ?? null,
        emailsSent,
      };
    },
  });

  const logs = useQuery({
    queryKey: ["admin-newsletter-logs"],
    queryFn: async () => {
      const { data } = await sb
        .from("newsletter_logs")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(50);
      return (data ?? []) as LogRow[];
    },
  });

  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const sendNow = async () => {
    if (sending) return;
    setSending(true);
    setFlash(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-newsletter", { body: {} });
      if (error) throw error;
      const r = data as { status?: string; reason?: string; successful?: number; failed?: number; coupons?: number; dry_run?: boolean };
      const msg = r.reason === "no_new_coupons"
        ? "No new coupons since the last newsletter — nothing sent."
        : r.reason === "no_subscribers"
          ? "No active subscribers to send to."
          : `${r.status ?? "done"} — ${r.successful ?? 0} sent, ${r.failed ?? 0} failed (${r.coupons ?? 0} coupons)${r.dry_run ? " · dry-run: add RESEND_API_KEY & NEWSLETTER_FROM_EMAIL to send" : ""}`;
      setFlash({ kind: "ok", msg });
      qc.invalidateQueries({ queryKey: ["admin-newsletter-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-newsletter-logs"] });
    } catch (e) {
      setFlash({ kind: "err", msg: (e as Error).message ?? "Send failed" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Newsletters"
        action={
          <button
            onClick={sendNow}
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Sending…" : "Send Newsletter Now"}
          </button>
        }
      />

      {flash && (
        <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${flash.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {flash.msg}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Subscribers" value={stats.data?.total ?? 0} icon={<Users className="h-5 w-5" />} tint="bg-indigo-50 text-indigo-600" />
        <StatCard label="Active Subscribers" value={stats.data?.active ?? 0} icon={<UserCheck className="h-5 w-5" />} tint="bg-emerald-50 text-emerald-600" />
        <StatCard
          label="Last Newsletter Sent"
          value={stats.data?.lastSent ? new Date(stats.data.lastSent).toLocaleDateString() : "—"}
          hint={stats.data?.lastSent ? new Date(stats.data.lastSent).toLocaleTimeString() : "No sends yet"}
          icon={<Mail className="h-5 w-5" />}
          tint="bg-amber-50 text-amber-600"
        />
        <StatCard label="Emails Sent" value={stats.data?.emailsSent ?? 0} icon={<Send className="h-5 w-5" />} tint="bg-sky-50 text-sky-600" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-800">Recent Sends</h2>
          <span className="text-xs text-slate-500">{logs.data?.length ?? 0} entries</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold">Sent At</th>
                <th className="px-5 py-3 font-semibold">Subscribers</th>
                <th className="px-5 py-3 font-semibold">Coupons</th>
                <th className="px-5 py-3 font-semibold">Successful</th>
                <th className="px-5 py-3 font-semibold">Failed</th>
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.isLoading && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
              {!logs.isLoading && (logs.data?.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No newsletters have been sent yet.</td></tr>
              )}
              {logs.data?.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-700">
                    <div className="font-medium">{new Date(r.sent_at).toLocaleDateString()}</div>
                    <div className="text-xs text-slate-500">{new Date(r.sent_at).toLocaleTimeString()}</div>
                  </td>
                  <td className="px-5 py-3 text-slate-700">{r.subscribers_count.toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-700">{r.coupons_sent}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {r.successful.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {r.failed > 0 ? (
                      <span className="inline-flex items-center gap-1 text-rose-600">
                        <XCircle className="h-3.5 w-3.5" /> {r.failed.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {formatMs(r.execution_time)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill status={r.status} error={r.error_message} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint, icon, tint }: { label: string; value: string | number; hint?: string; icon: React.ReactNode; tint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <div className={`grid h-9 w-9 place-items-center rounded-full ${tint}`}>{icon}</div>
      </div>
      <div className="mt-2 font-display text-2xl font-bold text-slate-800">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function StatusPill({ status, error }: { status: string; error: string | null }) {
  const map: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    partial: "bg-amber-50 text-amber-700 ring-amber-200",
    failed: "bg-rose-50 text-rose-700 ring-rose-200",
    running: "bg-sky-50 text-sky-700 ring-sky-200",
  };
  const cls = map[status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span title={error ?? undefined} className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}

function formatMs(ms: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
