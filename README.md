# Pixel Spell

A focused pixel art editor that runs entirely in the browser. Draw sprites, build layered artwork, and animate frame by frame with a clean, modern interface.

![Pixel Spell screenshot](docs/screenshot.jpg)

## Features

- **Drawing tools** — pencil, spray, eraser, line, curve, shape, paint bucket, gradient, and eyedropper, plus pan and pointer-focused zoom tools. The shape tool draws rectangles, ellipses, stars, or hearts, either as an outline or filled. The gradient tool fills a matching area with a linear or radial primary-to-secondary gradient, using optional Bayer 2×2, 4×4, or 8×8 dithering, fill tolerance, and contiguous-region matching. Zooming with the tool or the scroll wheel moves the view halfway from the current center toward the pointer. The curve tool starts with a dragged base line, then two clicks place its control points. The spray tool scatters random pixels inside a round area at an adjustable pixel rate.
- **Area effects** — the blur and jumble tools soften or scramble pixels inside a round area as you pass over them, with adjustable radius and power.
- **Effects menu** — **Effects → Outline…**, **Drop shadow…**, and **Color replace…** open live-preview dialogs that apply to the active cel or every visible layer in the active frame. Outline grows a border outside the silhouette or recolors its inner edge, with 1–8 px thickness, an outline color, and optional diagonal corners. Drop shadow offsets and spreads a shadow behind the silhouette with its own color and opacity. Color replace swaps one color for another with an exact-or-tolerant RGB match and optional alpha preservation. Every dialog previews the composited result, respects the current pixel selection, skips reference, hidden, and locked layers, and applies as one undoable step.
- **Selections** — magic wand (with optional diagonal connections), a shape marquee tool for rectangles, ellipses, stars, and hearts, freehand or polygonal lasso, and select-by-color. Drag inside a selection to move its pixels. The selection box carries transform handles: drag a corner or edge handle to scale (crossing the center flips, `Shift` locks the aspect ratio), the circle above the top edge rotates (`Shift` snaps to 15°), and `Ctrl`/`Cmd`-dragging a corner skews — each gesture is applied on release and is undoable. Hold `Shift` while making another selection to add it to the current one. Copy and paste selected pixels with `Ctrl+C` and `Ctrl+V` using an in-app clipboard. Pasted pixels stay floating so they can be dragged before being applied on deselect; moving or floating selections are previewed at 50% opacity. Transparent pixels are skipped so they never erase the destination. Edits are clipped to the selected area, and `Delete` clears the selected pixels. Deselect with the panel button, `Esc`, or by clicking the empty canvas stage with a selection tool.
- **Tool options** — brush sizes from 1–8 px, filled shapes, fill tolerance and contiguous fill, layer-aware color sampling, and selection options. The top bar's alpha-lock toggle prevents painting over fully transparent pixels.
- **Double tool mode** — an optional, disabled-by-default **View → Double tool mode** that maps a different tool to each mouse button. Left-click a tool button to assign the blue left slot, right-click to assign the orange right slot. The tool options panel follows the last-selected tool, with an arrow button to swap to the other slot; a thin blue/orange strip marks which one is showing. The canvas uses a crosshair with floating tool icons (bottom-left, plus bottom-right in double mode). Zoom gains an in/out direction option, lasso finishes on a double-click from either button, and the eyedropper can target the primary or secondary color.
- **Customizable tool strip** — drag a tool button into the gap above or below another tool to reorder the strip; a primary-colored line shows where it will land. The ellipsis button pinned to the bottom of the strip opens a **Tools** dialog for showing or hiding tools. Every current tool starts visible, the last visible tool cannot be hidden, and the order and visibility are saved in the browser. Hiding a tool only removes its strip button; its keyboard shortcut and command palette entry still select it.
- **Pixel perfect** — optional per-tool corner-pixel removal for pencil, eraser, curve, and shape-outline strokes. The switch lives in the tool options panel and only appears for tools that support it. The line tool does not expose it because Bresenham lines already avoid redundant corner pixels.
- **Mirroring** — X, Y, and two diagonal axis mirrors. X mirrors across the horizontal axis and Y across the vertical axis. Active axes are drawn as dashed blue lines across the whole canvas stage and can be dragged from anywhere on the stage; drag a line in half-pixel steps to move its mirror axis. Turning a mirror off resets its guide to the center. The toggles live in the top bar next to the theme switch.
- **Radial symmetry** — an asterisk button duplicates every stroke around a center point for mandalas, wheels, and ornaments. Choose 2–16 rotational copies from the adjacent chevron menu, and drag the center handle on the canvas to move the rotation origin. Radial symmetry can be combined with the axis mirrors; mirror axes stay blue while radial spokes and the center handle are red. Turning radial symmetry off resets its center to the canvas center.
- **Aseprite-style timeline** — layers are rows and frames are columns. Click any cel to select its layer and frame; drag across cels to select a block of layers and frames, and the last cel you touch becomes the active cel shown on the canvas. Shift-click cels to extend both the layer and frame range, or click and Shift-click layer headers to select layers on their own. The active cel has a thick blue border, and every cel in a selected row or column uses a translucent primary-blue background. Sticky headers keep both axes visible while scrolling. The eye, lock, and link buttons in the layer column header hide/show, lock/unlock, or link/unlink new cels on every layer at once. Add, duplicate, reorder (drag frame headers), rename, hide, lock, delete, and adjust layer opacity in **Layer properties**; add frames at the end of the timeline, duplicate, and delete them; play the animation at 1–60 fps. The plus and folder-plus buttons below the last layer header add a layer or group at the bottom of the stack. Drag a layer by its header to reorder it; drop it onto a group to move it inside, or onto the top/bottom edge of a row to place it above or below at the same nesting level. Drag a selected frame header to move the whole range. A single selected frame animates the whole timeline; two or more selected frames become the animation range. The toolbar's animation-mode menu switches between forward, backward, and ping-pong playback, and the adjacent loop toggle repeats or stops after one pass. Double-click a layer header to open **Layer properties** for that layer, or double-click a frame header to open its duration/tag settings. Right-click a layer header or frame header for a matching action menu. **Layer properties** also sets the layer's opacity and identity color, which shades its header and entire frame track so long layer stacks are easier to scan. A link button next to each layer's lock toggles **continuous** mode, which links every newly added cel to the active frame so repeated content stays in sync.
- **Layer groups, blend modes, and clipping masks** — organize the stack into collapsible groups with their own opacity and blend mode. Create an empty group with the folder button or wrap every selected layer with **Group selected layers**; **Ungroup selected layers** moves the selected layers out of their groups one level. Deleting a selected group removes the group while keeping its children. Layers inside a group are indented with IDE-style guide lines so the hierarchy stays readable, and the layer column widens as nesting deepens. Group rows have their own visibility and lock buttons next to the collapse chevron; both cascade to every layer and nested group inside the group, so hiding or locking a group also hides or locks its contents. Every layer and group can carry a blend mode (normal, multiply, screen, overlay, darken, lighten, color dodge, color burn, hard light, soft light, difference, exclusion, add, or subtract) and a **Clip to below** toggle that masks its pixels to the composited content below. Blend modes and clipping are applied on export, so PNG/GIF/sprite-sheet output matches the canvas.
- **Onion skinning** — show previous and/or next frames at low opacity behind the active frame. Choose a 1–3 frame range, 15/30/50% opacity, and a previous/next tint preset. Toggle it with `O`, the ghost button, or its settings menu.
- **Multi-frame editing** — copy, paste, and duplicate selected frame ranges. Duplicate can shift every cel by X/Y offsets. Right-click a frame header for the same actions plus move left/right, frame duration and tag settings, and delete.
- **Linked cels and cel properties** — select a continuous range of cels, right-click it, and choose **Link cels** to share one pixel buffer across every selected frame on each selected layer, so editing any of them writes through to the others. The active cel supplies the pixels. **Unlink cels** gives each linked selected cel its own copy again. Both actions run for every selected layer. **Link cels** is disabled when only one frame is selected; **Unlink cels** also works on a single selected cel. Linked cels are connected by a blue line in the timeline. Double-click a cel (or use its right-click menu) to open **Cel properties**, which sets a per-cel opacity (multiplied with the layer opacity) and a z-index that reorders cels within a frame. Cels with a custom opacity or z-index show a small indicator icon.
- **Frame tags, durations, and animation range** — give frames a tag and a custom duration. Contiguous frames with the same tag appear as color-coded tag ranges above the timeline; click a range to select it. Each frame header shows its duration in milliseconds: a custom duration from frame properties appears in square brackets (`[ 123ms ]`), while a duration inherited from the project FPS stays bare (`123ms`). Playback and animation export use the selected frames when two or more are selected, or the whole timeline otherwise.
- **Canvas size tools** — the Project menu scales, resizes, and crops the canvas. **Scale Canvas** resamples with nearest-neighbor and offers a live preview, aspect lock, and ½×/1×/2×/3× presets. **Resize Canvas** crops or extends around a 3×3 anchor with a live preview. **Crop to Content** trims transparent borders across every layer and frame, and **Crop to Selection** crops to the selection rectangle. Both crop commands disable when they would leave the canvas unchanged; Crop to Content also disables when nothing is painted. All four operations are undoable.
- **Reference layers** — add a locked, non-exported reference layer to the timeline from an image. Reference layers are fitted to the canvas, can be shown or hidden, have their own opacity, and keep a cel per frame for animation-focused reference work. Choose **Reference Layer** in the import dialog to apply to one frame or all frames, then select the reference layer to replace its current frame's cel from the import dialog.
- **Reference board** — a project-level mood board for images that should not live in the layer stack. Board references are independent of frames and layers, can be moved outside the canvas, support visibility, lock, opacity, zoom, and 5°-step rotation controls, and are never exported. Toggle it from **View → Show reference board** or the top-left canvas button.
- **Resizable workspace** — drag the divider above the timeline, or focus it and use `↑` / `↓`, to resize the canvas/timeline split. The height is remembered between visits.
- **Color workflow** — separate primary (left mouse) and secondary (right mouse) colors. Click either color swatch to open the color picker dialog, which combines a saturation/brightness field, hue and alpha sliders, a hex field, RGB/HSV channel sliders with numeric inputs, and one-click palette swatches. The color panel supports multiple palettes: the built-in 32-color palette is read-only, while custom palettes can be created, renamed, deleted, and hold up to 256 colors. The palette header's `+` and `−` buttons add the primary color (repeats are allowed) or remove the last color, and the palette button creates a new palette. Drag a swatch onto the gap between two colors to reorder a custom palette; the manual arrangement becomes the new original order and clears any active sort. When a palette has more colors than fit, the color list scrolls on its own instead of scrolling the whole panel. The palette tools button opens sorting by original add/import order, hue, saturation, or lightness; the original order is preserved and persisted. It also generates color ramps between two colors in RGB, HSV, or OKLab — ramps always append to the active palette, skip duplicates, keep their generated order, and can lock the palette when finished. The same menu opens the Palette Library, a searchable set of built-in palettes that can be added repeatedly as independent editable copies, and **Color cycles…**. Left-click a palette swatch to set the primary color; right-click to set the secondary. The palette tools menu also removes palette colors that no frame or normal layer uses (reference layers are ignored) and opens **Coverage analysis…**, a read-only report of how the active palette is used by the active project: used/unused counts, pixel coverage, per-color usage, hue and brightness coverage, and the most common off-palette colors. The Default palette stays read-only, so pruning requires a custom unlocked palette. The Color Cycles dialog picks a palette range, direction (forward, reverse, or ping-pong), and 50–500 ms step speed, then previews the animated frame and range strip inside the dialog. **Bake phase into this frame** writes one phase into the active frame, while **Generate N frames** inserts one full tagged, timed cycle pass after the active frame so GIF and sprite-sheet export animate it. The padlock beside the palette selector locks it for indexed-style work: picker and eyedropper colors snap to the nearest swatch when released, and palette edits are disabled. A swap button between the two swatches exchanges the primary and secondary colors. Custom palettes, the active palette, and the lock state are persisted in `localStorage`; color cycle settings are workspace-only and are never written to project files.
- **History** — an 80-step undo/redo stack per project with named steps. **Edit → History…** (also in the command palette) lists every state from the earliest retained step to the redoable steps, labels each action, and shows the affected layer and frame. Click any entry to jump straight to that state; making a new edit discards the redoable steps below the current one.
- **Export** — one dialog for image, sprite sheet, video, and icon output. Export the current or chosen frame as PNG, WebP, or JPEG; build horizontal, vertical, or grid sprite sheets with configurable spacing; render an animation as GIF, APNG, animated WebP, or a video file (WebM, MP4, MOV, AVI, or MKV); or package a multi-size `.ico` or `.icns` app icon. Every mode supports 1×–10× scaling and background choices, with live previews and size warnings. Sprite sheets can also download a JSON sidecar in Aseprite, TexturePacker, or Godot format with frame rects, trimmed content bounds, a configurable pivot, per-frame durations, and tag-based animations.
- **Multiple projects** — open several projects in tabs above the canvas. New projects can be named, started with a transparent, white, or black background, and use a canvas-size preset list covering every power-of-two square from 8 × 8 to 1024 × 1024 plus a deduplicated catalog of retro hardware resolutions. Double-click a tab name to rename it. Each tab keeps its own document, history, zoom, pan, rotation, and unsaved state. Closing a dirty project asks for confirmation; closing the last project starts a new untitled one.
- **Autosave and crash recovery** — unsaved projects are snapshotted to IndexedDB shortly after you pause drawing, and every few seconds during longer sessions. If the app is reloaded or crashes, the next launch offers the autosaved tabs with a live preview and **Restore** or **Discard** choices. Autosaves are recovery copies; saved `.pixelspell` files remain the source of truth.
- **File import** — use **File → Import…** or drag and drop a file anywhere to open the import dialog. Common images (PNG, JPEG, GIF, WebP, BMP, AVIF, ICO, SVG) can become a new project, a normal layer, a new frame, a timeline reference layer, or a reference-board image. Project imports larger than 2048 × 2048 are cropped to the top-left corner; reference layers use the complete image fitted to the canvas, and board references retain their original full-resolution bytes. PNGs can also contribute a palette built from their unique colors, and JASC `.pal`, GIMP `.gpl`, and `.hex` palettes import directly. Palettes are capped at 256 colors and previewed before import. **File → Import from URL…** loads a direct image link into the same dialog, and pasting an image from the OS clipboard anywhere outside a text field opens the dialog with that image. Image URLs must allow cross-origin (CORS) requests; otherwise the dialog explains the failure and suggests downloading the file.
- **Projects** — save and open portable `.pixelspell` files; opened files get their own tab. Reference layers and board images are stored inside the project file, so references travel with the artwork.
- **Canvas controls** — fit-to-window or manual zoom, scroll-wheel zoom, middle-mouse panning that always keeps part of the sprite on stage, canvas rotation from −180° to +180° in 15° steps, preset grid sizes from 1×1 to 64×64, and a live cursor preview. The grid control sits at the bottom left of the canvas, while rotation and zoom controls sit at the bottom right. A compact menu-bar readout shows the canvas size, last cursor coordinate, current frame, and active layer.
- **Preview window** — a 1× copy of the active frame floats in the upper-right of the canvas stage. Close it to leave a circular scan-eye button; toggle it from **View → Show preview**. The preview updates while the animation plays.
- **Light and dark themes** with a sky-blue accent, persisted in `localStorage`.

## Tech stack

- [Svelte 5](https://svelte.dev/) with runes
- [Vite](https://vite.dev/) + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com/)
- [shadcn-svelte](https://shadcn-svelte.com/) (Nova preset) and [bits-ui](https://bits-ui.com/)
- [Lucide](https://lucide.dev/) icons

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

### Scripts

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                    |
| `npm run build`   | Build for production                          |
| `npm run preview` | Preview the production build locally         |
| `npm run check`   | Run `svelte-check` and TypeScript validation |
| `npm run bench`   | Run the deterministic core performance benchmarks |

## Keyboard shortcuts

| Action              | Shortcut                 |
| ------------------- | ------------------------ |
| Pan                 | `H`                      |
| Zoom                | `Z`                      |
| Magic wand          | `W`                      |
| Shape select        | `M`                      |
| Lasso               | `Q`                      |
| Select by color     | `C`                      |
| Pencil              | `B`                      |
| Spray               | `S`                      |
| Eraser              | `E`                      |
| Line                | `L`                      |
| Curve               | `U`                      |
| Shape               | `R`                      |
| Fill                | `G`                      |
| Gradient            | `D`                      |
| Eyedropper          | `I`                      |
| Blur                | `K`                      |
| Jumble              | `J`                      |
| Command palette     | `Ctrl+K`                 |
| Undo / redo         | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| New project         | `Ctrl+N`                 |
| Save project        | `Ctrl+S`                 |
| Play / pause        | `Space`                  |
| Previous / next frame | `[` / `]` or `,` / `.`  |
| Toggle onion skin   | `O`                      |
| Move selected frames | `Alt+←` / `Alt+→`       |
| Toggle grid         | `Shift+G`                |
| Select all          | `Ctrl+A`                 |
| Copy selection      | `Ctrl+C`                 |
| Paste selection     | `Ctrl+V`                 |
| Delete selection    | `Delete`                 |
| Deselect            | `Esc`                    |
| Resize timeline     | Drag divider, or `↑` / `↓` |

`Ctrl+K` opens a searchable command palette for every action. Every shortcut can be rebound in **Help → Keyboard shortcuts**: click a key chip and press the new combination, use `+` to add an alternate binding, or click the × to remove one. Conflicts are rejected with an inline message, and **Restore defaults** resets the whole set. Bindings are saved in the browser and apply immediately to the menu bar, tooltips, and command palette. Shortcuts are ignored while typing in an input, except `Ctrl+K`. Right-clicking never opens the browser context menu.

## Project structure

```
src/
├── App.svelte                  # App shell, layout, global shortcuts
├── app.css                     # Tailwind, shadcn theme, editor surface styles
└── lib/
    ├── components/
    │   ├── editor/             # Menu bar, tool strip, tool/color panels, canvas, timeline, dialogs
    │   └── ui/                 # shadcn-svelte components
    └── editor/
        ├── editor.svelte.ts    # Reactive editor state (Svelte 5 runes)
        ├── types.ts            # Document, layer, frame, and tool types
        ├── doc.ts              # Document creation, cloning, compositing
        ├── draw.ts             # Brush, line, shape, and fill algorithms
        ├── filters.ts          # Outline, drop shadow, and color-replace pixel filters
        ├── render.ts           # Canvas and thumbnail rendering helpers
        ├── color.ts            # Packed RGBA and hex color utilities
        ├── file.ts             # Project serialization and save helpers
        ├── layer-color.ts      # Layer identity tints, presets, and row shading
        ├── autosave.ts         # IndexedDB crash-recovery snapshots
        ├── canvas.ts           # Nearest-neighbor scale, resize, and crop helpers
        ├── import.ts           # Image/palette import parsing and analysis
        ├── reference.ts        # Reference-layer fitting and board placement helpers
        ├── export.ts           # Image, sprite sheet, GIF, and metadata export
        ├── export-apng.ts     # Animated PNG encoder
        ├── export-webp.ts     # Animated WebP encoder
        ├── export-icon.ts     # ICO and ICNS icon encoders
        ├── export-video.ts    # Video dispatch, AVI/MOV/MKV muxers, MediaRecorder
        ├── palette.ts          # Default palette, nearest-color matching, persistence
        ├── palette-ramp.ts     # RGB, HSV, and OKLab palette ramp generation
        ├── palette-cycle.ts    # Palette cycle ranges, display order, and remapping
        ├── palette-analysis.ts # Palette usage scanning and coverage reports
        ├── commands.ts         # Command catalog for the palette and shortcuts
        ├── keybindings.svelte.ts # Rebinding state, conflict checks, persistence
        └── tools.ts            # Tool metadata and shortcuts
bench/                          # Deterministic core benchmarks (npm run bench)
docs/                           # Screenshot, performance notes, planned features
```

The project tab strip lives in `components/editor/ProjectTabs.svelte`; the editor core keeps one session per project in `editor.svelte.ts`.

## Data model

A document is a `PixelDoc`:

- `width`, `height`, `fps`
- `frames[]` — animation frames, each with an optional custom duration (milliseconds) and tag
- `layers[]` — ordered bottom-to-top; each layer has visibility, opacity, lock state, an optional `role: "reference"`, an optional `continuous` flag, an optional timeline color (`#rrggbb`), and one `Uint32Array` cel per frame. Layers can be grouped into a tree: a group node has `isGroup: true`, no cels, and an optional `parentId`, and every node can carry a `blendMode` and a `clipping` flag. Children are stored contiguously after their parent group. Per-cel opacity and z-index live in `celProps`, and linked cels simply share a single `Uint32Array` buffer.
- `references[]` — project-level reference-board images with their source bytes, natural dimensions, display bounds, opacity, visibility, and lock state
- `animationMode`, `animationLoop` — playback order (`forward`, `backward`, or `ping-pong`) and whether playback repeats

Pixels are packed little-endian RGBA (`0xAABBGGRR`), which lets cels be written directly into `ImageData` for rendering and PNG export. Transparent pixels are `0`.

Reference layers participate in the viewport composite but are excluded from export, preview, and thumbnails by default. Reference-board images are rendered separately on the canvas stage and never enter the cel compositor. The eyedropper can sample visible reference layers when layer-aware sampling is enabled.

Project files use the current `PXSP` container format (version 4). Layer and frame metadata is stored in a UTF-8 metadata block and each cel is stored as raw little-endian RGBA or run-length encoded data, whichever is smaller. Group nodes carry no cels, so only drawable layers contribute to the cel section. Reference-board images are appended as their original compressed source bytes after the cels, which keeps photos and other high-resolution references efficient. Projects from earlier unreleased format versions are intentionally not supported.

Undo history stores one previous cel buffer for pixel edits and a full document snapshot only for structural edits (adding, deleting, or reordering layers and frames). Every entry carries a label and optional context (for example “Pencil · Layer 1 · Frame 2”), which the history dialog uses to name steps and to jump between states. The stack is capped at 80 entries and about 128 MB per project.

Each open project is a separate `PixelDoc` session with its own active layer/frame, zoom, pan, rotation, undo history, and dirty state. Tool, tool strip order/visibility, color, palette collection, theme, and timeline-height settings are shared across the workspace.

## Notes and limitations

- Open project tabs are kept in memory; reloading the page offers to recover any tabs that had unsaved changes from IndexedDB.
- Each tab shows an unsaved dot when it has unsaved progress. Double-click a tab name to rename it inline; Enter or clicking away commits, Escape cancels, and renaming marks the project dirty. Closing a dirty project asks for confirmation, and the close button is disabled for a single untouched project. Closing a dirty project without saving also deletes its recovery snapshot.
- **File → New project** and **File → Open project** create new tabs; **File → Save project** saves the active project. The **Project** menu contains canvas scaling, resizing, and cropping, and the **Effects** menu contains the outline, drop-shadow, and color-replace filters. **Edit → History…** opens the undo history dialog for the active project.
- **Edit → History…** lists the active project's states from the earliest retained step through the redoable steps. Clicking an entry jumps to that state, and the current row is marked with a primary dot. The footer shows the current step, undoable/redoable counts, and the approximate memory held by history. Jumping does not create new entries, but a new edit after jumping discards the redoable steps.
- Effects are destructive pixel filters that run on the active frame only. They skip reference, hidden, and locked layers, honour the current pixel selection, preview through the normal layer composite, and record one undo step per apply.
- Canvas transforms apply to every layer and frame. Reference layers are resampled or cropped with the artwork; reference-board images keep their absolute position and size. Crop to Content ignores reference layers and board images, so tracing aids do not prevent a tight crop.
- Canvas transforms clear the current pixel selection and are undoable. Scale uses nearest-neighbor sampling, not bilinear smoothing.
- **File → Import…** opens a file picker, and dropping a file anywhere in the app opens the same import dialog. Images can become project tabs, layers, frames, timeline reference layers, or reference-board images; palettes are added to the workspace palette collection.
- **File → Import from URL…** opens the import dialog with a URL field; the downloaded image goes through the same analysis, so it can target any import destination. The host must send CORS headers, since the browser will not expose pixels from a cross-origin response that does not opt in. A failed URL shows a readable error instead of a partial import.
- Pasting an image from the OS clipboard outside a text field opens the import dialog with that image. When the clipboard holds an image, `Ctrl+V` imports it; otherwise `Ctrl+V` still pastes the in-app selection as before.
- **File → Export…** opens the export dialog for images, sprite sheets, animations and videos, and app icons. Outputs are generated locally and downloaded by the browser.
- Sprite sheets can include a JSON metadata sidecar in Aseprite, TexturePacker (JSON Hash), or Godot format. It records each frame's sheet rect, untrimmed source size, opaque content bounds, millisecond duration, a normalized pivot you choose in the dialog, and tag ranges as animations. All rectangles use output-sheet pixels, so scale and spacing are already applied; the metadata also stores the sheet scale. Choosing a metadata format downloads two files: the sheet image and the `.json` sidecar.
- Reference layers are locked and never exported. They are fitted to the canvas and store one cel per frame, so each frame can carry its own reference. Applying a large reference to many frames increases project file size because each reference cel is saved like a normal cel.
- Reference-board images are stored inside the project file. A large mood board therefore makes the `.pixelspell` file larger. Board image movement, opacity, zoom, and rotation changes are not part of the undo history; adding and removing a board image is.
- Reference-board images are draggable only while selected in the board panel and unlocked. Lock them when you want to keep drawing over them without moving them.
- The timeline is an Aseprite-style grid: layer rows and frame columns, with sticky headers and cel thumbnails. Its height is remembered in `localStorage`. Frame tags appear as ranges above the frame numbers, and selected frames are highlighted. Dragging across cels selects a rectangular block of layers and frames rather than individual cels; the last cel becomes the active cel, the active cel has a thick primary border, and selected rows/columns are tinted with translucent primary blue. Layer headers support click/Shift selection, double-click for Layer properties, and a right-click action menu; frame headers keep their click/Shift selection plus double-click properties and a right-click menu.
- Onion skins are a viewport aid only; they are never included in thumbnails, previews, or exports. They are hidden during playback.
- Per-frame durations, tag ranges, animation mode, and the loop toggle are stored in `.pixelspell` files. Frames without a custom duration follow the project FPS.
- Playback and animation/video export use per-frame durations and the current frame selection as the animation range. GIF, APNG, and animated WebP honor an in-file loop flag; video containers (WebM, MP4, MOV, AVI, MKV) play once and flatten transparency because they carry no alpha channel. The fallback frame rate applies to GIF and AVI, which use a fixed or fallback rate rather than per-frame timestamps. WebM and MP4 are recorded with `MediaRecorder` in real time.
- Custom color palettes, the active palette, and the palette lock are saved in `localStorage`; the built-in palette is recreated on load and cannot be edited. Color cycle range, speed, and direction are workspace preferences only: they are never written to project files, and generated frames are ordinary frames. Tool strip order and visibility are also saved in `localStorage` and never affect project files, history, or the dirty flag.
- Layer visibility and layer opacity are document-wide rather than per-frame. Per-cel opacity (and z-index) are the exception, set through **Cel properties**.
- Layer colors are timeline identity tints only: they shade the timeline row and frame track, are saved in project files and carried through undo snapshots, but never affect pixels, exports, or composite order. Changing a layer color is not undoable.
- Brushes are square and pixel-aligned. Selection transforms scale, flip, and skew with nearest-neighbor sampling, and rotate with the RotSprite algorithm (Scale2x upscaling plus nearest-neighbor rotation), so transformed pixel art keeps hard edges and never introduces new colors.
- Projects are limited to 1024 layers and 1000 frames.
- The editor autosaves dirty tabs to IndexedDB for crash recovery. Autosaves are offered on the next launch and do not replace **File → Save project**, which is still required to keep a `.pixelspell` file. Saving or discarding a dirty project clears its recovery snapshot.
- The default canvas is 32 × 32; new projects can be 1–2048 px in each dimension.
