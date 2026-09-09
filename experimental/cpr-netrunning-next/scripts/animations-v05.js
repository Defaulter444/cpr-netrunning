/* Netrunning Lab 0.5 — encounter motion.
 * Reads the DOM produced by ui-v05 and animates only real state transitions.
 */
const snapshots = new WeakMap();
function rootFor(app,html){const host=html?.[0]||html;return host?.matches?.(".crnsl-root")?host:host?.querySelector?.(".crnsl-root")||app?.element?.[0]?.querySelector?.(".crnsl-root")||null;}
function motionOff(root){return root.classList.contains("v04-motion-off")||root.classList.contains("reduced-motion")||window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;}
function setOf(value){return new Set(String(value||"").split("|").filter(Boolean));}
function snap(root){return{pending:Number(root.dataset.v05Pending||0),effects:Number(root.dataset.v05Effects||0),engaged:setOf(root.dataset.v05Engaged),slid:setOf(root.dataset.v05Slid)};}
function transient(el,cls,ms=760){if(!el)return;el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);setTimeout(()=>el.classList.remove(cls),ms);}
function diff(app,root){const next=snap(root),prev=snapshots.get(app);snapshots.set(app,next);if(!prev||motionOff(root))return;const current=root.querySelector(".crnsl-node.current");if(next.pending>prev.pending)transient(current,"v05-ice-wake",860);if(next.effects>prev.effects)transient(current,"v05-effect-impact",720);const escaped=[...next.slid].some((ref)=>!prev.slid.has(ref));const detached=[...prev.engaged].some((ref)=>!next.engaged.has(ref));if(escaped&&detached)transient(current,"v05-slide-break",900);if(next.engaged.size>prev.engaged.size)transient(current,"v05-pursuit-lock",700);}
function enhance(app,html){if(app?.options?.id!=="crnsl-window")return;const root=rootFor(app,html);if(!root)return;requestAnimationFrame(()=>requestAnimationFrame(()=>diff(app,root)));}
Hooks.on("renderApplication",enhance);Hooks.on("renderNetrunningLabApp",enhance);
