# BRITTO'S FORGEHSE — Design system

**Direction:** a calm, technical HSE control centre. It should feel executive-friendly on desktop and
efficient in the field on a phone. Navy carries authority, one blue marks actions, and teal is the
only accent. Green, amber, orange and red are reserved for risk and status, so they always mean something.

**Basis:** the BRITTO brand board (Midnight Navy, Enterprise Blue, Intelligent Teal, Platinum, Slate,
Manrope) and the existing screens. It was not derived from comparing other websites; no reference
library was connected.

Source of truth in code:
- Web: `apps/web/src/styles.css` (`:root` tokens, dark values under `:root[data-theme='dark']`)
- Android: `apps/mobile/src/theme.ts`

Pages use token names, never raw values.

## Colour

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | #F5F7FB | #071426 | Page background |
| `--surface` | #FFFFFF | #0D1E38 | Panels, cards, inputs |
| `--surface-2` | #EEF2F8 | #12284A | Hover, pressed, table header, secondary fill |
| `--ink` | #0B1F3B | #E6EDF7 | Headings and body text (15.4:1 / 15.7:1) |
| `--ink-2` | #334155 | #C3CEDF | Secondary text |
| `--muted` | #5B6B82 | #93A3BC | Meta text, hints (≥4.8:1 on every surface) |
| `--line` | #E2E8F0 | #1C3354 | Dividers and card borders (decorative) |
| `--field-border` | #7B8AA0 | #5B7396 | Input, select and textarea borders (≥3:1, WCAG 1.4.11) |
| `--midnight` / `--rail` | #0B1F3B | #050F20 | Navigation rail, hero, brand blocks |
| `--primary` | #2563EB | #2563EB | **Primary buttons**: white text 5.2:1 |
| `--primary-hover` | #1D4ED8 | #1D4ED8 | Primary hover |
| `--electric-ink` | #2563EB | #7FB0FF | Links and active text |
| `--electric` | #3B82F6 | #3B82F6 | Focus ring (3.7:1), chart series 1, decorative only — never body text on white |
| `--teal` | #14B8A6 | #14B8A6 | The one accent: progress, chart series 2, AI marks. **Never text or focus on light backgrounds** (2.5:1) |
| `--teal-ink` | #0F766E | #4FD1C1 | Teal when it must be read as text |
| `--platinum` | #C7D2FE | — | Light text and borders on navy only |

**Risk and status** (text on its own tint and on `--surface-2`; every pair ≥ 4.5:1, checked with axe-core). Never use these for decoration. Success text `--ok` #166534; warning text `--warn` #92400E.

| Band | Text | Tint | Dark text / tint |
|---|---|---|---|
| Low / safe / approved | #0F766E | #E6F7F4 | #3CC5B6 / #0F2E2C |
| Medium / pending | #92400E | #FEF3C7 | #F0B44C / #33270F |
| High / draft attention | #C2410C | #FFEDD5 | #F58A54 / #3A1E12 |
| Critical / error / rejected | #B91C1C | #FEE2E2 | #F87171 / #3B1618 |

## Typography

- **Family:** Manrope (self-hosted, 400–800) for everything; `ui-monospace` only for codes.
- **Base:** 16px body, line height 1.5. Prose is capped at ~72 characters (`.prose-block`, notices).
- **Weights:** 400 body, 500 labels, 600 headings and buttons, 700–800 KPI numbers only.

| Token | Size | Line height | Use |
|---|---|---|---|
| `--fs-xs` | 12px | 1.4 | Badges, chart labels, footers (not for sentences) |
| `--fs-sm` | 14px | 1.45 | Tables, meta, hints, help text |
| `--fs-base` | 16px | 1.5 | Body, inputs, buttons |
| `--fs-md` | 18px | 1.4 | Panel titles (h3), lead text |
| `--fs-lg` | 20px | 1.3 | Section titles (h2) |
| `--fs-xl` | 26px | 1.2 | Page titles (h1) |
| `--fs-2xl` | 32px | 1.1 | KPI numbers |
| `--fs-3xl` | 44px | 1.05 | Public hero only |

## Spacing and layout

- **Scale (4px base):** `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-6` 24, `--sp-8` 32, `--sp-12` 48.
- Panel padding is 16–18px, gaps between panels 16px, page side padding 24px (16px on phones).
- **Width:** app content is fluid; forms max 960px; reading text 72ch.
- **Breakpoints:** 1100px (KPI strip to 3 columns), 900px (side panels stack), 640px (tables become cards, filters stack).
- **Touch targets:** at least 44×44px on phones (Android buttons 48px).

## Shape and depth

- **Radius:** `--r-sm` 4px (buttons, chips, inputs), `--r` 8px (cards), `--r-lg` 12px (panels), `--r-xl` 18px (hero blocks).
- **Shadows:** `--shadow-sm` for resting cards, `--shadow` for menus and popovers, `--shadow-pop` for dialogs. Nothing else.
- Borders: 1px `--line` on containers; 1px `--field-border` on form controls.

## Components

- **Buttons:** primary (`--primary`, white text); secondary (surface, `--field-border`, ink text); quiet/ghost (no border, ink-2); danger (critical). Every button has a hover state, a visible `--focus` ring (2px, 2px offset) and a disabled state (50% opacity, no pointer). Each screen has one primary action.
- **Links:** `--electric-ink`, underlined on hover, with a 2px offset.
- **Inputs:** 44px minimum height, `--field-border`, focus ring `--focus`. The label sits above the field, and `*` marks a field that is required to submit. Error text is critical colour, below the field, with `role="alert"`.
- **Cards and panels:** surface, 1px `--line`, a header with the title on the left and actions on the right.
- **Status chips:** risk-band colours only. The text label is always present, so colour is never the only signal.
- **KPI strip:** large number, label under it; whole tile clickable as a filter; `aria-pressed` when active.
- **Navigation:** midnight rail with grouped sections. The active item is white text on a lifted navy fill. On phones the rail becomes a drawer opened from the top bar.
- **Tables:** 14px; at ≤640px register tables switch to stacked cards (`.hide-mobile` / `.show-mobile`).
- **Dialogs:** a navy scrim; the focus is trapped and Esc closes. A required reason is marked and blocks the confirm button.
- **Toasts:** bottom-right, ok/error colours, auto-dismiss.
- **Risk matrix picker:** coloured cells by band, the score printed in each cell, the selected cell outlined in ink with a focus ring. Every cell has an aria-label with L, S, score and band.

## Imagery and icons

- **Icons:** one line icon set (`components/ui.tsx`, 20px, 1.75 stroke) for UI, and HSE pictograms (`hse-icons`) for hazards and posters. No emoji as icons.
- **Graphics:** blueprint grid and node patterns on navy only, decorative and `aria-hidden`.
- **Photos:** none are bundled. Use real project photos where available, with a navy overlay for text. If there is no image, show a neutral pattern rather than a stock photo.
- **Charts:** blue then teal for series. Red and amber only for thresholds and problems. When there is no data, show "No data" rather than placeholder figures.

## Motion

200ms ease for state changes, 320ms for reveals and chart drawing. There are no looping backgrounds.
`prefers-reduced-motion` and the in-app "reduce motion" setting turn off non-essential motion.

## Avoid

Gradient text on headings, glassmorphism, purple gradients, three identical feature cards, decorative
use of status colours, teal text on light backgrounds, and placeholder numbers presented as data.
