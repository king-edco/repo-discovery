import { DEFAULT_SETTINGS, resolveDark } from "@/lib/settings";

/**
 * Inline script injected before hydration that applies the resolved theme
 * class to <html> immediately, preventing a flash of the wrong theme on load.
 * Reads the saved preference from localStorage and falls back to the OS
 * prefers-color-scheme. Runs synchronously in <head> so the class is set
 * before the first paint.
 */
export function ThemeScript() {
  const code = `(function(){try{
var raw = localStorage.getItem(${JSON.stringify("foundry.settings.v1")});
var theme = ${JSON.stringify(DEFAULT_SETTINGS.theme)};
if (raw) { try { var p = JSON.parse(raw); if (p && (p.theme === "light" || p.theme === "dark")) { theme = p.theme; } } catch(e){} }
var sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
var dark = ${resolveDark.toString()}(theme, sysDark);
var root = document.documentElement;
if (dark) { root.classList.add("dark"); } else { root.classList.remove("dark"); }
} catch(e){}
})();`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
