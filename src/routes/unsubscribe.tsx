import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Mail, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { sb } from "@/lib/db";

const searchSchema = z.object({
  token: z.string().uuid().optional(),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Unsubscribe — SaveHub" },
      { name: "description", content: "Unsubscribe from SaveHub newsletter." },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: "https://dealio-dash.lovable.app/unsubscribe" }],
  }),
  component: UnsubscribePage,
});

type Status = "loading" | "success" | "invalid" | "missing" | "error";

function UnsubscribePage() {
  const { token } = Route.useSearch();
  const [status, setStatus] = useState<Status>(token ? "loading" : "missing");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await sb.rpc("unsubscribe_by_token", { _token: token });
      if (cancelled) return;
      if (error) setStatus("error");
      else if (data === true) setStatus("success");
      else setStatus("invalid");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg items-center px-4 py-16">
      <div className="w-full rounded-3xl border border-white/10 bg-surface p-8 text-center shadow-glow sm:p-10">
        <Mail className="mx-auto mb-4 h-8 w-8 text-glow" />
        {status === "loading" && (
          <>
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-white/60" />
            <p className="text-white/70">Processing your request…</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
            <h1 className="font-display text-2xl font-bold">You've been unsubscribed</h1>
            <p className="mt-2 text-white/70">You won't receive any more newsletter emails from us. Changed your mind? You can resubscribe anytime from the homepage.</p>
          </>
        )}
        {status === "invalid" && (
          <>
            <XCircle className="mx-auto mb-3 h-10 w-10 text-amber-400" />
            <h1 className="font-display text-2xl font-bold">Link is invalid or expired</h1>
            <p className="mt-2 text-white/70">We couldn't find a matching subscription for this link. It may have already been used.</p>
          </>
        )}
        {status === "missing" && (
          <>
            <XCircle className="mx-auto mb-3 h-10 w-10 text-amber-400" />
            <h1 className="font-display text-2xl font-bold">No token provided</h1>
            <p className="mt-2 text-white/70">This page needs a valid unsubscribe link from one of our emails.</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
            <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
            <p className="mt-2 text-white/70">Please try again in a moment.</p>
          </>
        )}
        <a href="/" className="mt-6 inline-flex rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-white hover:bg-white/10">
          Back to home
        </a>
      </div>
    </div>
  );
}
