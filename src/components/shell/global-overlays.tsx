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

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={closePalette} onOpenCapture={openCapture} />
      <QuickCapture
        open={captureOpen}
        onClose={closeCapture}
        projects={projects}
        lifeAreas={lifeAreas}
      />
    </>
  );
}
