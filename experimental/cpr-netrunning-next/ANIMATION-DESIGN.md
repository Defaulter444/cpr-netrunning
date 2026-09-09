# Netrunning Lab 0.5 — motion design for Foundry VTT v12

The Lab is a Foundry **Application window**, not a PIXI effect package. Motion therefore uses ordinary DOM/CSS/Web Animations plus Foundry render hooks, without fighting the Scene canvas or running a second render loop.

## Design rules

1. **Animation follows state truth.** The runtime changes first; motion only explains what already happened.
2. **No fake combat.** A visual effect never stands in for an unresolved RED mechanic.
3. **No permanent JS loop.** Continuous decorative motion is optional CSS; event motion is short-lived.
4. **Foundry-window safe.** Effects tolerate resize, scroll, map zoom and window repositioning.
5. **Reduced motion wins.** Client Reduce Motion and `prefers-reduced-motion` disable decorative animation.
6. **Context before spectacle.** A Black ICE banner exists only while the player actually has to resolve that encounter.

## Motion presets

### Off
No decorative or transition animation. Mechanical colors, icons and controls remain.

### Subtle — default
Short state transitions:

- confirmed NET movement: route packet + arrival pulse;
- unknown → known: decrypt transition;
- new Breach / Eye-Dee / Control / Virus state: short pulse;
- NET Action spend/reset: pip response;
- Program REZ/DEREZ: row response;
- new Black ICE encounter: current-floor threat wake;
- failed SPEED / stealth encounter: impact feedback while the GM effect gate appears;
- Black ICE pursuit begins: short lock pulse;
- successful Slide: pursuit-break pulse after the runner moves.

### Cinematic
Everything in Subtle plus low-intensity ambient NET flow, faint scan passes, and a gentle threat breathing effect on a current floor while Black ICE is following. These loops are CSS-only and encode no rules.

## Black ICE animation contract

0.5 deliberately couples motion to the encounter runtime:

`enter floor → encounter state → native roll → authoritative comparison → runtime state → render → animation`

The animation never starts the SPEED check, never decides who wins, never applies an ICE effect, and never moves the runner. It observes the resulting DOM state.

### SPEED
A triggered Black ICE produces a contextual banner. The current node receives a short threat pulse only after the runtime has actually created the pending encounter. A failed check produces an impact response and the explicit GM effect-resolution banner.

### Going Quiet
The same encounter slot changes visual language from red/threat to violet/stealth. Success simply clears the banner; failure transitions into normal threat state because stealth is actually broken by the runtime.

### Pursuit
Following ICE is represented by a compact PURSUIT strip and a controlled glow on the current NET floor. In Cinematic mode that glow breathes slowly. There is no animated sprite continuously flying behind the runner because that would add noise to a Foundry window and imply a physical simulation that the rules do not need.

### Slide
A successful Slide first resolves the opposed roll and mandatory adjacent move. Only after the new runtime state renders does the current node get the pursuit-break animation. The escaped ICE remains at the previous virtual floor in runtime; animation does not teleport it.

## Existing Foundry v12 implementation

- `scripts/animations-v04.js` — generic map/status/program motion.
- `styles/animations-v04.css` — generic state motion and Cinematic ambient flow.
- `scripts/animations-v05.js` — encounter/pursuit/Slide state diff.
- `styles/v05.css` — encounter presentation and Black ICE transition keyframes.

`Element.animate()` is used only for bounded route packets. The module does not use `setInterval()` or a game-loop-style animation scheduler.

## Still intentionally unanimated

Until corresponding rules are fully implemented and live-tested:

- Black ICE normal Turn attacks and damage/effect automation;
- Zap and Program combat;
- unsafe Jack Out consequences;
- Watcher active-search lifecycle.

Those mechanics may gain animation later, but only after the same rule → native roll → authoritative state → projection chain is complete.
