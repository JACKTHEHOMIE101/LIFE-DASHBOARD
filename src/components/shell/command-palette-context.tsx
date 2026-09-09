"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type PaletteState = {
  paletteOpen: boolean;
  captureOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  openCapture: () => void;
  closeCapture: () => void;
};

const Ctx = createContext<PaletteState | null>(null);

/**
 * Owns the two global overlays so any button anywhere can open them, and so the
 * keyboard shortcuts live in exactly one place.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  const openPalette = useCallback(() => {
    setCaptureOpen(false);
    setPaletteOpen(true);
  }, []);
  const openCapture = useCallback(() => {
    setPaletteOpen(false);
    setCaptureOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Cmd+K is capture-first per the brief; Cmd+Shift+K opens the palette.
        if (e.shiftKey) openPalette();
        else openCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCapture, openPalette]);

  const value = useMemo<PaletteState>(
    () => ({
      paletteOpen,
      captureOpen,
      openPalette,
      closePalette: () => setPaletteOpen(false),
      openCapture,
      closeCapture: () => setCaptureOpen(false),
    }),
    [paletteOpen, captureOpen, openPalette, openCapture],
  );

  return <Ctx value={value}>{children}</Ctx>;
}

export function useCommandPalette() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}
