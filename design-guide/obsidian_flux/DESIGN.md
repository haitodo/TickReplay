---
name: Obsidian Flux
colors:
  surface: '#111318'
  surface-dim: '#111318'
  surface-bright: '#37393f'
  surface-container-lowest: '#0c0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#282a2f'
  surface-container-highest: '#33353a'
  on-surface: '#e2e2e9'
  on-surface-variant: '#bbcac5'
  inverse-surface: '#e2e2e9'
  inverse-on-surface: '#2e3036'
  outline: '#859490'
  outline-variant: '#3c4a46'
  surface-tint: '#46dcc5'
  primary: '#4adfc8'
  on-primary: '#003730'
  primary-container: '#19c3ad'
  on-primary-container: '#004b41'
  inverse-primary: '#006b5e'
  secondary: '#9fcaff'
  on-secondary: '#003259'
  secondary-container: '#0397fd'
  on-secondary-container: '#002d52'
  tertiary: '#c9c9cc'
  on-tertiary: '#2f3133'
  tertiary-container: '#adaeb1'
  on-tertiary-container: '#404244'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#69f9e1'
  primary-fixed-dim: '#46dcc5'
  on-primary-fixed: '#00201b'
  on-primary-fixed-variant: '#005046'
  secondary-fixed: '#d2e4ff'
  secondary-fixed-dim: '#9fcaff'
  on-secondary-fixed: '#001c37'
  on-secondary-fixed-variant: '#00497e'
  tertiary-fixed: '#e2e2e5'
  tertiary-fixed-dim: '#c6c6c9'
  on-tertiary-fixed: '#1a1c1e'
  on-tertiary-fixed-variant: '#454749'
  background: '#111318'
  on-background: '#e2e2e9'
  surface-variant: '#33353a'
  surface-obsidian: '#0D0F14'
  surface-charcoal: '#16181E'
  session-tyo: '#1DB954'
  session-ldn: '#3182CE'
  session-ny: '#E53E3E'
  status-danger: '#EE3F4D'
  status-warning: '#F59E0B'
  status-success: '#22C55E'
typography:
  display-lg:
    fontFamily: Outfit
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  heading-md:
    fontFamily: Outfit
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.01em
  label-xs:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: '1.2'
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13.5px
    fontWeight: '600'
    lineHeight: '1.4'
  data-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.0'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-padding-desktop: 64px
  section-gap: 48px
  grid-gap: 24px
  component-padding: 12px
  compact-padding: 8px
---

## Brand & Style

The design system embodies a **High-Tech Obsidian** aesthetic, tailored for professional traders who require surgical precision and absolute reliability. The brand personality is clinical, futuristic, and sophisticated—evoking the feeling of a mission-control interface rather than a consumer app.

The style leverages **Modern Glassmorphism** and **Tonal Layering**. It utilizes deep charcoal and obsidian surfaces to minimize eye strain during long trading sessions, while employing high-chroma accents (Cyan, Electric Blue) to highlight critical real-time data. UI elements feature subtle 1px translucent inner borders to define structure without adding visual bulk.

**Design Principles:**
- **Information Density:** High clarity even with dense tick-data visualization.
- **Visual Hierarchy:** Critical status and action states use vibrant color; secondary data remains muted.
- **Tactile Precision:** Components feel engineered, using sharp geometry balanced by deliberate 12px-16px rounding.

## Colors

The palette is rooted in a "Deep Space" hierarchy. The primary color is a high-contrast **Emerald-Cyan**, reserved for active "Play" states and primary calls to action. The **Electric Blue** secondary color is dedicated to informational data points like server time and JST sync.

**Market Sessions:**
To aid rapid cognitive recognition, market sessions are color-coded with high-saturation, semi-transparent overlays:
- **TYO (Tokyo):** Emerald Green (Vitality/Growth)
- **LDN (London):** Corporate Blue (Stability/Volume)
- **NY (New York):** Deep Orange/Red (Volatility/Action)

**Implementation Note:** All surface colors (`surface-charcoal`) should be applied with an 85-90% opacity and a 20px backdrop-blur when used as floating panels to maintain the glassmorphic depth.

## Typography

This system uses a specialized triple-stack to balance brand, usability, and technical precision:

1.  **Outfit (Headings):** A geometric sans-serif that provides a modern, high-tech flair for titles and navigation headers.
2.  **Inter (UI/Body):** The workhorse for readability. Used for all labels, inputs, and descriptive text to ensure clarity in dense layouts.
3.  **JetBrains Mono (Data):** Essential for financial instruments. Used for all timestamps, tick values, and hotkey indicators. Its monospaced nature prevents layout "jitter" when numbers update rapidly during high-speed playback.

**Usage Rules:**
- Use `data-mono` for any value that changes dynamically (price, time, percentage).
- Use `label-xs` in uppercase for all sidebar category headers and meta-labels.

## Layout & Spacing

The layout philosophy follows a **Rigid Grid** for the application simulation and a **Fluid Content Flow** for documentation. We utilize an 8px base rhythm to ensure mathematical harmony across all components.

**Layout Tiers:**
- **Desktop (Documentation):** Generous 64px margins and 48px section gaps to reduce cognitive load and emphasize premium space.
- **App/Remote Mode:** High-density spacing. Gaps are reduced to 8px-12px to maximize the visible chart area in MetaTrader. 

**Structure:**
The sidebar is fixed at 240px when expanded. The main content area utilizes a flexible 12-column grid for dashboard widgets.

## Elevation & Depth

Visual hierarchy is established through **Tonal Layering** and **Luminous Outlines** rather than heavy shadows.

- **Level 0 (Base):** Deepest Black (`#0F1116`).
- **Level 1 (Panels):** Obsidian (`#0D0F14`) with a 1px `rgba(255, 255, 255, 0.08)` border.
- **Level 2 (Cards/Active Modals):** Charcoal (`#16181E`) with `backdrop-blur: 16px` and a `0 20px 50px rgba(0, 0, 0, 0.5)` shadow to simulate a "floating" glass effect.
- **Interactive State:** Hovered items increase border opacity to `0.15` and add a subtle inner glow using the primary color at 5% opacity.

Avoid using drop shadows on small UI elements (buttons, chips); use tonal contrast and borders instead. Shadows are reserved for the primary application window to separate it from the MT5 background.

## Shapes

The design uses **Rounded (Radius: 2)** geometry to soften the technical nature of the data. 

- **Containers & Large Cards:** 16px (`rounded-xl`).
- **Feature Modules & Modals:** 12px (`rounded-lg`).
- **Buttons & Inputs:** 6px (Standardized for a "pro-tool" feel that balances comfort and precision).
- **Shortcut Tags:** 4px (Minimal rounding for small data indicators).

Icons should always use a "Round" linecap and join to match the 2-unit roundedness of the UI components.

## Components

### Buttons
- **Primary (Play/Action):** Background `primary-color`, text `neutral-color`. 6px radius.
- **Secondary (Control):** Ghost style with 1px border `border-color`. On hover, background becomes `white/5%`.
- **Destructive (Stop/Reset):** Background `status-danger`.

### Controls & Inputs
- **Seekbar/Timeline:** 8px height track. Filled portion uses `primary-color`. Session overlays (TYO/LDN/NY) should be 30% opacity to allow the playhead to remain visible underneath.
- **Inputs:** Dark background (`black/35%`) with a 1px border. Focus state uses a `secondary-color` (Electric Blue) border.

### Chips & Tags
- **Shortcut Keys:** Monospace font, 1px border, 4px radius.
- **Status Indicators:** Small 8px dots with a pulse animation for "Active" or "Live" states.

### Cards
- **Feature Cards:** 12px padding, `surface-charcoal` background, subtle transition on hover (border color brightens).

### Remote Bar
- A specialized component that collapses the entire UI into a 48px height horizontal bar. Text is hidden; only primary icons and the miniaturized timeline remain visible.