import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Sparkles, Send, X, Trash2, MessageCircle, Loader2, Tag, Store as StoreIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { loadChatHistory, saveChatMessages, clearChatHistory } from "@/lib/chat.functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt?: string;
};

const SUGGESTIONS = [
  "Find me Nike sneakers under $100",
  "Best food delivery coupons today",
  "Show me Amazon electronics deals",
  "Any travel discounts this week?",
];

export function AIAssistant({ open, onOpenChange, initialPrompt }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastPersistedRef = useRef<number>(0);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthed(!!s?.user);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open || !authed || initialMessages !== null) return;
    loadChatHistory()
      .then((msgs) => {
        const ui = msgs.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) as unknown as UIMessage[];
        setInitialMessages(ui);
        lastPersistedRef.current = ui.length;
      })
      .catch(() => setInitialMessages([]));
  }, [open, authed, initialMessages]);

  const { messages, sendMessage, status, setMessages } = useChat({
    id: "dealio",
    messages: initialMessages ?? [],
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  // Sync loaded history into the chat hook once.
  useEffect(() => {
    if (initialMessages && messages.length === 0 && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  // Persist new messages after each completed turn.
  useEffect(() => {
    if (!authed) return;
    if (status !== "ready") return;
    if (messages.length <= lastPersistedRef.current) return;
    const newOnes = messages.slice(lastPersistedRef.current).map((m) => ({
      role: (m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user") as
        | "user"
        | "assistant"
        | "system",
      parts: m.parts as unknown[],
    }));
    const count = messages.length;
    saveChatMessages({ data: { messages: newOnes } })
      .then(() => {
        lastPersistedRef.current = count;
      })
      .catch(() => void 0);
  }, [status, messages, authed]);

  useEffect(() => {
    if (open) setTimeout(() => taRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (initialPrompt && open && authed) {
      void sendMessage({ text: initialPrompt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, open, authed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    void sendMessage({ text });
  };

  const handleClear = async () => {
    await clearChatHistory().catch(() => void 0);
    setMessages([]);
    lastPersistedRef.current = 0;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-end sm:items-end sm:justify-end">
      <button
        aria-label="Close assistant"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative flex h-[100dvh] w-full flex-col bg-background shadow-2xl sm:m-4 sm:h-[640px] sm:max-h-[85vh] sm:w-[420px] sm:rounded-3xl sm:border sm:border-border">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent-foreground text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="font-display text-sm font-bold leading-none">Dealio</p>
              <p className="mt-1 text-[11px] text-muted-foreground">AI Deal Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {authed && messages.length > 0 && (
              <button
                onClick={handleClear}
                title="Clear chat"
                className="rounded-full p-2 text-muted-foreground hover:bg-secondary"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-full p-2 text-muted-foreground hover:bg-secondary"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {authed === false ? (
            <SignedOutState />
          ) : authed === null || initialMessages === null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState onPick={(s) => void sendMessage({ text: s })} />
          ) : (
            <div className="space-y-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {status === "submitted" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        {authed && (
          <form onSubmit={handleSubmit} className="border-t border-border bg-card px-3 py-3">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 focus-within:border-primary">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={1}
                placeholder="Ask for any deal…"
                className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={isBusy || !input.trim()}
                className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SignedOutState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <p className="font-display text-base font-bold">Sign in to chat with Dealio</p>
      <p className="max-w-[240px] text-xs text-muted-foreground">
        Your conversations are saved so Dealio gets better at finding deals you'll love.
      </p>
      <Link
        to="/auth"
        className="mt-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
      >
        Sign in
      </Link>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h3 className="mt-3 font-display text-lg font-bold">What deal are you looking for?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ask me anything — I'll find live coupons and deals.
        </p>
      </div>
      <div className="grid gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm transition hover:border-primary/40 hover:bg-primary-soft"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  output?: unknown;
  input?: unknown;
};

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
            : "w-full max-w-full space-y-2 text-sm text-foreground"
        }
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap leading-relaxed">
                {renderMarkdownLite(part.text)}
              </div>
            );
          }
          const p = part as ToolPart;
          if (typeof p.type === "string" && p.type.startsWith("tool-")) {
            return <ToolResult key={i} part={p} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

type CouponResult = {
  id: string;
  title: string;
  coupon_code: string | null;
  coupon_type: "code" | "deal";
  affiliate_url: string | null;
  stores?: { name?: string; slug?: string; logo_url?: string | null } | null;
};
type StoreResult = { id: string; name: string; slug: string; logo_url: string | null };

function ToolResult({ part }: { part: ToolPart }) {
  if (part.state !== "output-available" || !part.output) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Searching deals…
      </div>
    );
  }
  const out = part.output as { results?: unknown[] };
  if (!out.results || out.results.length === 0) return null;

  const isStore = part.type === "tool-searchStores";
  if (isStore) {
    return (
      <div className="grid gap-1.5">
        {(out.results as StoreResult[]).slice(0, 4).map((s) => (
          <Link
            key={s.id}
            to="/$slug"
            params={{ slug: s.slug }}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs hover:border-primary/40"
          >
            <StoreIcon className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">{s.name}</span>
            <span className="ml-auto text-muted-foreground">View →</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      {(out.results as CouponResult[]).slice(0, 5).map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs"
        >
          <Tag className="h-3.5 w-3.5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{c.title}</p>
            {c.stores?.name && (
              <p className="truncate text-muted-foreground">{c.stores.name}</p>
            )}
          </div>
          {c.coupon_code && (
            <span className="rounded-md bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
              {c.coupon_code}
            </span>
          )}
          {c.stores?.slug && (
            <Link
              to="/$slug"
              params={{ slug: c.stores.slug }}
              className="text-primary hover:underline"
            >
              Get
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

// Very small markdown subset: bold **text**, lists, line breaks.
function renderMarkdownLite(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const bold = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**") ? (
        <strong key={j}>{seg.slice(2, -2)}</strong>
      ) : (
        <span key={j}>{seg}</span>
      ),
    );
    return (
      <div key={i}>
        {bold}
        {i < lines.length - 1 ? null : null}
      </div>
    );
  });
}

export function FloatingAssistantTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open AI deal assistant"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-gradient-to-br from-primary to-accent-foreground px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:scale-105"
    >
      <MessageCircle className="h-4 w-4" />
      <span className="hidden sm:inline">Ask Dealio</span>
    </button>
  );
}
