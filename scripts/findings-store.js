import {MODULE_ID,esc} from './constants.js';
import {floorFindings,normalizeFindings,findingKey,FINDING_KINDS} from './findings-model.js';
const flag=(doc,key)=>doc?.getFlag?.(MODULE_ID,key)??doc?.flags?.[MODULE_ID]?.[key];
export const canReadFinding=(doc,user=game.user)=>!!doc?.testUserPermission?.(user,'OBSERVER');
export function journalFindings(doc){
  if(!canReadFinding(doc))return [];
  return normalizeFindings(Array.from(doc.pages??[]).sort((a,b)=>a.sort-b.sort).map(p=>flag(p,'findingData')).filter(Boolean));
}
export function findingHTML(f){
  const text=esc(f.text).replace(/@/g,'&#64;').replace(/\[/g,'&#91;').replace(/\n/g,'<br>');
  return `<h2>${esc(f.title)}</h2><p>${esc(FINDING_KINDS[f.kind])}</p>${f.kind==='message'?`<p>${esc(f.from)} → ${esc(f.to)}</p>`:''}<p>${text}</p>${f.src&&['image','map'].includes(f.kind)?`<img src="${esc(f.src)}" alt="${esc(f.title)}">`:''}${f.src&&f.kind==='audio'?`<p>Аудиозапись доступна в консоли → Находки.</p>`:''}`;
}
function pages(findings){return findings.map((f,i)=>({name:f.title,type:'text',sort:(i+1)*100000,text:{format:1,content:findingHTML(f)},flags:{[MODULE_ID]:{findingData:f}}}));}
export function hydrateFindings(archs){
  for(const arch of Object.values(archs??{}))for(const floor of arch.floors??[]){
    if(floor.findingSourceId){
      const doc=game.journal?.get(floor.findingSourceId);
      if(doc&&canReadFinding(doc))floor.findings=journalFindings(doc);
      // Legacy UI and exports keep reading the first legacy record, but the raw
      // world setting contains only the source id after migration.
      if(Array.isArray(floor.findings)||!game.user.isGM){
        floor.contents=floor.findings?.find(f=>f.id==='legacy')?.text??'';
        floor.contentsImage=floor.findings?.find(f=>f.id==='legacy-image')?.src??'';
      }
    }
  }
  return archs;
}
/** Source contents live on permissioned Journal pages, never in architecture settings. */
export async function persistFindings(archs,usersFor=()=>[]){
  const out=foundry.utils.deepClone(archs);
  for(const [archId,arch] of Object.entries(out??{}))for(const floor of arch.floors??[]){
    const liveSource=floor.findingSourceId?game.journal?.get(floor.findingSourceId):null;
    if(!Array.isArray(floor.findings)&&!liveSource&&(String(floor.contents||'').trim()||floor.contentsImage))floor.findings=floorFindings(floor);
    if(!Array.isArray(floor.findings))continue;
    const findings=normalizeFindings(floor.findings);
    let doc=game.journal?.get(floor.findingSourceId);
    if(floor.findingSourceId&&!doc&&!findings.length){delete floor.findings;continue;}
    const identity=flag(doc,'findingSource');
    if(!identity||identity.archId!==archId||identity.floorId!==floor.id)doc=null;
    if(!doc&&findings.length)doc=await JournalEntry.create({name:'СЕТЬ · закрытые файлы',ownership:{default:0},flags:{[MODULE_ID]:{findingSource:{archId,floorId:floor.id}}},pages:pages(findings)});
    else if(doc&&JSON.stringify(journalFindings(doc))!==JSON.stringify(findings)){
      const oldIds=Array.from(doc.pages).map(p=>p.id);
      if(findings.length)await doc.createEmbeddedDocuments('JournalEntryPage',pages(findings));
      await doc.deleteEmbeddedDocuments('JournalEntryPage',oldIds);
    }
    if(doc)floor.findingSourceId=doc.id;else delete floor.findingSourceId;
    if(doc)await grantFindingAccess(floor,usersFor(archId,floor.id));
    // Explicitly authored records replace the legacy source, not the collected snapshots.
    floor.contents='';floor.contentsImage='';delete floor.findings;
  }
  return out;
}
export async function grantFindingAccess(floor,users){
  const doc=game.journal?.get(floor?.findingSourceId);if(!doc||!flag(doc,'findingSource'))return;
  const changes={};for(const user of users)if(!user.isGM&&!canReadFinding(doc,user))changes[`ownership.${user.id}`]=2;
  if(Object.keys(changes).length)await doc.update(changes);
}
export function findingOperations({getWorld,ownsParticipant,requesterIsGM}){
  return {
    async 'finding.collect'({archId,floorId,findingId,pid}={},userId){
      const floor=getWorld('netArchs')?.[archId]?.floors?.find(f=>f.id===floorId);
      const session=getWorld('session')??{},part=session.participants?.[pid];
      if(!floor||(!requesterIsGM(userId)&&(!ownsParticipant(part,userId)||!(session.floorState?.[`${archId}:${floorId}`]?.eyedee??[]).includes(pid))))return {ok:false};
      const finding=floorFindings(floor).find(f=>f.id===findingId);if(!finding)return {ok:false};
      const key=findingKey({archId,floorId,findingId,userId});
      const existing=game.journal.find(doc=>flag(doc,'finding')?.key===key);
      if(existing)return {ok:true,journalId:existing.id};
      const doc=await JournalEntry.create({name:finding.title,ownership:{default:0,[userId]:2},flags:{[MODULE_ID]:{finding:{key,collectorId:userId,archId,floorId,findingId,collectedAt:Date.now()}}},pages:pages([finding])});
      return {ok:true,journalId:doc.id};
    },
    async 'finding.share'({journalId,userIds}={},userId){
      const doc=game.journal?.get(journalId),user=game.users.get(userId);
      if(!flag(doc,'finding')||!user||!canReadFinding(doc,user))return {ok:false};
      const recipients=[...new Set(Array.isArray(userIds)?userIds.slice(0,32):[])].filter(id=>id!==userId&&game.users.get(id)&&!game.users.get(id).isGM);
      if(!recipients.length)return {ok:false};
      await doc.update(Object.fromEntries(recipients.map(id=>[`ownership.${id}`,Math.max(2,doc.ownership?.[id]??0)])));
      await ChatMessage.create({user:game.user.id,whisper:recipients,content:`<p>${esc(user.name||'Игрок')} передаёт находку: @UUID[${doc.uuid}]{${esc(doc.name).replace(/[{}\[\]]/g,'')}}</p><p>Открыть в консоли → Находки.</p>`});
      return {ok:true};
    }
  };
}
