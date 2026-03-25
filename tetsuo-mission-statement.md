# Tetsuo Type Tool — Project Mission Statement

> Named for Shinya Tsukamoto's *Tetsuo: The Iron Man* (1989) — a film about flesh consumed by metal, organic form overwhelmed by industrial texture. Shot on grainy 16mm, black and white, with a physicality that's almost violent. That's the energy: clean digital letterforms invaded by grain, rust, erosion, and warp until they feel like they were never digital at all.

## Project Goal

Build an interactive, browser-based typography tool that lets you type words and headlines, arrange them freely on a canvas, and then *sculpt* them — applying organic, physical-world distortions both globally and locally. The emphasis is on effects that feel decidedly *not digital* — weathered, textured, imperfect, alive. Grain, grit, blur, ink bleed, erosion, discoloration. Every effect should feel like something that *happened* to the type, not something applied to it.

What makes this different from Figma or Photoshop: you can reach in and manipulate individual letters. Stretch a single character taller. Erode just the bottom edge of a word. Brush grain onto one corner. Pull and distort letterforms like they're made of hot wax. The tool gives you direct, tactile control over type in ways that uniform-transform tools simply can't.

The tool loads any Google Font, treats each letter and word as an independent object on a freeform canvas, and passes everything through a WebGL shader pipeline where effects are layered, blended, and controlled via both sliders (global) and brush/drag interaction (local). The output is a high-res PNG export.

Hosted on Vercel. Fast. Beautiful. No account required.

## Why This Project Exists

Digital type is too clean. Every tool — Figma, Photoshop, Canva — produces text that looks *made by a computer*. The letterforms are mathematically perfect, the edges are razor-sharp, and any "texture" applied on top feels like a filter, not a material.

But real typography has always been physical. Letterpress leaves impression marks. Screen-printed type bleeds at the edges. Signage weathers. Posters fade unevenly in sunlight. Rubber stamps deposit ink inconsistently. These imperfections aren't flaws — they're what make type feel *human*.

This project exists to bring that quality to the browser. The same shader techniques that made Mantle Creep's shell patterns feel organic — FBM noise fields, substrate-driven irregularity, concentration gradients, grain at transition zones — can transform flat digital letterforms into something that looks weathered, printed, eroded, or grown.

But it goes further than global filters. The real magic is *spot manipulation* — the ability to grab a letter and stretch it, brush erosion onto a specific word, warp just one corner of a headline. This is the thing you can't do in Figma. Figma gives you uniform transforms. Photoshop gives you raster filters on flat layers. Tetsuo lets you *sculpt* type — interacting directly with letterforms as if they're physical objects made of ink, wax, or metal.

The magic is in the specificity. Not "add noise" but "simulate ink bleeding into uncoated paper." Not "blur" but "the way a rubber stamp loses definition at the edges of a heavy stroke." Each effect should reference a real physical process, even if the user never knows the science behind it.

## Desired Outcome

A web-based tool (hosted on Vercel) that:

- Lets you type words and headlines (2-3 lines) directly in the browser, treating each **word** as an independent object
- Gives you a **freeform canvas** — drag words around, resize them, stack lines, control spacing and position
- Offers **spot distortions** via a brush with soft falloff and adjustable radius — paint effects onto specific areas
- Offers a curated library of Google Fonts — display serifs, heavy sans-serifs, expressive faces that respond well to distortion
- Ships with **6 stackable effects** via WebGL shaders — layered on top of each other for combined results
- Controls effects two ways: **sliders** for global intensity, **brush/drag** for local application
- Exports as **solid-background or transparent PNG** at high resolution
- Supports **undo** (Ctrl+Z) for the last action
- Feels fast — effects respond instantly, no lag, no loading spinners
- Looks stunning at rest — the UI itself should reflect the same aesthetic restraint as the output
- Flat composition (no layers in v1) — one canvas, one output
- Per-letter manipulation planned for a future version (v1 is per-word)

A person should be able to open it, type a few words, stretch a letter until it towers over the rest, brush some erosion onto the edges, add grain to just one corner, and export something that could never have been made in Figma — without understanding shaders, noise fields, or rendering pipelines.

## Effects Library (Core)

Each effect is grounded in a real-world physical process. Organized by category:

### Texture & Grain
- **Film Grain** — photographic silver halide noise, concentrated in midtones
- **Risograph** — coarse dot pattern with slight misregistration and ink density variation
- **Halftone** — classic CMYK dot screen at adjustable angle and frequency
- **Paper Tooth** — substrate texture that catches pigment in surface valleys

### Weathering & Decay
- **Edge Erosion** — letterform boundaries dissolve unevenly, as if sandblasted or acid-etched
- **UV Fade** — color loss that's stronger at top/exposed edges, like sun-bleached signage
- **Oxidation** — warm discoloration (rust, patina, foxing) that accumulates in crevices
- **Water Damage** — tideline staining with characteristic hard edges and mineral deposits

### Blur & Focus
- **Selective Focus** — tilt-shift depth-of-field across the headline
- **Chromatic Aberration** — RGB channel separation, like a cheap lens or risograph misregistration
- **Motion Blur** — directional smear suggesting movement or vibration
- **Ink Spread** — gaussian-style bloom that mimics oversaturated ink on absorbent paper

### Organic Distortion
- **Heat Shimmer** — refraction warp, the way hot air bends light above pavement
- **Liquid Warp** — slow, viscous deformation as if the type is printed on a fluid surface
- **Paper Crumple** — displacement mapped to a crumpled-paper normal map
- **Emboss / Deboss** — simulated depth from directional lighting on the letterform surface

### Direct Manipulation (spot/local effects)
- **Stretch / Squash** — grab a letter and pull it taller, wider, or compress it
- **Liquify Brush** — push, pull, and swirl letterforms like Photoshop's liquify, but for type on a canvas
- **Spot Erosion** — brush erosion/decay onto specific areas — eat away at just one edge
- **Effect Masking** — paint a mask that controls where any global effect is applied (e.g., grain only on the left half)
- **Smear** — drag pigment/ink across the surface as if smudging wet paint

### Color & Tone
- **Ink Bleed** — pigment seeping laterally through paper fibers, softening edges
- **Duotone** — map luminance to a two-color gradient (classic print technique)
- **Tonal Shift** — hue rotation that varies spatially, like aging chemical prints
- **Solarization** — partial tone inversion (Sabattier effect from darkroom photography)

> **V1 ships with 6 effects.** All stackable. The full library above is the long-term vision — v1 picks the 6 most compelling and polishes them. Current candidates for the launch set: **grain, ink bleed, edge erosion, chromatic aberration, organic warp, duotone.** Final selection after prototyping.

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| **Build** | Vite | Fast dev server, instant HMR, trivial Vercel deploy |
| **Language** | Vanilla JS (ES modules) | No framework overhead. Direct canvas/WebGL access |
| **Text Rendering** | Canvas 2D API | Render text to offscreen canvas at high resolution |
| **Scene Graph** | Custom JS | Each letter/word is an independent, transformable object |
| **Interaction** | Pointer events + custom brush engine | Click, drag, stretch, and brush effects onto the canvas |
| **Effects** | WebGL + GLSL shaders | GPU-accelerated, real-time, same approach as Mantle Creep |
| **Fonts** | Google Fonts API | Load any of 1,500+ families on demand |
| **Hosting** | Vercel | Free tier, global CDN, deploy from Git |
| **Export** | Canvas `.toBlob()` | High-res PNG download |

### Architecture

```
[User types text] → [Scene graph: each letter/word is an object]
                          ↓
              [Layout engine: position, scale, rotate, stretch per-object]
                          ↓
              [Canvas 2D renders composed text at high res]
                          ↓
              [Upload to WebGL texture + effect mask texture]
                          ↓
              [Shader pipeline: grain → blur → warp → color]
              (each pass reads both the text texture and the mask
               to know where/how strongly to apply the effect)
                          ↓
              [Display on screen / export as PNG]
```

The shader pipeline is modular — each effect is a uniform-controlled pass that can be enabled, disabled, or reordered. Sliders control global intensity; the effect mask (painted by brush interaction) controls *where* each effect applies. Per-letter transforms (stretch, rotate, scale) happen in the scene graph before rendering.

## Visual Direction

- **Canvas**: light / white — the text is the subject, not the background. Like a sheet of paper.
- **Text**: black by default. Maximum contrast. Degradation reads clearly against a clean surface.
- **UI**: monochrome — greys, black, white. No color in the interface. The only color on screen should come from the user's work.
- **Overall feel**: minimal, restrained, precise. The UI disappears and the type is the only thing you see.
- **Reference energy**: Teenage Engineering product pages, Dieter Rams — nothing decorative, everything functional.

This is the opposite of Mantle Creep's dark, atmospheric UI. That tool was about mood. This tool is about *the work*. Clean, bright, paper-like.

## Font Curation (Starter Set)

Nine fonts selected by Chris. Mix of high-contrast serifs, textured display serifs, and clean geometric/humanist sans-serifs — each chosen for character and how they respond to distortion.

### The lineup

| Font | Category | Why it works here |
|------|----------|-------------------|
| **DM Sans** | Geometric sans | Clean, neutral starting point — lets the effects do the talking |
| **Cormorant** | High-contrast serif | Dramatic thin/thick contrast. Thin strokes break apart beautifully under erosion |
| **Fira Sans** | Humanist sans | Warm, readable, open. Good workhorse that takes texture well |
| **Eczar** | Heavy display serif | Bold, textured, high personality. Built to take punishment |
| **Inknut Antiqua** | Heavy decorative serif | Chunky, inky, almost woodcut-like. The most Tetsuo font on this list |
| **Poppins** | Geometric sans | Round, friendly geometry that contrasts sharply with destructive effects |
| **Spectral** | High-contrast serif | Elegant didone-adjacent. The delicate serifs will shatter in interesting ways |
| **IBM Plex Sans** | Neo-grotesque sans | Precise, technical feel (Teenage Engineering energy). Pairs well with grain |
| **Rubik** | Rounded sans | Soft corners and friendly weight. Good contrast against harsh effects |
| **Archivo Black** | Ultra-bold sans | Maximum mass. Heavy enough to survive extreme erosion and grain |
| **Syne** | Expressive display sans | Distinctive geometry with personality. Variable font with a wide weight range |

## Plan / How to Get There

### Phase 1: Foundation (scaffold + canvas + font loading)
- Set up Vite project with Vercel deployment
- Build the freeform canvas — type a word, see it rendered, drag it around
- Scene graph: each word (and optionally each letter) is an independent object
- Google Fonts integration — dropdown/search to pick a font, load it dynamically
- Basic per-object transforms: move, resize, rotate
- Canvas 2D text rendering at high resolution
- WebGL pipeline scaffolding — upload canvas texture, display on fullscreen quad

### Phase 2: Brush & spot effects (what makes it different)
- Brush engine — soft falloff, adjustable radius, pointer events mapped to canvas coordinates
- Effect mask system — paint where effects apply (per-pixel mask texture uploaded to GPU)
- Liquify brush — push/pull letterforms with direct drag

### Phase 3: Core effects (the creative heart)
- Implement 6 flagship effects as GLSL shaders (all stackable)
- Priority: grain, ink bleed, edge erosion, chromatic aberration, organic warp, duotone
- Slider UI for each effect — map to shader uniforms (global intensity)
- Mask-aware rendering — effects apply at full strength where mask is white, zero where black
- Real-time preview as sliders and brush strokes change
- Performance budget: 6 stackable effects must run at 60fps

### Phase 4: Polish & ship
- PNG export — solid background or transparent, at high resolution
- Undo (Ctrl+Z) for last action
- Background color picker
- UI refinement — layout, typography, micro-interactions
- Final QA across browsers
- Vercel production deployment
- Open Graph / social preview image
- User-facing description and landing copy

### Future (post-v1)
- Per-letter manipulation mode (stretch, squash, skew individual characters)
- Additional effects from the full library
- Preset combinations ("Letterpress", "Faded Poster", "Darkroom Print")
- Smear brush, spot erosion brush, additional brush tools
- Full undo/redo history
- Session persistence (localStorage)
- Mobile responsiveness

## References & Inspiration

### Namesake
- **Tetsuo: The Iron Man** (Shinya Tsukamoto, 1989) — the core aesthetic reference. A man's body is gradually consumed by scrap metal — organic flesh merging with industrial material. Shot on 16mm with extreme grain, high contrast black and white, frenetic editing. The film's texture *is* the content. Everything feels corroded, physical, visceral. This is the feeling the tool should channel: digital type being overtaken by physical-world forces until the clean edges are gone and something rawer remains.

### Direct lineage
- **Mantle Creep** — the shell pattern tool that proved this shader pipeline approach works for organic rendering. Grain, blur, FBM noise, iridescence, caustic lighting — all techniques that transfer directly to type effects.

### Aesthetic references
- **Risograph printing** — the beautiful imperfection of soy-based ink on uncoated paper
- **Letterpress** — impression, ink squeeze, fiber pull at character edges
- **Darkroom photography** — grain, solarization, dodge/burn, chemical accidents
- **Weathered signage** — sun-bleached, rain-streaked, paint-chipped urban typography
- **Japanese woodblock printing (mokuhanga)** — wood grain texture, deliberate ink variation, water-based pigment behavior
- **Industrial decay** — rust, patina, oxidized metal, pitted concrete — the material vocabulary of Tsukamoto's world

### Technical references
- **The Book of Shaders** (thebookofshaders.com) — GLSL fundamentals, noise functions, pattern generation
- **Shadertoy** (shadertoy.com) — community shader experiments, grain/blur/distortion techniques
- **Inigo Quilez** (iquilezles.org) — SDF functions, noise, procedural techniques
- **Mantle Creep shader code** — proven WebGL pipeline with FBM noise, 5-tap blur, surface normals, soft-light blending

## Design Decisions (Resolved)

These were open questions — now locked in.

| Decision | Answer | Notes |
|----------|--------|-------|
| **Effects in v1** | 6 polished effects | Quality over quantity. Expand later. |
| **Stackable effects?** | Yes — stackable | Effects layer on top of each other. Performance is a concern — 6 effects keeps the shader pipeline manageable. |
| **Background** | Solid color or transparent | User picks solid color, or exports transparent PNG. No textured paper backgrounds in v1. |
| **Text layout** | Support 2-3 lines | Multiple words/lines on the canvas. Not single-word-only. |
| **Manipulation granularity** | Per-word first, per-letter later | Start with words as the unit of manipulation. Per-letter control added as a future mode. |
| **Brush model** | Soft falloff, adjustable radius | Smooth feathered edge, not hard. User controls brush size. |
| **Layers** | Flat composition (no layers) | One canvas, one output. Keeps it simple. |
| **Undo** | Undo last action | Single-step undo (Ctrl+Z). Not a full history stack in v1. |
| **Presets** | Not in v1 | Let people discover their own combinations first. Presets can come later once we see what people gravitate toward. |
| **Name** | Tetsuo Type Tool | Ship name. Named for Tsukamoto's *Tetsuo: The Iron Man*. |

## Open Questions

- Which 6 effects make the launch set? Current candidates: grain, ink bleed, edge erosion, chromatic aberration, organic warp, duotone. Final call after prototyping.
- What's the default canvas size / aspect ratio?
- Export resolution — 1x, 2x, or user-selectable?
- Should the tool remember your last session (localStorage), or start fresh every time?
