import { useEffect, useRef, useState, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Sparkles, Send, X, Trash2, MessageCircle, Loader2, Tag, Store as StoreIcon, Minus, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { storeSlug } from "@/lib/coupon-actions";
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
            params={{ slug: storeSlug(s.slug) }}
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
              params={{ slug: storeSlug(c.stores.slug) }}
              hash={c.id}
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

type FloatingWidgetProps = {
  onClick: () => void;
  label?: string;
  footerSelector?: string;
  bottomOffset?: number;
  rightOffset?: number;
  footerGap?: number;
  storageKey?: string;
};

/**
 * Reusable floating assistant trigger.
 * - Adaptive positioning: lifts above the footer via IntersectionObserver.
 * - Auto-collapses to an icon when footer is visible.
 * - Manual dock/collapse control persisted for the session.
 * - Pure CSS transforms for 60fps animation. No scroll listeners.
 */
export function FloatingAssistantTrigger({
  onClick,
  label = "Ask Dealio",
  footerSelector = "[data-site-footer], #site-footer, footer",
  bottomOffset = 32,
  rightOffset = 32,
  footerGap = 32,
  storageKey = "dealio-widget-docked",
}: FloatingWidgetProps) {
  const [footerVisible, setFooterVisible] = useState(false);
  const [liftPx, setLiftPx] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [userDocked, setUserDocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const btnRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef<number | null>(null);
  const [heroVisible, setHeroVisible] = useState(false);

  // Hide the floating widget while an inline hero assistant is on screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hero = document.querySelector("[data-hero-assistant]");
    if (!hero) {
      setHeroVisible(false);
      return;
    }
    setHeroVisible(true);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setHeroVisible(e.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  // Observe footer visibility to lift widget and auto-collapse.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const footer = document.querySelector(footerSelector) as HTMLElement | null;
    if (!footer) return;

    const compute = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const rect = footer.getBoundingClientRect();
        const vh = window.innerHeight;
        // How much the footer intrudes into the viewport from the bottom.
        const intrusion = Math.max(0, vh - rect.top);
        setLiftPx(intrusion > 0 ? intrusion + footerGap - bottomOffset : 0);
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setFooterVisible(e.isIntersecting);
        }
        compute();
      },
      { threshold: [0, 0.01, 0.5, 1], rootMargin: `0px 0px ${footerGap}px 0px` },
    );
    io.observe(footer);

    // Recompute on resize (no scroll listener; IO fires on scroll-visibility).
    const onResize = () => compute();
    window.addEventListener("resize", onResize, { passive: true });
    // Also recompute periodically while footer is in view via a lightweight IO on scroll frames.
    const scrollIO = new IntersectionObserver(() => compute(), { threshold: [0, 1] });
    scrollIO.observe(footer);

    compute();
    return () => {
      io.disconnect();
      scrollIO.disconnect();
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [footerSelector, footerGap, bottomOffset]);

  // Recompute lift on every animation frame while footer is visible (cheap, avoids scroll listeners).
  useEffect(() => {
    if (!footerVisible) return;
    let running = true;
    const footer = document.querySelector(footerSelector) as HTMLElement | null;
    if (!footer) return;
    const tick = () => {
      if (!running) return;
      const rect = footer.getBoundingClientRect();
      const vh = window.innerHeight;
      const intrusion = Math.max(0, vh - rect.top);
      setLiftPx(intrusion > 0 ? intrusion + footerGap - bottomOffset : 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [footerVisible, footerSelector, footerGap, bottomOffset]);

  const toggleDock = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setUserDocked((v) => {
        const next = !v;
        try {
          sessionStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storageKey],
  );

  // Collapsed if: user manually docked, OR footer is visible (auto-collapse).
  const collapsed = userDocked || footerVisible;
  // Expand affordance: hover (desktop) or first tap (mobile).
  const expanded = !collapsed || hovered || mobileExpanded;

  const handleClick = () => {
    // Mobile: first tap expands, second opens. Detect via matchMedia.
    if (
      collapsed &&
      typeof window !== "undefined" &&
      window.matchMedia("(hover: none)").matches &&
      !mobileExpanded
    ) {
      setMobileExpanded(true);
      // Auto-collapse after a moment if not clicked again.
      window.setTimeout(() => setMobileExpanded(false), 2500);
      return;
    }
    setMobileExpanded(false);
    onClick();
  };

  if (heroVisible) return null;

  return (
    <div
      aria-hidden={false}
      style={{
        position: "fixed",
        right: `max(${rightOffset}px, env(safe-area-inset-right))`,
        bottom: `max(${bottomOffset}px, env(safe-area-inset-bottom))`,
        transform: `translateY(-${liftPx}px)`,
        transition: "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)",
        zIndex: 50,
        willChange: "transform",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative flex items-center">
        <button
          ref={btnRef}
          onClick={handleClick}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          aria-label={collapsed && !expanded ? `Open ${label}` : `Open ${label} chat`}
          aria-expanded={expanded}
          className="group flex items-center gap-2 rounded-full bg-gradient-to-br from-primary to-accent-foreground font-semibold text-primary-foreground shadow-lg shadow-primary/30 outline-none ring-primary/40 transition-[padding,width,box-shadow] duration-300 ease-out hover:shadow-xl focus-visible:ring-2"
          style={{
            minHeight: 44,
            minWidth: 44,
            paddingLeft: expanded ? 18 : 12,
            paddingRight: expanded ? (collapsed ? 18 : 40) : 12,
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          {collapsed && !expanded ? (
            <Sparkles className="h-5 w-5" />
          ) : (
            <MessageCircle className="h-4 w-4 shrink-0" />
          )}
          <span
            className="overflow-hidden whitespace-nowrap text-sm transition-[max-width,opacity] duration-300"
            style={{
              maxWidth: expanded ? 200 : 0,
              opacity: expanded ? 1 : 0,
            }}
          >
            {label}
          </span>
        </button>

        {/* Manual dock / expand control — only visible when the pill is expanded */}
        {expanded && !collapsed && (
          <button
            type="button"
            onClick={toggleDock}
            aria-label={userDocked ? "Expand assistant widget" : "Collapse assistant widget"}
            title={userDocked ? "Expand" : "Collapse"}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-primary-foreground/90 backdrop-blur transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {userDocked ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* When docked/collapsed, still allow user to un-dock via a small floating pip */}
        {userDocked && !footerVisible && (
          <button
            type="button"
            onClick={toggleDock}
            aria-label="Expand assistant widget"
            className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-background bg-foreground/80 text-[10px] text-background shadow"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
