import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "gyc-theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    setLight(stored === "light");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", light);
  }, [light]);

  const toggle = () => {
    setLight((v) => {
      const next = !v;
      window.localStorage.setItem(KEY, next ? "light" : "dark");
      return next;
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className={`focus-ring inline-grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground ${className}`}
    >
      {light ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
    </button>
  );
}
