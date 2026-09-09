import { ID } from "./store.js";
import * as rules from "./rules.js";

const PROJECTION_FLAG = "projectionFor";
const EXPOSED_ABILITIES = new Set(["backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus"]);
const clone = (v) => foundry.utils.deepClone(v);

function childrenOf(nodes, id) { return (nodes || []).filter((n) => n.parent === id || (n.alsoFrom || []).includes(id)); }
function frontierIds(arch, runner) {
  const anchors = new Set([...(runner?.visitedNodeIds || []), runner?.currentNodeId].filter(Boolean));
  const known = new Set(runner?.knownNodeIds || []), frontier = new Set();
  for (const id of anchors) {
    for (const child of childrenOf(arch.nodes, id)) if (!known.has(child.id)) frontier.add(child.id);
    const node = arch.nodes.find((n) => n.id === id);
    if (node?.parent && !known.has(node.parent)) frontier.add(node.parent);
    for (const extra of node?.alsoFrom || []) if (!known.has(extra)) frontier.add(extra);
  }
  return frontier;
}
function sanitizedEntity(entity) { return { id:entity.id, kind:entity.kind, label:entity.label || (entity.kind === "demon" ? "Demon" : "Black ICE") }; }
function iceSummary(arch, ref) {
  const id = String(ref || "").startsWith("ice:") ? String(ref).slice(4) : "";
  for (const node of arch?.nodes || []) {
    const entity = (node.entities || []).find((e) => e.kind === "blackice" && e.id === id);
    if (entity) return { ref:`ice:${entity.id}`, id:entity.id, label:entity.label || "Black ICE" };
  }
  return { ref:String(ref || ""), id, label:"Black ICE" };
}

function sanitizedNode(node, runner, runtime, visibleIds) {
  const known = new Set(runner?.knownNodeIds || []), visited = new Set(runner?.visitedNodeIds || []);
  const fx = runtime.floorState?.[node.id] || {};
  const identified = (fx.eyedee || []).includes(runner.id), controlledByMe = fx.control?.runnerId === runner.id;
  if (!known.has(node.id)) return { id:node.id, parent:visibleIds.has(node.parent)?node.parent:"", alsoFrom:(node.alsoFrom||[]).filter((id)=>visibleIds.has(id)), unknown:true };
  const physicallyKnown = visited.has(node.id) || runner.currentNodeId === node.id;
  const dataUnlocked = physicallyKnown && identified, isData = rules.floorHoldsData(node);
  return {
    id:node.id, parent:visibleIds.has(node.parent)?node.parent:"", alsoFrom:(node.alsoFrom||[]).filter((id)=>visibleIds.has(id)), unknown:false,
    scouted:!physicallyKnown, visited:physicallyKnown, label:node.label, kind:node.kind,
    gate:physicallyKnown ? !!node.gate : false, check:physicallyKnown ? (node.check || "") : "",
    state:{ breached:physicallyKnown ? !!fx.breached : false, identified:!!dataUnlocked, controlledByMe:!!controlledByMe, hasVirus:(fx.viruses||[]).some((v)=>v.runnerId===runner.id) },
    contents:dataUnlocked ? (node.contents || "") : "", contentsImage:dataUnlocked ? (node.contentsImage || "") : "", hasLockedData:!!isData && !dataUnlocked,
    attachments:physicallyKnown && (!isData || dataUnlocked) ? (node.attachments||[]).filter((a)=>a.visible).map((a)=>({id:a.id,uuid:a.uuid,label:a.label||"Linked document",documentType:a.documentType||""})) : [],
    controls:controlledByMe ? (node.controls||[]).filter((c)=>c.visible!==false).map((c)=>({id:c.id,label:c.label||"CONTROL"})) : [],
    entities:physicallyKnown ? (node.entities||[]).filter((e)=>e.visible!==false).map(sanitizedEntity) : []
  };
}

export function sanitizeArchitecture(arch, runtime = {}, runnerId = "") {
  if (!arch) return null;
  const runner = runtime.runners?.[runnerId] || null; if (!runner) return null;
  const known = new Set(runner.knownNodeIds || []), visibleIds = new Set([...known, ...frontierIds(arch, runner)]);
  const nodes = arch.nodes.filter((n)=>visibleIds.has(n.id)).map((n)=>sanitizedNode(n,runner,runtime,visibleIds));
  const current = arch.nodes.find((n)=>n.id===runner.currentNodeId) || null;
  const context = current ? rules.primaryContext({ nodes:arch.nodes,node:current,floorState:runtime.floorState||{},runnerId:runner.id,hasIceTarget:String(runner.targetRef||"").startsWith("ice:"),hasZapTarget:!!runner.targetRef,slideUsed:!!runner.slideUsed }).filter((a)=>EXPOSED_ABILITIES.has(a.key)) : [];
  const pendingEncounters = Object.values(runtime.encounters || {}).filter((e)=>e.runnerId===runner.id && e.status==="pending").map((e)=>({ id:e.id,ref:e.ref,name:e.name,mode:e.mode,nodeId:e.nodeId,status:e.status }));
  const freeIceEffects = Object.values(runtime.freeIceEffects || {}).filter((e)=>e.runnerId===runner.id).map((e)=>({ id:e.id,ref:e.ref,name:e.name,nodeId:e.nodeId,source:e.source }));
  const encounterBlocked = pendingEncounters.length > 0 || freeIceEffects.length > 0;
  const moves = current ? rules.neighborIds(arch.nodes,current.id).filter((id)=>visibleIds.has(id)).map((id)=> encounterBlocked ? {id,ok:false,reason:"encounter"} : ({id,...rules.canMove(arch.nodes,current.id,id,runtime.floorState||{})})) : [];
  return {
    schema:5, architectureId:arch.id, name:arch.name,
    runner:{
      id:runner.id, actorUuid:runner.actorUuid, name:runner.name, img:runner.img, rank:runner.rank, deckName:runner.deckName,
      actionsMax:runner.actionsMax, actionsUsed:runner.actionsUsed, jackedIn:!!runner.jackedIn, stealthed:!!runner.stealthed, quietMode:!!runner.quietMode,
      targetRef:runner.targetRef||"", slideUsed:!!runner.slideUsed,
      engagedIceRefs:[...(runner.engagedIceRefs||[])], slidIceRefs:[...(runner.slidIceRefs||[])],
      engagedIce:(runner.engagedIceRefs||[]).map((ref)=>iceSummary(arch,ref)), pendingEncounters, freeIceEffects,
      programs:(runner.programs||[]).map((p)=>({id:p.id,name:p.name,img:p.img,class:p.class,rezzed:!!p.rezzed,rez:p.rez,rezMax:p.rezMax,atk:p.atk,def:p.def,hasDamage:!!p.hasDamage}))
    },
    currentNodeId:runner.currentNodeId||"", knownNodeIds:[...known], visitedNodeIds:[...(runner.visitedNodeIds||[])], actionContext:context, moves, turnSerial:Number(runtime.turnSerial||0), nodes
  };
}

async function projectionDocument(userId) {
  const existing = game.journal?.find((j)=>j.getFlag(ID,PROJECTION_FLAG)===userId); if (existing) return existing;
  const ownership = { default:CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }; ownership[userId]=CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  return JournalEntry.create({ name:`[CRNS LAB] Player Projection ${userId}`, ownership, flags:{[ID]:{[PROJECTION_FLAG]:userId,payload:{}}} });
}
export async function publishProjection(store, runnerId="") {
  if (!game.user.isGM) return null;
  const runtime=await store.getRuntime(), runner=runtime?.runners?.[runnerId]; if(!runner?.userId)return null;
  const arch=await store.get(runtime.activeArchitectureId), payload=sanitizeArchitecture(arch,runtime,runnerId)||{}, doc=await projectionDocument(runner.userId);
  await doc.setFlag(ID,"payload",payload); return payload;
}
export async function publishAllProjections(store){ if(!game.user.isGM)return; const runtime=await store.getRuntime(); for(const runner of Object.values(runtime.runners||{})) if(runner.userId) await publishProjection(store,runner.id); }
export function readMyProjection(){ if(game.user.isGM)return null; const doc=game.journal?.find((j)=>j.getFlag(ID,PROJECTION_FLAG)===game.user.id); return clone(doc?.getFlag(ID,"payload")||null); }
export async function clearProjectionForUser(userId){ if(!game.user.isGM)return; const doc=game.journal?.find((j)=>j.getFlag(ID,PROJECTION_FLAG)===userId); if(doc)await doc.setFlag(ID,"payload",{}); }
