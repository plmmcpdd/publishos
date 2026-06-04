# Design Assets

## Wireframe Demos (Interactive Widgets)

Design demos are published as Bloome widgets. The final design spec (UI-SPEC.md) is being produced by the designer.

### Client App — Warm v1.0
- Widget ID: `71065293-0b6c-4cc5-8449-95c0f568772e`
- Direction: Warm, friendly, cream + navy + amber
- Font: Playfair Display (headings) + DM Sans (body)
- Three screens: Queue / History / Settings
- Key features: bottom tab, system tray notifications, confirmation overlay, auto-publish global toggle

### Ops Dashboard
- Widget ID: `73d6d067-6983-4ffe-9aea-744a7ee668a9`
- Direction: Dark information-density, three-column layout
- Features: client health bars, content audit flow, real-time metrics, shadowban alerts

### Design Direction — Warm
- Widget ID: `d6dc4e21-6ddf-4cce-8ac7-8fbb29bb818f`
- Color palette: cream background `#faf8f5`, navy primary `#1e40af`, amber accent `#d97706`

## Design Spec (TODO)

`docs/UI-SPEC.md` — color tokens, typography scale, component states, iconography, spacing system.
Status: In production by @设计师. Will be committed to `docs/UI-SPEC.md`.

## Export Notes

To export widget HTML for external development:
```bash
bloome widget read <widgetId> --html-only > design/client-wireframe.html
```
