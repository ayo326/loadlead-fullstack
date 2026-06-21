# LoadLead Design System — MASTER

> Single source of truth for the LoadLead frontend refresh.
> Palette is locked from the existing codebase. Every other surface
> (typography, spacing, radii, elevation, motion, surface treatment,
> rail) is being deliberately rebuilt.

**Brand voice slots**
- Primary motto: **"Connect. Load. Drop."** — hero action line. Used once per top-level surface.
- Secondary tagline: **"Where loads meet leads."** — brand line under the logo, hero subhead, footer. Never stacked with the motto in the same slot.

---

## 1. Direction

A serious **freight operations console**. Closer to a control tower than a marketing site: high information density, calm light surfaces with one deep navy slab on the left, type that holds up at small sizes, generous data tables, and an opinionated 8-pixel rhythm. The look earns trust by being legible, fast, and predictable rather than ornamental. Color is reserved for status and identity; structure is carried by tight borders and a strict spacing scale. **No purple/pink AI gradients, no glass, no neumorphism.** Micro-motion exists but it never gets in the way of the next click.

The word for it: **dispatch-grade**.

---

## 2. Typography

### Pairing
- **Display / UI:** [Inter](https://fonts.google.com/specimen/Inter) — variable, ships with `font-feature-settings: 'cv11', 'ss01', 'ss03'` to lift the freight-ops feel (true straight `a`, single-storey `g`).
- **Mono / data:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — for MC numbers, DOT numbers, load IDs, VINs, ETAs in tables, currency cells.

> One family across every text role, plus mono for codes. Fewer variables, less drift.

### Scale
Type scale uses a 1.125 (major second) ramp so dense tables stay readable.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-display`   | 32 / 40 px | 600 | hero h1 only |
| `text-h1`        | 24 / 32 px | 600 | page title |
| `text-h2`        | 20 / 28 px | 600 | section heading |
| `text-h3`        | 16 / 24 px | 600 | card title |
| `text-body`      | 14 / 22 px | 400 | default body, table cells |
| `text-body-md`   | 15 / 24 px | 400 | comfortable reading (load detail prose) |
| `text-label`     | 12 / 16 px | 500 | form labels, side labels |
| `text-overline`  | 11 / 14 px | 600, uppercase, tracking +0.06em | section eyebrows, table column heads |
| `text-mono`      | 13 / 20 px | 500 | IDs, codes |

### Rules
- Body is **14px**, not 16px — this is an operator console; the eye targets data, not paragraphs. Reading copy bumps to 15px.
- **Tabular numerals on by default for tables** (`font-feature-settings: 'tnum'`).
- Headings never use letter-spacing > 0; only the overline uses tracked uppercase.
- Line-height for tables: **20px** (cells), **36px** (rows including padding).
- No font sizes below 11px. No font weights below 400 (we have a dark slab — light weights die on white).
- Max line length: **72 characters** for body prose.

---

## 3. Spacing scale

Base unit: **4px**. Components compose on multiples of 4; layout structure on multiples of 8.

| Token | px | Use |
|---|---:|---|
| `space-0`  | 0  | reset |
| `space-1`  | 4  | hairline padding inside chips |
| `space-2`  | 8  | inline gap, chip-to-chip |
| `space-3`  | 12 | card padding (tight surfaces) |
| `space-4`  | 16 | default form field gap, card padding (default) |
| `space-5`  | 20 | section internal gap |
| `space-6`  | 24 | card padding (roomy), page section gap |
| `space-8`  | 32 | between page sections |
| `space-10` | 40 | top of major surfaces (page header → content) |
| `space-12` | 48 | reserved — hero / empty states only |

### Rhythm rules
- **Table row height: 36px** (cells `py-2`). Compact mode: 32px.
- **Form field height: 36px** (matching tables visually).
- **Card outer padding: 24px** (header/footer get 16px when present).
- **Page gutter (content edge to viewport): 24px** at md and below, **32px** above.
- Never use arbitrary values like `mt-[13px]` in production code. Round to a scale token.

---

## 4. Radii

| Token | Value | Use |
|---|---|---|
| `rounded-none` | 0   | data tables, table cells |
| `rounded-sm`   | 4px | inputs, buttons, chips, badges, pills |
| `rounded-md`   | 8px | cards, popovers, dropdown panels, sidebar items |
| `rounded-lg`   | 12px | modals, sheets, drawers, hero blocks |
| `rounded-full` | full | avatars, dot status indicators only |

> Drop the 0.75rem default. The current frontend leans `rounded-xl` (94 occurrences) — too soft for the ops feel. Inputs become sharper (4px), cards stay clearly rectangular (8px). Modals only earn 12px.

---

## 5. Elevation

Flat-leaning four-level scale. No coloured shadows.

| Token | Value | Use |
|---|---|---|
| `elev-0` | none | inline elements, table rows, chips |
| `elev-1` | `0 1px 2px rgba(15, 23, 42, 0.04)` | resting cards, inputs (only on focus, see below) |
| `elev-2` | `0 4px 8px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)` | popovers, dropdowns, hover cards |
| `elev-3` | `0 12px 24px -8px rgba(15, 23, 42, 0.10), 0 4px 8px -4px rgba(15, 23, 42, 0.06)` | modals, sheets, drawers, toasts |

### Rules
- Cards are **bordered, not shadowed** by default. `border: 1px solid var(--border)` + `elev-0`. A hover state can lift to `elev-1` if interactive.
- Modals get `elev-3` + a 24% black scrim.
- Inputs use a **ring on focus**, not a shadow. See "ring" in §9.
- Drop the existing `--shadow-elegant` (it leaks primary tint) and `--gradient-hero` (it stacks too many stops). Replace with the scale above.

---

## 6. Motion

### Tokens
| Token | Value |
|---|---|
| `duration-fast` | 120ms — hover, focus, color crossfades |
| `duration-base` | 180ms — popovers, dropdowns, accordion |
| `duration-slow` | 240ms — modals, sheets, drawers in/out |
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` — entering |
| `ease-in`  | `cubic-bezier(0.4, 0.0, 1, 1)` — exiting |
| `ease-soft`| `cubic-bezier(0.4, 0, 0.2, 1)` — defaults / crossfade |

### Rules
- What animates: opacity, transform, color, ring. Never width/height except for accordions (with `auto` height shim).
- Each view animates **1–2 elements maximum** (per the skill's anti-pattern). Page transitions: no. Section entries: a single 8px upward slide + fade is enough.
- **`prefers-reduced-motion: reduce` is mandatory.** All animations collapse to instant; opacity-only is preserved at 50ms.
- No `animate-bounce`, no `animate-pulse` on more than the live-status dot.
- Status-dot pulse: 2s `ease-in-out` infinite, opacity 0.6→1.0. Disabled under reduced motion (becomes solid).

---

## 7. Surface system

Four surfaces, ordered light → dark:

| Surface | Background | Border | Notes |
|---|---|---|---|
| **Page** | `--background` (`hsl(210 40% 98%)`) | none | the canvas |
| **Card** | `--card` (`#fff`) | `1px solid --border` | resting elevation; never plain on `--background` without a border |
| **Inset** | `--secondary` (`hsl(214 32% 94%)`) | none or `--border` | nested panels, quiet info |
| **Rail** | `--sidebar-background` (`hsl(215 60% 10%)`) | right edge `1px solid --sidebar-border` | the deep navy slab |

### Dividers
- Horizontal rule: `1px solid --border`. **Never** a colored line.
- Vertical dividers between table columns: avoid — use header weight + alignment instead.
- Section eyebrow (overline + thin underline) lives **on** the card header, not floating above it.

### `primary-glow` usage (subtle accent, no gradients)
- Active row left accent stripe (3px wide, `--primary-glow`).
- The 1px **focus ring inner glow** (see §9 — inputs).
- The dot inside the active sidebar item (4px circle).
- Never as a background fill on a wide area.

---

## 8. The rail (sidebar) restyle

The deep navy slab stays. Its language changes from "shadcn dashboard sidebar" to "freight operations rail".

### Direction
- **Width:** 240px (collapses to 64px rail-only on `<lg`).
- **Padding:** 16px outer, 4px between items.
- **Logo block:** 56px tall, `--sidebar-background` darkened by an inner border line (`1px solid --sidebar-border` bottom). Logo + tagline "Where loads meet leads." in `text-label` `--sidebar-foreground/70`.
- **Section eyebrows:** `text-overline`, `--sidebar-foreground/50`, padding `space-3 space-4 space-1`. **No vertical separator lines** between sections — eyebrows are enough.

### Nav item
```
[ icon  Label                          (badge?) ]
```
- **Resting:** `bg-transparent`, `text-sidebar-foreground/80`, icon `currentColor`, no border.
- **Hover:** `bg-sidebar-accent` (`hsl(215 55% 16%)`), `text-sidebar-foreground`.
- **Active:** `bg-sidebar-accent`, `text-white`, **left edge accent stripe 3px wide in `--primary-glow`**, and a 4px dot in `--primary-glow` next to the label. No background tint shift, no glow effects.
- **Icon:** 18px lucide-react, `stroke-width: 1.75` (matches our body weight).
- **Badge** (counts): `text-overline` on `bg-sidebar-foreground/10`, no border.

### Footer of the rail
- Persona switcher (Carrier / OO / Driver / Shipper / Admin) lives at the bottom, 56px tall, `--sidebar-accent` panel with the user's role + avatar. Click expands a popover (`elev-2`) anchored to the right edge.
- Below it, a one-line "Connect. Load. Drop." in `text-overline`, `--sidebar-foreground/40`. The motto's quiet home.

### Density
- Persona-shared items in a single top group: Dashboard, Loads, History, Analytics.
- Persona-specific in a second group: e.g. Carrier → "Drivers / Fleet"; OO → "Fleet"; Shipper → "Post Load".
- Settings + Help at the bottom in a third group.

---

## 9. Component-specific direction

> shadcn/ui atoms stay. Only their **token bindings + variants** change.

### Button
- Heights: `sm` 28px, `md` 36px (default), `lg` 44px. **Always** `cursor-pointer`.
- Variants:
  - `primary` — `bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary` — no gradient, no glow.
  - `secondary` — `bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80`.
  - `ghost` — text-only, `hover:bg-secondary` on hover.
  - `destructive` — `bg-destructive text-destructive-foreground`.
  - `outline` — `border border-border bg-transparent hover:bg-secondary`.
- Disabled: `opacity-60`, no cursor.
- Loading: small spinner left of the label, label stays. No layout shift.

### Badge / pill
- Height 20px, padding `0 8px`, `text-overline`, `rounded-sm`.
- Variants: `neutral` (`bg-secondary text-secondary-foreground`), `success`, `warning`, `destructive`, `info` (uses `--accent` quietly).
- Status pill is identical shape but prefixes a **6px dot** in the variant color.

### Input / textarea / select trigger
- Height 36px, `rounded-sm` (4px), `border-border` 1px, `bg-card`.
- Focus: 1px `border-primary`, outer ring `0 0 0 3px hsl(var(--ring) / 0.15)`. Subtle, no glow blur.
- Error: `border-destructive`, helper text below in `--destructive` `text-label`.

### Card
- `bg-card border border-border rounded-md` (8px). Padding 24px default, 16px tight.
- Card header: 16px top padding, no bottom border by default. Section eyebrow lives on the header.
- Interactive card (whole-card click): adds `hover:bg-secondary/40` and a focus ring on `:focus-visible`. `cursor-pointer`.

### Table
- `bg-card`, `rounded-md`, `border border-border` outer; **no inner vertical borders**.
- Header row: `bg-secondary`, `text-overline`, sticky on scroll.
- Cell: `py-2 px-4`, body row 36px. Compact mode `py-1` for 32px.
- Active row: 3px `--primary-glow` left stripe, `bg-primary/4` tint (`bg-primary/[0.04]`). Hover: `bg-secondary/60`.
- Zebra: **off** by default. Optional `zebra` modifier uses `bg-secondary/30` on even rows.
- Numbers right-aligned, tabular numerals. IDs in `font-mono text-mono`.

### Page header
- 56px tall. Title in `text-h1`, eyebrow ABOVE in `text-overline` for breadcrumb-style context (e.g. "Loads / Detail").
- Actions cluster top-right; primary action max one.
- No background of its own; sits on `--background` with a 1px bottom border.

### Status pills (load lifecycle)
Use the same shape across the app. Color is the only differentiator and it inherits the existing tokens.
- `tendered` `info` (`--accent`)
- `accepted` `success`
- `in transit` `info` + pulse on the dot
- `delivered` `success`
- `cancelled` `destructive`
- `draft` `neutral`

### Toast / sonner
- `bg-card`, `border-border`, `rounded-md`, `elev-3`.
- Title `text-h3`, body `text-body`.
- Auto-dismiss 4s for info/success, 7s for warning, sticky for destructive.

### Modal / dialog / sheet
- `rounded-lg` (12px), `elev-3`, scrim `bg-foreground/24`.
- Header padding 24px, footer 16px 24px, content 24px.
- Width: `sm 420 / md 560 / lg 720`. Side sheet 480px on desktop.

---

## 10. Anti-patterns (do not ship)

- ❌ **No purple/pink gradients.** Anywhere. Even one stop.
- ❌ **No multi-stop gradients on primary or accent.** `--primary-glow` is a flat color usage only.
- ❌ **No glass / blur / backdrop-filter.** Wrong tone, performance cost, contrast risk.
- ❌ **No animation on layout properties** (width, height, top, left). Use transform.
- ❌ **No drop-shadow with a brand-color tint.** Shadows are neutral grey.
- ❌ **No `rounded-xl`/`rounded-2xl` as a default radius.** They survive on the hero/modal only.
- ❌ **No emojis as UI icons.** lucide-react only.
- ❌ **No em dashes in UI copy.** Use a regular hyphen, comma, or restructure.
- ❌ **No font sizes below 11px**, no weights below 400.
- ❌ **No `Select` listing equipment classes / commodities** — those go through the `<AsyncCombobox>` over `/api/reference/*` (already in place per Phase 6).
- ❌ **No persona branching inside shared atoms.** Carrier vs OO logic lives at the page/route layer.
- ❌ **No skeleton on the whole page** if the data is < 200ms — use a single 18px spinner top-right of the section.
- ❌ **No infinite scroll** on data tables. Paginate or virtualize.

---

# Style options to choose from

Both options sit on the foundation above. The palette, spacing, radii, motion, surface system, and rail behavior are identical. They differ in **personality** through type, weight, and a couple of finishing touches.

## Option A — **"Dispatch"**

**Type pairing:** Inter (variable) + JetBrains Mono.
**Personality:** crisp, instrument-panel, slightly mechanical. Headings are 600 with `-0.01em` tracking. Mono is used freely for IDs, ETAs, currency in tables. Buttons are square-ish (4px radius) and feel like keys on a control deck.

**Finishing touches**
- Section eyebrow uses 11px JetBrains Mono uppercase + 0.08em tracking for column heads and panel labels — leans into the control-tower feel.
- Active-state stripe on rail items and tables in `--primary-glow` is **2px**, not 3px — tighter line.
- Hover on rows is a `bg-secondary/40` cross-fade; no transform.

**Pick this if** you want LoadLead to read most like Datadog / Linear / Retool.

---

## Option B — **"Hangar"**

**Type pairing:** Inter for body + UI, **Manrope** for headings (32 / 24 / 20). Manrope's slightly geometric warmth softens the dispatch read without going consumer.
**Personality:** more breathable, calmer headings, a little more space-on-the-page. Reads as "fleet HQ" rather than "control tower" — same operator, smaller room.

**Finishing touches**
- Slightly larger card padding default (28px instead of 24px) on dashboard surfaces only — tables and forms stay tight.
- Section eyebrow uses Inter Display 11px 600 uppercase (no mono) — quieter than Dispatch.
- Active-state stripe is **3px** (matches the rail's stripe), unifying rail + content.

**Pick this if** you want LoadLead to read closer to Plaid / Mercury / Ramp's operator surfaces.

---

# Decided

**Direction: Option A "Dispatch" everywhere** — Inter + JetBrains Mono, sharp radii, mono section eyebrows, 2px active stripes.

**Scoped exception: Option B "Hangar"** on the 6 pre-app pages:
- `pages/Landing.tsx`
- `pages/Login.tsx`
- `pages/Signup.tsx`
- `pages/ResetPassword.tsx`
- `pages/AcceptInvite.tsx`
- `pages/SetupAdmin.tsx`

Hangar differs only in heading family (Inter → **Manrope** 600 for `text-display`/`text-h1`/`text-h2`), card padding default (24 → 28 on hero/auth surfaces), and active-stripe width (2 → 3px). Body, mono, motion, spacing, and palette remain identical to Dispatch.

Everything past the auth boundary (the `RequireAuth` tree in `App.tsx`) is Dispatch.

**Implementation branch:** `feat/ui-refresh`.
