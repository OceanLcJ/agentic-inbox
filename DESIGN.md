---
name: Agentic Inbox
description: Compact Chinese project email workspace.
colors:
  primary: "var(--color-kumo-brand)"
  link: "var(--text-color-kumo-link)"
  base: "var(--color-kumo-base)"
  recessed: "var(--color-kumo-recessed)"
  hover: "var(--color-kumo-tint)"
  line: "var(--color-kumo-line)"
  ink: "var(--text-color-kumo-default)"
  muted: "var(--text-color-kumo-strong)"
  info-tint: "var(--color-kumo-info-tint)"
  owner: "light-dark(#9b6418, #e3b76a)"
  owner-tint: "light-dark(#fcf3e3, #302819)"
  resolved: "light-dark(#39775b, #8dc7a5)"
  resolved-tint: "light-dark(#edf5ef, #1e3027)"
  on-primary: "#fff"
typography:
  headline:
    fontFamily: "var(--font-sans)"
    fontSize: "23px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "var(--font-sans)"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "var(--font-sans)"
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontFamily: "var(--font-sans)"
    fontSize: "12px"
  metric:
    fontFamily: "var(--font-sans)"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
rounded:
  badge: "4px"
  button: "5px"
  control: "6px"
  panel: "8px"
  dialog: "10px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "18px"
  content: "20px"
  section: "24px"
  wide: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.base}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  field:
    backgroundColor: "{colors.base}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  nav-link:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  owner-badge:
    backgroundColor: "{colors.owner-tint}"
    textColor: "{colors.owner}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  metric-card:
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 14px"
  case-row:
    textColor: "{colors.ink}"
    padding: "15px 0"
---

# Design System: Agentic Inbox

## Overview

**Creative North Star: "项目邮件工作台"**

A compact Chinese workspace for reading project mail, deciding what needs attention, and reviewing processing history. The existing interface label supplies the north star: calm operational surfaces, short labels, readable records, and visible state.

The system extends Cloudflare Kumo with a persistent navigation shell and compact dashboard. Preserve its neutral surfaces, blue controls, system typography, and light/dark semantic variables. This document records the implemented workspace; `app/workspace.css`, `app/index.css`, and their corresponding components remain the source of truth.

**Key Characteristics:**

- Compact navigation and restrained, bordered surfaces.
- Four operational metrics with tabular numbers.
- Status color paired with a written label.
- Responsive list/detail navigation and constrained mail content.

## Colors

Kumo supplies the neutral light/dark palette and blue interaction colors. The frontmatter preserves semantic CSS variables so future screens inherit the active theme.

### Primary

- **Action Blue** (`primary`): filled actions, focus outlines, and the directory brand icon. Use the background brand token; Kumo's separately named text-brand token is orange.
- **Link Blue** (`link`): links, active navigation, processing state, and work metric values. It adapts independently from the filled-action color.
- **Information Tint** (`info-tint`): processing badges and text selection.

### Neutral

- **Workspace Surface** (`base`): main canvas, detail panels, inputs, and active desktop navigation.
- **Recessed Surface** (`recessed`): rail, quiet badges, project marks, and selected case rows.
- **Interaction Tint** (`hover`): subtle navigation and metric hover feedback.
- **Divider** (`line`): thin boundaries and inactive distribution segments.
- **Reading Ink** (`ink`): headings, subjects, body text, and values.
- **Supporting Ink** (`muted`): metadata, times, explanatory copy, and waiting-customer distribution segments.
- **On Action** (`on-primary`): text on filled blue buttons.

Owner attention uses `owner` with `owner-tint`; resolved state uses `resolved` with `resolved-tint`. These amber and green pairs describe status. Pending and waiting-customer badges remain neutral. Keep the written state alongside color.

**The Semantic Surface Rule.** Use Kumo semantic variables and the workspace status pairs for workspace surfaces; preserve their light/dark behavior.

## Typography

Use the inherited Tailwind system sans stack: `ui-sans-serif`, `system-ui`, `sans-serif`, followed by platform emoji fonts. The workspace has no custom display font.

- **Headline:** frontmatter `headline` for page titles; mobile workspace titles reduce to (21px).
- **Title:** frontmatter `title` for dashboard section headings. Case subjects use (13px, weight 600); detail titles use (17px, weight 600), reducing to (16px) on mobile.
- **Body:** frontmatter `body` establishes the shell. Summaries and forms mostly use (12–13px); constrained support mail uses (13px, line-height 1.9).
- **Label:** frontmatter `label` for compact labels. Metadata often uses (11px), dashboard badges (10px). Keep these smaller roles for short supporting text.
- **Metric:** frontmatter `metric` for dashboard counts; mobile reduces to (25px). Counts, timestamps, and pagination use tabular numerals.

## Layout

The shell fills the viewport (`100dvh`) with a separately scrollable content area and a desktop rail (182px). The rail scrolls vertically. Main workspace screens center within a maximum width (1440px), with desktop padding (25px 28px 40px).

The dashboard places four equal metric cards above two columns (`1.55fr 1fr`, gap 28px). Owner decisions and processing progress occupy the first; distribution and daily activity occupy the second. Empty states retain explanatory text and genuine zero counts.

- At **1100px and below**, screen padding becomes (24px), metric gaps become (10px), and dashboard column gaps become (24px). Open inbox detail uses `minmax(210px, .8fr) minmax(320px, 1.2fr)`.
- At **850px and below**, metrics become two columns and the dashboard becomes one column. An open support detail replaces the list and page heading; a visible back control returns to the list.
- At **650px and below**, the rail becomes a top header with four equal tabs. Active tabs gain a blue lower border. Tabs and workspace buttons have a minimum height (44px). Compose sits at the upper right; rail notes and embedded mailbox navigation are hidden. Content padding becomes (21px 18px 30px), and metric gaps become (8px).

The project directory inside the shell has a centered maximum width (1280px) with workspace padding overrides. Categories and shortcut views wrap horizontally above search and the project/account list. Rows have two columns on wide screens and stack at (760px); pagination wraps and centers its controls there. At (400px), some category icons and pagination words are hidden. Preserve these directory-specific transitions alongside the shell's (650px) rule.

Desktop inbox list/detail uses `minmax(230px, .85fr) minmax(360px, 1.2fr)` with a gap (25px). Long addresses and evidence wrap; mail tables scroll within their content area.

## Elevation & Depth

Workspace surfaces are flat. Depth comes from neutral tonal changes, one-pixel borders, selected backgrounds, and spacing. Cards and buttons have no decorative shadows. The native compose dialog has a translucent backdrop (`#0005`) and a bordered surface; it fits within `min(560px, calc(100vw - 28px))` and scrolls within `calc(100dvh - 30px)`.

**The Flat Workspace Rule.** Keep dashboard and reading surfaces flat; use the established tonal and border hierarchy to show grouping and state.

## Shapes

The form language is gently rounded and compact. Use the frontmatter radii for badges, buttons, controls, panels, and dialogs. Directory containers also use the dialog radius; directory view buttons use (7px). Health dots are circular; distribution legend marks are small squares with softened corners. Keep divider lines thin and borders intact around scrolling content.

## Components

### Buttons

Primary and secondary workspace buttons share (12px) text, line-height (1.5), and a minimum desktop height (35px); mobile buttons grow to (44px). Secondary hover uses the recessed surface; primary hover retains the brand background. Disabled workspace buttons use opacity (.5) and a default cursor. Focus-visible uses a brand outline (2px) with an offset (3px).

### Inputs / Fields

Inputs, selects, and textareas use the base surface, a one-pixel divider border, control radius, and (13px) text. Toolbar inputs are (40px) high; form textareas resize vertically. Search groups use a brand border on focus-within. Keep labels visible, allow toolbars to wrap or become a mobile grid, and preserve focus outlines and blue carets.

### Navigation

Desktop links pair an icon and short Chinese label with a minimum height (42px). Active links use the base surface, blue text, and weight (600); hover uses interaction tint. Mobile follows Layout's four-tab treatment. Desktop mailbox context embeds folder links and a switcher; narrow mailbox views retain a separate drawer for full mailbox controls.

### Chips

Compact status badges always include text. Owner, processing, and resolved use the amber, blue, and green treatments. Category filters and pagination use a base surface and blue text for selection. Keep `aria-current`, `aria-selected`, and pressed state aligned with visible state.

### Cards / Containers

Metric cards use the panel radius and a one-pixel divider border. The whole metric is a link with subtle hover feedback. Case lists use row dividers; subjects become blue on hover. Full rows show a two-line summary, project/domain metadata, timestamp, and status. Compact rows omit the summary and project mark.

### Mail / Detail

Support detail tabs have a minimum height (44px), blue selected text, and blue underline (2px). Constrained support mail retains paragraphs, emphasis, links, lists, quotes, and tables; sender styling and controls are excluded. Quotes use a thin left divider, long text wraps, and tables scroll. Preserve the boundary between mail content and workspace actions. The full mailbox reader retains its separate light iframe document and existing email styling.

### Health / Activity

Automation health is a compact disclosure with a status dot and latest-check time. Quiet checks and agent runs are distinct; the summary reflects the latest check, while expanded details retain run times. Warning states pair amber with explicit text. Activity rows align times in a narrow first column and descriptions with metadata in the second. Expanded evidence uses pre-wrapped text and long-token wrapping.

## Do's and Don'ts

### Do:

- **Do** preserve Kumo semantic variables and the inherited system font.
- **Do** retain the four-tab mobile navigation and the list/detail back path.
- **Do** pair status colors with text and show genuine zero and empty states.
- **Do** keep long mail, addresses, evidence, and pagination within their content bounds.
- **Do** preserve visible keyboard focus and honor reduced-motion preferences.

### Don't:

- **Don't** substitute decorative shadows for the workspace's border and tonal hierarchy.
- **Don't** use the orange Kumo text-brand token for the workspace's blue action role.
- **Don't** let sender-supplied mail styling redefine workspace controls or layout.
- **Don't** hide a selected detail's path back to its list on narrow screens.
