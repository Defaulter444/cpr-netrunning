# Netrunning Lab 0.3 — Rules Matrix

The experiment follows a strict policy: **an incomplete automation stays hidden or GM-adjudicated instead of inventing a replacement rule.**

Primary references:

- Cyberpunk RED Core Rulebook — Netrunning chapter.
- Official Cyberpunk RED Rules FAQ v1.3: https://rtalsoriangames.com/wp-content/uploads/2021/07/RTG-CPR-CoreBookFAQv1.3.pdf
- Netrunning Deck User's Guide v1.1: https://rtalsoriangames.com/wp-content/uploads/2021/10/RTG-CPR-NetrunningDeck-Instructionsv1.1.pdf
- Going Quiet v1.1: https://rtalsoriangames.com/wp-content/uploads/2025/07/RTG-CPR-DLC-GoingQuietv1.1.pdf

This document summarizes mechanics; it does not reproduce rulebook text.

| Rule | Lab 0.3 behavior | Status |
|---|---|---|
| Interface Rank 1–3 / 4–6 / 7–9 / 10 grants 2 / 3 / 4 / 5 NET Actions | Action pool is derived from the active NET Role | Automated |
| Interface tests must beat DV; ties fail | `total > DV` | Automated + tested |
| Scanner locates Access Points in meatspace | Scanner is never offered as an in-Architecture action | Enforced |
| Jack In / safe Jack Out cost one NET Action | Runtime spends one | Automated |
| Quiet Jack In costs an additional NET Action | Runtime requires and spends two | Automated |
| Quiet Jack In is a plain Interface Check against every Watcher | 0.3 uses native `CPRInterfaceRoll`; Scanner is no longer used as a carrier | Automated, fail-closed if CPR internals differ |
| Virtual movement between adjacent NET floors is free | Movement does not spend NET Actions | Automated |
| Unresolved obstruction blocks movement deeper but not retreat | Topology checks current floor gate before downward movement | Automated |
| Pathfinder reveals topology but not DV | Branch-aware reveal; player projection never includes DV | Automated |
| Backdoor opens the relevant obstruction | Native Interface roll then strict DV comparison | Automated |
| Eye-Dee reveals File/data contents | Content stays withheld until successful identification | Automated |
| Taking a Control Node is a NET Action | Native Interface roll, then ownership state | Automated |
| Using a controlled device is a separate NET Action | Scene control execution spends an additional action | Automated |
| A Control Node can be activated only once per Turn | 0.3 records activation by node + turn serial and rejects a second use before spending | Automated + hardened in 0.3 |
| Virus is installed at the bottom of a branch | Only leaf nodes accept Virus | Automated |
| Virus removal DV is based on the install Check | Stored Virus record keeps the install total as DV | Automated state |
| Slide is once per Turn and opposed against non-Demon Black ICE | UI does not expose Slide until the complete opposed resolver + destination flow is finished | Intentionally hidden |
| Zap uses opposed NET combat and causes 1d6 on success | UI does not expose Zap until the complete opposed resolver + damage flow is finished | Intentionally hidden |
| Black ICE Speed encounter / pursuit / effects | Entity native stats exist, but full lifecycle is not claimed yet | GM-adjudicated |
| Demons are not ordinary Black ICE | Demon entities remain distinct; Slide is not exposed against them | Enforced / incomplete lifecycle |
| Unsafe Jack Out resolves encountered hostile Black ICE effects | Not automated until encounter history and effect lifecycle are complete | GM-adjudicated |
| Architecture resets only after all friendly Netrunners are out (FAQ) | Runtime does not reset shared Architecture state while another runner remains Jacked In | Automated baseline |
| Going Quiet: Control takeover or hostile direct interaction breaks stealth | Runtime primitives track stealth break; unsupported combat interactions remain hidden | Partially automated, no fake combat |
| Going Quiet: stealing Files / placing Virus does not inherently break stealth | Those actions do not clear stealth | Automated state |
| Player must not learn hidden DVs or GM notes through UI transport | Per-user sanitized projection omits them | Enforced |

## Rules-safety gate

Before an action can become a permanent RUN-mode button it must have:

1. an identified RED rule and action cost;
2. a native CPR roll path when a roll is required;
3. a server/GM-side state mutation with permission validation;
4. a test for the result and action economy;
5. a projection rule specifying what the player is allowed to learn.

Until all five exist, the action remains hidden or explicitly manual.
