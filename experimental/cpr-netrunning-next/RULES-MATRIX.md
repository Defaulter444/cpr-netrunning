# Netrunning Lab 0.5 — Rules Matrix

The experiment follows one hard policy: **unfinished automation stays hidden or explicitly GM-adjudicated instead of inventing a replacement rule.**

Primary rules references used for this pass:

- Cyberpunk RED Core Rulebook — Netrunning, especially Interface Abilities, Black ICE, Initiative, and Control Nodes.
- Official Cyberpunk RED Rules FAQ v1.3: https://rtalsoriangames.com/wp-content/uploads/2021/07/RTG-CPR-CoreBookFAQv1.3.pdf
- Netrunning Deck User's Guide v1.1: https://rtalsoriangames.com/wp-content/uploads/2021/10/RTG-CPR-NetrunningDeck-Instructionsv1.1.pdf
- Going Quiet v1.1: https://rtalsoriangames.com/wp-content/uploads/2025/07/RTG-CPR-DLC-GoingQuietv1.1.pdf

This file summarizes implementation behavior; it does not reproduce rulebook text.

| Rule | Lab 0.5 behavior | Status |
|---|---|---|
| Interface Rank 1–3 / 4–6 / 7–9 / 10 gives 2 / 3 / 4 / 5 NET Actions | Derived from the active NET Role | Automated + tested |
| Interface checks against a DV must beat it; ties fail | `total > DV` | Automated + tested |
| Scanner locates Access Points in meatspace | Never offered as an in-Architecture NET Action | Enforced |
| Jack In / safe Jack Out cost 1 NET Action | Runtime spends one | Automated |
| Quiet Jack In costs one additional NET Action | Runtime requires/spends 2 total | Automated |
| Quiet Jack In is a plain Interface Check against every Watcher | Native `CPRInterfaceRoll`; no Scanner substitution | Automated; fail-closed if CPR internals differ |
| Virtual movement between adjacent NET floors is free | Movement spends no NET Action | Automated |
| A NET obstruction blocks moving deeper but not retreat | Topology gate is checked before downward movement | Automated |
| Pathfinder reveals topology/content type but not DVs | Branch-aware reveal; sanitized player projection omits DV | Automated |
| Backdoor defeats the relevant obstruction | Native Interface roll + strict DV check | Automated |
| Eye-Dee identifies found data | Contents stay hidden until successful identification | Automated |
| Taking Control of a Control Node costs 1 NET Action | Native Interface roll; contested Control uses the stored Control Check | Automated |
| Operating something attached to an owned Control Node costs another NET Action | Linked Foundry Scene action is separate from taking Control | Automated |
| **Each Control Node can be activated only once per Turn** | Runtime reserves by Control Node + Turn before changing the Scene document; a second activation is rejected | Automated + tested |
| Failed Foundry Wall/Token/Tile/Light/Sound update must not burn the Control activation | Reservation and NET Action are rolled back on Scene update failure | Automated + tested |
| Virus can be installed only at the bottom of a branch | Leaf-only validation | Automated |
| Virus destruction DV is based on the install Check | Install total is stored on the Virus record | Automated state |
| **Black ICE SPEED encounter** happens immediately when Black ICE is triggered | Netrunner uses native Interface SPEED roll; ICE uses native SPD; the check is separate from Initiative | Automated in 0.5 |
| SPEED tie | A tie protects the defending Netrunner from the immediate Black ICE effect | Automated + tested |
| Triggered Black ICE enters the top of the Initiative Queue regardless of SPEED result | Black ICE Combatant is placed above the current highest initiative; the Netrunner uses normal REF initiative | Automated; requires live Foundry acceptance test |
| Failed SPEED check | The immediate Black ICE effect becomes a blocking GM-resolution card; the module does **not** guess how to apply heterogeneous ICE effects | Explicit GM adjudication, state-gated |
| Black ICE that has engaged a Netrunner follows them through the Architecture | Runtime stores pursuit position and moves pursuing ICE with the runner | Automated state |
| **Slide** targets one non-Demon Black ICE already following the Netrunner | Requires an engaged ICE target and 1 NET Action; only once per Turn | Automated in 0.5 |
| Slide opposed check | Netrunner must strictly beat Black ICE PER; tie stays with the ICE | Automated + tested |
| Successful Slide movement | Player chooses an adjacent accessible floor before rolling; on success the Netrunner immediately moves there | Automated in 0.5 |
| Successful Slide leaves Black ICE behind | Escaped ICE stops following and **lays in wait** on the floor where pursuit was broken; returning there can trigger it again | Automated in 0.5 |
| Slide cannot pass a Password/other NET obstruction | Destination is validated with the same adjacency/obstruction topology rules | Automated |
| Going Quiet: stealthed Black ICE encounter uses Cloak bonus vs ICE PER instead of SPEED | Native Cloak Interface roll vs native Black ICE PER | Automated in 0.5 |
| Going Quiet: successful stealth encounter | ICE never detects the Netrunner, does not enter Initiative, and is not marked encountered for that success | Automated state |
| Going Quiet: failed stealth encounter | Stealth breaks, failed ICE immediate effect is pending, failed ICE enters top Initiative, and other Black ICE on that floor react normally | Automated state + GM effect resolution |
| Taking a Control Node or directly interacting with hostile NET entities breaks stealth | Runtime primitives preserve this policy; combat actions are exposed only when their resolver is complete | Partially automated |
| File theft / Virus placement does not inherently break stealth | Those actions do not clear stealth | Automated state |
| Safe Jack Out after Sliding | Safe Jack Out is still safe; merely having active Black ICE elsewhere does not make the explicit Jack Out action unsafe | Enforced by normal safe Jack Out path |
| Unsafe Jack Out | Effects of encountered, still-rezzed hostile Black ICE must resolve | **Not yet automated** |
| Black ICE normal combat turns (ATK/DEF/effects) | Actor stats exist and Initiative lifecycle starts, but full attack/effect automation is not yet claimed | GM-adjudicated |
| Zap / Program combat | Not exposed as a claimed-complete automatic combat resolver yet | Intentionally hidden/incomplete |
| Demons are not ordinary Black ICE | They remain distinct; Slide is not valid against Demons | Enforced |
| Architecture resets when all friendly Netrunners are out | Shared runtime does not reset while another runner remains Jacked In | Automated baseline |
| Player secrecy | Per-user projection omits hidden DVs, GM notes, hidden contents, Actor IDs, and control configuration | Enforced |

## Rules-safety gate

Before a RUN-mode action is considered complete it needs all five:

1. an identified RED rule and action cost;
2. a native CPR roll path when a roll is required;
3. authoritative GM-side validation/state mutation;
4. regression tests for result and action economy;
5. an explicit player-projection rule for what information may be revealed.

Until all five exist, the action is hidden or marked as GM-adjudicated.
