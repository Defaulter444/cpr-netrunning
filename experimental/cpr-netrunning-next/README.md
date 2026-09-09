# Cyberpunk RED: Netrunning Lab 0.5

Experimental **sidecar module** for `cpr-netrunning`. It is deliberately isolated from production saves so UX, rules and multiplayer behavior can be tested without touching the working module.

- module id: `cpr-netrunning-next`
- Foundry VTT: **12.343**
- Cyberpunk RED - CORE: **0.92.4**
- production `cpr-netrunning`: read-only source for **Import Copy**

## 0.5 — Black ICE becomes a real runtime state

0.3 built the rules-first cockpit. 0.4 added Foundry-safe motion. 0.5 tackles the first combat lifecycle instead of adding decorative combat buttons.

A Black ICE encounter is now a blocking state that must actually resolve before the Netrunner can continue doing unrelated NET Actions.

### Normal Black ICE encounter

When a Netrunner enters a floor containing active Black ICE:

1. the Black ICE is triggered and begins following the Netrunner;
2. it enters the top of the shared Foundry Combat initiative queue;
3. the cockpit shows a contextual **SPEED CHECK** banner instead of adding a permanent combat panel;
4. the Netrunner rolls the native CPR Interface SPEED check, including normal modifiers/LUCK/crits;
5. the Black ICE rolls native SPD;
6. a tie protects the defending Netrunner from the immediate effect;
7. on failure, the immediate ICE effect becomes an explicit GM-resolution state and the run cannot silently continue past it.

The module does **not** guess how every Black ICE effect should mutate a Character. Effects include damage, Program destruction, fire, forced unsafe Jack Out and other behavior. Until each effect has a verified implementation, the GM opens the actual ICE sheet/card, applies the effect, then clicks **Effect resolved**. This is deliberate rules safety, not missing UI polish.

### Going Quiet + Black ICE

A stealthed Netrunner encountering Black ICE does not use SPEED. The Lab now follows Going Quiet v1.1:

- native Interface + Cloak bonuses vs Black ICE PER;
- success: ICE does not detect the runner, never enters Initiative, and is not marked encountered from that successful pass;
- failure: stealth breaks, the failed ICE immediate effect resolves as a failed SPEED Check, the ICE enters the top of Initiative, and other Black ICE on that floor react normally.

### Pursuit

Black ICE that has engaged a Netrunner now has a virtual runtime position independent of the authored floor definition.

- pursuing ICE follows the runner between NET floors;
- the action dock shows a compact **PURSUIT** strip only while something is following;
- clicking the pursuing ICE makes it the current target;
- the current node gets a subtle threat state rather than another permanent sidebar.

### Slide

Slide is no longer hidden because its complete action flow now exists:

- valid target = one non-Demon Black ICE currently following the Netrunner;
- costs 1 NET Action;
- only one Slide attempt per Turn;
- player chooses the adjacent destination **before** rolling;
- destination must be normally reachable and cannot cross a NET obstruction;
- native Slide roll vs native Black ICE PER;
- the Netrunner must strictly beat PER; ties stay with the ICE;
- success immediately moves the Netrunner to the chosen adjacent floor;
- escaped ICE remains on the floor where pursuit broke and lays in wait there;
- returning to that floor can trigger the ICE again.

## Control Node correction retained from 0.4

A Control Node and a device behind it are not the same action:

- taking Control costs a NET Action;
- activating the controlled node/device costs another NET Action;
- **each Control Node can be activated only once per Turn**;
- the activation is reserved before Foundry changes a Wall/Token/Tile/Light/Sound;
- if the Scene Document update throws, the activation reservation and spent NET Action are rolled back.

0.5 intentionally keeps the 0.4 Control runtime instead of replacing it inside the Black ICE code.

## Foundry VTT v12 UI philosophy

The Lab is a resizable Foundry **Application window**, not a replacement Scene canvas.

Permanent UI remains small:

- **map** — NET topology and known state;
- **session strip** — Netrunner, Cyberdeck, Interface, NET Actions and Jack state;
- **action dock** — only currently relevant actions;
- **inspector** — selected node details;
- **program drawer** — collapsible;
- **encounter banner** — exists only while an immediate Black ICE check/effect is unresolved.

Map controls remain floating: Fit, zoom, inspector collapse, Focus Mode and Help.

Keyboard:

- `F` — Fit;
- `[` / `]` — zoom;
- `P` — Programs;
- `I` — inspector;
- `?` — help;
- `Space + drag` / middle mouse — pan;
- `Alt+1 / Alt+2 / Alt+3` — GM RUN / BUILD / PLAYER VIEW.

## Motion

Motion remains optional and tied to state truth.

**Off** — no decorative motion.

**Subtle** — default:

- route packet on confirmed movement;
- decrypt/reveal transition;
- state/pip/Program feedback;
- Black ICE wake/engagement pulse;
- failed immediate-effect impact;
- successful Slide pursuit-break pulse.

**Cinematic** adds low-intensity topology flow and threat breathing, but no animation creates or resolves a rule.

`Reduce Motion` and `prefers-reduced-motion` disable decorative animation.

## Existing rules-aware runtime

Already automated/tested:

- Interface action bands 2 / 3 / 4 / 5;
- strict `total > DV`;
- native CPR Interface dialogs, modifiers, LUCK, crits and chat cards;
- Jack In / safe Jack Out;
- Quiet Jack In and Watcher contest;
- free adjacent virtual movement;
- branch-aware topology and obstruction gating;
- Pathfinder without leaking DV;
- Backdoor, Eye-Dee, Control, Cloak and Virus state;
- Virus only at a branch bottom;
- per-Turn NET Action reset from Foundry Combat;
- Control Node once-per-Turn activation;
- Black ICE initial SPEED encounter;
- Going Quiet Black ICE Cloak-vs-PER encounter;
- Black ICE pursuit position;
- Slide opposed flow + mandatory adjacent move;
- multiple Netrunners in one Architecture;
- player-specific sanitized projections.

Still **not** claimed complete:

- Black ICE normal Turn attacks / DEF / damage/effect lifecycle;
- automatic application of every Black ICE effect;
- unsafe Jack Out effects from all encountered/rezzed hostile ICE;
- Zap end-to-end damage flow;
- full Program-vs-Program / Program-vs-Netrunner combat;
- Watcher active Pathfinder search once per Turn;
- live multiplayer acceptance testing on Foundry 12.343.

See [RULES-MATRIX.md](RULES-MATRIX.md).

## Privacy

Full Architecture/runtime live in GM-only Journal storage. Each player gets a separate sanitized projection.

The projection does not include hidden DV, GM notes, undiscovered content, private Scene-control configuration, or Black ICE Actor IDs. Encounter summaries expose only what the affected player needs to act.

Player mutations are validated by the authoritative GM. Secure transport uses ECDH P-256 + AES-GCM when WebCrypto is available; insecure player writes do not silently downgrade.

## BUILD integration

BUILD accepts real Foundry Documents:

- JournalEntry / JournalEntryPage;
- Item;
- Wall door;
- Token;
- Tile;
- AmbientLight;
- AmbientSound.

RUN only exposes a bound Scene action when the relevant Control Node is actually owned.

## Installation

From branch `experiment/netrunning-next`, copy:

`experimental/cpr-netrunning-next`

into:

`Data/modules/cpr-netrunning-next`

Restart Foundry and enable **Cyberpunk RED: Netrunning Lab**. Production `cpr-netrunning` can remain enabled because ids and stores are separate.

## Recommended 0.5 test sequence

1. BUILD → Import Copy or Demo.
2. Use an Architecture with at least one real Black ICE Actor reference.
3. Add a Netrunner Actor with active Interface Role and equipped Cyberdeck.
4. RUN → Jack In and enter the ICE floor.
5. Confirm the SPEED banner appears before unrelated NET actions can continue.
6. Test both a SPEED success and failure; on failure verify the GM effect gate.
7. With pursuing ICE targeted, use Slide and choose an adjacent destination.
8. Confirm success moves the runner, leaves ICE behind, and returning to that floor triggers it again.
9. Quiet Jack In and approach ICE again: confirm Cloak-vs-PER replaces SPEED while stealthed.
10. PLAYER VIEW → confirm encounter state is useful but private Actor IDs/DVs/GM notes remain absent.
11. Test Control Node twice in one Turn: the second activation must be rejected without changing the Scene.
12. Test Off/Subtle/Cinematic and OS Reduce Motion.

## Checks

```bash
node experimental/cpr-netrunning-next/tools/check.mjs
node experimental/cpr-netrunning-next/tools/test-v05.mjs
```

The experiment remains a draft PR. `master` is not modified until live Foundry 12.343 acceptance testing is good enough to justify selectively porting features back.
