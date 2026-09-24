---
name: Modern Clinical Intelligence
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#1d4ed8'
  on-secondary: '#ffffff'
  secondary-container: '#4069f2'
  on-secondary-container: '#fffbff'
  tertiary: '#006058'
  on-tertiary: '#ffffff'
  tertiary-container: '#007b71'
  on-tertiary-container: '#b3fff3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dce1ff'
  secondary-fixed-dim: '#b7c4ff'
  on-secondary-fixed: '#001551'
  on-secondary-fixed-variant: '#0039b5'
  tertiary-fixed: '#89f5e7'
  tertiary-fixed-dim: '#6bd8cb'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#005049'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 2.5rem
    fontWeight: '700'
    lineHeight: 3rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Manrope
    fontSize: 2rem
    fontWeight: '700'
    lineHeight: 2.5rem
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 1.5rem
    fontWeight: '700'
    lineHeight: 2rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Manrope
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Manrope
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.625rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 1.125rem
    fontWeight: '400'
    lineHeight: 1.75rem
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.025em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies a modern clinical intelligence aesthetic, tailored for precision pharmaceutical workflows, medical presentation synthesis, and structured clinical strategy. The visual identity establishes an environment of unwavering clinical rigor, scientific authority, and streamlined technological clarity.

### Visual Character
- **Atmosphere:** Clean, analytical, light-filled, and reassuringly precise.
- **Design Metaphor:** Precision clinical instrumentation meets contemporary enterprise computing—featuring crisp data density, calibrated architectural grids, and refined micro-interactions.
- **Audience Resonance:** Designed for medical directors, clinical researchers, and healthcare strategy teams requiring instant credibility, absolute clarity, and swift synthesis of complex scientific collateral.

## Colors

The color system uses high-contrast clinical primaries set against layered, low-saturation slate neutrals to minimize cognitive fatigue during intensive deck-authoring and multi-tier pharmaceutical data analysis.

### Palette Architecture
- **Primary (`#2563EB`):** Core diagnostic blue. Represents active structural focus, primary buttons, step indicators, and primary navigation states.
- **Secondary (`#1D4ED8`):** Deep clinical cobalt. Applied to hover states, focused borders, active table row accents, and high-emphasis brand points.
- **Tertiary (`#0D9488`):** Bio-teal accent. Reserved for successful validation states, clinical proof metrics, completed milestones, and statistical callouts.
- **Neutrals & Surfaces:**
  - `Surface Canvas`: `#F8FAFC` (App background base)
  - `Surface Subdued`: `#F1F5F9` (Nested panels, inactive tab backgrounds, secondary card fills)
  - `Surface Card / Panel`: `#FFFFFF` (Primary elevated containers, modal dialogues, input fields)
  - `Border Line / Subtle`: `#E2E8F0` (Default borders, dividers, grid lines)
  - `Text Primary`: `#0F172A` (Deep slate navy, ensuring AAA readability for dense scientific prose)
  - `Text Secondary`: `#475569` (Metadata, breadcrumbs, supplementary labels)
  - `Text Muted`: `#94A3B8` (Placeholders, disabled indications, micro-timestamps)

## Typography

Typography pairs structural geometric poise with technical readability. **Manrope** provides authoritative, measured geometric confidence for strategic headlines and deck titles. **Hanken Grotesk** serves as a high-legibility workhorse for technical clinical documentation, complex tables, slide annotations, and interactive controls.

### Hierarchy & Typesetting Rules
- **Display & Section Titles (`Manrope`):** Rendered with tight letter-spacing to reinforce architectural solidarity. Keep titles to sentence case or controlled title case; avoid all-caps across long strings.
- **Body & Data Grid (`Hanken Grotesk`):** Calibrated for maximum optical clarity at 13px–15px in multi-column tables, deck template settings, and form arrays.
- **Numeric Fidelity:** Tabular figures are enforced for statistical medical tables, slide page counts, and timestamp readouts.

## Layout & Spacing

The layout is built on a 12-column responsive fluid grid structured around continuous, SPA-driven view switching, a persistent 64px horizontal header, and clean contextual sub-panes.

### Layout Topology
- **Top Horizon Bar (Header):** Fixed 64px height with full-width spanning, hosting the primary horizontal navigation, workspace switcher, and user profiles.
- **Context Ribbon:** Located immediately beneath the header; hosts the breadcrumb path, real-time sync indicators, and primary action controls.
- **Workspace Canvas:** Uses fluid width with a maximum constraint of `1600px` to maintain optimal presentation editing ratios and dashboard data density.

### Breakpoints & Adaptive Scaling
- **Desktop (`>= 1280px`):** 12 columns, `1.5rem` gutters, `2rem` outer padding. Side-by-side authoring views and multi-step creation wizards sit adjacent to interactive slide previewers.
- **Tablet (`768px - 1279px`):** 8 columns, `1rem` gutters, `1.5rem` canvas margin. Slide previews collapse into drawer panels or tabbed views.
- **Mobile (`< 768px`):** 4 columns, `0.75rem` gutters, `1rem` margin. Top navigation collapses into a slide-over panel; wizard steps collapse into a micro progress meter.

## Elevation & Depth

This system avoids heavy drop shadows in favor of balanced atmospheric depth, crisp boundary demarcation, and clinical ambient layering.

### Surface Elevation Levels
- **Base Canvas (Level 0):** `#F8FAFC`. Completely flat base layer.
- **Sub-Surface Tier (Level 1):** `#F1F5F9`. Inset containers, table toolbars, and inactive track regions; separated via `#E2E8F0` hairline borders with no shadow.
- **Primary Raised Cards (Level 2):** `#FFFFFF`. White cards sit against the canvas with a 1px border (`#E2E8F0`) and an ambient tinted shadow:
  `box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.02)`.
- **Floating Overlays & Popovers (Level 3):** `#FFFFFF`. Dropdowns, popovers, and slide template drawers:
  `box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)`.
- **Modals & Slide Focus Overlays (Level 4):** Presentation view switchers and large generation dialogs:
  `box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.18)` accompanied by a backdrop scrim tinted with `rgba(15, 23, 42, 0.35)`.

## Shapes

The interface balances sharp technological precision with humanized ergonomics through a standardized roundedness scale (`roundedness: 2`).

### Geometric Specifications
- **Small Controls (`0.375rem` / `6px`):** Checkboxes, inline badges, micro tags, and form input controls.
- **Standard UI Elements (`0.5rem` / `8px`):** Action buttons, input containers, select dropdowns, step markers, and chips.
- **Cards & Panes (`1rem` / `16px`):** Primary content modules, template thumbnails, step-by-step wizard stages, and structured data tables.
- **Modal & Floating Dialogue Canvases (`1.5rem` / `24px`):** Complex generation dialogs, export screens, and full-scale presentation layout canvases.

## Components

### Top Horizontal Navigation & Breadcrumbs
- **Header:** White background (`#FFFFFF`), hairline bottom divider (`#E2E8F0`), height `64px`. Primary navigation links use `Hanken Grotesk` Medium (`0.9375rem`). Hover states trigger a subtle `#F1F5F9` background pill; active routes display an anchored `2px` underline in `#2563EB` alongside bold font weights.
- **Breadcrumbs:** Contained in the context sub-bar, rendered in `label-sm` (`0.8125rem`). Hierarchy items are separated by subtle forward-slashes (`#94A3B8`). Current page is highlighted in `#0F172A` with non-active segments in `#475569`.

### Stepper Indicator (PPT Solution Wizard)
- **Geometry:** Horizontal connected node rail.
- **Active Step:** Ring-bound node filled with `#2563EB`, displaying a white index numeral or clinical icon, flanked by a bold title.
- **Completed Step:** Solid background `#2563EB` with a crisp white checkmark; connecting line renders as a solid `#2563EB` path.
- **Upcoming Step:** Inactive surface `#F1F5F9`, bordered by `#E2E8F0`, with muted text `#94A3B8`.

### Buttons & Chips
- **Primary Button:** Background `#2563EB`, text `#FFFFFF`, border-radius `0.5rem`, padding `0.625rem 1.25rem`. Transitions smoothly to `#1D4ED8` on hover. Focus rings present a `3px` halo in `rgba(37, 99, 235, 0.2)`.
- **Secondary Button:** Surface `#FFFFFF`, border `1px solid #E2E8F0`, text `#0F172A`. Hover transitions background to `#F8FAFC`.
- **Chips & Tags:** Small capsules with `0.375rem` border-radius; clinical indicator chips use soft translucent fills (e.g., `#EFF6FF` background with `#1D4ED8` typography for active pharmaceutical categories).

### Form Elements & Inputs
- **Inputs & Selects:** Height `40px`, background `#FFFFFF`, border `1px solid #CBD5E1`, border-radius `0.5rem`, padding `0 0.875rem`. Text rendered in `Hanken Grotesk` `0.9375rem`. Focused state shifts border to `#2563EB` with a soft blue ambient glow.
- **Checkboxes & Radios:** `18px` precision squares/circles with `1.5px` borders in `#CBD5E1`. Selected state resolves to `#2563EB` fill with a sharp white check/dot.

### Tables & Data Grids
- **Header Row:** Background `#F8FAFC`, uppercase `label-sm` typography in `#475569`, border-bottom `1px solid #E2E8F0`.
- **Data Rows:** Background `#FFFFFF`, transition to `#F8FAFC` on hover. Alternating row fills are omitted to preserve slide-like minimalism; separation relies strictly on `1px solid #F1F5F9` borders.
- **Selected State:** Light primary tint `#EFF6FF` with an anchored left border highlight in `#2563EB`.

### Cards & Slide Preview Frames
- **Deck Cards:** Bounded within white frames (`#FFFFFF`), `1rem` radius, bordered with `1px solid #E2E8F0`. Features a 16:9 inner presentation viewport container finished with an inset `#00000008` outline to cleanly isolate preview assets.