# Cyberpunk RED — Netrunning Suite: Architecture Specification

> **Примечание форка.** Это спецификация ОРИГИНАЛА
> (`cyberpunk-red-netrunning-suite`, автор Lumiel, MIT). Она сохранена целиком,
> потому что описывает механизмы, на которых форк стоит: слой данных, сокет,
> мост к системе, порядок хода, чёрный лёд.
>
> Форк `cpr-netrunning` от неё отступает. Главное расхождение: здесь
> архитектура описана как ПРЯМАЯ ЦЕПОЧКА (`floors` — упорядоченный список,
> «глубже» = больший индекс). В форке она дерево: у этажа есть поле `parent`,
> ход идёт по родителю и детям, Следопыт обходит каждую ветку отдельно, а дно
> у каждой ветки своё. Что именно разошлось — в README и в истории коммитов.


FoundryVTT **v12** module for system `cyberpunk-red-core` (v0.92.x). Module id: `cyberpunk-red-netrunning-suite`.
This document is the single source of truth for all implementation phases. Do not deviate from the contracts here without recording the deviation at the bottom ("Deviations" section).

## 0. Product summary

A full-screen-capable, resizable window application ("Netrunning Suite") that provides:

- **GM**: a file-manager (folders + architecture files) in a left panel; create/rename/duplicate/delete/import/export NET architectures; an architecture editor (chain of floors, per-floor type/DV/description, up to 3 Black ICE per floor, up to 1 Demon per floor with a global cap of `ceil(floorCount/6)` demons per architecture); open architectures as tabs (like a text editor); connect players/NPC netrunners to an architecture; a slide-out right panel of GM-controlled netrunners (drag & drop Actors in); select any Black ICE / Demon / GM runner and use its action panel (attack / defense / speed / perception / damage / rez management); optional auto-roll for GM-controlled entities defending against player actions.
- **Player** (actor with an **equipped cyberdeck**): sees the architecture they are connected to; NET action counter per turn based on Interface rank (1–3→2, 4–6→3, 7–9→4, 10→5); performs interface abilities (the system's NET actions), program activate/deactivate, Jack In/Out; moves along floors; targets entities with click + `T`.
- **Spectators** (players without a deck, if enabled in settings): read-only view of what runners see; optional free navigation between architectures that have runners.
- Pan/zoom camera over the architecture, animated "data flow" between floors, 4 Matrix-style themes (red / yellow / blue / green).
- All shared state lives in world settings, synced via the module socket with a **primary-GM relay** (same pattern as the sibling module `cyberpunk-red-agent-os-modified`).
- **Actor-backed entities (hard requirement)**: everything that acts inside an architecture is tied to a real Actor document. Runners/NPC runners → `character`/`mook` actors (already). Every Black ICE placed in an architecture → an Actor of system type `blackIce`; every Demon → an Actor of type `demon`. The module creates/deletes these actors automatically (GM-side ops) inside a folder tree `NET Architectures/<arch name>`. Actor is the source of truth for stats and current REZ; GM can open the native sheet (double-click the chip) and tweak stats. Rolls of these entities go through the system's own actor roll methods.

Languages: **en + ru**, full key parity. i18n prefix: `CRNS.*`.

## 1. File layout

```
module.json
SPEC.md                      (this file)
lang/en.json  lang/ru.json
styles/netrunning.css        (single stylesheet)
templates/
  shell.hbs                  (window content: composite layout, all includes)
  tree.hbs                   (GM file panel)
  tabs.hbs                   (open-architecture tab strip)
  arch-canvas.hbs            (architecture viewport: floors, entities, participants)
  editor.hbs                 (architecture edit mode: floor chain editing)
  runners.hbs                (GM right slide-out panel)
  actions.hbs                (bottom action bar + selected-entity action panel)
  entity-card.hbs            (one ICE/Demon/participant chip — shared partial)
scripts/
  main.js                    (entry: init/ready hooks, settings, scene control button, helpers, loadTemplates)
  constants.js               (MODULE_ID, tables: ICE/DEMON/PROGRAM data, floor types, themes, formulas)
  data.js                    (world-setting store, mutate/applyOp/OPS, primaryGM)
  socket.js                  (socket router)
  cpr-bridge.js              (ALL touch points with the CPR system: rank, deck, rolls, chat cards)
  apps/suite-app.js          (NetrunningSuiteApp extends Application — the shell)
  apps/tree.js               (left panel impl)
  apps/editor.js             (editor impl)
  apps/arch-canvas.js        (viewport render + pan/zoom + selection/targeting + data-flow)
  apps/runners.js            (GM runner panel + actor drag&drop)
  apps/actions.js            (action bar, entity action panels, roll execution, damage application)
tools/verify.mjs             (static verification harness — CI-style checks, run with node)
```

Rule: `cpr-bridge.js` is the **only** file allowed to import from the system or touch `actor.*`/`item.*` CPR internals. Everything else calls the bridge.

## 2. module.json

```json
{
  "id": "cyberpunk-red-netrunning-suite",
  "title": "Cyberpunk RED — Netrunning Suite",
  "description": "Immersive NET architecture builder and netrunning interface for Cyberpunk RED.",
  "version": "1.0",
  "compatibility": { "minimum": "12", "verified": "12" },
  "authors": [{ "name": "Lumiel" }],
  "socket": true,
  "esmodules": ["scripts/main.js"],
  "styles": ["styles/netrunning.css"],
  "packs": [],
  "languages": [
    { "lang": "en", "name": "English",  "path": "lang/en.json" },
    { "lang": "ru", "name": "Русский", "path": "lang/ru.json" }
  ],
  "relationships": { "systems": [{ "id": "cyberpunk-red-core", "type": "system", "compatibility": {} }] },
  "url": "https://github.com/Frost-Jack/cyberpunk-red-netrunning-suite",
  "manifest": "https://github.com/Frost-Jack/cyberpunk-red-netrunning-suite/releases/latest/download/module.json",
  "download": "https://github.com/Frost-Jack/cyberpunk-red-netrunning-suite/releases/latest/download/module.zip",
  "license": "LICENSE",
  "readme": "README.md"
}
```

Keep `.github/workflows/main.yml` release workflow (already present from template) — do not touch `.git`. **Never run git commands.**

## 3. Data model (world settings, all `scope:"world", config:false, type:Object`)

Register in `main.js` init from a `WORLD_OBJECTS` dict (loop), exactly like agent-os.

### 3.1 `netTree` — file system (Array of flat nodes)
```js
{ id: "nd_xxxxxxxxxxxx", type: "folder"|"arch", name: "…", parentId: ""|nodeId, archId?: "a_…" }
```
- Root = `parentId: ""`. Folders nest arbitrarily. `arch` nodes carry `archId` pointing into `netArchs`.
- Sort: folders first, then archs, alphabetical, at render time.

### 3.2 `treeState` — folder open/closed (Object) `{ [folderNodeId]: true }` (world-stored per user request).

### 3.3 `netArchs` — architecture definitions (Object keyed by archId)
```js
{
  id: "a_xxxxxxxxxxxx",
  name: "Militech Vault",
  floors: [ Floor, … ]           // ordered chain, index 0 = first floor
}
Floor = {
  id: "f_xxxxxxxxxxxx",
  kind: "password"|"file"|"controlnode"|"custom",   // "obstacle"/loot type of the floor
  label: "",            // custom display label (used when kind==="custom", optional otherwise)
  dv: 6,                // difficulty value of the floor obstacle (0 = none)
  description: "",      // GM notes / what the file or control node is
  ice: [ IceDef, … ],   // 0..3
  demon: DemonDef|null  // 0..1 per floor; global cap ceil(floors.length/6)
}
IceDef   = { id: "i_x…", type: "asp"|"giant"|…|"sabertooth", actorId: "…" }   // actorId → world Actor (type "blackIce")
DemonDef = { id: "d_x…", type: "imp"|"efreet"|"balron", actorId: "…" }        // actorId → world Actor (type "demon")
```
**Actor lifecycle (GM-side, inside OPS handlers):** adding an ICE/Demon in the editor creates a world Actor (`blackIce`/`demon`) seeded from the constants tables (name = localized type name, `img` from `ENTITY_ICONS`, stats + rez max) inside folder `NET Architectures/<arch name>` (create folders idempotently). Removing it from the arch (or deleting/overwriting the arch, closing without keeping) deletes the actor. `arch.duplicate` duplicates the actors; `arch.import` creates fresh actors; `tree.delete` of arch nodes deletes their actors and folder. `arch.update` diffs old vs new floors and reconciles actors. The **Actor is the source of truth** for name/img/stats/current REZ; the arch stores only type + actorId. UI chips render actor name/img/rez live (updateActor hook re-renders the app — real-time sync for every client).

### 3.4 `session` — live multiplayer state (Object)
```js
{
  tabs: ["a_1", …],            // open architecture tabs (GM-managed, visible to all)
  activeTab: "a_1"|"",         // GM's focused tab; players/spectators follow their own rules (see 7.4)
  // NOTE: no per-entity rez state here — current REZ lives on the backing Actor
  // (`system.stats.rez.value`); "derezzed" = rez.value <= 0.
  participants: {               // key: participantId (see below)
    "<pid>": {
      kind: "runner"|"spectator",
      userId: "…",              // owning user ("" for GM-added NPC runners → GM users control)
      actorUuid: "Actor.xyz"|"",// runners only; spectators have ""
      archId: ""|"a_1",         // where they are; "" = not connected
      floorIndex: 0,            // 0-based position in the chain
      jackedIn: false,
      actions: { value: 2, max: 2 },     // NET actions this turn (runners only)
      rezzed: {                 // player's own rezzed BLACK ICE instances (runner-controlled ICE)
        // programItemId: { rez, rezMax, derezzed:false }  — mirror for display; source of truth = actor item
      }
    }
  },
  targets: { [userId]: "<entityRef>"|"" },     // current target per user
  demonPrograms: {}             // reserved
}
```
- `participantId`: runners → `actor:<actorUuid>` (normalized, replace dots with `_`); spectators → `user:<userId>`.
- `entityRef` (selection/target serialization): `"ice:<archId>:<floorId>:<iceId>"`, `"demon:<archId>:<floorId>:<demonId>"`, `"runner:<pid>"`, `"prog:<pid>:<programItemId>"` (a runner's rezzed Black ICE program).

### 3.5 Config settings (visible in module settings, `config:true`)
| key | scope | type | default | meaning |
|---|---|---|---|---|
| `allowSpectators` | world | Boolean | false | players without a cyberdeck get the toolbar button and join as spectators |
| `spectatorFreeMove` | world | Boolean | false | spectators may switch between architectures that currently have a runner |
| `autoRollNPC` | world | Boolean | true | GM-controlled ICE/Demons/NPC runners auto-roll their defense/speed when a player rolls an attack/action against them |
| `theme` | client | String (choices red/yellow/blue/green) | "green" | UI theme |

## 4. Socket + data layer (copy the agent-os pattern)

`constants.js`:
```js
export const MODULE_ID = "cyberpunk-red-netrunning-suite";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const TPL = (n) => `modules/${MODULE_ID}/templates/${n}.hbs`;
export const uid = (p) => `${p}_${foundry.utils.randomID(12)}`;
export const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
```

`data.js`: `getWorld(key)` (deepClone), `setWorld(key,value)`, `primaryGM()`, `isPrimaryGM()`, `mutate(op,payload)` with requestId + 10s timeout + `_pendingMutations` Map, `applyOp(op,payload,userId)` over an `OPS` table, `requesterIsGM(userId)`, `notifyClients(data)` (socket `notify` + local `Hooks.callAll`). Copy the exact skeleton from `modules/cyberpunk-red-agent-os-modified/scripts/data.js` (lines 1–75) and `scripts/socket.js` — adapted names, `AGENTOS`→`CRNS`.

**Every OPS handler re-validates permissions on the GM side** using `userId` (never trust the client).

### OPS table (op → who may call → effect)
| op | caller | effect |
|---|---|---|
| `tree.createFolder {parentId,name}` | GM | add folder node |
| `tree.createArch {parentId,name}` | GM | new empty arch (1 default floor "password", dv 6) + tree node; returns archId |
| `tree.rename {nodeId,name}` | GM | rename node (arch node also renames arch) |
| `tree.delete {nodeId}` | GM | delete node recursively; archs referenced by deleted nodes are removed from `netArchs`, their tabs closed, participants disconnected |
| `tree.toggle {nodeId,open}` | GM | set `treeState[nodeId]` |
| `tree.move {nodeId,parentId}` | GM | reparent (guard cycles) |
| `arch.update {archId,arch}` | GM | replace whole arch object (editor saves whole doc; validate demon/ice caps server-side) |
| `arch.duplicate {archId}` | GM | deep copy with new ids (`name + " (copy)"`), tree node next to original |
| `arch.import {parentId,arch}` | GM | validate + insert with fresh ids |
| `tabs.open {archId}` / `tabs.close {archId}` / `tabs.activate {archId}` | GM | manage `session.tabs`/`activeTab`; closing a tab disconnects its participants |
| `session.connect {pid, actorUuid, userId, archId}` | GM | create/replace runner participant on floor 0, `jackedIn:true`, actions reset, spend 1 action (Jack In costs 1) |
| `session.spectate {userId, archId}` | GM or the spectator himself (if allowed by settings) | upsert spectator participant |
| `session.disconnect {pid}` | GM or owning user | remove participant (or set archId "") |
| `session.move {pid, floorIndex}` | GM, or owning user (runner); spectator only if `spectatorFreeMove` | clamp 0..floors-1 |
| `session.setTarget {entityRef}` | any user in session | `targets[userId]=ref` |
| `run.jack {pid, in:true/false}` | GM or owner | toggle jackedIn; costs 1 action; jack-out clears rezzed mirror |
| `run.spend {pid, n}` | GM or owner | actions.value = max(0, v-n) |
| `run.reset {pid}` / `run.resetAll {archId?}` | GM (resetAll), owner (own) | actions.value = max (recompute max from bridge) |
| `run.setRezzed {pid, programId, state|null}` | GM or owner | maintain `rezzed` mirror (null deletes) |
| `ent.damage {actorId, amount}` | GM or attacker's owner after damage roll | GM-side: `actor.update({"system.stats.rez.value": clamp(v-amount, 0, max)})` |
| `ent.setRez {actorId, value}` | GM | set/clamp on the actor |
| `ent.restore {actorId}` | GM | rez.value = rez.max |
| `ent.reset {archId}` | GM | restore all entity actors of the arch (fresh run) |

Socket actions: `mutate`, `mutateResult`, `notify`. `notify` kinds used: `{kind:"rollRequest"}` (see 8.4 auto-roll), `{kind:"flash", …}` (optional toast).

## 5. CPR bridge (`cpr-bridge.js`) — the ONLY system-facing file

Imports (URL imports from the system are legal in Foundry):
```js
import * as CPRRolls from "/systems/cyberpunk-red-core/modules/rolls/cpr-rolls.js";
import CPRChat from "/systems/cyberpunk-red-core/modules/chat/cpr-chat.js";
```
(If default vs named export mismatch: check the file — `CPRChat` is the default/named export in `modules/chat/cpr-chat.js`; adjust import accordingly. Wrap both imports in a try/catch at module top? No — top-level static imports; if the system changes paths the module fails loudly, acceptable.)

Exports:
```js
export function getNetRole(actor)            // actor.itemTypes.role.find(r => r.id === actor.system.roleInfo.activeNetRole) ?? null
export function getInterfaceRank(actor)      // Number(getNetRole(actor)?.system.rank ?? 0)
export function netActionsMax(rank)          // rank<=0 ? 0 : Math.min(5, Math.ceil(rank/3)+1)   // 1-3→2 4-6→3 7-9→4 10→5
export function getDeck(actor)               // actor.getEquippedCyberdeck?.() ?? null
export function hasDeck(actor)               // !!getDeck(actor)
export function eligibleNetrunner(actor)     // actor && (actor.type==="character"||actor.type==="mook") && hasDeck(actor)
export function installedPrograms(deck)      // deck.system.installedPrograms
export function rezzedPrograms(deck)         // deck.system.rezzedPrograms

// Player/NPC-runner rolls — reuse system pipeline (dialog + crits + DSN + chat card):
export async function rollInterface(actor, ability, event)   // ability ∈ CONFIG.CPR.interfaceAbilities keys + "speed"|"defense"
export async function rollProgram(actor, programId, executionType, event) // executionType "atk"|"def"|"damage"
// Both: build via deck.createRoll("interfaceAbility"|"cyberdeckProgram", actor, {...}) exactly as the
// sheet does (see cpr-actor-sheet.js:559-616 / cpr-cyberdeck.js:77,185); then
// await roll.handleRollDialog(event, actor, deck); if false → return null; await roll.roll();
// roll.entityData = { actor: actor.id }; await CPRChat.RenderRollCard(roll); return roll.
// For "speed"/"defense" pass interfaceAbility "speed"/"defense" — the system's _createInterfaceRoll handles them.

export async function rezProgram(actor, programId)   // deck.rezProgram(program, null) + sheet-less _updateOwnedItem equivalent:
                                                      // await actor.updateEmbeddedDocuments("Item", [{_id: deck.id, ...deck changes}]) —
                                                      // ACTUALLY: call deck.rezProgram(program) then persist:
                                                      // await actor.updateEmbeddedDocuments("Item", [{ _id: program.id, "system.isRezzed": true }])
                                                      // plus deck.system.isRezzed bookkeeping if required — replicate what
                                                      // _cyberdeckProgramExecution + _updateOwnedItem do (read the system source first!)
export async function derezProgram(actor, programId) // symmetric; ALSO reset program rez to max (module rule: deactivation restores REZ)

// Architecture-entity actors (blackIce/demon actor documents — see §3.3):
export async function ensureEntityFolder(archName)                 // Folder type "Actor": root "NET Architectures" → child <archName>; returns child folder
export async function createIceActor(type, archName)               // Actor.create({type:"blackIce", name: loc(name), img: ENTITY_ICONS[type],
                                                                    //   folder, system:{class: BLACK_ICE[type].tgt==="P"?"antiprogram":"antipersonnel",
                                                                    //   stats:{per,spd,atk,def, rez:{value,max}}}}) — verify field paths against
                                                                    //   blackIce-datamodel.js; returns actor.id
export async function createDemonActor(type, archName)             // same for type "demon" (stats: rez, interface, actions, combatNumber)
export async function deleteEntityActors(actorIds)                 // bulk delete, ignore missing
// Rolls run off the backing actor (replicate cpr-black-ice-sheet.js _onRoll, lines ~130+):
export async function rollEntityStat(actor, statName, event)        // BI: actor.createStatRoll(statName); demon: same API (check cpr-demon.js);
                                                                    // cprRoll.setNetCombat(actor.name); handleRollDialog; roll(); entityData {actor:actor.id};
                                                                    // CPRChat.RenderRollCard
export async function rollEntityDamage(actor, formula, event)       // new CPRRolls.CPRDamageRoll(actor.name, formula, "program"); setNetCombat; roll; card
                                                                    // (formula from constants by entity type — arch ICE actors have no program item)
export async function rollDemonStatic(actor, cn)                    // no dice: styled chat card stating the Combat Number (see 8.3), speaker = actor
export async function damageEntity(actorId, amount)                 // clamp + actor.update rez.value (call ONLY on GM side, from OPS)
```
Phase-A agent MUST open and read `cpr-actor-sheet.js` `_onRoll` (line ~508), `cpr-character-sheet.js` `_cyberdeckProgramExecution` (~599), `cpr-cyberdeck.js` (62–230, 433–510) before writing the bridge, and replicate persistence side effects faithfully.

Fallback rule: every bridge function that touches system internals must be defensive (`?.`, try/catch with `ui.notifications.error(loc("CRNS.Errors.SystemApi"))`) so a system update degrades gracefully instead of breaking the whole app.

## 6. Constants — game data tables

`constants.js` exports (values from the RED core book, verified):

```js
export const BLACK_ICE = {
  asp:        { tgt:"N", per:4, spd:6, atk:2, def:2, rez:15, damage:null,  effectKey:"CRNS.Ice.Asp" },
  giant:      { tgt:"N", per:2, spd:2, atk:8, def:4, rez:25, damage:"3d6", effectKey:"CRNS.Ice.Giant" },
  hellhound:  { tgt:"N", per:6, spd:6, atk:6, def:2, rez:20, damage:"2d6", effectKey:"CRNS.Ice.Hellhound" },
  kraken:     { tgt:"N", per:6, spd:2, atk:8, def:4, rez:30, damage:"3d6", effectKey:"CRNS.Ice.Kraken" },
  liche:      { tgt:"N", per:8, spd:2, atk:6, def:2, rez:25, damage:null,  effectKey:"CRNS.Ice.Liche" },
  raven:      { tgt:"N", per:6, spd:4, atk:4, def:2, rez:15, damage:"1d6", effectKey:"CRNS.Ice.Raven" },
  scorpion:   { tgt:"N", per:2, spd:6, atk:2, def:2, rez:15, damage:null,  effectKey:"CRNS.Ice.Scorpion" },
  skunk:      { tgt:"N", per:2, spd:4, atk:4, def:2, rez:10, damage:null,  effectKey:"CRNS.Ice.Skunk" },
  wisp:       { tgt:"N", per:4, spd:4, atk:4, def:2, rez:15, damage:"1d6", effectKey:"CRNS.Ice.Wisp" },
  dragon:     { tgt:"P", per:6, spd:4, atk:6, def:6, rez:30, damage:"6d6", effectKey:"CRNS.Ice.Dragon" },
  killer:     { tgt:"P", per:4, spd:8, atk:6, def:2, rez:20, damage:"4d6", effectKey:"CRNS.Ice.Killer" },
  sabertooth: { tgt:"P", per:8, spd:6, atk:6, def:2, rez:25, damage:"6d6", effectKey:"CRNS.Ice.Sabertooth" },
};
export const DEMONS = {
  imp:    { rez:15, interface:3, actions:2, combatNumber:14 },
  efreet: { rez:25, interface:4, actions:3, combatNumber:14 },
  balron: { rez:30, interface:7, actions:4, combatNumber:14 },
};
export const FLOOR_KINDS = ["password","file","controlnode","custom"];
export const THEMES = ["red","yellow","blue","green"];
// Icons — reuse the system's own art (verified to exist):
const SYS = "systems/cyberpunk-red-core/icons";
export const ENTITY_ICONS = {
  // Black ICE actor portraits (webp) — used as Actor.img and canvas chips:
  asp:`${SYS}/compendium/blackice/asp.webp`, giant:`${SYS}/compendium/blackice/giant.webp`,
  hellhound:`${SYS}/compendium/blackice/hellhound.webp`, kraken:`${SYS}/compendium/blackice/kraken.webp`,
  liche:`${SYS}/compendium/blackice/liche.webp`, raven:`${SYS}/compendium/blackice/raven.webp`,
  scorpion:`${SYS}/compendium/blackice/scorpion.webp`, skunk:`${SYS}/compendium/blackice/skunk.webp`,
  wisp:`${SYS}/compendium/blackice/wisp.webp`, dragon:`${SYS}/compendium/blackice/dragon.webp`,
  killer:`${SYS}/compendium/blackice/killer.webp`, sabertooth:`${SYS}/compendium/blackice/sabertooth.webp`,
  // Demons (netrunning PNG set):
  imp:`${SYS}/netrunning/Imp.png`, efreet:`${SYS}/netrunning/Efreet.png`, balron:`${SYS}/netrunning/Balron.png`,
};
export const FLOOR_ICONS = {
  password:`${SYS}/netrunning/Password.png`, file:`${SYS}/netrunning/File.png`,
  controlnode:`${SYS}/netrunning/Control_Node.png`, custom:`${SYS}/netrunning/Access.png`,
  root:`${SYS}/netrunning/Root_Access.png`,   // decorative: last floor marker
};
export const MAX_ICE_PER_FLOOR = 3;
export const maxDemons = (floorCount) => Math.ceil(floorCount / 6);
export const netActionsMax = (rank) => rank <= 0 ? 0 : Math.min(5, Math.ceil(rank / 3) + 1);
```
Every ICE/Demon also needs `CRNS.Ice.<Type>.name` and `.effect` i18n keys (effect text from the rulebook, both languages — translate RU faithfully).
Program reference data (booster/defender/attacker effects) is NOT needed as a table — programs come from the actor's cyberdeck items. Only add `CRNS.ProgramClass.*` labels if the system's `CPR.global.programClass.*` keys are insufficient.

## 7. UI specification

### 7.1 Shell (`suite-app.js` + `shell.hbs`)
- `NetrunningSuiteApp extends Application` (v1), singleton at `globalThis.CRNS = { ui }`.
- defaultOptions: `id:"crns-suite"`, `classes:["crns-window"]`, `template: TPL("shell")`, `popOut:true`, **`resizable:true`**, `width:1180`, `height:760`, `minimizable:true`. Native Foundry header is visually restyled (slim) but kept for drag/close (unlike agent-os — we need resizable).
- Root element: `.crns-root.theme-{{theme}}` with CSS var contract (see 9).
- Layout grid: `[left tree | main column | right runners]`, main column = `[tabs strip] [viewport OR editor] [action bar]`.
  - Left panel: GM only. Collapsible (chevron button; state in `app.ui state`, not persisted).
  - Right panel: GM only, slide-out (collapsed by default to a thin rail with an icon).
  - Players/spectators see only the main column.
- App-level transient state `this.state = { selection:"", editorArchId:"", collapsedLeft:false, collapsedRight:true, cam:{ [archId]:{x,y,z} }, draft:{} }`.
- Delegation contract: suite-app composes `getData` from sub-modules — `Tree.getData(app)`, `Tabs`, `Canvas`, `Editor`, `Runners`, `Actions` (each exports `getData(app)` and `activateListeners(app, html)`); suite-app calls them all (each guards its own visibility).
- Re-render: debounced (100ms) `updateSetting` hook filtered by `${MODULE_ID}.` prefix (in main.js) + `updateActor/updateItem/createItem/deleteItem` re-render when the actor (or item's parent actor) is a session runner **or an architecture entity actor** (blackIce/demon type, or actorId referenced by any arch) — this is what keeps chips live-synced with the real actors.
- Keydown handler (attached to the app element, `tabindex="0"`): `T`/`т` → target hovered entity (see 7.5); `Escape` → clear selection.
- The GM-vs-player view divergence is decided ONLY by `game.user.isGM` + participant lookup (`myParticipant()` helper in suite-app: runner participant owned by me, else my spectator record, else null).

### 7.2 Tree (GM left panel)
- Rendered from `netTree` + `treeState`. Folders: click header toggles (op `tree.toggle`), chevron rotates. Rows for archs: name + buttons **open** (tabs.open+activate), **edit** (open tab in editor mode: `state.editorArchId=archId` + tabs.open), **duplicate**, **export** (client-side `saveDataToFile(JSON.stringify(arch,null,2), "text/json", name + ".json")`), **delete** (confirm dialog).
- Header buttons: new folder (at root), new arch (at root), import (file input → JSON parse → validate → `arch.import`). Each folder row has "+" buttons for new subfolder/new arch inside it.
- Rename: double-click name → inline input (or small dialog `promptText` helper) → `tree.rename`.
- Move: drag a node row onto a folder row → `tree.move` (HTML5 dnd, `data-node-id`; simple, no fancy sorting).

### 7.3 Tabs
- Strip of open archs (`session.tabs`); GM sees close ✕ on each and can drag nothing (no reorder needed). Active tab highlighted.
- GM click → `tabs.activate`. Editor mode indicator (pencil badge) if that tab is being edited.
- Player: tabs are hidden — a runner is locked to their `archId` (they always see the architecture they are connected to); a spectator sees the arch of the runner they follow, or free tab list of runner-occupied archs if `spectatorFreeMove` (rendered as plain switcher, `session.spectate` moves them).

### 7.4 Canvas / viewport (`arch-canvas.js`, `arch-canvas.hbs`)
- The arch to display: GM → `activeTab`; runner → own `archId`; spectator → own `archId`.
- Structure: `.crns-viewport` (fills area, `overflow:hidden`, matrix-rain background) → `.crns-stage` (absolutely positioned, centered via `translate(-50%,-50%) translate(x,y) scale(z)`).
- Floors rendered as a **vertical chain** of `.crns-floor` cards (fixed width ~340px, gap ~90px): floor number, kind icon + label, DV badge, description (GM only, and only in editor/hover tooltip), entity chips (ICE/Demon), participant tokens (actor avatars of runners on this floor; spectators not shown on floors).
- Between consecutive floors: `.crns-link` connector with **animated data-flow** (recipe in 9.3). Connectors must scale with the stage transform automatically (they're inside the stage — nothing special needed).
- Pan/zoom: copy `wireMapViewport`/`zoomAt` from agent-os `scripts/apps/map.js:66-208` **without** the chassis-zoom correction (`chassisScale()` → always 1, we don't use CSS zoom). Camera per arch persisted in `app.state.cam[archId]`; wheel-zoom clamp 0.3–2.5. Camera survives re-render (state), re-applied on each render.
- Entities: `entity-card.hbs` chip — the backing **actor's `img`** (portrait, cut-corner frame with neon border), actor name, live REZ bar (`actor.system.stats.rez.value/max`), status (rez ≤ 0 → derezzed: grayscale + ✖ overlay + glitch animation). Clicking = selection (7.5). **Double-click (GM) opens the actor's native sheet.** Hovering sets `app.hovered = entityRef`. Floor kind icons come from `FLOOR_ICONS` (system art), last floor additionally shows the Root_Access marker. Make the chips beautiful: portrait glow in theme accent, REZ bar as segmented neon cells, demon chips slightly larger with a horned frame accent.
- Participants: avatar chip on their floor; own participant ringed. Click (own/GM) selects the runner.
- Floor click (runner, on adjacent floor): move — costs nothing by default (movement is part of actions in RED; do NOT auto-spend). GM can drag any participant chip onto any floor (`session.move`).
- Zoom buttons (+/−/reset) overlaid bottom-right of viewport; "fit" recenters cam.

### 7.5 Selection & targeting
- Click an entity chip → `app.state.selection = entityRef` (local only, per client), visual ring. Only selectable if you may act with it: GM — everything; player — own runner + own rezzed BI programs (`prog:` refs).
- **Target**: hover an entity and press `T` (both layouts: `t`/`т`), or right-click chip → context "Target". Calls `session.setTarget {entityRef}` → stored per user, rendered as red crosshair badge on the chip for everyone (so GM sees player targets). Pressing `T` on the current target clears it (toggle, mirroring Foundry).
- Selection determines what the **action panel** (7.6) shows.

### 7.6 Action panel (`actions.js`, `actions.hbs`) — bottom bar
Three variants by selection:
1. **Own runner selected (or player default when nothing selected)**:
   - NET-action pips `●●○` (`actions.value/max`) + "End Turn"/"Reset" (op `run.reset` own; GM has `resetAll`).
   - Jack In/Out button (toggles; costs 1 action; disabled at 0 actions; Jack In only if connected to arch by GM).
   - Interface abilities row: all keys from `CONFIG.CPR.interfaceAbilities` + Speed + Defense (localized via system keys `CPR.global.role.netrunner.interfaceAbility.*`); click → confirm-spend? NO dialog: spends 1 action via `run.spend` then `bridge.rollInterface`. If 0 actions → warn toast, no roll. (Defense/speed rolls in response to attacks do NOT cost actions — provide a modifier-click: holding Shift skips the action spend; document in a tooltip `CRNS.Hints.FreeRoll`.)
   - Programs strip: each installed program chip with class icon, ATK/DEF/REZ, rezzed glow; buttons: **Activate/Deactivate** (costs 1 action; bridge rez/derez; deactivation restores REZ to max — module rule), for rezzed: **ATK**/**DMG**/**DEF** (attackers: after DMG roll auto-derez — module rule "attackers deactivate after use"), booster/defender: no rolls, just rez state. Player's Black ICE program when rezzed ALSO appears as a `prog:` entity able to act like arch ICE (select it → ICE panel with its stats from the program item).
2. **Arch ICE/Demon selected (GM)**: name, REZ bar with +/− and set-input (`ent.setRez`/`ent.damage`/`ent.restore`), buttons: **Attack** (1d10+ATK), **Defense** (1d10+DEF), **Speed** (1d10+SPD), **Perception** (1d10+PER) → `bridge.rollEntityStat` with alias = localized ICE name; **Damage** (`bridge.rollEntityDamage` with table formula; ICE with `damage:null` → button hidden, effect text posted instead) ; **Effect** button posts localized effect description to chat (whisper GM? no — public). Demon: **Action (1d10+Interface)**, **Combat Number** static card, REZ management, NA badge.
3. **Enemy/other runner selected (GM, NPC runners)**: same as variant 1 but acting for that actor (GM controls NPC runner participants).
- Every roll posts through the system pipeline → normal CPR chat cards, Dice So Nice works.
- All actions that mutate state go through `mutate()`; UI optimistically re-renders.

### 7.7 Runners panel (GM right slide-out, `runners.js`)
- Drop zone: dragging an Actor from the sidebar onto the panel (or anywhere on the app when panel open) → `TextEditor.getDragEventData(event)` → if `type:"Actor"`, resolve `fromUuid`, check `eligibleNetrunner`; add participant `{kind:"runner", userId:"", actorUuid, archId:"", jackedIn:false, actions:{…}}` via `session.connect`-like op (but without arch → op `session.connect` accepts `archId:""` meaning "in roster, not connected").
- List: all runner participants — avatar, name, owner (user color dot), arch/floor position, Interface rank, actions pips; buttons: connect-to-active-arch (`session.connect` to `activeTab` floor 0), disconnect, remove from roster, "act as" (select).
- Player connect flow: GM clicks "connect" on a player-owned runner → player's window switches automatically (their `archId` changed → their view follows).
- Roster auto-listing: any player whose character has an equipped deck appears in the roster automatically (computed at render from `game.users` + assigned characters), so the GM can connect them without dragging.

### 7.8 Scene controls button (main.js)
```js
Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find(c => c.name === "token");
  token?.tools.push({
    name: "crns", title: loc("CRNS.Button.Open"), icon: "fas fa-microchip",
    visible: game.user.isGM
      || eligibleNetrunner(game.user.character)
      || game.settings.get(MODULE_ID, "allowSpectators"),
    onClick: () => globalThis.CRNS.ui.render(true), button: true
  });
});
```
(For players, also check ANY owned actor with a deck, not only `user.character` — helper `userNetrunnerActor(user)`: prefers `user.character` if eligible, else first owned eligible character actor.)

### 7.9 Turn economy
- `actions.max` recomputed on connect/reset from `bridge.netActionsMax(getInterfaceRank(actor))`.
- Combat integration: `Hooks.on("combatTurn"/"combatRound")` in main.js — if the new combatant's actor is a session runner, primary GM auto-runs `run.reset` for it. Manual reset buttons remain.
- Demons/ICE have no tracked counter (GM discretion), demon NA shown as a badge.

## 8. Roll & combat semantics

### 8.1 Netrunner rolls
All via system pipeline (bridge). Attack on ICE = interface ability roll vs ICE DEF; the module does NOT auto-resolve player-vs-ICE outcomes — it posts both cards; but see auto-roll.

### 8.2 Arch entity rolls
Through the backing actor: `actor.createStatRoll(statName)` (blackIce/demon actor classes) + `setNetCombat(actor.name)` + system dialog/crit/DSN pipeline + `CPRChat.RenderRollCard` with real actor speaker — identical to rolling from the native Black ICE sheet. Damage: `CPRDamageRoll(actor.name, formulaFromConstants, "program")` + `.setNetCombat` — crits per system (two+ 6s → +5).

### 8.3 Demon static CN
Post a chat card (module template or simple HTML) — "«Imp» acts with Combat Number **14**" (localized), speaker alias = demon name. No dice.

### 8.4 Auto-roll (setting `autoRollNPC`)
When a player rolls **attack** (interface ability roll of kind "attack"/zap, or program `atk`) while having a target that is GM-controlled (`ice:`/`demon:` ref, or `runner:` participant with `userId:""`):
- After the player's roll resolves, the player's client emits `notify {kind:"rollRequest", targetRef, vs:"defense"|"speed", attackerName, total}`.
- Primary GM client (listener in main.js on the module notify hook): if `autoRollNPC` → executes the corresponding defensive roll (`rollEntityStat` def for ICE, CN card for demon, `bridge.rollInterface(actor,"defense")` for NPC runner) and posts a comparison chat line (module mini-card: attacker total vs defender total → HIT/MISS, localized).
- If auto-roll off → GM gets a toast prompting to roll manually.

### 8.5 Damage application
- To arch ICE/demon: after a damage roll against a targeted `ice:`/`demon:` entity, show (attacker & GM) an "Apply N damage" button in the action panel (uses last damage total per client) → op `ent.damage`. Simpler and robust: the action panel for a *targeted* entity always offers a small numeric input + "Apply damage" (GM and the attacking player allowed).
- To netrunners (brain damage): NOT auto-applied. The CPR damage chat card already supports system damage application; leave it to the system/GM.
- Player's own Black ICE (prog refs): damage applies to the program item's `system.rez.value` via bridge (`actor.updateEmbeddedDocuments`), mirrored in `run.setRezzed`.

## 9. Styling (`styles/netrunning.css`)

### 9.1 Theme contract
`.crns-root` defines defaults; `.crns-root.theme-<id>` overrides. Variables (same contract as agent-os):
`--crns-accent, --crns-accent-2, --crns-warn, --crns-good, --crns-bg, --crns-panel, --crns-glass, --crns-border, --crns-glow, --crns-text, --crns-dim`.
Themes: `green` (#00ff6a matrix classic), `red` (#ff2b4e), `yellow` (#ffd23f), `blue` (#38b6ff) — dark near-black backgrounds tinted toward the accent hue, phosphor-terminal look ("Matrix" style): monospace UI font (`"JetBrains Mono", "Consolas", monospace`), scanlines, glow.

### 9.2 Mandatory blocks
- Namespace EVERYTHING under `.crns-root`.
- Foundry window restyle: `.crns-window .window-header` slim dark; `.crns-window .window-content { padding:0; background:transparent }`.
- **HARD OVERRIDE block at the very END of the file**: the CPR system ships high-specificity `button` rules — re-assert every module button class with `!important` (background/border/width/height/margin/line-height/color), `.crns-root button i { margin:0 !important }`. (Proven necessity — see agent-os agent.css:3368.)
- Cut-corner `clip-path` chips/cards/buttons (9px btn, 16px modal, 10px rows), `// ` ::before section titles, uppercase monospace buttons.
- Matrix rain: `.crns-viewport::before` — layered repeating-linear-gradients of glyph-like columns is ugly; instead use a `<canvas class="crns-rain">` absolutely positioned behind the stage, driven by a tiny rAF loop in arch-canvas.js (katakana/latin glyphs falling, alpha-faded, uses `--crns-accent` color, ~30fps, paused when app not rendered — store rAF id on app, cancel in close/re-render). Density low (opacity ≤ 0.25) so it doesn't distract.
- CRT scanline overlay on viewport (`::after`, background-size 100% 4px recipe) + sweeping scanline under tab strip.

### 9.3 Data-flow connectors
`.crns-link` = vertical element between floors containing 3 layers:
1. spine: 2px line `linear-gradient(var(--crns-accent), transparent…)`, glow.
2. flow: `background: repeating-linear-gradient(180deg, transparent 0 6px, var(--crns-accent) 6px 10px)` animated `background-position` downward (`@keyframes crns-flow { to { background-position-y: 32px } }`, linear infinite) — reads as packets flowing between floors.
3. occasional bright "packet" dot (`::after` with `animation: crns-packet 2.4s cubic-bezier(...) infinite` translateY 0→100%).
Respect zoom automatically (inside stage). Derezzed/inactive branch → dimmed.

### 9.4 Themes switch
Client setting `theme` + a small selector (palette icon) in the app header row; setting change → re-render (settings `onChange`).

## 10. i18n

- Prefix `CRNS.` — namespaces: `Button, Tree, Tabs, Editor, Canvas, Actions, Runners, Ice, Demon, Settings, Errors, Hints, Chat, Themes`.
- FULL en/ru parity (verify.mjs checks).
- Reuse system keys where sensible (`CPR.global.role.netrunner.interfaceAbility.*`, `CPR.global.blackIce.stats.*`) — do not duplicate those.

## 11. Verification (`tools/verify.mjs`, zero-dep Node)

Checks (exit non-zero on failure, print each failure):
1. `node --check` every `scripts/**/*.js` (spawn `node --check`).
2. en/ru key parity (deep flatten).
3. Every `data-action="x"` in templates has a handler string match in scripts (and vice versa for `[data-action=`).
4. HBS block balance (`{{#if}}`/`{{/if}}`, each/unless), and every `{{> "..."}}` partial path exists.
5. Every i18n key referenced in JS (`loc("CRNS.`) and HBS (`{{localize "CRNS.`) exists in both lang files.
6. CSS brace balance; every template class prefix `crns-` referenced in CSS at least once (warning only).
7. module.json JSON-parses; all template/style/lang paths exist; SPEC deviations section present.

## 12. Implementation phases & ownership

- **Phase A (foundation)**: module.json, lang skeletons (structure + Settings/Button/Errors keys), constants.js, data.js, socket.js, cpr-bridge.js, main.js (settings, hooks, helpers `crnsEq/crnsOr/…` if needed — prefix `crns`), suite-app.js skeleton with delegation contract + EMPTY stub files for apps/* returning `{}`/no-op, shell.hbs full layout skeleton (all containers + includes present, subtemplates may be minimal placeholders), tools/verify.mjs.
- **Phase B (tree/tabs/editor)**: apps/tree.js, apps/editor.js, tabs portion, templates tree/tabs/editor, related OPS fleshed out in data.js (tree.*, arch.*, tabs.*), lang keys.
- **Phase C (canvas/session/runners)**: apps/arch-canvas.js, apps/runners.js, templates arch-canvas/runners/entity-card, OPS session.*/ent.*, matrix-rain canvas, pan/zoom, selection/targeting, lang keys.
- **Phase D (actions/rolls)**: apps/actions.js, actions.hbs, OPS run.*, auto-roll notify flow, combat hooks, damage application, lang keys.
- **Phase E (styles)**: styles/netrunning.css complete (layout + themes + effects + HARD OVERRIDE end block).
- **Phase F**: verify + fix + review.

Rules for every phase agent:
- Read this SPEC fully first. Read the referenced agent-os/system files before implementing bridge/socket/pan-zoom parts.
- Do not run git. Do not touch files owned by other phases except where this spec says to extend (data.js OPS, lang files, loadTemplates list in main.js).
- Foundry v12 API only (Application v1, `foundry.utils.*`). No TypeScript. ES modules. No external deps.
- UI strings only via i18n (en + ru simultaneously).
- After finishing, run `node tools/verify.mjs` if node is available and fix what it reports (best effort).

## 13. Deviations

(append here when reality forces a change)

### Phase A
- **Entity roll cards for actor-backed entities use `CPRChat.RenderRollCard`.** `CPRChat.RenderRollCard` (cpr-chat.js:70-83) dereferences `actor.name` without a null guard when `entityData` is present. Because Phase A's ICE/Demon are now real Actor documents, `rollEntityStat`/`rollEntityDamage` set `entityData = { actor: actor.id }` and use the system pipeline directly (matching the native Black ICE sheet `_onRoll`), so the alias-fallback path described in the pre-update §5 is not needed. `rollDemonStatic` still posts a plain `crns-chat-card` (no dice) with a proper actor speaker.
- **blackIce `class` mapping (RESOLVED — mapping is correct).** SPEC §5 line 235 specifies `tgt==="P" ? "antiprogram" : "antipersonnel"`, which is **correct** per the CPR RED rulebook: TGT "N" = anti-NETRUNNER → system class `antipersonnel` (Asp…Wisp); TGT "P" = anti-PROGRAM → system class `antiprogram` (Dragon, Killer, Sabertooth). The earlier `constants.js` comment that labelled `tgt "P"` as "anti-personnel" was **wrong** and has been corrected to state the rulebook semantics (see FIX 5). The bridge mapping is unchanged. `blackIce-datamodel.js` only accepts `antipersonnel`/`antiprogram`/`other` (keys of `CPR.blackIceType`), and `class` merely selects which damage field an *attacker's* program reads — arch ICE roll their own formula from constants, so this choice is cosmetically load-bearing only.
- **`socket.js` mutateResult** now also relays `object` results (not just string/boolean), because the Phase A `ping` op and future ops (e.g. `tree.createArch` returning an archId) return richer values.
- **verify.mjs check 5** skips i18n keys containing `${` (runtime-interpolated keys such as `CRNS.Demon.${type}.name`), since they cannot be resolved statically.
- **`data.js` `setWorld`** is retained (currently only read by future OPS handlers) so Phase B can write world state without re-adding the helper.

### Phase B
- **Tabs are a dedicated `apps/tabs.js` module.** Phase A's `suite-app.js` `SUBMODULES` list had no Tabs delegate even though `shell.hbs` includes `tabs.hbs`. Phase B adds `scripts/apps/tabs.js` (exporting `getData`/`activateListeners`) and registers it in `SUBMODULES` (additive, no restructure), matching the delegation contract.
- **`promptText(title, initial)` shared helper** added to `suite-app.js` (exported) as specified — a small `Dialog` returning the trimmed string or `null`.
- **New `cpr-bridge.js` helpers** (still the only system-facing file): `duplicateEntityActor`, `deleteEntityFolder`, `renameEntityFolder`, `applyActorOverrides`, `snapshotEntityActor`. Used by the `arch.*`/`tree.*` OPS for actor reconciliation, folder lifecycle, import overrides, and export snapshots.
- **Export enrichment lives in `tree.js`** (`enrichArchForExport`): each ICE/Demon def is serialized with an `actorData` snapshot `{name, img, system:{stats}}` from the backing actor and its `actorId` stripped; `arch.import` re-creates fresh actors and applies `actorData` overrides onto them.
- **Editor draft** is stored in `app.state.draft` (deep clone of the arch on entering the editor, re-synced from the reconciled stored arch after a successful Save). New ICE/Demon defs get `uid("i")`/`uid("d")` with empty `actorId`; the `arch.update` OP assigns real actor ids on Save.
- **New localized OP error keys** returned as `{error:"CRNS.Errors.*"}`: `MinFloor`, `TooManyIce`, `UnknownIce`, `UnknownDemon`, `TooManyDemons`, `Cycle`, `BadImport`. Callers surface them via `ui.notifications.warn(loc(...))`.

### Phase D
- `interfaceAbilities`: the system does not populate `CONFIG.CPR`; bridge imports the default export of `modules/system/config.js` instead and exposes `interfaceAbilities()` (localized list + free-flagged Speed/Defense).
- Speed/Defense rows use the system generic i18n keys `CPR.global.generic.speed`/`.defense` (no per-ability keys exist).
- Demon "Action" roll uses `createStatRoll("interface")` (valid demonStatList key).

### Fix pass (blocker/major/minor batch)
- **Auto-roll defence no longer throws on a missing event.** `CPRRoll.handleRollDialog` (cpr-rolls.js:263) dereferences `event.ctrlKey`/`.metaKey` unconditionally, so the eventless auto-roll call sites in `main.js` (`bridge.rollEntityStat(actor,"def")`, `bridge.rollInterface(actor,"defense")`) crashed. Every bridge roll that forwards an event into `handleRollDialog` (`rollInterface`, `rollProgram`, `rollEntityStat`, `rollEntityDamage`) now defaults it first: `event = event ?? { ctrlKey: true, metaKey: false, type: "auto" }`. **Dialog-skip decision:** the synthetic event SKIPS the dialog. Evidence — cpr-rolls.js:263-270: `skipDialog = event.ctrlKey || event.metaKey`, and the `invertRollCtrlFunction` setting is only applied when `event.type === "click"`. A non-`"click"` synthetic with `ctrlKey:true` therefore takes the plain, non-inverted path → `skipDialog === true`, so auto-rolls never pop a confirmation dialog on the GM client. Interactive call sites still pass the real DOM event and behave normally (ctrl/setting honoured).
- **Editor centre pane branches on the `editor` payload, not raw `state.editorArchId`.** `editor.getData` returns a truthy `editor` key only when `currentDraft` resolves (the arch is still stored and tab-open). `shell.hbs` now uses `{{#if editor}}…{{else}}canvas{{/if}}`, so a stale `editorArchId` pointing at a deleted arch renders the canvas instead of a blank pane. Additionally, `tree.js` arch-delete/folder-delete handlers clear `app.state.editorArchId`/`app.state.draft` when the deleted arch (or an arch under a deleted folder — detected by checking whether `state.editorArchId`'s arch still exists in `netArchs` after the mutate) was the one open in the editor, mirroring `tabs.js` tab-close.
- **Damage-op target ownership (server-side).** `ent.damage`: non-GM callers must own a session participant AND their own `session.targets[callerId]` must be an `ice:`/`demon:` ref resolving (via `netArchs` floors) to exactly `payload.actorId`; otherwise `{error:"CRNS.Errors.NotYourTarget"}`. `run.progDamage`: non-GM callers' target must equal `prog:${pid}:${programId}`. Both ops clamp `amount` to a whole number in 0..500 (`clampDamage`; the fix-list's "1..500" floor is applied as 0..500 so an accidental 0 is a harmless no-op rather than an error). The GM path is unrestricted (still clamped). New lang key `CRNS.Errors.NotYourTarget` (en/ru). The damage-box UI already derives its ref from the caller's own target (`buildDamageBox` → `targetReadout(session, game.user.id)`), so no UI change was needed.
- **`arch.update` reconciles the live session.** After replacing the arch and reconciling actors, participants in that arch have `floorIndex` clamped to `0..floors.length-1`, and every `session.targets` entry whose `ice:`/`demon:` ref carries this archId is dropped unless its floor + entity still exist and the def still has an `actorId`. `session` is only re-written when something changed. `tree.delete` additionally prunes `session.targets` entries referencing any deleted arch's ice/demon (it already disconnected participants and closed tabs).
- **Black ICE `tgt` comment corrected (FIX 5).** `constants.js` now documents the rulebook-correct semantics: `tgt "N"` = anti-NETRUNNER → `antipersonnel`; `tgt "P"` = anti-PROGRAM → `antiprogram`. The bridge mapping (`tgt==="P" ? "antiprogram" : "antipersonnel"`) was already correct and is unchanged.
- **Minor batch.** `runners.js` in-session rows now always carry `actorUuid`/`userId` (populating `runners.hbs` data attributes). `arch-canvas.js` `buildEntity` img fallback aligned to `icons/svg/mystery-man.svg`. Dead lang keys `CRNS.Canvas.Derezzed`/`CRNS.Canvas.Target` removed from both files (zero references). The GM double-click-to-open-sheet handler now sets `app.state.selection` to the chip's ref first, so the click+dblclick sequence leaves the chip selected instead of toggled off.

### Bug-fix + feature batch (context-scope bugs, GM entity moves, ownership badge)
- **BUG 1 — root-floor icon fixed (Handlebars context scope).** `arch-canvas.hbs:19` read `{{canvas.rootIcon}}` inside `{{#each canvas.floors as |floor|}}`, where the context is the floor item, so `canvas.rootIcon` resolved to nothing and the Root_Access marker `src` was empty. Fixed JS-side: the floor view-model in `arch-canvas.js` now carries `rootIcon: isRoot ? FLOOR_ICONS.root : ""`, the template uses `{{floor.rootIcon}}`, and the now-dead top-level `canvas.rootIcon` key was removed.
- **BUG 2 — runner-connect no longer permanently disabled (same class of bug).** `runners.hbs:39` read `runners.hasActiveTab` inside `{{#each runners.rows as |row|}}` → `undefined` → the `{{#unless}}` always rendered `disabled` + the NoActiveTab title. Fixed JS-side: `runners.js` adds `hasActiveTab: !!activeTab` to every row object (both the in-session branch and the auto-listed branch); the template switches to `row.hasActiveTab` in both the title `{{#if}}` and the `{{#unless}}`. The dead top-level `runners.hasActiveTab` key was removed.
- **Full template sweep for the same context mistake.** Every `{{#each}}` block across all eight templates was checked for references to top-level `getData` keys (`canvas.`, `runners.`, `tree.`, `editor.`, `actions.`, `tabs*`, `state.`, `isGM`) that are neither `@root`/`../`-prefixed nor provided on the item. Only the two diagnosed instances existed (`arch-canvas.hbs:19`, `runners.hbs:39`). All other blocks already use item-scoped keys or correctly `../`-prefix parent keys (`editor.hbs` `../editor.kinds`/`../editor.demonBudgetFull`; `actions.hbs` `../actions.pid`/`../actions.actorId`). No further fixes needed.
- **FEATURE — GM moves ICE/Demon/Program between floors.** New GM-only ops in `data.js`: `ent.move {archId, entId, toFloorIndex}` finds the ICE/Demon def in any floor, validates target capacity (ice → `< MAX_ICE_PER_FLOOR`; demon → target has no demon), moves the def, and rewrites any `session.targets` `ice:`/`demon:` refs whose floorId segment changed; returns `{error:"CRNS.Errors.FloorFull"}` on a capacity violation. `run.progFloor {pid, programId, floorIndex|null}` maintains `session.progFloors = { "<pid>|<programId>": floorIndex }` (null deletes). `session` gains a `progFloors: {}` default. Cleanup of `progFloors` keys added wherever the rezzed mirror is cleared: `run.setRezzed` (state null, per-program), `session.disconnect`, and jack-out (`run.jack` with `in:false`), via a shared `clearProgFloors(session, pid)` helper.
- **FEATURE — prog-entity placement override.** `arch-canvas.js` builds rezzed Black-ICE prog chips once (grouped by render-floor index) instead of per-floor: the render floor is the owning runner's `floorIndex`, overridden and clamped by `session.progFloors["<pid>|<programId>"]` when present.
- **FEATURE — GM drag & drop of entity chips.** Entity chips (`ice:`/`demon:`/`prog:`) get `draggable="true"` for the GM (view-model `gmDraggable`, applied in `entity-card.hbs`); `dragstart` sets `text/plain` JSON `{crns:"ent", ref}`. The existing GM floor-drop handler now distinguishes payloads: `{crnsRunner}` → `session.move` (unchanged), `{crns:"ent"}` → `ent.move` for ice/demon or `run.progFloor` for prog (pid parsed from the `prog:` ref allowing `:` inside the pid). `{error}` results surface via `ui.notifications.warn(loc(error))`.
- **FEATURE — ownership badge on netrunner-owned ICE.** Prog chips carry `owner: { name, img, color, title }` — the owning participant's actor name/img, the owning user's colour (`participant.userId → game.users.get(...)?.color`; GM/NPC runners fall back to the active GM's colour, else `#8f8f8f`), and a pre-formatted localized `title` via `CRNS.Canvas.OwnedBy`. `entity-card.hbs` renders a `.crns-ent-owner` corner badge (`--owner-color`, `title`, avatar img) when `ent.owner` is present. Styled in `styles/netrunning.css` with the other entity-chip rules (not the HARD OVERRIDE block): ~18px round avatar, 2px `var(--owner-color)` border, glow, absolute top-right.
- **New lang keys (en/ru parity):** `CRNS.Errors.FloorFull` ("That floor has no free slot for this entity." / "На этом этаже нет свободного слота для этой сущности.") and `CRNS.Canvas.OwnedBy` ("Netrunner's ICE: {name}" / "Лёд нетраннера: {name}").

### Targeting-fix + program-targeting + Black-ICE-SPEED-test batch

- **FIX A — targeting gestures.**
  - `suite-app.js` `_onKeyDown` now binds the target key by **physical code** (`ev.code === "KeyT"`) instead of `ev.key === "t"/"т"`. Root cause: Foundry core binds hotkeys by physical code, and on the Russian ЙЦУКЕН layout the physical **T** key produces the character `"е"`, so `ev.key` never matched `"t"`/`"т"` and the target gesture silently failed for RU-layout users. `Escape` still uses `ev.key`. The handler also **bails early when the event target is inside `input, textarea, select, [contenteditable]`**, so the key never hijacks typing (rename fields, REZ boxes, chat).
  - **Focus reliability.** (a) `suite-app.js` `activateListeners` adds a `pointerdown` listener on `.crns-root` that calls `rootEl.focus({preventScroll:true})` unless the pointerdown target is a form field — so clicking anywhere in the window arms the T key. (b) `arch-canvas.js` chip `mouseenter` focuses `.crns-root` (found via `ev.currentTarget.closest(".crns-root")`, with `preventScroll`) **only** when `document.activeElement` is `document.body` or lies outside the app window element — so hovering a chip arms the T key without stealing focus from chat/dialog typing.
  - **Feedback.** All three action-bar variants (runner/entity/none) already render the current target readout via `crns-target-readout` when `actions.target.ref` is set; verified consistent — no change needed.
- **FEATURE B — targetable activated programs.** `arch-canvas.js` builds, for each runner participant, a `progMinis` array of **every rezzed NON-blackice program** (booster/defender/attacker) sourced from the backing actor's equipped deck (`installedPrograms`, `isRezzed`, `class !== "blackice"`). Rendered inline in `arch-canvas.hbs` as a compact `.crns-prog-mini` row under the runner chip (existing rezzed **blackice** programs keep their full `prog:` chips as before). Each mini-chip carries `entityRef = prog:<pid>:<programItemId>`, a class icon (`fa-arrow-trend-up` booster / `fa-shield-halved` defender / `fa-burst` attacker), the current REZ value when the program has a rez pool, a program-name tooltip, and per-user target markers. Mini-chips are added to the canvas `chips` selector (`.crns-prog-mini`) so they share the hover/click/contextmenu targeting wiring and the pan-bail-out; they are **owner-selectable** (via `canSelect`) and **targetable by anyone**, but **NOT draggable**. `run.progDamage` already accepts these `prog:` refs (same format; `parseProgRef` is robust to `:` inside the pid). Styled in `styles/netrunning.css` (glass row, ~16px icons) above the HARD OVERRIDE block.
- **FEATURE C — Black ICE attack-of-opportunity SPEED test + turn queue (Corebook p.205).**
  - **Tie rule (recorded per §13 requirement): ties go to the RUNNER.** The runner is *defending* against the ICE's attack of opportunity, so the ICE must **strictly exceed** the runner's SPEED total to land its effect (`avoided = runnerTotal >= iceTotal`).
  - `session` gains `pendingTests: []` (default + lazy init in ops). The GM-side ops that PLACE a runner on a floor — `session.move` and `session.connect` (with `archId`, floor 0) — call `triggerFloorIce(session, archId, pid)`: for each alive Black ICE on the destination floor (backing actor `rez.value > 0`) with **no existing pending test for this pid+iceRef**, it pushes `{id: uid("st"), pid, ref, iceActorId, iceName, ts}`, calls `moveToTopOfQueue(iceActorId)`, and posts a localized `crns-chat-card` ("«{name}» reacts to the intrusion!"). GM dragging ICE onto a runner's floor goes through `ent.move`, which does **not** trigger (only runner movement provokes, matching the rule).
  - `moveToTopOfQueue(actorId)` (exported from `data.js`, core Foundry Combat API only) finds/creates an **actorId-only** combatant (legal in v12; name/img fall back to the actor) and sets its initiative to `max(others)+1`. No active combat → returns false and the encounter card whispers the GM a "no active combat — queue unchanged" hint.
  - **Runner action bar:** when `session.pendingTests` has entries for the displayed runner, `actions.js` builds `speedTests` and `actions.hbs` renders a warn-styled `.crns-speedtests` block at the **top** of the runner variant — per test: ICE name + "SPEED TEST" label + a **Roll** button. Click → free `bridge.rollInterface(actor, "speed", ev)` (no NET-action spend); on a non-null roll it `notifyClients({kind:"speedTest", testId, pid, runnerTotal})` and re-renders optimistically. A cancelled roll leaves the test pending.
  - **`main.js` notify consumer (primary GM):** on `{kind:"speedTest"}` it looks up the pending test, rolls the ICE's SPD via `bridge.rollEntityStat(iceActor, "spd")` (synthetic event skips the dialog), compares with the runner tie-to-runner rule, posts a SPEED-TEST comparison card (extended `postComparisonCard` with a titled `avoided`/`failed` variant + a "ties go to the runner" note), on a runner loss additionally posts the ICE's effect text (shared `postEffectCard` helper duplicated minimally into `main.js`), then `mutate("run.clearSpeedTest", {testId})`.
  - **New ops:** `run.clearSpeedTest {testId}` (GM or the owner of the test's pid; idempotent); `ent.toQueue {actorId, demon?}` (GM — manual "to top of queue"; demons post a distinct "activated" card). The entity action panel gains a plain **"To top of queue"** button (ICE) and an **"Activate"** button (demon → `ent.toQueue {demon:true}` + "Demon activated — top of the turn queue" card).
  - **Cleanup — pendingTests pruning** added in: `session.disconnect` (that pid), `disconnectArchParticipants` (used by `tabs.close`/`tree.delete` — participants of those archs), `tree.delete` (tests whose ICE lived in a deleted arch), `arch.update` reconciliation (tests whose floor/ice no longer resolves), and `ent.damage` (when the hit derezzes an ICE — `rez` reaches 0 → drop tests with that `iceActorId`). `ent.damage` was refactored so the GM and non-GM paths share one apply-then-prune tail.
  - **New lang keys (en/ru parity):** `CRNS.Actions.{SpeedTest, SpeedTestRoll, SpeedAvoided, SpeedFailed, SpeedTieNote, ToQueue, ActivateDemon}` and `CRNS.Chat.{IceReacts, TurnQueue, NoCombat, DemonActivated, ToQueue}`. (`CRNS.Actions.ActivateDemon` is a distinct label from the pre-existing `CRNS.Actions.Activate` = "Activate program".)

## 14. Round-2 feature batch (user feedback 2026-07-13)

Binding requirements; implemented in two phases: **G1 (mechanics/data/ops)** and **G2 (UI/rendering)**. Recorded decisions here override earlier sections where they conflict.

### 14.1 Turn queue: equal initiative, above the current top (replaces "+1")
`moveToTopOfQueue(actorId)`: set initiative EQUAL to the current highest initiative (or the combat''s first combatant''s initiative), NOT top+1. Ordering above ties: the CPR system does not override `_sortCombatants` (verified), core v12 tie-breaks arbitrarily by id — so main.js (ready hook) monkey-patches `CONFIG.Combat.documentClass.prototype._sortCombatants`: when initiatives are equal, compare combatant flag `cyberpunk-red-netrunning-suite.queueTs` DESC (newer first — "most recently encountered on top"), else fall back to the original comparator. Combatants we bump get `queueTs = Date.now()`. Keep the original function reference; patch idempotently.

### 14.2 SPEED test UX
- Each pending test row gets a dismiss ✕ (op `run.clearSpeedTest`, owner or GM) — skip without rolling.
- The runner''s SPEED roll passes the REAL click event into the system pipeline so the standard CPR roll-verify dialog appears (players can add LUCK). Only the GM''s ICE-side roll stays dialog-skipped (synthetic event).

### 14.3 Program chips redesign
Bigger chips (~52-60px), dominated by a 3-letter code (monospace, big, glowing). `PROGRAM_ABBR` map in constants.js for the known set (Eraser ERS, See Ya SYA, Speedy Gonzalvez SPG, Worm WRM, Armor ARM, Flak FLK, Shield SHD, Banhammer BAN, Sword SWD, Deck KRASH KRS, Hellbolt HLB, Nervescrub NRV, Poison Flatline PSN, Superglue GLU, Vrizzbolt VRZ — key by lowercased name match) + fallback: uppercase name, strip vowels after first char, first 3 chars. Applies to the action-bar program strip AND the canvas mini-chips (mini keeps smaller size but shows the code). Tooltip = full name + class + REZ.

### 14.4 + 14.5 Static 3-zone action bar with a permanent target panel
The action bar is a FIXED-HEIGHT (do not grow/shrink with content; pick ~200px) 3-zone grid that never reflows the viewport:
- LEFT zone (fixed ~260px): current selection panel — portrait, name, REZ/pips, entity/runner controls. Empty-state placeholder ("no selection" prompt) when nothing selected.
- CENTER zone (flex): abilities strip + programs strip (runner variant) / entity action buttons; scrolls internally.
- RIGHT zone (fixed ~240px): TARGET panel — always present: my current target''s portrait, name, kind, REZ bar (when resolvable), damage box, clear-target button; empty-state placeholder when no target. (Answers "информация о цели должна отображаться где-то".)
Selecting/targeting must not move the window or the canvas: all three zones always rendered (placeholders), the bar height constant, viewport height therefore constant.

### 14.6 DV / opposed-roll audit (global rule)
- DV checks: success ONLY when total > DV (DV 10 → need 11+). Sweep every comparison.
- Opposed checks: DEFENDER wins ties. Attack vs defense: hit = atk > def (already). SPEED test: ICE is the attacker → runner avoids when runnerTotal >= iceTotal (equivalent; keep). Slide: runner initiates → success only when runnerTotal > icePerTotal.

### 14.7 Interface-ability logic, floor markers, fog of war
New world state `session.floorState = { "<archId>:<floorId>": FloorFx }`:
```js
FloorFx = { breached: false, cloaks: [{id, pid, dv}], viruses: [{id, pid}],
            control: { pid, dv } | null, eyedee: [pid, ...] }
```
Ability availability (runner action bar): if contextual condition unmet → chip gets class `dim` (dimmed but STILL clickable; clicking rolls anyway, only the effect application is gated):
- **Backdoor** — lit when current floor kind === "password" && !breached. Flow: player rolls (system dialog); then op `run.abilityResult {ability:"backdoor", total}` (GM-side): resolves the runner''s current floor, beat = total > floor.dv → set breached=true; chat verdict card WITHOUT revealing the DV (localized "ВЗЛОМАНО"/"НЕ ПРОБИТО"). Movement gate (server-side in session.move for non-GM movers): cannot move DEEPER than an un-breached password floor (moving onto it is fine; past it is not). Players may only move ±1 floor per move (enforce server-side too).
- **Cloak** — always lit. After roll → op adds cloak marker {pid, dv: total} on the current floor (icon rendered on the floor card; DV visible to GM only).
- **Control** — lit when current floor kind === "controlnode" && floorState.control?.pid !== myPid. Beat DV (existing control.dv if contested, else floor.dv) → control = {pid, dv: total}. Controlled node renders tinted with the controller''s user color + name chip. While a runner controls ≥1 node, their action bar shows an extra ability chip **"Control Node"** (costs 1 NET action): pick one of their controlled nodes → transient activation pulse on that floor (notify {kind:"nodePulse"} → all clients animate ~2s highlight; no persistent state) + chat card.
- **Eye-Dee** — lit when current floor kind === "file" && !eyedee.includes(myPid). Beat floor DV → push pid into eyedee (file icon on that floor gets an "accessed" glow + small avatar of who accessed, GM sees list).
- **Pathfinder** — always lit. Fog of war for PLAYER runners (GM/spectators see everything): a player sees only floors they have VISITED (track `part.maxFloor`, updated in session.move/connect) plus their pathfinder reveal. Roll → op `run.abilityResult {ability:"pathfinder", total}`: GM-side computes reveal depth walking DEEPER from the runner''s current floor: up to `total` floors, stopping AT (inclusive) the first un-breached password floor whose dv > total; store `session.reveal[pid] = { [archId]: maxIndex }`. Player canvas renders only visible floors (others: nothing — chain link fades into a "???" stub after the last visible floor). Players NEVER see floor DV badges (hide DV from non-GM everywhere).
- **Virus** — lit only when current floor is the LAST floor (root). After roll → virus marker {pid} on the floor (icon).
- **Slide** — lit when my current target is an `ice:` ref (not demon). Opposed: runner rolls slide (dialog); ICE rolls PER GM-side (notify pattern like speedTest, kind:"slideTest"); success = runnerTotal > icePerTotal → remove the ICE''s attachment to this runner (14.11) + record in `session.slid = [{archId, iceId, pid}]`; the ICE chip shows a "slid" badge (crossed-eye) for that runner; a slid ICE never re-attaches to that runner (until GM clears).
GM overrides (GM-only ops + UI): clear any cloak/virus marker (✕ on the marker), toggle breached on any floor, set/clear control (and pick controller), clear eyedee entries, clear a runner''s reveal (`session.reveal[pid]` delete), clear slid records, detach/attach ICE. UI placement: GM floor-marker chips are clickable (✕ affordance); breach/control/eyedee toggles in a small GM popover per floor (gear icon on floor card, GM only).

### 14.8 Demon rework
- Defense vs netrunner attacks: demons now ROLL 1d10+Interface (change the auto-roll rollRequest demon branch from static CN to `rollEntityStat(actor, "interface")`).
- Combat Number: stays ONLY as a separate action button on the demon panel ("Combat Number" static card, as today).
- Demons gain **Zap** (attack roll 1d10+Interface, same semantics as a netrunner Zap; posts attack card; participates in auto-roll comparison vs the targeted runner''s defense) and a **NET-action counter**: `session.demonState = { [actorId]: { value, max } }`, max seeded from DEMONS[type].actions; pips on the demon panel; Zap / Action / Combat Number each spend 1 (dim at 0 but clickable per the dim rule? — actions that SPEND: block at 0 with warn, same as runner); reset button.
- Combat hook (14.10): on combatTurn/combatRound, primary GM resets the counter of the runner OR demon whose actor is the new combatant (start of their turn). Keep existing runner reset; add demon.

### 14.11 Black ICE follows the player''s netrunner
- On encounter trigger (runner enters a floor with alive ICE): if the runner participant belongs to a PLAYER (part.userId !== "" and user is not GM) AND the ICE''s follow option is enabled → create attachment `session.attachments = [{archId, iceId, pid}]` (skip if this ice+pid is in session.slid). GM-controlled runners never auto-attach.
- Follow option: per-ICE toggle shown in the ICE entity panel (GM): flag on the backing actor `flags.cyberpunk-red-netrunning-suite.follow` (default TRUE — per the rulebook both anti-personnel and anti-program ICE follow until derezzed or slid). Panel also shows current attachment ("Привязан к: <runner>") + detach button + attach-to-runner select (runners on the same arch).
- Movement: in session.move (any mover), after the runner lands, move every attached ICE''s def onto the runner''s new floor (internal def-move helper; RUNTIME follows may exceed the 3-ICE editor cap — allowed, note in chat nothing; update targets refs'' floorId like ent.move does). Derez (rez 0) → drop its attachments. Slide success → drop that attachment + record slid.

### 14.12 Player Black ICE: trap vs deployed
`session.progState = { "<pid>|<programId>": { mode: "trap"|"deployed", targetRef: "", floorIndex } }` (replaces/extends progFloors usage for BI):
- Activating an own blackice program: if the player currently has a valid target → **deployed** mode vs that target (targetRef stored; canvas draws an SVG line from the BI chip to the target chip — see below). If NO target → **trap** mode: forbidden while a combat is active (game.combat?.started → warn + abort); placed on the runner''s CURRENT floor; renders as an arch-ICE-like chip with a distinct TRAP badge (mine/bear-trap icon overlay); it obeys architecture-ICE rules and does NOT act for its owner (GM controls it via the normal entity panel).
- Retarget: costs **2 NET actions** — "Retarget" button on the deployed BI chip''s owner panel: requires a current target; spend 2 (block+warn if <2), update targetRef (chat card "deactivated and reactivated against <target>").
- Derez a TRAP BI: only when the owner runner stands on the same floor as the trap (validate; warn otherwise). Deployed BI derez: as today.
- Ownership visuals (extends the existing owner badge): every prog-BI chip shows the owner badge; DEPLOYED BI draws a target line: `<svg class="crns-lines">` overlay inside .crns-stage (full stage size, pointer-events none, z between links and chips); after each render compute chip centers in stage-space (getBoundingClientRect of chip and stage, divide deltas by cam.z) and draw <line> per deployed BI with a theme-accent dashed stroke + slow dash animation; skip when either end is off-view (fog).

### Notes
- All new ops re-validate permissions GM-side (owner-or-GM per participant; GM-only for overrides).
- All comparisons follow 14.6. All new strings en+ru. Dim = class only, never disabled (except explicit 0-action spends which warn).
- progFloors (GM manual placement) stays; trap floorIndex reuses it where sensible — implementer''s choice, record in §13.

### Round-2 G1 (mechanics/data/ops — 2026-07-13)

- **§14.1 turn queue.** `moveToTopOfQueue(actorId)` now sets initiative EQUAL to the current highest (was top+1). It stamps the combatant flag `cyberpunk-red-netrunning-suite.queueTs = Date.now()` BEFORE setting initiative. `main.js` `patchSortCombatants()` (called from the `ready` hook, idempotent via a `_crnsSortPatched` marker on the prototype) wraps `CONFIG.Combat.documentClass.prototype._sortCombatants` (the CPRCombat prototype — verified the CPR system does NOT override `_sortCombatants`; `cpr.js:142` sets `CONFIG.Combat.documentClass = CPRCombat`). On equal initiative it compares `queueTs` DESC (newest first), else delegates to the original comparator (reference kept in a closure).
- **§14.6 DV/opposed audit.** Full table below (all sites verified/correct). New DV checks introduced by `run.abilityResult` all use strict `total > dv` (DV 10 → 11+). Opposed: slide `runnerTotal > iceTotal` (runner initiates → ties to ICE), speed `runnerTotal >= iceTotal` (runner defends → ties to runner, unchanged), attack `atkTotal > defTotal` (unchanged). Pathfinder stop uses `dv > total` (a floor the runner cannot beat blocks reveal — the exact complement of the `total > dv` success rule).
- **§14.7 floor state.** `session.floorState` keyed `"<archId>:<floorId>"` → `{breached, cloaks:[{id,pid,dv}], viruses:[{id,pid}], control:{pid,dv}|null, eyedee:[pid]}`. `run.abilityResult {pid, ability, total, extra?}` (owner-or-GM; pid resolved server-side via `resolveActingRunner`) handles backdoor/cloak/control/eyedee/virus/pathfinder; each posts a PUBLIC verdict chat card with neutral wording that never prints the DV number. Returns `{ok, applied}`. Movement gating added to `session.move` for non-GM movers: ±1 step (`CRNS.Errors.MoveStep`) and no stepping deeper OFF an un-breached password floor (`CRNS.Errors.PasswordBlocked`); `part.maxFloor` tracked in `session.move` and reset in `session.connect`/disconnect. `run.nodePulse {archId, floorId}` (GM or controlling-pid owner) emits `notifyClients({kind:"nodePulse", archId, floorId})` + chat card. GM overrides: single flexible op `fx.clear {archId, floorId, kind, id?|pid?|value?}` (kind cloak/virus by id, eyedee by pid, breach by boolean value, control by pid|null); `run.clearReveal {pid}`; `run.clearSlid {archId, iceId, pid?}`.
- **§14.7 slide / §14.11 attachments.** `session.slid` = `[{archId, iceId, pid}]`; `session.attachments` = `[{archId, iceId, pid}]`. Slide notify consumer in `main.js` (`handleSlideTest`, `{kind:"slideTest"}` → `{testRef, pid, runnerTotal}`): primary GM rolls ICE PER via `bridge.rollEntityStat(actor,"per")`, `success = runnerTotal > iceTotal`, on success calls `mutate("run.slideResolve", {archId, iceId, pid})` (drops the attachment + records slid) and posts a SLIDE comparison card (new `slide` variant of `postComparisonCard`). Auto-attach lives in `triggerFloorIce`: only when the runner participant's `userId` maps to a non-GM user, the ICE actor flag `follow !== false`, and not in `session.slid` for this ice+pid. Follow-on-move: `session.move` calls the shared internal `moveIceDefToFloor(session, archs, archId, iceId, toFloorIndex)` (runtime follows ignore the 3-per-floor cap; rewrites affected `session.targets` ice: floorIds). Ops `ice.setFollow {actorId, value}` (bridge `setActorFlag`), `ice.attach {archId, iceId, pid|null}`. Cleanup on derez (`ent.damage` → rez 0, mapped def-ids via `iceDefIdsForActor`), `tree.delete`/`tabs.close` (`disconnectArchParticipants`), `arch.update` reconciliation, `session.disconnect` (by pid), jack-out.
- **§14.8 demon.** `session.demonState = {actorId:{value,max}}` seeded lazily by `ensureDemonState` — reads the demon type from the actor flag `cyberpunk-red-netrunning-suite.type` (now written by `bridge.createDemonActor`), falling back to case-insensitive name-match against DEMONS keys (`bridge.getDemonType` for legacy actors). Ops `demon.spend {actorId, n}`, `demon.reset {actorId}` (GM-only). Auto-roll demon defense branch in `main.js handleRollRequest` now rolls `bridge.rollEntityStat(actor, "interface")` (valid `demonStatList` key) instead of the static CN. Combat reset (`resetRunnerForCombatant`) extended: a demon combatant resets its `demonState` on its turn.
- **§14.12 progState.** `session.progState = {"<pid>|<programId>":{mode, targetRef, floorIndex}}`. Ops: `run.progDeploy {pid, programId, mode, targetRef, floorIndex}` (owner-or-GM; trap forbidden when `game.combat?.started` → `CRNS.Errors.TrapInCombat`; deployed needs a valid `targetRef` → `CRNS.Errors.NoTarget`; trap floorIndex defaults to the runner's current floor, reusing the same index semantics as progFloors), `run.progRetarget {pid, programId, targetRef}` (owner-or-GM; rejects when `part.actions.value < 2` → `CRNS.Errors.NeedTwoActions`, then spends 2 atomically). progState cleanup on derez (`run.setRezzed` state null — drops the key AND its progFloors entry), disconnect, jack-out (via `clearProgState`). `canDerezTrap(session, pid, programId)` EXPORTED from data.js for G2 — returns true unless it's a trap and the owner is not standing on the trap's floor (server-side enforcement of an own-actor item write is impossible, so the UI must call this gate first; noted per §13 requirement).
- **constants.js.** `PROGRAM_ABBR` map (15 known programs) + `abbrFor(name)` fallback (uppercase, keep first char, strip vowels/spaces after it, first 3 chars; empty → "???").
- **Decision — one flexible `fx.clear` op** (not several small ops) for GM floor-marker overrides; keeps the OPS table small and the payload self-describing via `kind`.
- **Decision — `run.slideResolve` is its own GM-only op** rather than folding the slid/attachment write into `handleSlideTest` directly, because the notify consumer runs on the primary GM client but must go through `mutate`/`applyOp` for the world-setting write to stay on the single-writer path.
- **Known G2 follow-up (not a bug):** the existing player move UI (`arch-canvas.js` floor-move-here) fire-and-forgets `mutate("session.move", …)` and ignores the result, so a `PasswordBlocked`/`MoveStep` rejection fails silently. G2 should surface `{error}` via `ui.notifications.warn(loc(error))` on player moves.

#### DV / opposed comparison audit table
| site | comparison | rule | verdict | fixed? |
|---|---|---|---|---|
| `main.js` handleRollRequest (attack) | `atkTotal > defTotal` (via postComparisonCard default) | attack: hit = atk exceeds def, ties to defender | correct | no change |
| `main.js` handleSpeedTest | `runnerTotal >= iceTotal` | speed test: ICE attacks, runner defends → ties to runner | correct | no change (kept per §14.6) |
| `main.js` handleSlideTest (NEW) | `runnerTotal > iceTotal` | slide: runner initiates → must exceed, ties to ICE | correct | new, compliant |
| `main.js` postComparisonCard default | `atkTotal > defTotal` | attacker must exceed defender | correct | no change |
| `data.js` run.abilityResult backdoor | `total > floor.dv` | DV success = total > DV | correct | new, compliant |
| `data.js` run.abilityResult control | `total > contestDv` (existing control.dv else floor.dv) | DV/opposed, must exceed | correct | new, compliant |
| `data.js` run.abilityResult eyedee | `total > floor.dv` | DV success = total > DV | correct | new, compliant |
| `data.js` run.abilityResult pathfinder | stop when `f.dv > total` | inclusive stop at un-breached password floor total cannot beat | correct (complement of total>dv) | new, compliant |
| `data.js` session.move gate | `Math.abs(dest-from) > 1`, deeper-past-password | movement rule, not a DV/opposed roll | n/a | new |

### Round-2 G2 (UI/rendering — 2026-07-13)

Consumes the G1 ops/state verbatim; no data.js/main.js restructure (only a G2-scope call-site fix: player floor-move now surfaces `{error}`). Owns `apps/actions.js`, `apps/arch-canvas.js`, `apps/runners.js` (one row + handler), templates, CSS, lang.

- **§14.4/14.5 static 3-zone action bar.** `actions.hbs` is now a fixed-height (200px) CSS grid `260px 1fr 240px` → `.crns-zone-left | .crns-zone-center | .crns-zone-right`, ALL THREE always rendered (empty-state `.crns-zone-empty` placeholders) so selecting/targeting never reflows the viewport. `actions.js getData` still returns the three variants (`runner`/`entity`/`none`) but each fills the three zones. LEFT = selection portrait + identity + pips/REZ + primary toggles (jack/reset/reset-all/disconnect for runner; REZ-manage for entity). CENTER = speed-tests + abilities strip + programs strip (runner) / entity buttons (entity), `overflow:auto`. RIGHT = permanent TARGET panel (`actions-target.hbs`, new partial): portrait, name, kind label, REZ bar when resolvable, damage box (moved here from `actions-damagebox.hbs`, which is now only referenced by the render harness), clear-✕; placeholder otherwise. `targetPanel()` replaces the old `targetReadout()`/`buildDamageBox` top-level split and nests `damageBox` under `actions.target`.
- **§14.2 speed-test UX.** Per-test dismiss ✕ (`speed-test-dismiss` → `run.clearSpeedTest`, owner-or-GM `canDismiss` flag). The runner's speed roll already passed `ev.originalEvent||ev` (real event) — verified no dialog-skip on the player side; kept.
- **§14.3 program chips.** Action-bar chips are 56px columns dominated by the 3-letter `abbrFor(name)` code (`.crns-prog-code`, mono/glow), a small class icon, a REZ badge (`.crns-prog-rezbadge`), rezzed glow; trap/deployed get border variants. Canvas mini-chips gained `.crns-prog-mini-code`; full prog chips gained `.crns-chip-code`. Tooltip = `name · class · REZ`.
- **§14.7 ability UX.** `abilityAvailability(part, session, archs)` computes per-ability lit/dim (backdoor: password && !breached; control: controlnode && control.pid!==me; eyedee: file && !accessed; virus: last floor; slide: my target is `ice:`; others always). Unavailable → `dim` class (opacity .38 + grayscale, hover .6) — still clickable. Roll flow: after the interface roll, backdoor/cloak/control/eyedee/virus/pathfinder → `run.abilityResult`; slide → `slideTest` notify; zap/other → `maybeAutoRoll`. Extra **Control Node** chip (`hasControl`) appears when the runner controls ≥1 node → 0-action warn else a `Dialog` picker (or auto-pick when one) → `run.spend` + `run.nodePulse`. Controlled-node list is serialized to a `data-nodes` JSON attribute (HTML-escaped by Handlebars, parsed back client-side) — avoided adding a Handlebars helper to keep main.js untouched.
- **§14.7 canvas rendering.** Floor cards render a `.crns-floor-markers` row: broken/intact lock (password), `fa-user-ninja` cloaks, `fa-virus` viruses, control chip + whole-card `--control-color` tint, eyedee file glow + accessor avatars. GM markers carry inline `data-action="fx-*"` (→ `fx.clear`); a per-floor gear popover (`floor-gear` toggles `.open`) holds breach toggle + control set/clear select. **DV is GM-only** (`showDv`); `floor.dv` is zeroed for non-GM everywhere. **Fog of war** (player runners only; GM + spectators see all): `visibleMax = max(part.maxFloor, reveal[pid][archId] ?? -1, myFloor)`; deeper floor cards are filtered out and a dim glitch `.crns-fog-stub` "???" card is appended when `fogStub`. Attachment visuals: `.crns-ent-tether` link dot in the runner's colour ("привязан к …"); slid ICE gets `.crns-ent-slid` crossed-eye (runner-who-slid + GM). **nodePulse listener** registered module-level once (`ensureNodePulseHook`, guarded flag) → finds `.crns-floor[data-floor-id]` in the open app, toggles `.crns-node-pulse` for 2s (CSS animation, no re-render). Per-runner **hide-revealed** button lives in the runners panel row (`hasReveal` → `run.clearReveal`).
- **§14.8 demon panel.** Entity/demon variant shows action pips from `session.demonState` (falls back to `DEMONS[type].actions` before first spend), **Zap** (`rollEntityStat interface` → posts the attack + emits `rollRequest {vs:"defense"}` when a runner is targeted, matching the runner-attack contract in `main.js handleRollRequest`), **Action**, **Combat Number**, each spending 1 via `demon.spend` with a 0-action guard (`spendDemonAction`), plus a **Reset** button (`demon.reset`). GM-only.
- **§14.11 ICE panel.** Entity/ice variant adds a **follow** checkbox (`ice.setFollow`, default true via `bridge.getActorFlag !== false`), an attachment status line (`Привязан к: X` or `—`), a **detach** button and an **attach-to** `<select>` of runner participants on the arch (→ `ice.attach`).
- **§14.12 player BI deploy UX.** `activateBlackIce()`: valid current target (non-`prog:`) → rez + `run.progDeploy {mode:"deployed"}`; else combat-active → warn `TrapInCombat`; else rez + `run.progDeploy {mode:"trap", floorIndex}`. Canvas: trap BI chip gets a `fa-land-mine-on` badge + owner badge ("ловушка"); deployed BI chip carries `data-deploy-target` and `drawDeployLines()` draws dashed accent `<line>`s in a `<svg class="crns-lines">` overlay inside `.crns-stage` (z-index 0, pointer-events none) — chip centres computed in stage-space (`rect ÷ cam.z`), redraw per-render (deferred one rAF for layout), endpoints skipped when the target chip is missing/fogged. Retarget ✕→ `run.progRetarget` (server spends 2) on the deployed chip; trap derez gated client-side by `canDerezTrap` (warn `TrapDerezFloor`).
- **Decisions.** (1) Control-node list passed as an escaped-JSON data attribute rather than a new Handlebars helper — surgical, main.js untouched. (2) Deploy has no separate button — the single "activate" click decides trap vs deployed from the current target, so the speculative `Deploy*` lang keys were dropped. (3) `actions-damagebox.hbs` is now orphaned from `actions.hbs` (the damage box moved into the target panel) but kept, still exercised standalone by the render harness. (4) Spectators are treated as full-visibility (no fog) since there is no watched-runner binding in session state — DV is still hidden for them.
- **New lang keys (en+ru parity).** `CRNS.Canvas.{Breached,Locked,Cloak,CloakPlayer,Virus,Controlled,Accessed,AccessedBy,MoreFloors,AttachedTo,Slid,Trap,GmFloor,ToggleBreach,SetControl,ClearControl,HideReveal}`; `CRNS.Actions.{NoSelectionTitle,NoTargetTitle,NoTargetHint,TargetLabel,KindRunner,KindIce,KindDemon,KindProgram,ControlNode,ControlNodePick,Retarget,DemonZap,DemonReset,DemonActions,Follow,AttachTo,Detach,AttachmentNone,AttachmentTo}`; `CRNS.Errors.{TrapDerezFloor,NoControlledNode}`. Terms fixed: «взломан», «ловушка», «привязан», «скрытие/раскрытие».
- **Render harness (scratchpad).** `scenarios.mjs` reshaped for the 3-zone VMs + a new demon-panel scenario E and a fog scenario G; `run-render.mjs` adds assertions: all 3 zones render in every variant incl. empty states; the target panel populates vs placeholder; the `dim` class lands on unavailable abilities only; fog hides deep floors + renders the ??? stub; deploy/trap chips + SVG line overlay; floor markers + DV visibility; demon pips/Zap/Reset; ICE follow/attach. 120/120 render assertions pass; `node tools/verify.mjs` exits 0.

### Round-3 batch (Task 1 actor-backed player BI + Task 2 layout + Addenda — 2026-07-13)

- **Task 1 — actor-backed player Black ICE / "nonexistent Actor" warning (ROOT CAUSE).** The warning is the system's `CPR.messages.rezBlackIceWithoutToken`, fired at `cpr-cyberdeck.js:302-306` inside `_rezBlackIceToken`. Path: our `bridge.rezProgram` called `deck.rezProgram(program, actor.token ?? null)`; for a blackice program `deck.rezProgram` invokes `_rezBlackIceToken`, which — because netrunners in this suite have **no scene token** and we pass a null calling token — fails the token search (`tokenList.length !== 1`) and raises the message, warning that a Black-ICE Actor/Token could not be created. **Silencing mechanism (chosen):** `bridge.rezProgram` now replicates ONLY the safe subset of `deck.rezProgram` for a blackice program — `await program.setRezzed()` — and **skips the token spawn entirely** (never calls `_rezBlackIceToken`). Non-blackice programs still go through the full `deck.rezProgram`. This kills the warning at the source AND avoids spawning an unwanted canvas token; we don't touch `program.system.prototypeActor` at all (no scene involvement, so nothing to silence there). Module rule "derez restores REZ" means nothing mirrors back to the item.
- **Task 1 — backing actor lifecycle.** New bridge helper `createProgIceActor(snap, archName)` creates a `blackIce` Actor (type "blackIce", name = program name, `img = ENTITY_ICONS[lowercased-name] || program.img`, class from `program.system.blackIceType` clamped to the datamodel's `antipersonnel|antiprogram|other`, stats per/spd/atk/def + rez{value,max}) in the same `NET Architectures/<archName>` folder as arch entities. `run.progDeploy` (GM-side; owner-or-GM) reads the program snapshot from the owner's actor (`part.actorUuid` → `getOwnedItem`), creates the actor, and stores `actorId` in `session.progState["<pid>|<programId>"]` alongside `{mode,targetRef,floorIndex}`. Re-deploy reuses an existing live `actorId` (no duplicate). While rezzed the **ACTOR is the source of truth** for the prog entity's REZ/name/img: `arch-canvas.js` prog chips, `actions.js targetPanel` prog branch, and `main.js refToActor` (new `prog:` branch → resolves to the actor, typed as ICE for rolls) all read the actor when `progState.actorId` is set; **legacy** prog entities without `actorId` fall back to the program item (no crash). `run.progDamage` damages the ACTOR (`bridge.damageEntity`) instead of the item when `actorId` is present. **Deletion** (derez restores REZ so no mirror-back): new `deleteProgActors(session, pid, programId?)` + `progActorIdsForPid` delete the backing actors on derez (`run.setRezzed` state null, per-program), jack-out (`run.jack` in:false), `session.disconnect`, `runner.remove`, and arch teardown (`disconnectArchParticipants` made **async**, now deletes prog actors; `tree.delete` reordered to disconnect participants BEFORE deleting the arch folder; `tabs.close` awaits). Works identically for GM-run NPC runners (owner-or-GM resolve reads the same owned item).
- **Addendum bug — re-triggered SPEED test on follow-move.** `triggerFloorIce` now SKIPS any alive ICE whose `{archId,iceId}` is already attached to the MOVING runner's pid in `session.attachments` — the attack-of-opportunity is a one-time first-contact event, and attached ICE move together with the runner (follow logic), so without the skip every step re-provoked a test. Slid ICE and ICE attached to OTHER runners are unaffected (they may legitimately re-trigger for their own runner).
- **Addendum 2 — player Defense uses the standard CPR dialog.** (1) The action-bar Defense chip already passes the real click event (`ev.originalEvent || ev`) into `bridge.rollInterface(actor,"defense",ev)` and free abilities are NOT dialog-skipped (the bridge only synthesizes a skip-event when none is passed) — verified, unchanged. (2) `main.js handleRollRequest` now branches on the defender: GM-controlled defenders (ice/demon, or runner with `userId===""`) auto-roll GM-side as before; a **player-owned runner** target does NOT auto-roll — the primary GM emits `notifyClients({kind:"defenseRequest", pid, attackerName, total})`. That notify is consumed on EVERY client (not GM-gated) by `handleDefenseRequest`, which — only on the **owning** client (`part.userId === game.user.id`) — pushes a pending entry onto `app._pendingDefense` and re-renders. The runner action bar renders a warn/accent `.crns-defensetest` prompt block (reuses the speed-test row markup) naming the attacker with a **Defend** button + dismiss ✕; clicking rolls `bridge.rollInterface(actor,"defense",realEvent)` (standard dialog, LUCK available) then emits `notifyClients({kind:"defenseResult", pid, attackerName, attackerTotal, defenseTotal})`. The primary GM consumes `defenseResult` and posts the standard comparison card (attacker total vs defence, ties to defender). GM attack flows wired into this prompt: **demon Zap** already emitted the `rollRequest{vs:"defense"}` for a `runner:` target (now routed to the prompt for players); **GM ICE attack** (`entity-stat` atk) now emits the same `rollRequest` when the GM's current target is a `runner:`. (3) The runner SPEED-test roll already used the real event — unchanged.
- **Task 2.1 — left panel.** Players get NO left column: shell adds a `no-left` class on `.crns-root` when `!isGM`, and CSS `grid-template-columns` for `.no-left` (and `.no-left.right-collapsed`) drops the left track to `0`. For the GM the left panel is now COLLAPSIBLE exactly like the right runners panel: `app.state.collapsedLeft` (default `false`/expanded, already existed) toggles a 36px `.crns-tree-rail` (vertical `fa-sitemap` button) vs the full tree; a `data-action="tree-toggle"` button lives both in the tree header (`fa-angles-left`) and on the rail; `tree.js` binds `tree-toggle` on the whole html (before the `.crns-tree` guard) so it works in both states. Grid columns: left-collapsed → `36px 1fr 280px` (and combos with right-collapsed). New lang key `CRNS.Tree.Collapse` (en/ru).
- **Task 2.2 — bigger multi-row action bar.** `.crns-actions` height 200→**290px**, columns `280px 1fr 260px`, roomier gap/padding — height stays CONSTANT across all variants/empty states (static-layout principle from §14.4/14.5 kept). CENTER zone lays out in stacked rows that WRAP: abilities strip `flex-wrap:wrap` (multi-row), programs strip `flex-wrap:wrap` + `max-height:168px` (≈2 rows of the 56px chips) with `overflow-y:auto` beyond; speed/defence-test blocks stay on top. LEFT/RIGHT portraits 40/44→**64px**, pips enlarged (13px), left controls `flex-wrap`. `.crns-center` gets `min-height:180px` on the flexible `1fr` grid row so the canvas stays visible under the taller bar without ever forcing the 760px window to grow (window is resizable).
- **Task 2.3 — editor/canvas/fog under the new grid.** The editor still occupies the center (`shell.hbs {{#if editor}}` branch, unchanged); the grid change only resizes tracks, so editor/canvas/fog render intact (verified by the shell harness scenarios A–G).
- **Addendum 3 — advance into fogged floor.** `arch-canvas.js` computes `canvas.fogStubMove`/`fogStubIndex`: true when the fog stub directly follows the runner's current floor (`visibleMax === myFloor && myFloor+1 <= lastIndex`). The stub then renders a `.crns-fog-move` chevron (`data-action="floor-move-here" data-floor-index="myFloor+1"`, same handler, which already surfaces `{error}` via `ui.notifications.warn`). CSS resets the button's opacity/filter (the stub is dimmed) and accents it. Server-side gates in `session.move` (±1 step, un-breached-password block) are unchanged and still apply. New lang key `CRNS.Canvas.Advance` (en "Advance into the unknown" / ru "Шагнуть в неизвестность").
- **New lang keys (en+ru parity):** `CRNS.Tree.Collapse`, `CRNS.Canvas.Advance`, `CRNS.Actions.{DefensePrompt,DefenseRoll}`.
- **Render harness.** `scenarios.mjs`: scenario C gains `actions.defenseTests`, scenario G gains `canvas.{fogStubMove,fogStubIndex}`. `run-render.mjs` adds assertions for the left-panel rail (GM collapsed) / no-left column (player), the defence-prompt block, and the fog-stub advance button. **126/126** render assertions pass; `node tools/verify.mjs` exits 0.

### Round-4 batch (Task A resizable bar + Task B vertical program list + BI rework — 2026-07-13)

- **Task A — user-resizable action-bar height (per-client).** The bar height is driven by a CSS custom property `--crns-bar-h` (`.crns-actions { height: var(--crns-bar-h, 290px) }`). A slim top-edge drag handle (`.crns-bar-handle` → `.crns-bar-grip`, `data-action="bar-resize"`, `cursor: ns-resize`) is rendered at the top of `.crns-actions` in `actions.hbs`. `actions.js wireBarResize(app, html)` (called first in `activateListeners`) wires a `pointerdown` → `pointermove`/`pointerup` drag that live-sets `--crns-bar-h` inline on `.crns-root` (no re-render, no flicker), clamped to **min 200px … max 55% of the window content height** (`root.getBoundingClientRect().height * 0.55`). On drag end it persists the final height **debounced (250ms)** to a per-client user flag: `game.user.setFlag("cyberpunk-red-netrunning-suite", "barHeight", px)`. Double-clicking the handle **resets** to the 290px default (`root.style.removeProperty` + `game.user.unsetFlag`). The persisted value is read in `suite-app.js` `get barHeight()` (clamped `>0`), added to top-level `getData`, and emitted by `shell.hbs` as `{{#if barHeight}} style="--crns-bar-h:{{barHeight}}px"{{/if}}` on `.crns-root` — survives re-render without flicker (the inline var matches what the live drag last set). The static-layout principle (§14.4/14.5) is preserved: height changes ONLY via the user's drag, never from content/selection. `body.crns-resizing` suppresses selection + hints the cursor during a drag.
- **Task B — vertical, information-rich program list (runner variant).** The horizontal 56px program chips (`.crns-act-programs`/`.crns-prog-chip`) are replaced by a VERTICAL list of full-width rows: `.crns-prog-list` (fills the remaining center-zone height under the abilities strip, `flex:1 1 auto; overflow-y:auto`) of `.crns-prog-row`. Row anatomy: `[.crns-prog-code big monospace, class-colored]` `[.crns-prog-ident: name + localized class label]` `[.crns-prog-badges: ATK/DEF/REZ (mini bar), hidden when the program lacks the stat]` `[.crns-prog-states: REZZED glow / TRAP / DEPLOYED / auto-derez hint]` `[.crns-prog-btns right-aligned]`. Class color coding via `--crns-prog-color` + left border stripe: booster=`--crns-good`, defender=`--crns-accent-2`, attacker=`--crns-warn`, blackice=`--crns-accent` (`.crns-progclass-{booster,defender,attacker,blackice}`). Rezzed rows glow + brighten; `derezzed` (rezzed with rez 0) dims. `programVMs` gained `classBucket`, `classLabel` (new `CRNS.ProgramClass.{booster,defender,attacker,blackice}` keys), `showAtk`/`showDef`/`showDefBtn` (DEF roll button = rezzed non-booster/non-defender only), `rezPct`, `derezzed`, `autoDerezHint`. ALL existing data-action wiring + dataset attributes preserved (`program-activate`/`-deactivate`/`program-roll` exec atk|damage|def). New button classes: none (rows reuse `.crns-mini`, already re-asserted in the HARD OVERRIDE block via `.crns-prog-btns button`). The GM acts-as-runner path uses the same runner variant, so it inherits the list.
- **Player Black-ICE semantics REWORK (replaces the standby-escort behavior — removed entirely).** Canonical rules: activate WITHOUT a target → **TRAP** on the runner's current floor, allowed BOTH in and out of combat (removed the `TrapInCombat` prohibition); activate WITH a target → **DEPLOYED** vs that target; a deployed BI whose target later vanishes just SITS idle (dangling `targetRef` is harmless — the line simply isn't drawn). NO owner escort/standby. Removed: `isStandby` VM flag + escort render-index logic in `arch-canvas.js` (deployed/trap ALWAYS render at their stored `ps.floorIndex`), the `.crns-chip-standby` badge + CSS + blink keyframe in `entity-card.hbs`/CSS, the `DeployedStandby` toast, the standby state badge in the program rows, and standby handling in `programVMs`/`activateBlackIce`. **Removed the Retarget/SetTarget button + flow entirely:** the `program-retarget` button (from the new program rows), its handler in `actions.js`, and the `run.progRetarget` OP in `data.js`. Target changes now happen naturally via Deactivate (1 action) then Activate with a new target (1 action). `run.progDeploy`: deployed REQUIRES a valid `targetRef` (`CRNS.Errors.NoTarget`); trap allowed regardless of combat. `activateBlackIce` simplifies to target→deployed / no-target→trap. Trap derez still gated by `canDerezTrap` (owner on the trap's floor, unchanged); deployed derez unchanged. **Lang keys removed** (both langs): `CRNS.Actions.{Retarget,SetTarget,DeployedStandby,StateStandby}`, `CRNS.Errors.{NeedTwoActions,TrapInCombat}` (verify check 5 confirms no dangling references; the never-added `CRNS.Canvas.Standby` reference is gone with the badge).
- **Deploy target line — much more visible (was "слишком незаметная").** `drawDeployLines` (`arch-canvas.js`) now emits a `<defs><marker>` arrowhead at the target end, a wide blurred `.crns-deploy-glow` underline (stroke 8, blur 3px), and the bright `.crns-deploy-line` on top (stroke 3.5px, `stroke-dasharray:10 6`, full accent at 0.95 opacity, double drop-shadow glow, marching-dash `crns-dashmove` animation). The `.crns-lines` overlay z-index raised 0→2 so lines draw ABOVE floor cards but still `pointer-events:none` (chip hover/click passes through). Missing/fogged/vanished target endpoints are skipped (`if (!dst) continue`) — verified.
- **Owner badge repositioned.** `.crns-ent-owner` moved from top-right (where the target crosshairs clipped it) to the **top-left** corner (`left:-6px; top:-6px; right:auto`), color ring kept, z-index 4. When an owned chip is also slid, `.crns-ent-owner ~ .crns-ent-slid` drops the slid badge below it to avoid overlap. `.crns-chip` overflow stays visible so the badge sits proud of the corner.
- **Initiative (verify-only, no change).** Triggered ICE go to the top of the queue (already, §14.1); the runner combatant is added with equal/null initiative (already) — matches the user's rules quote. No code change.
- **New lang keys (en+ru parity):** `CRNS.Actions.{ResizeHint,StateRezzed,StateTrap,StateDeployed,AutoDerezHint}`, `CRNS.ProgramClass.{booster,defender,attacker,blackice}`.
- **Render harness.** `scenarios.mjs`: scenario C gains `barHeight:360` and full program VM fields (classBucket/classLabel/showAtk/showDef/showDefBtn/rezPct/derezzed/autoDerezHint; Vrizzbolt rezzed for the attacker-row assertion); standby fields removed. `run-render.mjs` adds Task A assertions (inline `--crns-bar-h` emitted from `barHeight` / omitted without it / drag handle present) and Task B assertions (vertical list not the legacy chip grid; row code+name+class label; ATK/REZ badges shown + DEF badge hidden for the attacker; full button set for the rezzed attacker; no DEF roll button for the defender; state badges + auto-derez hint; no derezzed row when rez>0). **136/136** render assertions pass; `node tools/verify.mjs` exits 0.

#### Addenda 2–5 (player-BI reacts / initiative / chase-follow / disconnect confirm — 2026-07-13)

- **Addendum 2 — player-placed Black ICE reacts to OTHER runners like arch ICE.** `data.js triggerFloorIce`, after the arch-ICE loop, iterates player TRAP entries from `session.progState` (new helper `aliveTrapProgsOnFloor(session, archId, floorIndex)`: `mode==="trap"`, `floorIndex===` entered floor, owner connected to the arch, backing actor `rez>0`) whose `ownerPid ≠` the moving runner's pid; for each it pushes a `pendingTests` entry `{ref:"prog:<ownerPid>:<programId>", iceActorId: ps.actorId, iceName}`, `moveToTopOfQueue(actorId)`, and posts the `CRNS.Chat.IceReacts` card — identical to arch ICE. Dedup: existing pending test for pid+ref, and already-attached-to-this-runner. **Chase-on-trigger:** when the moving runner is player-controlled, the trap attaches to them via a NEW discriminated attachment shape `{archId, progKey:"<ownerPid>|<programId>", pid}` (kind decided by `progKey` vs `iceId` presence), skipped if that runner already slid this BI. `session.move`'s follow step handles both shapes: `progKey` → update `session.progState[progKey].floorIndex` (mode stays "trap", no def-move); `iceId` → the existing `moveIceDefToFloor`. **Slide vs player BI:** `actions.js abilityAvailability.slide` now lit for a `prog:` target that resolves to a `blackice` program (`progRefIsBlackIce`); the slide-roll notify fires for `ice:`|`prog:` targets; `main.js handleSlideTest` resolves `prog:` testRefs (PER roll off `progState.actorId`, name-derived type via `blackIceTypeForName`) and on success calls `run.slideResolve {archId, progKey, pid}`. `run.slideResolve`/`run.clearSlid` accept both `iceId` and `progKey`; `session.slid` entries are `{archId, iceId|progKey, pid}`. **Failed-speed-test effect:** `handleSpeedTest` resolves the effect via `refToActor(test.ref)` whose `prog:` branch now returns a `type` derived by name (`blackIceTypeForName` in `constants.js`: matches raw BLACK_ICE key + localized `CRNS.Ice.<Type>.name`, `""` for custom names → the comparison card still posts, effect card skipped). **Cleanup:** new `pruneProgBiSideEffects(session, actorId, progKey)` drops the pendingTests (by `iceActorId`), attachments + slid (by `progKey`) a player BI provoked; called from `run.setRezzed` (state null, per-program, capturing the actorId before delete) and folded into `clearProgState` (per-key) so derez / jack-out / `session.disconnect` / `runner.remove` / arch teardown all prune. `refToActor` prog branch verified (actor + name-derived type).
- **Addendum 4 — deployed BI enters initiative.** `run.progDeploy` (mode "deployed", after storing progState+actorId): ALWAYS `moveToTopOfQueue(actorId)` (auto-creates the combat like `triggerFloorIce`), posts the `IceReacts` card. If `targetRef` is `runner:<pid>` and that participant is a runner → register a `pendingTests` `{pid: targetPid, ref:"prog:<ownerPid>:<programId>", iceActorId, iceName}` (dedup) so the targeted runner gets the standard SPEED-TEST block (their dialog roll vs the BI's SPD, ties to the runner; on loss the existing failed-speed-test path posts the BI effect). Non-runner targets (ice/demon/prog) → queue-top + reacts card only, no test. Cleanup via the same `iceActorId` pruning.
- **Addendum 5 — deployed BI chases its runner target.** `run.progDeploy` (deployed, runner target) immediately creates the prog attachment `{archId, progKey, pid: targetPid}` to the TARGET runner (dedup; skipped if that runner already slid this BI), so the BI's `floorIndex` follows the target via the same `session.move` prog-follow step (origin-agnostic — trap trigger or deployment). The attachment ends on: (a) the target's disconnect/jack-out (`pruneAttachments(a.pid===pid)` in `session.disconnect`/`run.jack`; `runner.remove` extended to prune attachments+pendingTests by pid too), or (b) a successful slide (`run.slideResolve` with `progKey` drops the attachment + records slid). Non-runner targets get no attachment.
- **Addendum 3 — disconnect confirmation.** New shared `confirmDisconnect(pid)` (exported from `actions.js`, resolves the runner name, `Dialog.confirm` with `esc()`'d content) gates both `run-disconnect` (action bar) and `runner-disconnect` (`runners.js`, which now imports it — no import cycle: actions.js doesn't import runners.js). New lang keys `CRNS.Actions.{DisconnectConfirmTitle,DisconnectConfirm}` (en/ru).
- **Decision — `blackIceTypeForName` lives in `constants.js`** (alongside `abbrFor`/`getDemonType`-style helpers) so both `main.js` and any caller reach it without touching the bridge; it is name-only (no actor), returning `""` for custom-named player programs so the effect card is skipped gracefully.
- **Lang key parity 249/249.** New: `CRNS.Actions.{DisconnectConfirmTitle,DisconnectConfirm}`. No new Chat/Errors keys (reused `CRNS.Chat.IceReacts`, `CRNS.Actions.KindIce`). Harness: template render **136/136** unaffected (logic-only changes); an added scratchpad `bi-logic-test.mjs` covers the pure helpers + attachment-shape discrimination + prog-ref round-trip (9/9). `node tools/verify.mjs` exits 0.

#### Addendum 6 (cloak: per-floor → architecture-level — 2026-07-13)

- **Storage.** New session key `cloaks = { [archId]: [{id, n, pid, dv}] }` (added to the `WORLD_OBJECTS` session default). `n` = stable sequential number within the arch (1,2,3… in creation order, `max(existing n)+1`, never reused after deletion). Helper `archCloaks(session, archId)` returns/creates the per-arch list. Cloaks REMOVED from `floorState`: `emptyFloorFx`/`getFloorFx` drop the `cloaks` field; no migration (old per-floor cloaks in stored `floorState` are dead/ignored). Arch deletion (`tree.delete`) prunes `session.cloaks[archId]` alongside `floorState`.
- **`run.abilityResult` "cloak".** Operates on `archCloaks(session, part.archId)` for the roller's pid: find the roller's LOWEST-dv marker; if the new total beats it → replace that marker's `dv` (keep its `n`); else append `{id:uid("ck"), n:next, pid, dv:total}`. Verdict card unchanged (no DV revealed); `CRNS.Chat.Cloaked` reworded "…in the architecture" (was "…on this floor").
- **Visibility + render.** `arch-canvas.js` builds `canvas.cloakStrip` (+ `hasCloaks`): GM sees ALL cloaks; a player sees ONLY their own (pid ↔ a runner participant they own by userId or actor OWNER perm); spectators see none. Rendered as a fixed, non-pan/zoom overlay strip at the top-left of the viewport (`arch-canvas.hbs`, outside `.crns-stage`, styled `.crns-cloak-strip`/`.crns-cloak-mark`/`.crns-cloak-n`/`.crns-cloak-x`): one `fa-user-ninja` per marker + its number badge `n`; tooltip GM `CRNS.Canvas.CloakGM {n,owner,dv}`, owner `CRNS.Canvas.CloakOwner {n,dv}`. The per-floor cloak marker block + `.crns-fm-cloak` CSS were removed.
- **GM clear.** `fx.clear` handles `kind:"cloak"` at the ARCH level (no `floorId` — special-cased before the `getFloorFx` path): removes `session.cloaks[archId]` entry by `id`. New canvas action `fx-clear-cloak {archId, cloakId}` (replaces the old per-floor `fx-clear-marker kind=cloak`, which now serves virus only).
- **Lang.** Replaced `CRNS.Canvas.{Cloak,CloakPlayer}` with `CRNS.Canvas.{CloakGM,CloakOwner}` (en/ru); parity 249/249. **Harness.** Scenarios A/C drop per-floor `markers.cloaks` and gain `canvas.{hasCloaks,cloakStrip}` (A = GM two numbered marks + ✕; C = one player-owned mark, no ✕); the floor-marker assertion no longer checks per-floor cloaks; a new Addendum-6 block asserts the strip renders numbered marks with a GM ✕, no per-floor cloak remains, and a player sees a numbered own mark without the ✕. **139/139** render assertions pass; `node tools/verify.mjs` exits 0.

#### Damage-flow rework (2026-07-13)

Three user requirements + one addendum, recorded here.

- **Req 1 — GM can always apply damage to targeted netrunners/programs.** `actions.js buildDamageBox` now also returns a box for `runner:` targets **when `isGM`** (players keep ice/demon/prog-with-ownership rules). Apply routing (`applyTargetDamage`): ice/demon → `ent.damage`, prog → `run.progDamage`, `runner:` → new GM-only op `runner.damage {pid, amount}`. `runner.damage` resolves the participant's actor and calls new bridge helper `damageRunnerHp(actorId, amount)` → clamps 0..hp.max and writes `system.derivedStats.hp.value` (verified against `derivedStats-schema.js` / `HpSchema` — NET "brain damage" goes straight to HP in CPR RED).
- **Req 1 addendum — GM can also damage the SELECTED object (not just the target).** The GM entity panel's left-zone REZ management already carried a damage input for ice/demon/prog (prog panel is `entityKind:"ice"` backed by the prog actor → `ent.damage` works on it). For a RUNNER selection (GM "acts as" runner, `variant:"runner"` + `isGM`) a new GM-only left-zone control (`buildRunnerVM.gmDamage`, template `.crns-runner-dmg`, action `runner-damage-self`) applies to that runner via `runner.damage`, independent of the target panel. The target-panel box is unchanged.
- **Req 2 — destroyed program (REZ→0) becomes INACTIVE + correct chat target.** `run.progDamage` (BOTH actor-backed prog BI and item-backed program paths): after applying damage, if the resulting REZ ≤ 0 → new shared GM-side helper `autoDerezDestroyedProg(session, pid, programId)` deletes the backing prog actor, derezzes the program item on the owner's actor (`bridge.derezProgram` — module rule restores item REZ, fine; permanent deletion stays a manual GM action), clears the progState/progFloors entry + owner rezzed mirror, and prunes the reactions it provoked (pendingTests/attachments/slid). `ent.damage` on rez→0 already pruned pendingTests/attachments (kept). **Chat**: both damage ops now post a localized `postDamageCard(name, n)` naming the TARGET actor correctly (resolved from the damaged actor, fixing the wrong-entity report) and a distinct `postDestroyedCard(name)` when REZ hits 0. New lang keys `CRNS.Chat.{DamageTitle, TookDamage, DestroyedTitle, Destroyed}` (en/ru).
- **Req 3 — attacker program MISS auto-derezzes WITHOUT a damage roll.** The attacker-program identity `{pid, programId, isAttacker}` is threaded from the `program-roll` atk handler → `maybeAutoRoll` opts → the `rollRequest` notify payload (`attackerProg`). `main.js handleRollRequest`: on a GM-controlled defender, after the comparison card, when `atk <= def` and `data.attackerProg?.isAttacker` → new shared `derezAttackerProg()` resolves the owner actor from `pid`, `bridge.derezProgram`, clears the rezzed mirror (`run.setRezzed state:null`), and posts the `AttackerDerez` text as a CHAT CARD (not just a toast). Player-defence path: `defenseRequest`/`app._pendingDefense`/`defenseResult` all carry `attackerProg` through to `handleDefenseResult`, which runs the same miss auto-derez. `derezAttackerProg` and the existing post-DMG auto-derez are both idempotent (skip when the program is already derezzed → no error, no double card). The hit path (player rolls damage, attacker self-derezzes after) is unchanged.
- **Notify payload changes.** `rollRequest` gains `attackerProg: {pid, programId, isAttacker} | null`; `defenseRequest` and `defenseResult` gain the same `attackerProg` field. All other fields unchanged.
- **Harness.** Scenario A fixed (`showFollow:true`; runner target now carries a `damageBox`); new scenario **H** (GM acts-as-runner → `gmDamage` left-zone control). New render assertions: GM runner-target damage box routes to the `runner:` ref, the GM left-zone `runner-damage-self` control renders (absent for players), scenario H keeps the static 3-zone bar. `node tools/verify.mjs` exits 0; render harness **150/150** pass.
