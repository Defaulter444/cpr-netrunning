/** Foundry V1 Dialog treats Enter on every inner control as its footer default. */
export function contentDialogKeys(root){
  root.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.target.closest('.dialog-buttons')||event.target.tagName==='TEXTAREA')return;
    event.stopPropagation();
    const button=event.target.closest('button');if(button){event.preventDefault();button.click();}
  });
}
