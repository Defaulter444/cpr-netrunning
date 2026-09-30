/** Decisions use only the same filtered view model that is drawn in the overview. */
export function overviewTokens(canvas) {
  return (canvas?.empty ? [] : canvas?.floors ?? []).filter(f=>!f.encrypted).flatMap(f=>[
    ...(f.participants??[]).map(p=>({...p,floorIndex:f.index,canMove:!!(p.gmDraggable||p.isMine),selectable:!!(p.gmDraggable||p.isMine)})),
    ...(f.entities??[]).map(e=>({...e,floorIndex:f.index,canMove:!!e.gmDraggable})),
  ]);
}
export function overviewMove(canvas, ref, floorIndex, {placement=false}={}) {
  const token=overviewTokens(canvas).find(t=>t.ref===ref);
  const floor=canvas?.floors?.find(f=>f.index===floorIndex);
  if(!token?.canMove||!floor||token.floorIndex===floorIndex)return null;
  if(ref.startsWith('runner:'))return {op:placement?'session.reposition':'session.move',payload:{pid:token.pid??ref.slice(7),floorIndex}};
  const [kind,archId,,entId]=ref.split(':');
  if(['ice','demon'].includes(kind)&&archId===canvas.archId&&entId)
    return {op:'ent.move',payload:{archId,entId,toFloorIndex:floorIndex}};
  if(kind==='prog') {
    const parts=ref.slice(5).split(':');
    if(parts.length===2&&parts.every(Boolean))return {op:'run.progFloor',payload:{pid:parts[0],programId:parts[1],floorIndex}};
  }
  return null;
}
export const escapeOverview = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
