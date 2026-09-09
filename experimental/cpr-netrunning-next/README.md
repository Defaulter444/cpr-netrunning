# Cyberpunk RED: Netrunning Lab 0.3

Experimental **sidecar module** for `cpr-netrunning`. It is deliberately isolated from production saves so the UX and runtime can be tested without touching the working module.

- module id: `cpr-netrunning-next`
- Foundry VTT: 12.343
- Cyberpunk RED - CORE: 0.92.4
- production `cpr-netrunning`: read-only source for an imported copy

## 0.3 goal: rules-first cockpit

0.2 proved the contextual RUN / BUILD / PLAYER VIEW structure. 0.3 refines it instead of adding another permanent panel.

The permanent surface remains small:

- **map** = what exists in the NET and what the runner currently knows;
- **session strip** = runner, equipped Cyberdeck, Interface, NET Action budget, Jack state;
- **action dock** = only actions that make sense in the current context;
- **inspector** = details for the selected node;
- **program drawer** = collapsible, not always visible.

New 0.3 map tools are floating and optional: Fit, zoom, inspector collapse, Focus Mode and Help. Mouse/keyboard navigation is intentionally closer to a tactical-map workflow than a form-heavy admin panel.

Keyboard shortcuts while the Lab has focus:

- `F` — fit the NET Architecture;
- `[` / `]` — zoom;
- `P` — Programs drawer;
- `I` — inspector;
- `?` — rules/controls help;
- `Space + drag` or middle mouse drag — pan;
- `Alt+1 / Alt+2 / Alt+3` — GM RUN / BUILD / PLAYER VIEW.

## Design policy

**More capability must not mean more permanent chrome.**

- Foundry Document configuration lives in BUILD.
- Scene bindings live in BUILD and appear in RUN only after the runner owns that Control Node.
- DV is a GM-intel overlay, not ordinary player information.
- unavailable combat mechanics are hidden instead of disabled-but-mysterious buttons.
- small windows can collapse the inspector or enter Focus Mode without losing the action dock.
- themes use original SVG/CSS assets: REDLINE, NEON and MONO.
- visible keyboard focus and reduced-motion modes are first-class behavior.

## Rules policy

The module does not copy game math into random UI handlers. Native Cyberpunk RED rolls go through `cyberpunk-red-core`; state rules are isolated and tested.

Important 0.3 hardening:

1. **Control Node use is once per Turn.** Taking the node and activating its connected system remain separate NET Actions, and a second activation of the same node in the same Turn is rejected before an action is spent.
2. **Going Quiet plain Interface Check is truly plain.** 0.2 used Scanner as a technical carrier. 0.3 builds CPR's native `CPRInterfaceRoll` directly so Scanner-specific modifiers cannot contaminate the check. If the exact CPR internals are unavailable, it fails closed and asks for manual adjudication instead of inventing a result.
3. **Scanner stays meatspace-only.** It is not presented as an action inside a NET Architecture.
4. **Slide / Zap / unfinished Black ICE combat remain hidden** until their complete opposed resolver, destination/damage flow and lifecycle are implemented. The Lab does not pretend that a partial implementation is rules-correct.

See [RULES-MATRIX.md](RULES-MATRIX.md) for the automation status of each relevant rule.

## Current rules-aware runtime

Implemented now:

- Interface action bands 2 / 3 / 4 / 5 from rank;
- strict `total > DV` checks;
- native CPR Interface dialogs, modifiers, LUCK, crits and chat cards;
- Jack In / safe Jack Out costs;
- Quiet Jack In cost and Watcher contest model from Going Quiet;
- free adjacent virtual movement;
- branch-aware topology and blocked descent through unresolved obstructions;
- Pathfinder branch reveal without leaking DV;
- Backdoor, Eye-Dee, Control, Cloak and Virus state;
- Virus only at a branch bottom;
- per-Turn NET Action reset from Foundry Combat;
- Control Node physical actions as separate NET Actions and once-per-Turn activation;
- multiple runner records in one Architecture;
- architecture reset only after no connected friendly runner remains Jacked In;
- player-specific sanitized projections.

Not falsely automated yet:

- complete Black ICE Speed / encounter / follow lifecycle;
- full Slide opposed flow and destination picker;
- Zap opposed flow + damage;
- Program combat end-to-end;
- unsafe Jack Out effects;
- full Watcher active-search lifecycle.

## Privacy model

Full Architecture and live runtime remain in a GM-only JournalEntry:

`[CRNS LAB] Private Store`

Each player receives a separate projection document. Unknown nodes contain only minimum topology. Hidden DV, GM notes, hidden content, private attachments and Scene-control configuration never enter that projection.

Player mutations are validated by the authoritative GM. Secure transport uses ECDH P-256 + AES-GCM when WebCrypto is available. Without secure transport, the module does not silently downgrade player write trust: unsafe remote mutations remain unavailable while the GM can continue local testing.

## Foundry integration

BUILD supports real Foundry Documents:

- JournalEntry;
- JournalEntryPage;
- Item;
- Wall door;
- Token;
- Tile;
- AmbientLight;
- AmbientSound.

RUN shows only contextual actions. For example, a door binding does not appear just because it exists: the selected runner must control the corresponding Control Node.

## Installation

From branch `experiment/netrunning-next`, copy:

`experimental/cpr-netrunning-next`

into:

`Data/modules/cpr-netrunning-next`

Restart Foundry and enable **Cyberpunk RED: Netrunning Lab**. Production `cpr-netrunning` can remain enabled; module ids and stores are separate.

## Test sequence

1. BUILD → Import Copy or Demo.
2. Add an Actor with active Interface Role and equipped Cyberdeck.
3. RUN → Jack In.
4. Check free adjacent movement and blocked descent through an undefeated obstruction.
5. Use Backdoor / Eye-Dee / Pathfinder and verify native CPR chat cards.
6. PLAYER VIEW → confirm hidden DV/notes/content are absent, not merely CSS-hidden.
7. BUILD → attach a Journal/Item and bind a Scene door to a Control Node.
8. RUN → take Control, operate the device once, then confirm a second activation in the same Turn is rejected without spending an action.
9. Advance Foundry Combat to the Netrunner and confirm the NET Action pool refreshes.
10. Try Fit/zoom/pan, inspector collapse, Focus Mode and keyboard navigation at both 1240px and the 860px minimum window.

## Checks

```bash
node experimental/cpr-netrunning-next/tools/check.mjs
node experimental/cpr-netrunning-next/tools/test-v03.mjs
```

The experiment stays in a draft PR until real Foundry 12.343 multiplayer acceptance testing passes. `master` is not the test bench.
