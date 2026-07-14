# Cyberpunk RED — Netrunning Suite

Immersive NET architecture builder and netrunning interface for the **Cyberpunk RED** system (`cyberpunk-red-core`) on **FoundryVTT v12**.

![Foundry v12](https://img.shields.io/badge/Foundry-v12-informational)

## Features

### For the GM
- **Architecture file manager** — folders (nested), architecture files: create, rename, duplicate, delete, drag-to-move, JSON export/import. Folder open/closed state is stored per world.
- **Architecture editor** — chain of floors: floor type (Password / File / Control Node / custom), DV, description, reorder/insert/delete floors. Up to **3 Black ICE** per floor and up to **1 Demon** per floor with a global cap of 1 Demon per 6 floors.
- **Actor-backed entities** — every Black ICE / Demon placed in an architecture is a real Actor (system types `blackIce` / `demon`) auto-created in the `NET Architectures/<arch>` folder, seeded with rulebook stats and system icon art. Double-click a chip to open its native sheet; current REZ lives on the actor and syncs live for every client.
- **Tabs** — open several architectures like files in a code editor; connect players (they land on floor 1 and auto-spend 1 NET action for Jack In).
- **NPC netrunners** — drag any actor with an equipped cyberdeck into the right slide-out panel and run them like a player.
- **Entity action panel** — select any ICE/Demon: Attack / Defense / Speed / Perception / Damage / Effect rolls through the system's own roll pipeline (dialogs, crits, Dice So Nice), plus REZ management. Demons act with 1d10+Interface and post their static Combat Number.
- **Auto-roll** (setting) — GM-controlled ICE / Demons / NPC runners automatically roll their defense against player attacks; a HIT/MISS comparison card is posted (ties favor the defender).

### For players (actor with an equipped cyberdeck)
- Toolbar chip icon opens the suite; you see the architecture the GM connected you to.
- **NET actions per turn** from Interface rank (1–3 → 2, 4–6 → 3, 7–9 → 4, 10 → 5), with pips, combat-turn auto-reset, Jack In/Out.
- All interface abilities (Backdoor, Cloak, Control, Eye-Dee, Pathfinder, Scanner, Slide, Virus, Zap + Speed/Defense) — every roll is the system's native 1d10 + Interface roll.
- **Programs** — activate/deactivate (1 NET action; deactivation restores REZ), attackers auto-derez after their damage roll, rezzed Black ICE programs appear in the architecture and act like regular ICE under your control.
- Click to select, hover + **T** (or right-click) to target — targets are visible to everyone.

### Spectators
Players without a cyberdeck can join as spectators (world setting), watching what runners see; optional free movement between occupied architectures.

### Presentation
- Pan/zoom camera (wheel-anchored zoom, drag pan), animated data-flow links between floors, Matrix glyph rain, CRT scanlines.
- **4 themes**: green (phosphor Matrix), red, amber, blue — client setting.
- Full **English + Русский** localization.

## Requirements
- FoundryVTT v12
- System: `cyberpunk-red-core` (built against v0.92.x)

## Development
- `node tools/verify.mjs` — static verification (syntax, i18n parity, template/action cross-refs, CSS balance).
- Architecture/contracts: see `SPEC.md`.
