# PublishOS UI Specification

> **Version:** 1.0  
> **Date:** 2024-06-04  
> **Aesthetic Direction:** Warm Professional — "A trusted assistant, not a machine"  
> **Target Audience:** US small business owners (HVAC, plumbing, roofing, AI startups)

---

## 1. Design Philosophy

**The product is a partner, not a tool.** Blue-collar customers operate in high-trust environments — they buy from people they know. The interface must feel:

- **Approachable** — no intimidating tech jargon, no harsh industrial aesthetics
- **Reliable** — consistent, predictable, never surprising in a bad way
- **Transparent** — AI labels, compliance controls, and status are visible upfront
- **Warm** — colors borrowed from physical environments (cream paper, trusted blue, warm amber) rather than digital neon

**Reference products:** Notion (clean warmth), Cron (friendly precision), Linear (trustworthy density without coldness)

**Anti-reference:** Brutalist dashboards, dark-mode developer tools, gradient-heavy SaaS templates

---

## 2. Color System

### 2.1 Core Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#faf8f5` | App background — warm cream, never pure white |
| `--surface` | `#ffffff` | Cards, panels, modals |
| `--surface-hover` | `#f5f3ef` | Hover states, subtle elevation |
| `--surface-warm` | `#fdf8f0` | Highlighted sections, warm accents |
| `--border` | `#e8e4de` | Dividers, input borders |
| `--border-light` | `#f0ece6` | Card borders, subtle separation |

### 2.2 Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#1f2937` | Headlines, body text, labels |
| `--text-secondary` | `#6b7280` | Descriptions, meta data, captions |
| `--text-muted` | `#9ca3af` | Placeholders, disabled states, timestamps |

### 2.3 Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent-primary` | `#1e40af` | Primary buttons, active states, links, brand identity |
| `--accent-primary-light` | `#3b82f6` | Primary hover, progress bars, emphasis |
| `--accent-warm` | `#d97706` | Schedule indicators, attention badges, warm highlights |
| `--accent-success` | `#059669` | Published, online, healthy status |
| `--accent-success-light` | `#d1fae5` | Success background tint |
| `--accent-danger` | `#dc2626` | Failed, offline, disconnect, errors |
| `--accent-danger-light` | `#fee2e2` | Danger background tint |
| `--accent-warn` | `#b45309` | Pending, warning, needs attention |
| `--accent-warn-light` | `#fef3c7` | Warning background tint |

**Color Rules:**
- Primary buttons always use `--accent-primary` on white text — never inverted
- Status badges use light tints + solid text (e.g., green bg + green text) for gentle contrast
- Warm amber is used sparingly — only for time/schedule indicators, not for primary actions
- No gradients on buttons or backgrounds. Solid colors only.

---

## 3. Typography

### 3.1 Font Stack

| Role | Font | Weight | Fallback |
|------|------|--------|----------|
| Display / Headlines | Playfair Display | 600–800 | Georgia, serif |
| Body / UI | DM Sans | 400–700 | -apple-system, sans-serif |
| Data / Mono | DM Mono | 400–500 | SF Mono, monospace |

**Google Fonts import:**
```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 3.2 Type Scale

| Token | Size | Weight | Line-height | Usage |
|-------|------|--------|-------------|-------|
| `display-lg` | 22px | 700 | 1.1 | App title (topbar) |
| `display-md` | 18–20px | 700 | 1.2 | Card titles, setting labels |
| `display-sm` | 16px | 700 | 1.2 | History item titles, account name |
| `body` | 14–15px | 500–600 | 1.5 | Buttons, descriptions |
| `body-sm` | 12–13px | 500 | 1.4 | Meta text, descriptions |
| `caption` | 10–11px | 600 | 1.2 | Tags, badges, section labels |
| `mono` | 10–11px | 400–500 | 1.2 | Handles, timestamps, technical data |

**Typography Rules:**
- Display font (Playfair) is used ONLY for titles, never for body text or buttons
- Buttons use DM Sans in sentence case ("Publish to TikTok", not "PUBLISH TO TIKTOK")
- Section labels are uppercase, 1.5px letter-spacing, `--text-muted` color
- Data labels (monospace) are lowercase, never uppercase

---

## 4. Component Library

### 4.1 Buttons

| Variant | Background | Text | Border | Shadow | Radius | Hover |
|---------|-----------|------|--------|--------|--------|-------|
| Primary | `--accent-primary` | white | none | `0 2px 8px rgba(30,64,175,0.25)` | 8px | bg → `#3b82f6`, shadow deepens |
| Ghost | `--surface` | `--text-secondary` | `1px solid --border` | `--shadow-sm` | 8px | bg → `--surface-hover`, text darkens |
| Danger | `--accent-danger-light` | `--accent-danger` | `1px solid rgba(220,38,38,0.2)` | none | 8px | bg → `#fecaca` |

**Button Rules:**
- Minimum tap target: 44px height
- Padding: 14px vertical for full-width, 8px 14px for small
- Font: DM Sans, 15px (full-width) or 12px (small), weight 600
- No ALL CAPS. Sentence case only.
- Active state: `transform: translateY(1px)`

### 4.2 Cards

```css
background: var(--surface);
border-radius: 12px;
padding: 18px;
border: 1px solid var(--border-light);
box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02);
transition: all 0.2s ease;
```

**Card Hover:**
```css
box-shadow: 0 4px 12px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.02);
transform: translateY(-1px);
```

**Card Rules:**
- No sharp corners. All cards use 12px radius.
- Cards always have a subtle border — never borderless on light backgrounds
- Dimmer cards (upcoming content) use `opacity: 0.5` with preserved layout

### 4.3 Tags / Badges

```css
font-size: 10px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.3px;
padding: 4px 10px;
border-radius: 999px;
```

| Type | Background | Border | Text |
|------|-----------|--------|------|
| Default | `--border-light` | `1px solid --border` | `--text-secondary` |
| TikTok | `rgba(30,64,175,0.06)` | `rgba(30,64,175,0.15)` | `--accent-primary` |
| AI | `rgba(217,119,6,0.08)` | `rgba(217,119,6,0.2)` | `--accent-warm` |
| Status: Published | `--accent-success-light` | `rgba(5,150,105,0.15)` | `--accent-success` |
| Status: Failed | `--accent-danger-light` | `rgba(220,38,38,0.15)` | `--accent-danger` |
| Status: Pending | `--accent-warn-light` | `rgba(180,83,9,0.15)` | `--accent-warn` |

### 4.4 Toggles

```css
width: 44px;
height: 26px;
border-radius: 13px;
background: --border; /* off */
background: --accent-primary; /* on */
border: 1px solid --border;
transition: all 0.2s ease;
```

Knob:
```css
width: 20px;
height: 20px;
border-radius: 50%;
background: white;
box-shadow: 0 1px 3px rgba(0,0,0,0.15);
transition: left 0.2s ease;
/* off: left: 2px; on: left: 20px */
```

### 4.5 Thumbnails

```css
width: 72px; /* card */ or 48px; /* history */
height: 96px; /* card */ or 48px; /* history */
border-radius: 8px;
background: linear-gradient(135deg, #f0ece6 0%, #e8e4de 100%);
```

**Thumbnail Rules:**
- Video items show a play overlay (semi-transparent dark + white triangle)
- Image items show the actual image (cropped cover)
- Missing media shows a generic media icon (SVG)
- No border on thumbnails — the gradient bg provides visual separation

### 4.6 Overlay / Modal

```css
background: rgba(31, 41, 55, 0.6);
backdrop-filter: blur(8px);
```

Modal card:
```css
background: var(--surface);
border-radius: 16px;
padding: 24px;
box-shadow: 0 12px 32px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02);
animation: slideUp 0.25s ease;
```

**Overlay Rules:**
- Always slides up from bottom (mobile pattern, works on desktop too)
- Title uses Playfair Display, 22px
- Description uses DM Sans, 14px, `--text-secondary`
- Two buttons side by side: Ghost (Cancel) + Primary (Confirm)
- No X close button — tap outside or Cancel to dismiss

---

## 5. Iconography

**Style:** Outline stroke icons, 2px stroke width, rounded caps and joins. No filled icons.

**Size:** 20px for tab bar, 24px for overlay icons, 18px for history thumbnails.

**Color:** Inherits from parent (`currentColor`). Active tabs: `--accent-primary`. Inactive: `--text-muted`.

**Icon Set:** Use a consistent icon library (e.g., Feather Icons or Lucide). Do not mix styles.

| Icon | Usage |
|------|-------|
| Grid (4 squares) | Queue tab |
| Clock with arrow | History tab |
| Gear | Settings tab |
| Play triangle | Video overlay |
| Checkmark | Success states, published status |
| Alert circle | Failed status, warnings |
| Clock | Pending status |

---

## 6. Screen Specifications

### 6.1 Screen 1: Queue (Tab 1)

**Purpose:** The primary screen. Customer sees content waiting for their approval and approves it with one tap.

**Layout:**
- Top: Auto-publish toggle bar (full width, inside content area)
- Section: "Pending approval" + count
- List: Cards with video thumbnail, title, schedule, tags, and a full-width primary button
- Section: "Upcoming" (dimmed, non-interactive)

**Interactions:**
- Tap "Publish to TikTok" → Overlay slides up with confirmation
- Tap "Cancel" → Overlay dismisses, no action
- Tap "Open browser" → App opens system browser to TikTok.com, toast confirms
- Toggle auto-publish → All pre-reviewed content bypasses this screen

**Card Structure (per item):**
```
[Thumbnail 72x96] [Title]       [Schedule dot + time]
                  [Tag: TikTok] [Tag: AI-generated]

[Button: Publish to TikTok — full width]
```

### 6.2 Screen 2: History (Tab 2)

**Purpose:** Review past published content and check status.

**Layout:**
- Section: "Last 7 days"
- List: Compact rows with small thumbnail, title, meta, status badge
- Bottom: "Load more" ghost button

**Status Badges:**
- Done → green pill
- Failed → red pill
- Pending → amber pill

**Interactions:**
- Tap a failed item → opens overlay with retry option (if supported by platform)
- Pull-to-refresh (if native) or tap "Load more" to fetch older items

### 6.3 Screen 3: Settings (Tab 3)

**Purpose:** Account connection, automation preferences, compliance controls.

**Layout:**
- Account card: Avatar (initial), business name, handle, online status
- Section: Automation (3 toggles)
- Section: Compliance (1 toggle)
- Danger zone: Disconnect button

**Toggles:**
1. **Auto-publish** — Skip approval for pre-reviewed content
2. **Desktop notifications** — System tray alerts for new content
3. **Sound alerts** — Audio notification
4. **AI content label** — Always mark AI-generated posts (FTC compliance, locked ON by default)

**Interactions:**
- Toggle tap → instant state change with haptic feedback (if available)
- "Disconnect account" → confirmation overlay before proceeding
- Account status dot → green (online) / gray (offline) / amber (warning)

---

## 7. Shadows & Elevation

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)` | Cards at rest |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.02)` | Cards on hover, dropdowns |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)` | Overlays, modals, toasts |

**Shadow Rules:**
- No colored shadows (no blue or purple tints)
- Shadows are soft and subtle — the interface should feel grounded, not floating
- The `0 0 0 1px` inset border in shadow simulates a hairline border without actual CSS border

---

## 8. Spacing & Layout

### 8.1 Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `space-xs` | 4px | Tight gaps, tag spacing |
| `space-sm` | 8px | Icon gaps, toggle padding |
| `space-md` | 12–14px | Card internal gaps, history rows |
| `space-lg` | 16–18px | Card padding, section gaps |
| `space-xl` | 20–24px | Section separation, modal padding |
| `space-2xl` | 32px | Major section breaks |

### 8.2 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 8px | Buttons, thumbnails, input fields |
| `--radius-md` | 12px | Cards, panels, content containers |
| `--radius-lg` | 16px | Overlays, modals |
| `--radius-full` | 999px | Tags, badges, toggles, status pills, avatars |

### 8.3 Layout Grid

- Content area: 16px horizontal padding
- Cards: full-width with internal 18px padding
- No sidebar navigation on mobile. Bottom tab bar only.
- Desktop (Electron): constrain max-width to 480px centered, or allow responsive expansion for Settings screen

---

## 9. Animation & Motion

### 9.1 Principles
- **Subtle:** Motion should be noticed only when it guides attention, not for decoration
- **Fast:** All transitions under 250ms. No slow fades.
- **Purposeful:** Animations indicate state change (screen switch, hover, toggle, toast)

### 9.2 Standard Transitions

| Element | Duration | Easing | Property |
|---------|----------|--------|----------|
| Screen switch | 200ms | `ease` | `opacity` + `translateY(6px)` |
| Card hover | 200ms | `ease` | `transform` + `box-shadow` |
| Button press | 100ms | `ease` | `transform: translateY(1px)` |
| Toggle | 200ms | `ease` | `left` (knob) + `background` |
| Overlay enter | 150ms | `ease` | `opacity` |
| Overlay card | 250ms | `ease` | `translateY(20px)` → `0` |
| Toast enter | 300ms | `ease` | `translateY(-12px)` → `0` |
| Toast exit | 200ms | `ease` | `opacity` → 0 (auto after 4s) |

### 9.3 No-Animation List
- Never animate layout properties (`width`, `height`, `margin`, `padding`) — causes jank
- Never use spring/bounce physics — feels unprofessional for this audience
- Never animate color transitions on buttons — instant is better

---

## 10. Platform-Specific Notes (Electron)

### 10.1 Window Chrome
- Frameless window with custom title bar (Playfair Display "PublishOS" + close/minimize buttons)
- Title bar background: `--surface` with bottom border `--border-light`
- Window size: 400px × 720px (phone-like aspect ratio)
- Minimum size: 360px × 600px
- No native menu bar (hide with Electron `autoHideMenuBar: true`)

### 10.2 System Tray
- Tray icon: Simple "P" monogram in `--accent-primary` on white bg
- Tray tooltip: "PublishOS — X items pending"
- Left-click: Show/hide window
- Right-click: Context menu with "Show", "Quit", "Settings"
- New content notification: Native notification (not custom) with title "New content ready" and body "Tap to review and publish"

### 10.3 Browser Integration
- "Publish to TikTok" opens the user's default browser (not an in-app WebView)
- Browser URL: `https://www.tiktok.com/upload` with query params for pre-filled content
- After upload, user returns to app — no deep-link required for v1

### 10.4 Auto-Launch
- Register app for auto-launch on login (Windows: registry, macOS: LaunchAgent)
- Setting in Settings tab: "Start on login" toggle

---

## 11. Accessibility

### 11.1 Contrast
- All text on `--surface` meets WCAG AA against `--text-primary` (7.5:1)
- `--text-secondary` on `--surface` meets WCAG AA (4.6:1)
- Primary button white text on `#1e40af` meets WCAG AA (7.2:1)

### 11.2 Touch Targets
- All interactive elements: minimum 44px × 44px
- Buttons: full-width on mobile, comfortable padding on desktop
- Tab bar: 68px height with generous tap areas

### 11.3 Screen Reader
- Tab bar icons have `aria-label` on the button, not just the icon
- Card buttons have descriptive labels: "Publish Summer HVAC Tune-Up Tips to TikTok"
- Toggle labels are programmatically associated with the switch
- Status badges announce state: "Published successfully" or "Failed to publish"

---

## 12. Handoff Assets Checklist

For the external development team (Codex / Cursor / human), provide:

- [x] `UI-SPEC.md` (this document) — full design system
- [x] `publishos-client-v1.html` — interactive wireframe of all 3 screens
- [ ] `publishos-dashboard-v1.html` — warm version of ops dashboard (in progress)
- [ ] `design-tokens.css` — CSS variables export for direct use
- [ ] `icons/` — SVG icon set (Feather/Lucide subset used)
- [ ] `screenshots/` — static PNGs of each screen for quick reference

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-06-04 | Initial warm direction. Switched from industrial dark to warm professional. Added full component library, screen specs, Electron notes, accessibility baseline. |

---

*End of specification.*
