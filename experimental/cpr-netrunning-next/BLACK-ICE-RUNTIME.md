# Netrunning Lab 0.5 — Black ICE runtime state machine

This document exists because Black ICE is the first place where a pretty UI can very easily lie about Cyberpunk RED rules. The runtime, not the animation, is authoritative.

## 1. Trigger

A Netrunner enters a NET floor. The runtime resolves which Black ICE is physically on that virtual floor using `icePositions` (falling back to the authored node for ICE that has never moved).

For every active Black ICE that is not already following that runner:

- normal Netrunner → create `encounter{mode:"speed"}`;
- stealthed Netrunner → create `encounter{mode:"stealth"}`.

Normal Black ICE is immediately marked as pursuing and enters the top of the shared Foundry Combat queue. Stealth-mode ICE does neither until it actually detects the runner.

## 2. Immediate opposed check

### Normal

Netrunner: native Interface SPEED roll.

Black ICE: native SPD roll.

The check exists only to determine whether the Black ICE receives its immediate effect. It is **not Initiative**. A tie protects the defending Netrunner.

The Black ICE remains in the Initiative Queue and follows whether the SPEED check succeeds or fails.

### Going Quiet

Netrunner: native Interface + Cloak modifiers.

Black ICE: native PER.

The Netrunner must strictly beat the ICE.

Success means the ICE never detected the runner: no Initiative entry, no pursuit, and that successful pass does not mark the ICE as encountered for unsafe Jack Out purposes.

Failure breaks stealth, creates the same immediate-effect state as failed SPEED, queues the ICE, and causes the other Black ICE on that floor to react normally.

## 3. Immediate effect gate

Black ICE effects are heterogeneous. Some damage brain HP, some destroy Programs, some change future NET Actions, some force an unsafe disconnect, some create meatspace conditions.

0.5 therefore stores a `freeIceEffects` record and pauses unrelated NET actions until the GM applies the actual effect from the Actor/card and confirms it.

This is deliberately less automatic than guessing.

Future versions can replace individual manual effect gates only when that ICE type has a tested effect adapter.

## 4. Pursuit

`runner.engagedIceRefs` identifies ICE following a Netrunner.

`runtime.icePositions[ref]` stores where each mobile ICE currently is.

Whenever the Netrunner moves, every engaged ICE moves to the same virtual floor before new floor encounters are registered.

The authored Architecture is not destructively rewritten just because ICE is chasing someone.

## 5. Slide

Slide is only valid against one non-Demon Black ICE already following the runner.

Before the roll, the player chooses a destination from adjacent, normally accessible floors. This avoids the bad UX of succeeding at Slide and only then discovering there is nowhere legal to go.

Netrunner must strictly beat Black ICE PER. Slide is only attempted once per Turn and spends 1 NET Action.

On success:

1. pursuit is removed for that ICE;
2. the Netrunner immediately moves to the chosen adjacent floor;
3. the escaped ICE remains at the old floor and lays in wait there;
4. if the runner later returns, the ICE can trigger again.

Other ICE still pursuing the runner continue to follow through the Slide movement.

## 6. Initiative in Foundry VTT v12

Cyberpunk RED uses the same Initiative Queue for meatspace and NET combat. Black ICE does not roll normal Initiative; when triggered it moves to the top.

The Lab therefore creates/reuses a Foundry Combatant for the Black ICE and raises it above the current maximum initiative. The Netrunner remains a normal Combatant using REF initiative.

This specific interaction must still be acceptance-tested live because Foundry re-sorts Combatants while a Turn may already be active.

## 7. Projection/privacy

Players receive only sanitized encounter information:

- encounter id;
- Black ICE display name/ref;
- SPEED vs stealth mode;
- whether an immediate effect is pending;
- which known ICE is currently pursuing them.

Actor IDs, hidden DVs, GM notes, and unrelated Architecture data remain private.

## 8. Still missing

0.5 does not claim to automate:

- ordinary Black ICE attack Turns;
- Black ICE effect application;
- Zap/Program combat;
- unsafe Jack Out effect fan-out;
- Watcher active search.

Those are the next runtime layers. They should reuse this state machine instead of creating a separate combat subsystem.
