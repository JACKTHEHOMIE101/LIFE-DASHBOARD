"use client";

import type { PaletteArea, PaletteProject } from "@/lib/domain/search-types";
import { useCommandPalette } from "./command-palette-context";
import { CommandPalette } from "./command-palette";
import { QuickCapture } from "./quick-capture";

/** Mounts the two global overlays once, at the shell level. */
export function GlobalOverlays({
  projects,
  lifeAreas,
}: {
  projects: PaletteProject[];
  lifeAreas: PaletteArea[];
}) {
  const { paletteOpen, closePalette, captureOpen, closeCapture, openCapture } = useCommandPalette();

  // Mounted only while open, so each one starts from clean state instead of
  // resetting itself in an effect every time it reopens.
  return (
    <>
      {paletteOpen ? (
        <CommandPalette onClose={closePalette} onOpenCapture={openCapture} />
      ) : null}
      {captureOpen ? (
        <QuickCapture onClose={closeCapture} projects={projects} lifeAreas={lifeAreas} />
      ) : null}
    </>
  );
}
