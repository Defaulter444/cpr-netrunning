# Netrunning Lab 0.4 — motion design for Foundry VTT v12

This module is a Foundry **Application window**, not a PIXI canvas effect package. The animation layer therefore uses browser-native DOM/CSS/Web Animations APIs and Foundry render hooks instead of fighting the Scene canvas.

## Design goals

1. **Animation follows truth.** Motion is triggered only by state that already changed: current NET floor, discovered node, NET Action pips, node status, or Program REZ state.
2. **No fake combat.** There is no attack flash, damage number, Slide trail, or Black ICE pursuit animation until the matching RED resolver exists.
3. **No permanent JS animation loop.** Continuous decorative motion is CSS-only and exists only in the optional Cinematic preset. JavaScript reacts to Foundry/Application renders and short state transitions.
4. **Foundry window safe.** Route packets use viewport coordinates so Foundry's resizable window, scroll container and map zoom do not distort their path. The effect is visual only; the actual position still comes from the runtime projection.
5. **Accessible by default.** `Reduce Motion` and the OS/browser `prefers-reduced-motion` setting force motion off. The default preset is Subtle, not Cinematic.

## Presets

### Off
No decorative or transition motion. Layout, colors, status icons and all controls remain fully functional.

### Subtle — default
Short event animations only:

- confirmed NET movement: small route packet + arrival pulse;
- unknown → known node: decrypt/reveal transition;
- new Breached / Eye-Dee / Control / Virus state: status pulse;
- NET Action spend/reset: pip feedback;
- Program REZ/DEREZ: program-row feedback.

### Cinematic
Everything in Subtle plus deliberately slow ambient motion:

- low-intensity data flow on topology lines;
- a faint scan pass through the NET map;
- gentle breathing glow on the runner's current node.

None of those continuous effects encode mechanical state.

## Foundry VTT v12 implementation

The layer lives in:

- `scripts/animations-v04.js`
- `styles/animations-v04.css`

It hooks `renderApplication` / `renderNetrunningLabApp`, snapshots the freshly rendered cockpit and compares it with the previous render for that Application instance. The first render never animates every node by accident.

The route packet is a short `Element.animate()` call and removes itself when finished. Continuous ambient effects are pure CSS keyframes. There is no `setInterval` game loop.

## Rules safety added in the same pass

Control Node scene execution now reserves the once-per-Turn activation and spends its NET Action **before** mutating the linked Foundry Wall/Token/Tile/Light/Sound. If the Scene Document update throws, the reservation and NET Action are rolled back. This prevents a second activation from changing meatspace and only then being rejected.

## What still does not animate

Until the corresponding full RED mechanics are implemented and live-tested:

- Slide;
- Zap / NET damage;
- Black ICE Speed/initiative/follow lifecycle;
- unsafe Jack Out effects;
- Watcher search lifecycle.

The UI continues to hide those unfinished actions instead of implying that a visual effect equals correct automation.
