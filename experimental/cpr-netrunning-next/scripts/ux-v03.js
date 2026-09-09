import { ID } from "./store.js";

const ICON = (name) => `modules/${ID}/assets/icons-v03.svg#${name}`;
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || min));
let spaceHeld = false;

const COPY = {
  ru: {
    fit:"Вписать карту", zoomOut:"Уменьшить", zoomIn:"Увеличить", reset:"100%",
    panel:"Скрыть/показать инспектор", focus:"Режим фокуса", help:"Справка",
    strict:"STRICT RED", strictSub:"Неполная механика не симулируется",
    helpTitle:"NETRUNNING // Краткая памятка",
    movement:"Переход между соседними этажами: 0 NET Actions.",
    action:"Большинство действий Interface: 1 NET Action.",
    quiet:"Jack In / безопасный Jack Out: 1. Quiet Jack In: 2.",
    control:"Захват Control Node и его активация — разные действия; один узел активируется не более одного раза за ход.",
    scanner:"Scanner — Meat Action для поиска Access Point, поэтому внутри Architecture отдельной кнопки Scanner нет.",
    combat:"Slide, Zap и незавершённый Black ICE combat не подменяются самодельной автоматикой: пока полный opposed resolver не готов, эти действия скрыты.",
    privacy:"PLAYER VIEW получает очищенную проекцию без скрытых DV, GM notes и неизвестного содержимого.",
    keys:"Клавиши: F — Fit, [ / ] — масштаб, P — Programs, I — Inspector, ? — справка, Space+drag — панорама.",
    close:"Закрыть"
  },
  en: {
    fit:"Fit map", zoomOut:"Zoom out", zoomIn:"Zoom in", reset:"100%",
    panel:"Toggle inspector", focus:"Focus mode", help:"Help",
    strict:"STRICT RED", strictSub:"Incomplete mechanics are never faked",
    helpTitle:"NETRUNNING // Quick reference",
    movement:"Move between adjacent NET floors: 0 NET Actions.",
    action:"Most Interface actions: 1 NET Action.",
    quiet:"Jack In / safe Jack Out: 1. Quiet Jack In: 2.",
    control:"Taking a Control Node and activating it are separate actions; a Control Node can activate no more than once per Turn.",
    scanner:"Scanner is a Meat Action used to locate Access Points, so it is not an in-Architecture action button.",
    combat:"Slide, Zap and unfinished Black ICE combat are not replaced with homebrew automation. They stay hidden until their opposed resolver is complete.",
    privacy:"PLAYER VIEW receives a sanitized projection without hidden DVs, GM notes or undiscovered content.",
    keys:"Keys: F — Fit, [ / ] — zoom, P — Programs, I — Inspector, ? — help, Space+drag — pan.",
    close:"Close"
  }
};
const text = () => COPY[String(game.i18n?.lang || "en").toLowerCase().startsWith("ru") ? "ru" : "en"];

Hooks.once("init", () => {
  game.settings.register(ID, "mapZoom", { scope:"client", config:false, type:Number, default:1 });
  game.settings.register(ID, "inspectorCollapsed", { scope:"client", config:false, type:Boolean, default:false });
  game.settings.register(ID, "focusMode", { scope:"client", config:false, type:Boolean, default:false });
  game.settings.register(ID, "learningHints", {
    name:"Netrunning Lab: Rules / keyboard help", hint:"Show the compact rules-safe status chip and help entry point.",
    scope:"client", config:true, type:Boolean, default:true
  });
});

function rootFor(app, html) {
  const host = html?.[0] || html;
  return host?.matches?.(".crnsl-root") ? host : host?.querySelector?.(".crnsl-root") || app?.element?.[0]?.querySelector?.(".crnsl-root") || null;
}
function save(key, value) { game.settings.set(ID, key, value).catch(() => {}); }
function mapParts(root) { return { scroll:root.querySelector(".crnsl-map-scroll"), map:root.querySelector(".crnsl-map") }; }

function setZoom(root, value, { persist=true, anchor=null } = {}) {
  const { scroll, map } = mapParts(root); if (!scroll || !map) return;
  const old = clamp(Number(map.dataset.v03Zoom || game.settings.get(ID,"mapZoom") || 1), .45, 1.45);
  const next = clamp(value, .45, 1.45);
  let logicalX=0, logicalY=0;
  if (anchor) { logicalX=(scroll.scrollLeft+anchor.x)/old; logicalY=(scroll.scrollTop+anchor.y)/old; }
  map.style.zoom=String(next); map.dataset.v03Zoom=String(next);
  root.querySelectorAll("[data-v03-zoom-label]").forEach((el)=>el.textContent=`${Math.round(next*100)}%`);
  if(anchor){ scroll.scrollLeft=logicalX*next-anchor.x; scroll.scrollTop=logicalY*next-anchor.y; }
  if(persist) save("mapZoom",next);
}
function fitMap(root) {
  const { scroll, map }=mapParts(root); if(!scroll||!map)return;
  const rawW=parseFloat(map.style.width)||map.offsetWidth||760, rawH=parseFloat(map.style.height)||map.offsetHeight||450;
  const z=clamp(Math.min((scroll.clientWidth-40)/rawW,(scroll.clientHeight-40)/rawH,1.12),.45,1.12);
  setZoom(root,z); requestAnimationFrame(()=>{scroll.scrollLeft=Math.max(0,(rawW*z-scroll.clientWidth)/2);scroll.scrollTop=Math.max(0,(rawH*z-scroll.clientHeight)/2);});
}
function toggleInspector(root) { const v=!root.classList.contains("v03-inspector-collapsed"); root.classList.toggle("v03-inspector-collapsed",v); save("inspectorCollapsed",v); }
function toggleFocus(root) { const v=!root.classList.contains("v03-focus"); root.classList.toggle("v03-focus",v); save("focusMode",v); }

function closeHelp(root){ root.querySelector(".crnsl-v03-help")?.remove(); }
function showHelp(root){
  closeHelp(root); const c=text();
  root.insertAdjacentHTML("beforeend",`<div class="crnsl-v03-help" role="dialog" aria-modal="true" aria-label="${c.helpTitle}"><div class="v03-help-card"><header><span class="v03-help-mark"><svg><use href="${ICON("rules")}"></use></svg></span><div><small>CYBERPUNK RED</small><h3>${c.helpTitle}</h3></div><button type="button" data-v03-action="help-close" aria-label="${c.close}"><svg><use href="${ICON("close")}"></use></svg></button></header><div class="v03-help-rules"><p><b>0</b>${c.movement}</p><p><b>1</b>${c.action}</p><p><b>2</b>${c.quiet}</p><p><svg><use href="${ICON("control")}"></use></svg>${c.control}</p><p><svg><use href="${ICON("scanner")}"></use></svg>${c.scanner}</p><p class="warning"><svg><use href="${ICON("warning")}"></use></svg>${c.combat}</p><p><svg><use href="${ICON("shield")}"></use></svg>${c.privacy}</p></div><footer>${c.keys}</footer></div></div>`);
}

function injectTools(root){
  const scroll=root.querySelector(".crnsl-map-scroll"); if(!scroll||scroll.querySelector(".crnsl-v03-maptools"))return;
  const c=text();
  scroll.insertAdjacentHTML("afterbegin",`<div class="crnsl-v03-maptools" role="toolbar" aria-label="Map controls"><button type="button" data-v03-action="fit" title="${c.fit}"><svg><use href="${ICON("fit")}"></use></svg></button><span class="v03-zoom-group"><button type="button" data-v03-action="zoom-out" title="${c.zoomOut}"><svg><use href="${ICON("minus")}"></use></svg></button><button type="button" class="zoom-label" data-v03-action="zoom-reset" data-v03-zoom-label title="${c.reset}">100%</button><button type="button" data-v03-action="zoom-in" title="${c.zoomIn}"><svg><use href="${ICON("plus")}"></use></svg></button></span><button type="button" data-v03-action="inspector" title="${c.panel}"><svg><use href="${ICON("panel")}"></use></svg></button><button type="button" data-v03-action="focus" title="${c.focus}"><svg><use href="${ICON("focus")}"></use></svg></button><button type="button" data-v03-action="help" title="${c.help}"><svg><use href="${ICON("help")}"></use></svg></button></div>`);
}
function injectRuleChip(root){
  if(!game.settings.get(ID,"learningHints"))return;
  const bar=root.querySelector(".crnsl-commandbar"), link=bar?.querySelector(".crnsl-link-state"); if(!bar||bar.querySelector(".crnsl-v03-rules-chip"))return;
  const c=text(); const html=`<button type="button" class="crnsl-v03-rules-chip" data-v03-action="help" title="${c.help}"><svg><use href="${ICON("rules")}"></use></svg><span><strong>${c.strict}</strong><small>${c.strictSub}</small></span></button>`;
  if(link)link.insertAdjacentHTML("beforebegin",html);else bar.insertAdjacentHTML("beforeend",html);
}
function bindPan(root){
  const {scroll}=mapParts(root); if(!scroll||scroll.dataset.v03Pan)return; scroll.dataset.v03Pan="1";
  let drag=null;
  scroll.addEventListener("pointerdown",(e)=>{ const pan=e.button===1||(spaceHeld&&e.button===0); if(!pan||e.target.closest("button,select,input,textarea"))return; e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:scroll.scrollLeft,top:scroll.scrollTop};scroll.setPointerCapture?.(e.pointerId);root.classList.add("v03-panning");});
  scroll.addEventListener("pointermove",(e)=>{if(!drag||e.pointerId!==drag.id)return;scroll.scrollLeft=drag.left-(e.clientX-drag.x);scroll.scrollTop=drag.top-(e.clientY-drag.y);});
  const end=(e)=>{if(!drag||e.pointerId!==drag.id)return;drag=null;root.classList.remove("v03-panning");}; scroll.addEventListener("pointerup",end);scroll.addEventListener("pointercancel",end);
  scroll.addEventListener("wheel",(e)=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const r=scroll.getBoundingClientRect(),anchor={x:e.clientX-r.left,y:e.clientY-r.top};const cur=Number(root.querySelector(".crnsl-map")?.dataset.v03Zoom||1);setZoom(root,cur*(e.deltaY<0?1.1:.9),{anchor});},{passive:false});
}
function action(root,name){
  const map=root.querySelector(".crnsl-map"),z=Number(map?.dataset.v03Zoom||game.settings.get(ID,"mapZoom")||1);
  if(name==="fit")fitMap(root); else if(name==="zoom-out")setZoom(root,z-.1); else if(name==="zoom-in")setZoom(root,z+.1); else if(name==="zoom-reset")setZoom(root,1); else if(name==="inspector")toggleInspector(root); else if(name==="focus")toggleFocus(root); else if(name==="help")showHelp(root); else if(name==="help-close")closeHelp(root);
}
function enhance(app,html){
  if(app?.options?.id!=="crnsl-window")return; const root=rootFor(app,html); if(!root)return;
  root.classList.add("crnsl-v03");root.classList.toggle("v03-inspector-collapsed",!!game.settings.get(ID,"inspectorCollapsed"));root.classList.toggle("v03-focus",!!game.settings.get(ID,"focusMode"));
  injectTools(root);injectRuleChip(root);bindPan(root);setZoom(root,game.settings.get(ID,"mapZoom")||1,{persist:false});
  if(!root.dataset.v03Click){root.dataset.v03Click="1";root.addEventListener("click",(e)=>{const b=e.target.closest("[data-v03-action]");if(!b)return;e.preventDefault();action(root,b.dataset.v03Action);});}
}
Hooks.on("renderApplication",enhance);Hooks.on("renderNetrunningLabApp",enhance);

document.addEventListener("keydown",(e)=>{
  if(e.key===" ")spaceHeld=true; const app=globalThis.CRNSL?.ui;if(!app?.rendered)return;const root=app.element?.[0]?.querySelector?.(".crnsl-root");if(!root)return;
  const tag=document.activeElement?.tagName;if(["INPUT","TEXTAREA","SELECT"].includes(tag)||document.activeElement?.isContentEditable)return;
  const key=e.key.toLowerCase(); if(key==="escape"){closeHelp(root);return;} if(key==="f"){e.preventDefault();fitMap(root);}else if(e.key==="["){e.preventDefault();const z=Number(root.querySelector(".crnsl-map")?.dataset.v03Zoom||1);setZoom(root,z-.1);}else if(e.key==="]"){e.preventDefault();const z=Number(root.querySelector(".crnsl-map")?.dataset.v03Zoom||1);setZoom(root,z+.1);}else if(key==="i"){e.preventDefault();toggleInspector(root);}else if(key==="p"){e.preventDefault();root.querySelector('[data-action="programs-toggle"]')?.click();}else if(e.key==="?"){e.preventDefault();showHelp(root);}else if(e.altKey&&["1","2","3"].includes(e.key)&&game.user.isGM){e.preventDefault();root.querySelector(e.key==="1"?'[data-action="mode-run"]':e.key==="2"?'[data-action="mode-build"]':'[data-action="toggle-preview"]')?.click();}
},{capture:true});
document.addEventListener("keyup",(e)=>{if(e.key===" ")spaceHeld=false;},{capture:true});
window.addEventListener("blur",()=>{spaceHeld=false;});
