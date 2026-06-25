import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AIAssistant, FloatingAssistantTrigger } from "./ai-assistant";

type Ctx = {
  open: (prompt?: string) => void;
};

const AssistantContext = createContext<Ctx | null>(null);

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [seed, setSeed] = useState<string | undefined>(undefined);
  const [seedKey, setSeedKey] = useState(0);

  const open = useCallback((prompt?: string) => {
    if (prompt) {
      setSeed(prompt);
      setSeedKey((k) => k + 1);
    } else {
      setSeed(undefined);
    }
    setIsOpen(true);
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
      <FloatingAssistantTrigger onClick={() => open()} />
      <AIAssistant
        key={seedKey}
        open={isOpen}
        onOpenChange={setIsOpen}
        initialPrompt={seed}
      />
    </AssistantContext.Provider>
  );
}
