import { profileFor, eligibleRunner } from "./runner-profile.js";
import * as rules from "./rules.js";

function rootId(arch) {
  return arch?.nodes?.find((n) => !n.parent)?.id || arch?.nodes?.[0]?.id || "";
}
function runnerIdFor(actor) { return `runner_${actor.id}`; }
function floorFx(runtime, nodeId) {
  runtime.floorState ||= {};
  runtime.floorState[nodeId] ||= { breached: false, control: null, eyedee: [], viruses: [] };
  const fx = runtime.floorState[nodeId];
  fx.eyedee = Array.isArray(fx.eyedee) ? fx.eyedee : [];
  fx.viruses = Array.isArray(fx.viruses) ? fx.viruses : [];
  return fx;
}
function refreshRunnerFromProfile(runner, actor) {
  const p = profileFor(actor);
  Object.assign(runner, { actorUuid:p.actorUuid,name:p.name,img:p.img,rank:p.rank,actionsMax:p.actionsMax,deckId:p.deckId,deckName:p.deckName,programs:p.programs });
  runner.actionsUsed = Math.min(Number(runner.actionsUsed || 0), runner.actionsMax);
  return runner;
}
function normalizeRuntimeRunner(r) {
  r.knownNodeIds = Array.isArray(r.knownNodeIds) ? r.knownNodeIds : [];
  r.visitedNodeIds = Array.isArray(r.visitedNodeIds) ? r.visitedNodeIds : [];
  r.engagedIceRefs = Array.isArray(r.engagedIceRefs) ? r.engagedIceRefs : [];
  r.encounteredIceRefs = Array.isArray(r.encounteredIceRefs) ? r.encounteredIceRefs : [];
  r.slidIceRefs = Array.isArray(r.slidIceRefs) ? r.slidIceRefs : [];
  r.evadedEntityRefs = Array.isArray(r.evadedEntityRefs) ? r.evadedEntityRefs : [];
  return r;
}

export class LabRuntimeService {
  constructor(store) { this.store = store; }
  async architecture(state = null) { state ||= await this.store.getRuntime(); return state?.activeArchitectureId ? this.store.get(state.activeArchitectureId) : null; }

  async addRunner(actorUuid, preferredUserId = "") {
    const actor = await fromUuid(actorUuid);
    if (!eligibleRunner(actor)) throw new Error("Actor needs a positive active Interface Role and an equipped Cyberdeck.");
    const arch = await this.architecture(); if (!arch) throw new Error("Select a NET Architecture first.");
    const id = runnerIdFor(actor), p = profileFor(actor);
    const owner = preferredUserId ? game.users.get(preferredUserId) : game.users.find((u) => !u.isGM && actor.testUserPermission?.(u,"OWNER"));
    await this.store.mutateRuntime((state) => {
      state.runners ||= {}; const prev = normalizeRuntimeRunner(state.runners[id] || {});
      state.runners[id] = normalizeRuntimeRunner({
        id,actorUuid:actor.uuid,userId:owner?.id || prev.userId || "",watcher:!!prev.watcher,
        name:p.name,img:p.img,rank:p.rank,deckId:p.deckId,deckName:p.deckName,programs:p.programs,
        actionsMax:p.actionsMax,actionsUsed:Number(prev.actionsUsed || 0),jackedIn:!!prev.jackedIn,
        stealthed:!!prev.stealthed,quietMode:!!prev.quietMode,currentNodeId:prev.currentNodeId || rootId(arch),
        knownNodeIds:prev.knownNodeIds,visitedNodeIds:prev.visitedNodeIds,cloakCheck:prev.cloakCheck ?? null,
        slideUsed:!!prev.slideUsed,targetRef:prev.targetRef || "",engagedIceRefs:prev.engagedIceRefs,
        encounteredIceRefs:prev.encounteredIceRefs,slidIceRefs:prev.slidIceRefs,evadedEntityRefs:prev.evadedEntityRefs
      }); state.activeRunnerId = id;
    }); return id;
  }
  async removeRunner(id) { await this.store.mutateRuntime((s)=>{ delete s.runners?.[id]; if(s.activeRunnerId===id)s.activeRunnerId=Object.keys(s.runners||{})[0]||""; }); }
  async selectRunner(id) { await this.store.mutateRuntime((s)=>{ if(!s.runners?.[id])throw new Error("Runner not found."); s.activeRunnerId=id; }); }
  async setWatcher(id,value){await this.store.mutateRuntime((s)=>{const r=s.runners?.[id];if(!r)throw new Error("Runner not found.");r.watcher=!!value;});}
  async setTarget(id,ref){await this.store.mutateRuntime((s)=>{const r=s.runners?.[id];if(!r)throw new Error("Runner not found.");r.targetRef=String(ref||"");});}
  async refreshRunner(id){const s=await this.store.getRuntime(),r=s.runners?.[id];if(!r)return null;const a=await fromUuid(r.actorUuid);if(!a)return r;await this.store.mutateRuntime((n)=>refreshRunnerFromProfile(n.runners[id],a));return (await this.store.getRuntime()).runners[id];}
  async startTurn(id){await this.store.mutateRuntime((s)=>{const r=s.runners?.[id];if(!r)throw new Error("Runner not found.");r.actionsUsed=0;r.slideUsed=false;s.turnSerial=Number(s.turnSerial||0)+1;});}
  async spendAction(id,n=1){await this.store.mutateRuntime((s)=>{const r=s.runners?.[id];if(!r)throw new Error("Runner not found.");this._spend(r,n);});}

  async jackIn(id,{quiet=false,stealthSucceeded=false}={}) {
    const arch=await this.architecture();if(!arch)throw new Error("No active architecture.");
    await this.store.mutateRuntime((s)=>{const r=normalizeRuntimeRunner(s.runners?.[id]);if(!r)throw new Error("Runner not found.");this._spend(r,quiet?rules.quietJackInActionCost():1);const root=rootId(arch);r.jackedIn=true;r.quietMode=!!quiet;r.stealthed=!!quiet&&!!stealthSucceeded;r.currentNodeId=root;r.knownNodeIds=root?[...new Set([...r.knownNodeIds,root])]:[];r.visitedNodeIds=root?[...new Set([...r.visitedNodeIds,root])]:[];r.engagedIceRefs=[];r.encounteredIceRefs=[];r.slidIceRefs=[];r.evadedEntityRefs=[];r.targetRef="";});
  }
  async jackOut(id){await this.store.mutateRuntime((s)=>{const r=normalizeRuntimeRunner(s.runners?.[id]);if(!r)throw new Error("Runner not found.");this._spend(r,1);r.jackedIn=false;r.stealthed=false;r.quietMode=false;r.targetRef="";r.engagedIceRefs=[];const anyone=Object.values(s.runners||{}).some((x)=>x.jackedIn);if(!anyone){s.floorState=rules.resetArchitectureState(s.floorState||{});for(const x of Object.values(s.runners||{})){normalizeRuntimeRunner(x);x.knownNodeIds=[];x.visitedNodeIds=[];x.cloakCheck=null;x.slideUsed=false;x.encounteredIceRefs=[];x.slidIceRefs=[];x.evadedEntityRefs=[];}}});}

  async move(id,nodeId){const s=await this.store.getRuntime(),arch=await this.architecture(s),r=normalizeRuntimeRunner(s.runners?.[id]);if(!r?.jackedIn)throw new Error("Jack In first.");const v=rules.canMove(arch.nodes,r.currentNodeId,nodeId,s.floorState||{});if(!v.ok)throw new Error(v.reason==="obstruction"?"Resolve the obstruction before moving deeper.":"NET movement is only between adjacent floors.");await this.store.mutateRuntime((n)=>{const x=normalizeRuntimeRunner(n.runners[id]);x.currentNodeId=nodeId;x.knownNodeIds=[...new Set([...x.knownNodeIds,nodeId])];x.visitedNodeIds=[...new Set([...x.visitedNodeIds,nodeId])];});return arch.nodes.find((n)=>n.id===nodeId)?.entities||[];}

  async markEncounter(id,ref,{engaged=false,evaded=false,breakStealth=false}={}){await this.store.mutateRuntime((s)=>{const r=normalizeRuntimeRunner(s.runners?.[id]);if(!r)throw new Error("Runner not found.");if(ref.startsWith("ice:")){r.encounteredIceRefs=[...new Set([...r.encounteredIceRefs,ref])];if(engaged&&!r.slidIceRefs.includes(ref))r.engagedIceRefs=[...new Set([...r.engagedIceRefs,ref])];}if(evaded)r.evadedEntityRefs=[...new Set([...r.evadedEntityRefs,ref])];if(breakStealth)r.stealthed=false;});}
  async resolveSlide(id,ref,success,destinationNodeId=""){await this.store.mutateRuntime((s)=>{const r=normalizeRuntimeRunner(s.runners?.[id]);if(!r)throw new Error("Runner not found.");this._spend(r,1);r.slideUsed=true;r.stealthed=false;if(success){r.engagedIceRefs=r.engagedIceRefs.filter((x)=>x!==ref);r.slidIceRefs=[...new Set([...r.slidIceRefs,ref])];}});if(success&&destinationNodeId)await this.move(id,destinationNodeId);}

  async applyAbilityResult(id,ability,nodeId,total,{virusText=""}={}) {
    const s=await this.store.getRuntime(),arch=await this.architecture(s),r=normalizeRuntimeRunner(s.runners?.[id]),node=arch?.nodes?.find((n)=>n.id===nodeId);if(!r||!node)throw new Error("Runner or node not found.");if(!r.jackedIn)throw new Error("Jack In first.");if(r.currentNodeId!==nodeId)throw new Error("Interface Abilities apply to the runner's current floor.");
    const av=rules.abilityAvailability({nodes:arch.nodes,node,floorState:s.floorState,runnerId:id,hasIceTarget:String(r.targetRef||"").startsWith("ice:"),hasZapTarget:!!r.targetRef,slideUsed:r.slideUsed});if(["backdoor","control","eyedee","virus"].includes(ability)&&!av[ability])throw new Error("That Interface Ability has no valid target here.");if(["slide","zap"].includes(ability))throw new Error("Combat Interface Ability must use its opposed resolver.");
    const result={ability,total:Number(total)||0,success:false};await this.store.mutateRuntime((next)=>{const x=normalizeRuntimeRunner(next.runners[id]);this._spend(x,1);const fx=floorFx(next,nodeId),roll=Number(total)||0;if(ability==="backdoor"){result.success=rules.beatsDV(roll,node.dv);if(result.success)fx.breached=true;}else if(ability==="eyedee"){result.success=rules.beatsDV(roll,node.dv);if(result.success&&!fx.eyedee.includes(id))fx.eyedee.push(id);}else if(ability==="control"){const dv=fx.control?.runnerId&&fx.control.runnerId!==id?Number(fx.control.dv||0):Number(node.dv||0);result.success=rules.beatsDV(roll,dv);if(result.success){fx.control={runnerId:id,dv:roll};x.stealthed=false;}}else if(ability==="pathfinder"){const found=rules.pathfinderReveal(arch.nodes,nodeId,roll,next.floorState||{});x.knownNodeIds=[...new Set([...x.knownNodeIds,...found])];result.success=found.length>0;result.revealed=found;}else if(ability==="cloak"){x.cloakCheck=roll;result.success=true;}else if(ability==="virus"){if(!rules.isLeaf(arch.nodes,nodeId))throw new Error("Virus can only be left at the bottom of a branch.");fx.viruses.push({id:foundry.utils.randomID(12),runnerId:id,dv:roll,text:String(virusText||"")});result.success=true;}});return result;
  }

  async activateControlledNode(id,nodeId){const s=await this.store.getRuntime(),r=s.runners?.[id],fx=s.floorState?.[nodeId];if(!r||fx?.control?.runnerId!==id)throw new Error("This runner does not control that node.");await this.spendAction(id,1);}
  async breakStealth(id){await this.store.mutateRuntime((s)=>{if(s.runners?.[id])s.runners[id].stealthed=false;});}
  async projectionForRunner(id){const s=await this.store.getRuntime(),arch=await this.architecture(s);const {sanitizeArchitecture}=await import("./projection.js");return sanitizeArchitecture(arch,s,id);}
  _spend(r,amount){const n=Math.max(0,Math.trunc(Number(amount)||0));if(Number(r.actionsUsed||0)+n>Number(r.actionsMax||0))throw new Error("No NET Actions remaining this Turn.");r.actionsUsed=Number(r.actionsUsed||0)+n;}
}
