/** Only visible console data and authorized cameras from the current scene. */
export function controlDeviceData(data,cameras=[]) {
 const action=data.actions??{},canvas=data.canvas??{};
 if(action.variant!=='runner'||!action.jackedIn)return {nodes:[],hasNodes:false};
 const nodes=(action.controlNodes??[]).map(node=>{
  const floor=canvas.archId===action.archId&&canvas.floors?.find(f=>f.floorId===node.floorId&&!f.encrypted);
  return {...node,label:floor?.label||'Узел управления',pid:action.pid,archId:action.archId,
   canAct:Number(action.actionsValue)>0,cameras:cameras.filter(c=>c.archId===action.archId&&c.floorId===node.floorId)};
 });
 return {nodes,hasNodes:!!nodes.length};
}
export function tokenHealth(token) {
 const current=Number(token.rez),max=Number(token.rezMax);
 return Number.isFinite(current)&&Number.isFinite(max)&&max>0?{
  hasHealth:true,health:Math.max(0,current),healthMax:max,healthPct:Math.min(100,Math.max(0,current/max*100)),healthLabel:'ХП'
 }:{hasHealth:false};
}
