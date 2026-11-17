# Feature roadmap

This document tracks completed work and the prioritized backlog for Pixel Spell. Ratings are deliberately simple:

- **Appeal (1–10)** — how much a typical pixel artist or game artist would want the feature. 10 means “I would switch editors for this”; 5 means “nice to have”; 1 means niche.
- **Difficulty (1–10)** — design + implementation + testing + file-format/performance risk. 1 is a small UI change; 10 is a multi-week architectural change.
- **Score = Appeal / Difficulty** — a rough cost-benefit ratio. Higher is better. Ties are ordered by appeal, then by how directly the feature strengthens the core editor.

“Strategic” marks features that could become unique selling points rather than catch-up features.

Features that are deliberately **not planned** (contradicting the client-only, local-first architecture or carrying outsized operational cost) live in their own table at the bottom, without appeal/difficulty scores.

> **Maintenance note:** this document is meant to be updated at **every feature
> completion**. When a feature ships, move its row from **Planned features** into
> **Completed features** (renumber both tables), and mark the matching
> **Recommended roadmap** entry with “— done”.

## Completed features

| # | Feature | Appeal | Difficulty | Score | Strategic | Why / implementation notes |
| ---: | --- | ---: | ---: | ---: | :---: | --- |
| 1 | Reference image / tracing layer | 9 | 2 | 4.50 | | Implemented as two complementary features: **Reference Layer** (timeline-integrated, per-frame cels, locked, non-exported, fitted to canvas) and **Reference Board** (project-level images independent of layers/frames, movable outside the canvas, non-exported). The import dialog also supports Layer and Frames destinations. |
| 2 | Radial / N-fold symmetry | 7 | 2 | 3.50 | | Implemented: rotational copies around a draggable center with a 2–16 symmetry count. Axis mirrors can be combined with radial symmetry; the red spoke guides and draggable center handle share the mirror overlay. Disabling radial symmetry resets its center. |
| 3 | Pixel-perfect line/shape/curve modes | 7 | 2 | 3.50 | | Implemented as a per-tool option for pencil, eraser, curve, and shape outlines. Freehand and curve paths reuse the existing pixel-perfect filter; outlines use a set-based corner filter that preserves solid blocks and leaves rectangles untouched. The Line tool hides the switch because Bresenham lines already avoid redundant corner pixels. The switch lives in the tool options panel. |
| 4 | Autosave and crash recovery | 9 | 3 | 3.00 | | Implemented: dirty project tabs are serialized with the normal project encoder into IndexedDB after drawing pauses and on a fixed interval. The next launch previews recovered tabs on a checkerboard stage and offers **Restore** or **Discard**. Saving or closing a dirty tab removes its snapshot, and restored tabs reopen as unsaved projects. |
| 5 | Onion skinning | 9 | 3 | 3.00 | | Implemented: previous/next frames render behind the active frame on a dedicated canvas with a 1–3 frame range, 15/30/50% opacity, previous/next visibility, and tint presets. Toggle with the ghost button or `O`; onion skins are hidden during playback and never exported. |
| 6 | Project templates / presets | 6 | 2 | 3.00 | | Implemented as the New Project canvas-size preset list: every power-of-two square from 8×8 to 1024×1024 plus a deduplicated catalog of retro hardware resolutions. Each row shows the size on the left and the hardware name on the right. The canvas limit is now 2048×2048; larger-than-preset sizes are entered manually. Advanced template features were intentionally descoped. |
| 7 | Command palette + shortcut editor | 6 | 2 | 3.00 | | Implemented: `Ctrl+K` opens a searchable, grouped action list for every command, including menu actions and tools. **Help → Keyboard shortcuts** edits the same catalog with click-to-capture rebinding, alternate bindings, inline conflict detection, and **Restore defaults**. Bindings persist in `localStorage` and immediately update the menu bar, tool tooltips, and palette. |
| 8 | Palette tools: sort, dedupe, palette library | 8 | 3 | 2.67 | | Implemented: a palette tools menu with sorting by original add/import order, hue, saturation, or lightness (the original order is preserved and persisted), duplicate removal, and a searchable Palette Library dialog. Library entries show a name, color preview, and optional author/legal notes; each Add creates an independent editable workspace copy. |
| 9 | Frame reordering drag-and-drop | 8 | 3 | 2.67 | | Implemented: drag frame headers to reorder a single frame or a multi-frame range. The frame order and every layer's cels are permuted together. Right-click move-left/right and `Alt+←`/`Alt+→` provide non-drag alternatives. |
| 10 | Frame tags, per-frame durations, animation range | 9 | 4 | 2.25 | | Implemented: `Frame` carries optional `duration` and `tag`; `PixelDoc` stores the playback mode and loop toggle. Tag ranges render above the frame headers, custom durations override the project FPS, playback uses per-frame timers, and two or more selected frames define the playback/export range (a single selection uses the whole timeline). |
| 11 | Canvas resize, crop, and nearest-neighbor scale | 9 | 4 | 2.25 | | Implemented as a Project menu: **Scale Canvas** resamples every cel with nearest-neighbor and offers a preview, aspect lock, and ½×/1×/2×/3× presets; **Resize Canvas** crops or extends around a 3×3 anchor with transparent new pixels and a preview; **Crop to Content** trims transparent borders across all normal layers and frames; **Crop to Selection** uses the selection bounds. Crop to Content and Crop to Selection are disabled when they would not change the canvas; Crop to Content is also disabled when no pixels are painted. All operations are undoable and clear the selection. |
| 12 | Multi-frame selection, copy/paste, and duplicate | 8 | 4 | 2.00 | | Implemented: shift-click selects a range and Ctrl/Cmd-click toggles frames. Copy/paste moves whole frames across layers, duplicate inserts copies with optional X/Y cel offsets, and the right-click menu exposes the same actions. |
| 13 | Palette ramps, lock, and color cycling | 8 | 3 | 2.67 | | Implemented: ramps interpolate between two colors in RGB, HSV, or OKLab and append to any editable palette (the built-in palette stays read-only), with step count, live preview, duplicate skipping, and an optional post-generation lock. Locking snaps the picker and eyedropper to the nearest palette entry when the picker is released, disables palette edits, and persists in `localStorage`. The Color Cycles dialog owns range selection, forward/reverse/ping-pong direction, 50–500 ms speed, and an in-dialog composited preview; swatch clicks no longer select a range. |
| 14 | Sprite sheet metadata export | 8 | 3 | 2.67 | | Implemented: the Spritesheet tab can download a JSON sidecar in Aseprite, TexturePacker (JSON Hash), or Godot format. It stores each frame's output-pixel rect, untrimmed source size, opaque trim bounds, duration, tag ranges as animations, and a configurable normalized pivot. Trim is computed per composited frame from visible normal layers; reference layers are ignored. All rectangles use the export scale and spacing. |
| 15 | Advanced color cycling (bake cycles, animation export) | 7 | 4 | 1.75 | | Implemented: the Color Cycles dialog (palette tools menu or command) previews a range inside the dialog, bakes the current phase into the active frame's visible normal layers, or generates one full cycle pass as ordinary frames with a duration and tag. The generated frames become the animation selection and export through the existing GIF and sprite-sheet paths. Cycling ranges, speed, and direction are workspace-only and deliberately not stored in project files. |
| 16 | ICO / favicon export | 5 | 2 | 2.50 | | Implemented: the export dialog's **Icon** tab writes a multi-size `.ico` (16/32/48/64/128/256 px, PNG-compressed entries) and `.icns` (16/32/64/128/256/512/1024 px, PNG entries) from the chosen frame, centered and nearest-neighbor scaled to fit each square. |
| 17 | APNG and animated WebP export | 7 | 4 | 1.75 | | Implemented: the export dialog's **Video** tab encodes APNG (reusing PNG frames with full alpha and per-frame durations) and animated WebP (lossy VP8 with full alpha, wrapping the browser's still-WebP encoder), both with an in-file loop flag. The same tab also exports WebM, MP4, MOV, AVI, and MKV video. |
| 18 | Layer color / colored layer tracks | 6 | 2 | 3.00 | | Implemented: every layer can carry an optional timeline identity tint chosen from twelve presets or a custom color. The tint shades the layer header and its whole frame track, gains strength for the active layer/frame/cel, appears as a dot in the menu-bar layer readout, survives project save/open and undo snapshots, and is presentation-only: it is not undoable and never changes pixels or exports. |

| 19 | Left/right mouse button tool mapping | 6 | 2 | 3.00 | | Implemented as an optional, disabled-by-default **Double tool mode** (View menu). When enabled, the left and right mouse buttons run separate tools: left-click a tool button to assign the blue left slot, right-click to assign the orange right slot. The tool options panel follows the last-selected tool and can be swapped with an arrow button; the canvas shows a crosshair with floating tool icons. Zoom gains an in/out direction option, lasso finishes on double-click from either button, and the eyedropper can target primary or secondary. |

## Planned features

| # | Feature | Appeal | Difficulty | Score | Strategic | Why / implementation notes |
| ---: | --- | ---: | ---: | ---: | :---: | --- |
| 1 | Onion-skin static reference frame | 6 | 2 | 3.00 | | Keep one chosen “static” frame always visible behind the active frame while onion skinning, independent of the relative previous/next range. Aseprite calls this out and it is a game-changer for matching poses to a key frame. |
| 2 | Import from URL & paste-from-clipboard | 6 | 2 | 3.00 | | Accept a pasted image from the OS clipboard and an image URL in the import dialog. Browser-native conveniences that lower the friction of grabbing a reference or a palette reference mid-session. |
| 3 | Dithering patterns and pattern brushes | 8 | 3 | 2.67 | | Add selectable dither masks (Bayer, checker, custom) to pencil/fill, plus standalone error-diffusion (Floyd–Steinberg) and ordered-dither filters over a selection. Reuse the gradient Bayer code and selection masks. |
| 4 | Color-blindness simulation and palette preview | 5 | 2 | 2.50 | | Preview deuteranopia/protanopia/tritanopia and grayscale in the canvas without changing pixels. Useful for accessibility checks and palette design. |
| 5 | Unused-color pruning and palette analysis | 5 | 2 | 2.50 | | Report how many colors are actually used and remove unused entries; add a Lospec-style analyzer that highlights weak ramp coverage. Lospec ships “remove unused colors” and GrafX2 offers palette coverage tools. |
| 6 | Frame duration badges and colored tag ranges | 5 | 2 | 2.50 | | Show each frame's duration (ms) as a badge on its timeline thumbnail and let tags carry a color so ranges are easier to distinguish. A common Aseprite UX wishlist item. |
| 7 | Export presets | 7 | 3 | 2.33 | | Name and reuse export configurations (format, scale, trim, spacing, metadata, loop) so the right settings are one click. Pixelorama ships an `export_presets.cfg`; the community repeatedly asks for this. |
| 8 | Outline, drop shadow, and color-replace filters | 8 | 4 | 2.00 | | Selection-aware filters that operate on the active cel or all visible layers. Add a preview and an undoable apply step. High value for quick sprite cleanup; the natural home for non-destructive FX layers later. |
| 9 | Rulers and draggable guides | 6 | 3 | 2.00 | | Horizontal/vertical guides with snapping, persisted per project, plus a quick measurement readout. Reuse the mirror-guide overlay and pointer mapping. |
| 10 | Split view / second zoom window | 6 | 3 | 2.00 | | A second viewport showing the same document at another zoom, or a detached 1× preview. Reuse `drawScaled` and the preview component. |
| 11 | Custom grid offsets and isometric grid | 6 | 3 | 2.00 | | Offset the grid origin and add isometric/diagonal (and later hexagonal) grid modes. Mostly rendering/UI work; useful for tiles and isometric art. |
| 12 | Timelapse / process replay | 8 | 4 | 2.00 | ★ | Record a compact log of pixel deltas and replay the making-of as a GIF/video. Artists love posting process shots, and Pixel Spell already tracks per-stroke history, making this cheap. A genuine browser-native delight no desktop editor ships out of the box. |
| 13 | Motion drawing (draw while playing) | 6 | 3 | 2.00 | | Paint into the animation while it plays (Pixelorama's “motion drawing”). Direct-manipulation feel for effects and onion-skin-assisted in-betweens. |
| 14 | Undo history panel | 7 | 4 | 1.75 | | Show named history entries, allow jumping to a point, and keep the cel-patch history compact. Requires history labels and a non-linear apply path. |
| 15 | Gradient map layer | 7 | 4 | 1.75 | | Map luminance to a multi-stop gradient as a live filter, so a whole sprite can be recolored in one step (Pixelorama ships this; a standing Aseprite request). Useful for palette swaps and mood variants. |
| 16 | Accessibility and localization pass | 5 | 3 | 1.67 | | Full keyboard navigation, screen-reader labels for canvas actions, reduced-motion support, and i18n extraction. Good for reach and polish. |
| 17 | Custom brushes (shapes, patterns, textured) | 8 | 5 | 1.60 | | A brush mask editor, saved brush library, and stamping pipeline. Build on `paintBrush` and `paintPixel`; add a brush preview and per-brush size/opacity. Include “custom brush from selection” (Aseprite v1.1). |
| 18 | Linked cels / continuous layers | 8 | 5 | 1.60 | | Link cels so editing one updates all linked copies, and auto-link new cels on “continuous” layers. Keeps a background or repeated body part in sync across frames without copy-paste drift (Aseprite, Pixelorama, Pixquare all ship cel linking). |
| 19 | Pixel cleanup and recolor (de-AA, snap-to-grid, palette remap) | 8 | 5 | 1.60 | | Clean up AI-generated or anti-aliased art: remove anti-aliasing, snap pixels to a detected grid, and recolor an image to a target palette with perceptual matching. Directly addresses the “mixelated AI art” problem and complements the existing nearest-color snapping. |
| 20 | Nine-slice / UI asset export | 6 | 4 | 1.50 | | Define nine-slice borders and export stretchable UI assets with metadata. Niche but valuable for game UI artists. |
| 21 | Recent files / project library | 6 | 4 | 1.50 | | A local project browser backed by IndexedDB/File System Access API, with thumbnails and recent projects. Complements autosave and is the offline prerequisite for any later cloud sync. |
| 22 | Isometric / seamless tiled drawing | 7 | 5 | 1.40 | | Wrap drawing across canvas edges and add an isometric tile mode. Requires careful coordinate wrapping in every drawing tool and preview. |
| 23 | Sprite atlas packing (MaxRects) | 7 | 5 | 1.40 | | Pack frames or tagged animations into an atlas with padding, trim, and rotation options. Build on the sprite-sheet geometry code. |
| 24 | Layer groups, blend modes, clipping masks | 8 | 6 | 1.33 | | Change the layer model to a tree, add blend modes (multiply, screen, overlay, add, etc.), group opacity/blend, and clipping or mask layers. High artist value but touches compositing, UI, undo, and file format. |
| 25 | Selection transform (scale/rotate/flip) | 8 | 6 | 1.33 | | Add transform handles to floating selections with nearest-neighbor scaling and 90° rotation. Reuse the floating-selection pipeline; add a transform matrix and commit path. Consider pixel-preserving rotation (RotSprite/cleanEdge) later. |
| 26 | WebGL shader filters | 8 | 6 | 1.33 | ★ | Real-time fragment-shader filters (scanlines, glow, palette posterize, outline) previewed on the canvas, user-loadable. Pixelorama ships Godot shaders; a WebGL path is a strong browser-native differentiator. |
| 27 | Tweening (position/scale/rotation/opacity, easing) | 8 | 6 | 1.33 | | Interpolate between frames with easing curves to generate in-betweens. One of the most-requested Aseprite features (v1.4 plan #96); a browser editor can ship it as a non-destructive “tween layer” or baked frames. |
| 28 | Version snapshots / named checkpoints | 6 | 5 | 1.20 | | Save named project snapshots locally with thumbnails and restore/diff. Complements undo and autosave without a backend. |
| 29 | Per-cel opacity | 6 | 5 | 1.20 | | Let a single frame's cel carry its own opacity, separate from the layer. Aseprite `Cel Properties` does this; enables per-frame fade without splitting layers. |
| 30 | Animated brushes | 6 | 5 | 1.20 | | Brushes that cycle through multiple cells as you stamp, producing an animated effect (sparkle, flame) in one gesture. Pro Motion's “AnimPainting”; a genuinely rare feature. |
| 31 | Grayscale mode (1/2/4/8-bit, dithering) | 7 | 6 | 1.17 | | A document color mode with single-channel cels and a ramp palette, plus dithering and conversion to/from RGBA. Medium model change; valuable for Game Boy/1-bit and grayscale art. |
| 32 | Non-destructive adjustments (hue/sat/levels/curves) | 7 | 6 | 1.17 | | Per-layer adjustment stacks with live preview and export. Requires a layer-effect model and compositing changes; can be destructive first, then non-destructive. |
| 33 | Brush pressure / velocity and tablet support | 7 | 6 | 1.17 | | Pointer pressure API, pressure-to-size/opacity curves, and tablet-friendly UI. Requires a brush engine change and careful pixel snapping. |
| 34 | AI palette, cleanup, and generation assist | 8 | 7 | 1.14 | ★ | Optional, explicit AI actions: generate a palette from a prompt, clean up stray pixels, suggest outlines/shadows, or generate a base sprite. Needs a provider abstraction, privacy controls, and a review step. |
| 35 | Desktop app (Tauri/Electron) | 8 | 7 | 1.14 | ★ | Native menus, file-system access, auto-save, drag-and-drop, and offline project library. Reuses the Svelte UI; the main work is packaging, file APIs, and updates. |
| 36 | Indexed color mode | 9 | 8 | 1.13 | | Store palette indices instead of RGBA, enforce a document palette, support transparency index, palette swap, color cycling, and indexed PNG/GIF export. A major model/file-format change, but the classic pixel-art workflow and a strong differentiator. |
| 37 | Aseprite `.aseprite` import/export | 9 | 8 | 1.13 | | Parse/write the Aseprite binary format (layers, frames, tags, palettes, cels). High interoperability value; requires careful binary parsing and test fixtures. |
| 38 | MCP server | 8 | 8 | 1.00 | ★ | Expose Pixel Spell projects and operations to AI agents through MCP tools: inspect document/layers/frames/palette, draw/fill/select, add/remove frames and layers, export PNG/GIF/sheet, save project. A local Node bridge can talk to the browser app over WebSocket, or run the same TypeScript core headlessly. Security must be opt-in, localhost-only, and project-scoped. This is a genuinely uncommon selling point. |
| 39 | Tilemap / tileset mode | 9 | 9 | 1.00 | ★ | Tile size, tile palette document, tile layers storing indices, tile picker, auto-tiling rules, isometric/hex grids, external tilesets, and tilemap JSON export. A large model change but extremely valuable for game artists and level design. |
| 40 | Mobile / touch UI and Apple Pencil | 7 | 7 | 1.00 | | Touch gestures, larger hit targets, pressure support, and a responsive layout. The canvas pointer pipeline is a good base; the UI needs a mobile pass. |
| 41 | Per-frame layer visibility | 6 | 6 | 1.00 | | Show/hide a layer independently per frame, enabling alternate outfit/expression frames without duplicating layers. Requires a per-frame visibility model and timeline UI. |
| 42 | Macros / recordable actions | 6 | 6 | 1.00 | | Record and replay multi-step actions (resize → index → dither → export) Photoshop-style, so non-coders can automate repetitive workflows. Aseprite has this on its v1.4 roadmap (#475). |
| 43 | Shareable live preview links | 7 | 7 | 1.00 | ★ | Produce a share URL/thumbnail of a sprite or animation with zero install, for feedback and embedding. A browser-native capability desktop editors cannot match natively. |
| 44 | Scripting / plugin API | 7 | 8 | 0.88 | | A safe JS/TS plugin API for custom tools, filters, and exporters, with a sandbox and permission model. Powerful but risky; needs a stable API, documentation, and ideally a marketplace/install UI. JavaScript in the same VM is a friendlier surface than Aseprite's Lua. |
| 45 | CSS / engine / headless export pipeline | 5 | 6 | 0.83 | | Extend export with CSS sprite-sheet metadata, direct-to-engine output (Godot/Unity/GameMaker/Phaser), and a headless/batch export path for build pipelines. |
| 46 | PSD import/export | 7 | 9 | 0.78 | | Read/write layered PSDs. High effort and large test surface; only worth it if the app targets artists who exchange files with Photoshop. |
| 47 | Color management (ICC/sRGB/linear) | 4 | 6 | 0.67 | | Color-space-aware compositing and export. Most pixel artists work in sRGB, so this is mostly relevant for professional pipelines. |
| 48 | Audio / animation sync | 4 | 6 | 0.67 | | Attach audio tracks to animations and scrub/play in sync. Niche; useful for cutscenes and rhythm games. |

## Not planned features

These are deliberately out of scope for the foreseeable future. They contradict the client-only, local-first architecture or carry outsized operational cost, so they are tracked without appeal/difficulty scores.

| # | Feature | Why not now |
| ---: | --- | --- |
| 1 | Cloud sync / project library | Requires accounts, server storage, sync and conflict resolution, and ongoing infrastructure cost. A local project library (see "Recent files / project library") covers the offline need first, and the client-only architecture is a core identity of the app. |
| 2 | Real-time collaboration | Multiplayer editing, presence, permissions, and CRDT/OT conflict resolution are very high complexity and operational cost for a client-only editor. Defer until after a plugin/API layer and a clear infrastructure story exist. |

## Recommended roadmap

### Phase 1 — high-value quick wins (days to ~2 weeks)

1. Reference image / tracing layer — done (Reference Layer + Reference Board)
2. Onion skinning — done
3. Autosave and crash recovery — done
4. Frame tags, per-frame durations, and animation range — done
5. Canvas resize/crop/scale — done
6. Palette tools (sort, dedupe, palette library) — done
7. Sprite-sheet metadata export — done
8. Frame reordering and multi-frame selection — done
9. ICO / favicon export — done
10. Layer color / colored layer tracks — done
11. Onion-skin static reference frame
12. Left/right mouse button tool mapping — done
13. Import from URL & paste-from-clipboard
14. Frame duration badges and colored tag ranges
15. Unused-color pruning and palette analysis

These add the most day-to-day value per unit of risk. Onion skinning and reference layers in particular are table stakes for animation and tracing workflows.

### Phase 2 — professional editing (1–2 months)

1. Layer groups, blend modes, and clipping masks
2. Selection transform (scale/rotate/flip)
3. Custom brushes and dithering patterns
4. Outline/shadow/color-replace filters
5. Grayscale mode
6. APNG/animated WebP export — done
7. Undo history panel
8. Palette ramps, lock, and color cycling — done
9. Advanced color cycling (bake and generate) — done
10. Linked cels / continuous layers
11. Export presets
12. Gradient map layer
13. Tweening (with easing)

This phase closes the biggest gaps versus Aseprite and Photoshop-style workflows without changing the core document format too radically.

### Phase 3 — strategic differentiators (2–4 months)

1. Indexed color mode with palette swap/cycling
2. Tilemap/tileset mode
3. MCP server for AI-agent workflows
4. Aseprite `.aseprite` import/export
5. Desktop app (Tauri) with native file access and autosave
6. WebGL shader filters
7. Timelapse / process replay
8. Shareable live preview links

Indexed color and tilemaps deepen the pixel-art/game-art focus. The MCP server, desktop app, WebGL shaders, and browser-native share/timelapse features make Pixel Spell useful in AI-assisted and offline workflows where most browser editors stop.

### Phase 4 — long bets

- Scripting/plugin API (and marketplace)
- Pixel cleanup and recolor (de-AA, snap-to-grid, remap)
- Per-cel opacity and per-frame layer visibility
- Animated brushes and motion drawing
- Macros / recordable actions
- CSS / engine / headless export pipeline
- PSD import/export
- Audio/animation sync

## Notes on the key requested and strategic features

### Indexed color mode

This is more than a palette UI: it changes the pixel representation and every tool that reads or writes pixels. A practical design:

- Add `doc.colorMode: "rgba" | "indexed"` and `doc.palette: string[]`.
- Store indexed cels as `Uint8Array` (or `Uint16Array` if more than 256 colors are allowed) and reserve index 0 or a configurable index for transparency.
- Make `compositeFrame` resolve indices through the document palette; make drawing tools write indices and compare indices for fill/selection.
- Add palette swap (replace palette entries without touching cels), color cycling (rotate a palette range over time), and indexed PNG/GIF export.
- Extend the project file format to version 3 with a color mode and palette table.
- Keep an “RGBA” escape hatch so users can convert a document without losing data.
- Store the palette *with* the document (per-image), unlike the current workspace-level palettes, so an indexed sprite travels with its palette.

Difficulty is high because undo, floating selections, copy/paste, import/export, and every tool need index-aware paths. The payoff is the classic pixel-art workflow and smaller cels.

### Grayscale mode

Grayscale is a smaller model change than indexed color but still needs its own pixel path:

- Add `doc.colorMode: "grayscale"` and a bit depth (1, 2, 4, or 8 bits per pixel).
- Store one value per pixel and resolve it through a grayscale ramp; support ordered/Bayer dithering when converting from RGBA.
- Make drawing tools compare and write values instead of packed RGBA; keep the same selection/floating-selection semantics.
- Convert to RGBA for PNG/WebP export and keep a dedicated grayscale export path for 1-bit/8-bit PNG.
- Add a document conversion command that maps the current RGBA image to the nearest ramp value with optional dithering.

This is a good fit for Game Boy, 1-bit, and monochrome art. It is less invasive than indexed color because there is no palette table, but it still touches tools, compositing, undo, and the file format.

### Advanced color cycling

Implemented as authoring tools inside the **Color cycles…** dialog, opened from the palette tools menu or the command palette:

- The dialog selects an inclusive palette range, direction (forward, reverse, or ping-pong), and 50–500 ms step speed, and previews the animated frame plus the rotated range strip without touching pixels. The canvas stage, preview window, thumbnails, and exports stay unmodified.
- **Bake phase into this frame** writes the current phase into the active frame's visible normal layers via an undoable cel patch, so the chosen look survives without a live cycle.
- **Generate cycle animation** inserts one full pass after the active frame. Every inserted frame is an ordinary frame with a rotated copy of every layer, a custom duration from the cycle speed, and an optional tag. The generated frames become the current selection, which also makes them the animation range. GIF and sprite-sheet export therefore animate the cycle through the existing paths.
- Cycling ranges, speed, and direction are workspace preferences and are deliberately **not** stored in project files. Only the generated frames (or baked pixels) are document data.
- Indexed color mode is still the long-term place for palette metadata cycling; this implementation is the RGBA authoring equivalent and does not change the file format.

### MCP server

A realistic architecture that preserves the client-only editor:

1. Add a local MCP server (stdio) that exposes tools such as `project.list`, `project.inspect`, `canvas.draw`, `canvas.fill`, `selection.set`, `frame.add`, `layer.add`, `export.png`, `export.gif`, and `project.save`.
2. Bridge the MCP server to the browser app over a localhost WebSocket, or run the same TypeScript core headlessly in Node with a canvas implementation.
3. Require an explicit “Enable MCP bridge” toggle, bind to `127.0.0.1`, and scope access to the open project. Do not expose arbitrary filesystem or network access.
4. Return structured JSON (dimensions, layers, frames, palette, changed pixel counts) so an agent can verify its work.
5. Add a read-only mode and an audit log of agent actions.

This is a strong differentiator because it lets an AI agent inspect and edit a real sprite project rather than generating a flat image. It is also a natural companion to AI palette/cleanup features.

### WebGL shader filters

A browser-native path to real-time, non-destructive preview effects:

1. Composite the document to a texture and run a user-selectable fragment shader per effect (scanlines, glow, palette posterize, outline, quantization).
2. Keep the shader stack viewport-only (never exported) unless the user bakes a result into pixels.
3. Ship a small built-in library and accept custom GLSL in a sandbox, mirroring Pixelorama's loadable Godot shaders.
4. Use a `requestAnimationFrame`-coalesced draw so previews stay cheap even while painting.

The appeal is that no desktop competitor offers the same discoverability and zero-install sharing; it pairs well with the shareable-links and timelapse features.

### Timelapse / process replay

Because history already stores per-stroke cel patches, a replay feature can be built without a new recording system:

1. Append compact pixel-delta records (or reuse history entries) as the user paints.
2. On demand, replay them into a GIF/WebP/video at a chosen speed, optionally skipping long pauses.
3. Offer “export timelapse” from the export dialog and an in-app replay scrubber.

This is a delight feature with strong social-sharing appeal and little model risk.

### Linked cels / continuous layers

A non-destructive way to keep repeated content in sync:

- Add a `cel.source` reference (a cel id or a “continuous” layer flag) so a cel can mirror another cel's pixels.
- Editing a linked cel writes through to all links; “continuous” layers auto-link newly created cels.
- Serialize the link in the project file (a small metadata addition, not a new cel storage format).

This is one of the highest-leverage animation features and directly addresses the “copy-paste drift” complaint.
