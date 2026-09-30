import {MODULE_ID} from './constants.js';
/** Transient attack cue transported through Foundry's permissioned chat channel. */
export function iceEventOperations({getWorld,ownsParticipant,requesterIsGM}){
  const lastCue=new Map();
  return {'ice.attackCue':async({sourceRef,targetRef}={},callerId)=>{
    const session=getWorld('session')??{},archs=getWorld('netArchs')??{};
    const resolve=ref=>{
      const [kind,a,b,id]=String(ref??'').split(':');
      if(kind==='runner'){const p=session.participants?.[a];return p?.jackedIn?{archId:p.archId,index:p.floorIndex??0}:null;}
      if(kind==='prog'){const p=session.participants?.[a],ps=session.progState?.[`${a}|${b}`];return p?.jackedIn&&ps?{archId:p.archId,index:ps.floorIndex??p.floorIndex??0,part:p,program:true,actorId:ps.actorId}:null;}
      const floors=archs[a]?.floors??[],index=floors.findIndex(f=>f.id===b),floor=floors[index];
      const def=kind==='ice'?floor?.ice?.find(e=>e.id===id):kind==='demon'&&floor?.demon?.id===id?floor.demon:null;
      return def?{archId:a,index,def}:null;
    };
    const source=resolve(sourceRef),target=resolve(targetRef);
    if(!source||!target||source.archId!==target.archId||sourceRef===targetRef)return false;
    if(!String(sourceRef).startsWith('ice:')&&!source.program)return false;
    if(!requesterIsGM(callerId)&&(!source.program||!ownsParticipant(source.part,callerId)))return false;
    const key=`${callerId}|${sourceRef}`,now=Date.now();if(now-(lastCue.get(key)??0)<1000)return false;
    const actor=game.actors?.get(source.def?.actorId??source.actorId);
    if(!actor||(actor.system?.stats?.rez?.value??0)<=0)return false;
    const floors=archs[source.archId]?.floors??[];
    const audience=game.users.filter(u=>u.isGM||Object.entries(session.participants??{}).some(([pid,p])=>{
      if(!p.jackedIn||p.archId!==source.archId||!ownsParticipant(p,u.id))return false;
      const known=new Set([...(Array.isArray(p.visited)?p.visited:[]),...(Array.isArray(session.reveal?.[pid]?.[p.archId])?session.reveal[pid][p.archId]:[]),floors[p.floorIndex??0]?.id]);
      return known.has(floors[source.index]?.id)&&known.has(floors[target.index]?.id);
    })).map(u=>u.id);
    lastCue.set(key,now);if(lastCue.size>256)lastCue.delete(lastCue.keys().next().value);
    const message=await ChatMessage.create({user:game.user.id,whisper:audience,content:'<p class="nc-ice-event">Чёрный ЛЁД атакует.</p>',flags:{[MODULE_ID]:{iceCue:{eventId:foundry.utils.randomID(),ref:sourceRef,targetRef,phase:'attack'}}}});
    setTimeout(()=>message?.delete?.().catch(console.error),10000);
    return true;
  }};
}
