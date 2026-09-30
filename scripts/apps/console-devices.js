import {mutate} from '../data.js';
import {MODULE_ID,loc} from '../constants.js';
export function activateDevices(app,root) {
 const scanner=game.modules.get(MODULE_ID)?.api?.scanner;
 root.querySelectorAll('[data-console-camera]').forEach(button=>button.addEventListener('click',async()=>{
  try{
   button.disabled=true;
   if(button.dataset.consoleCamera==='locate')await scanner?.cameraLocate(button.dataset.cameraId,button.dataset.pid);
   else await scanner?.cameraView(button.dataset.cameraId,button.dataset.pid,button.dataset.consoleCamera==='view');
  }catch(error){ui.notifications.warn(error.message);}finally{app.render(false);}
 }));
 root.querySelector('[data-console-camera-setup]')?.addEventListener('click',()=>scanner?.cameras?.());
 root.querySelector('[data-console-camera-stop]')?.addEventListener('click',()=>{scanner?.cameraStopPreview?.();app.render(false);});
 root.querySelectorAll('[data-console-node]').forEach(button=>button.addEventListener('click',async()=>{
  if(button.dataset.consoleNode==='release'&&!await Dialog.confirm({title:'Отпустить узел?',content:'<p>Контроль устройств и обзор связанных камер прекратятся.</p>'}))return;
  button.disabled=true;
  try{
   const result=await mutate(button.dataset.consoleNode==='release'?'run.nodeRelease':'run.nodePulse',{archId:button.dataset.archId,floorId:button.dataset.floorId});
   if(result!==true)ui.notifications.warn(result?.error?loc(result.error):'Узел больше недоступен.');
  }catch(error){ui.notifications.warn(error.message);}finally{app.render(false);}
 }));
}
