"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setTheme(currentTheme()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      style={theme === null ? { visibility: "hidden" } : undefined}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        localStorage.setItem("blockednyc-theme", next);
        setTheme(next);
      }}
    >
      {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      <span>{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
