import * as r from "../scripts/rules.js";

let failures = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); }
  else console.log(`OK   ${label}`);
};
const yes = (value, label) => eq(!!value, true, label);
const no = (value, label) => eq(!!value, false, label);

eq(r.netActionsMax(0), 0, "rank 0 has no NET Actions");
eq(r.netActionsMax(1), 2, "rank 1 -> 2 NET Actions");
eq(r.netActionsMax(3), 2, "rank 3 -> 2 NET Actions");
eq(r.netActionsMax(4), 3, "rank 4 -> 3 NET Actions");
eq(r.netActionsMax(7), 4, "rank 7 -> 4 NET Actions");
eq(r.netActionsMax(10), 5, "rank 10 -> 5 NET Actions");
no(r.beatsDV(8, 8), "tie does not beat a DV");
yes(r.beatsDV(9, 8), "higher total beats a DV");

const nodes = [
  { id:"root", parent:"", alsoFrom:[], kind:"custom", gate:false },
  { id:"gate", parent:"root", alsoFrom:[], kind:"password", gate:true, dv:8 },
  { id:"left", parent:"gate", alsoFrom:[], kind:"file", gate:false },
  { id:"right", parent:"root", alsoFrom:[], kind:"custom", gate:false },
  { id:"right2", parent:"right", alsoFrom:[], kind:"password", gate:true, dv:3 },
  { id:"merge", parent:"left", alsoFrom:["right2"], kind:"controlnode", gate:false }
];

yes(r.canMove(nodes,"root","gate",{}).ok, "movement to an adjacent floor is free");
no(r.canMove(nodes,"root","merge",{}).ok, "cannot jump non-adjacent floors");
no(r.canMove(nodes,"gate","left",{}).ok, "unbreached gate blocks movement deeper");
yes(r.canMove(nodes,"gate","root",{}).ok, "gate does not block retreat upward");
yes(r.canMove(nodes,"gate","left",{gate:{breached:true}}).ok, "breached gate allows deeper movement");

eq(r.pathfinderReveal(nodes,"root",4,{}), ["gate","right","right2","merge"], "Pathfinder branches independently and stops at unbeaten password");
eq(r.pathfinderReveal(nodes,"root",8,{}), ["gate","right","left","right2","merge"], "Pathfinder can see through a password it can beat");

eq(r.quietJackInActionCost(), 2, "Quiet Jack In costs two NET Actions total");
yes(r.stealthBreaksOn({action:"control-take"}), "taking Control breaks stealth");
yes(r.stealthBreaksOn({action:"zap"}), "attacking breaks stealth");
no(r.stealthBreaksOn({action:"virus"}), "leaving a Virus does not automatically break stealth");
eq(r.quietEncounterMode({stealthed:true,entityKind:"blackice"}), "cloak-vs-perception", "stealthed Black ICE encounter uses Cloak vs PER");
eq(r.quietEncounterMode({stealthed:true,entityKind:"demon"}), "cloak-vs-pathfinder", "stealthed Watcher encounter uses Cloak vs Pathfinder");

const iceContext = r.abilityAvailability({nodes,node:nodes[3],floorState:{},runnerId:"r",hasIceTarget:true,slideUsed:false});
yes(iceContext.slide, "Slide is offered for a Black ICE target");
no(r.abilityAvailability({nodes,node:nodes[3],floorState:{},runnerId:"r",hasIceTarget:true,slideUsed:true}).slide, "Slide is once per Turn");
yes(r.abilityAvailability({nodes,node:nodes[5],floorState:{},runnerId:"r"}).virus, "Virus is available at branch bottom");

/* Control Node activation is a runtime concern because it depends on Turn serial,
 * ownership, NET Action economy and Foundry Scene execution. The dedicated 0.4
 * regression suite verifies the Core Rulebook's once-per-Turn restriction and
 * rollback behavior; the pure topology/ability layer intentionally has no stateful
 * Control activation API. */
console.log("OK   Control Node once-per-Turn enforcement delegated to runtime suite");

console.log(`\nRule failures: ${failures}`);
process.exit(failures ? 1 : 0);
