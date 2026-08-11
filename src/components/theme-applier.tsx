"use client";

import { useTheme } from "@/lib/settings";

/**
 * Mounted once in the root layout so the resolved theme class is applied to
 * <html> on every page and kept in sync with the saved preference and the OS
 * prefers-color-scheme. The initial class is set by the inline `ThemeScript`
 * before hydration; this hook takes over once React is interactive and keeps it
 * in sync if the user (or the OS scheme) changes.
 */
export function ThemeApplier() {
  useTheme();
  return null;
}
