/** Read-only layout of the permission-filtered VM. Never infer undiscovered nodes. */
export const CONSOLE_GRAPH_WIDTH = 860;
const point = (x, y) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
const polygon = ps => ps.map(([x, y]) => point(x, y)).join(' ');

// Oblique projection of a rectangle. All grid lines and contents share this basis.
export function slabPoint(cx, cy, u, v) {
  return [cx - 300 + u * 405 + v * 195, cy + 20 - u * 102 + v * 62];
}
const glyph = f => f.encrypted ? 'fa-lock' : f.isEntry ? 'fa-right-to-bracket'
  : /Password/i.test(f.icon ?? '') ? 'fa-key'
  : /Control_Node/i.test(f.icon ?? '') ? 'fa-cube'
  : /File/i.test(f.icon ?? '') ? 'fa-file-lines' : 'fa-server';


// The classic canvas owns the primary tree. Extra entrances never determine depth.
// Older/filtered VMs use a visible-only forest; no world data enters this module.
function visibleTree(floors, links) {
  if (!links.length) return floors.map((f, row) => ({index:f.index,row,col:0}));
  const children=new Map(floors.map(f=>[f.index,[]])), incoming=new Set();
  const primary=new Set(links.filter(l=>l.extra!==true).map(l=>l.to));
  // A visible secondary entrance can anchor a floor whose primary parent is hidden.
  for(const l of links)if(l.extra!==true||!primary.has(l.to)){children.get(l.from).push(l.to);incoming.add(l.to);}
  const ordered=floors.every(f=>Number.isFinite(f.layoutOrder));
  const order=new Map(floors.map(f=>[f.index,ordered?f.layoutOrder:f.index]));
  const compare=(a,b)=>order.get(a)-order.get(b)||a-b;
  for(const kids of children.values())kids.sort(compare);
  const roots=floors.filter(f=>f.isEntry||!incoming.has(f.index)).sort((a,b)=>Number(!!b.isEntry)-Number(!!a.isEntry)||compare(a.index,b.index));
  const cells=new Map(), kids=new Map(floors.map(f=>[f.index,[]])), forest=[];
  for(const f of [...roots,...[...floors].sort((a,b)=>compare(a.index,b.index))]){
    if(cells.has(f.index))continue;
    forest.push(f.index);cells.set(f.index,{index:f.index,row:0,col:0});
    const queue=[f.index];
    for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])){
      if(cells.has(child))continue;
      cells.set(child,{index:child,row:cells.get(queue[i]).row+1,col:0,parent:queue[i]});
      kids.get(queue[i]).push(child);queue.push(child);
    }
  }
  let leaf=0;
  for(const root of forest){
    const stack=[[root,false]];
    while(stack.length){
      const [id,expanded]=stack.pop(),desc=kids.get(id);
      if(!expanded&&desc.length){stack.push([id,true]);for(const child of [...desc].reverse())stack.push([child,false]);continue;}
      cells.get(id).col=desc.length?(cells.get(desc[0]).col+cells.get(desc.at(-1)).col)/2:leaf++;
    }
  }
  return [...cells.values()];
}
function topology(floors, links, canvas) {
  const occupied=new Set();
  const valid=!canvas?.layoutVisibleOnly&&floors.every(f=>{
    const key=`${f.row}:${f.col}`;
    if(!Number.isInteger(f.row)||f.row<0||!Number.isFinite(f.col)||occupied.has(key))return false;
    occupied.add(key);return true;
  });
  const unit=Number.isFinite(canvas?.unit)&&canvas.unit>0?canvas.unit:1;
  const cells=valid?floors.map(f=>({index:f.index,row:f.row,col:f.col/unit})):visibleTree(floors,links);
  const ranks=[...new Set(cells.map(c=>c.row))].sort((a,b)=>a-b);
  const positions=new Map(cells.map(c=>[c.index,{rank:c.row,row:ranks.indexOf(c.row),col:c.col,parent:c.parent}]));
  if(valid)for(const l of links.filter(l=>l.extra!==true)){
    const a=positions.get(l.from),b=positions.get(l.to);
    if(a.row<b.row&&b.parent===undefined)b.parent=l.from;
  }
  const rows=new Map();for(const c of cells){if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);}
  // Nearly coincident corrupt coordinates could otherwise explode the SVG width.
  for(const row of rows.values()){
    row.sort((a,b)=>a.col-b.col);
    if(valid&&row.some((c,i)=>i&&c.col-row[i-1].col<1/64-1e-9))return topology(floors,links,{layoutVisibleOnly:true});
  }
  return {branched:[...rows.values()].some(row=>row.length>1),positions};
}
// Pack neighbouring subtrees using only rows they both occupy. A wide floor on
// a deep branch must not reserve that width beside a short, unrelated branch.
function compactPositions(nodes, links, gap=72) {
  const byId=new Map(nodes.map(n=>[n.index,n])), children=new Map(nodes.map(n=>[n.index,[]])), parent=new Map();
  for(const n of nodes)if(byId.has(n.parent)&&byId.get(n.parent).row<n.row){parent.set(n.index,n.parent);children.get(n.parent).push(n.index);}
  for(const l of [...links].sort((a,b)=>Number(a.extra===true)-Number(b.extra===true)||a.from-b.from||a.to-b.to)){
    if(parent.has(l.to)||byId.get(l.from).row>=byId.get(l.to).row)continue;
    parent.set(l.to,l.from);children.get(l.from).push(l.to);
  }
  const compare=(a,b)=>byId.get(a).col-byId.get(b).col||a-b;
  for(const kids of children.values())kids.sort(compare);
  const roots=nodes.filter(n=>!parent.has(n.index)).map(n=>n.index).sort(compare),built=new Map();
  const merge=(parts)=>{
    const positions=new Map(),contours=new Map(),anchors=[];
    for(const part of parts){
      let shift=anchors.length&&links.length?anchors.at(-1)+gap:0;
      for(const [row,range] of part.contours)if(contours.has(row))shift=Math.max(shift,contours.get(row)[1]+gap-range[0]);
      anchors.push(shift);
      for(const [id,x] of part.positions)positions.set(id,x+shift);
      for(const [row,[left,right]] of part.contours){const old=contours.get(row);contours.set(row,[Math.min(old?.[0]??Infinity,left+shift),Math.max(old?.[1]??-Infinity,right+shift)]);}
    }
    return {positions,contours,anchors};
  };
  for(const root of roots){
    const stack=[[root,false]];
    while(stack.length){
      const [id,expanded]=stack.pop(),kids=children.get(id),node=byId.get(id);
      if(!expanded&&kids.length){stack.push([id,true]);for(const child of [...kids].reverse())stack.push([child,false]);continue;}
      const part=merge(kids.map(k=>built.get(k))),center=kids.length?(part.anchors[0]+part.anchors.at(-1))/2:0;
      for(const [child,x] of part.positions)part.positions.set(child,x-center);
      for(const [row,range] of part.contours)part.contours.set(row,range.map(x=>x-center));
      part.positions.set(id,0);part.contours.set(node.row,[-node.width/2,node.width/2]);built.set(id,part);
    }
  }
  const result=merge(roots.map(r=>built.get(r)));
  for(const n of nodes)n.x=result.positions.get(n.index)??0;
  // Keep the classic within-row order even for a manually rearranged merge.
  const rows=new Map();for(const n of nodes){if(!rows.has(n.row))rows.set(n.row,[]);rows.get(n.row).push(n);}
  for(const [,row] of [...rows].sort((a,b)=>a[0]-b[0])){
    row.sort((a,b)=>a.col-b.col);
    for(let i=1;i<row.length;i++){
      const shift=Math.max(0,row[i-1].x+(row[i-1].width+row[i].width)/2+gap-row[i].x);
      if(!shift)continue;
      const queue=[row[i].index];for(let j=0;j<queue.length;j++){byId.get(queue[j]).x+=shift;queue.push(...children.get(queue[j]));}
    }
  }
  const left=Math.min(0,...nodes.map(n=>n.x-n.width/2));
  for(const n of nodes)n.x+=80-left;
}
function crossing(a,b,c,d){
  const cross=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
  const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
  if(Math.abs(ab1)+Math.abs(ab2)<1e-6){
    const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;if(len<1e-6)return null;
    const tc=((c[0]-a[0])*dx+(c[1]-a[1])*dy)/len,td=((d[0]-a[0])*dx+(d[1]-a[1])*dy)/len;
    const lo=Math.max(0,Math.min(tc,td)),hi=Math.min(1,Math.max(tc,td));
    return (hi-lo)*Math.sqrt(len)>2?[a[0]+(lo+hi)/2*dx,a[1]+(lo+hi)/2*dy]:null;
  }
  if(ab1*ab2>=-1e-6||cd1*cd2>=-1e-6)return null;
  const t=cd1/(cd1-cd2);return [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
}
export function insidePolygon([x,y],ps){
  let inside=false;
  for(let i=0,j=ps.length-1;i<ps.length;j=i++){
    const [xi,yi]=ps[i],[xj,yj]=ps[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
const arrowAt=(end,before)=>{
  const dx=end[0]-before[0],dy=end[1]-before[1],len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
  return polygon([end,[end[0]-ux*10-uy*5,end[1]-uy*10+ux*5],[end[0]-ux*10+uy*5,end[1]-uy*10-ux*5]]);
};
const sampleCurve=(ps,t)=>{
  if(ps.length===2)return [ps[0][0]+(ps[1][0]-ps[0][0])*t,ps[0][1]+(ps[1][1]-ps[0][1])*t];
  const u=1-t;return [0,1].map(k=>u*u*u*ps[0][k]+3*u*u*t*ps[1][k]+3*u*t*t*ps[2][k]+t*t*t*ps[3][k]);
};
export function consoleGraph(canvas,selected=-1){
  const floors=canvas?.empty?[]:[...(canvas?.floors??[])].sort((a,b)=>a.index-b.index);
  const chosen=floors.find(f=>f.index===selected)??floors.find(f=>(f.participants??[]).some(p=>p.selected||p.isMine))??floors.find(f=>f.isEntry)??floors[0];
  const index=chosen?.index??-1,ids=new Set(floors.map(f=>f.index)),seen=new Set();
  const links=(canvas?.links??[]).filter(l=>{const k=`${l.from}:${l.to}`;if(l.from===l.to||seen.has(k)||!ids.has(l.from)||!ids.has(l.to))return false;seen.add(k);return true;});
  const layout=topology(floors,links,canvas),rowHeights=[];
  const nodes=floors.map(f=>{
    const encrypted=!!f.encrypted,p=layout.positions.get(f.index),occupants=encrypted?[]:f.participants??[];
    const tokens=encrypted?[]:[...occupants.map(t=>({...t,kind:'runner',selectable:t.gmDraggable||t.isMine,canMove:t.gmDraggable||t.isMine})),
      ...(f.entities??[]).map(t=>({...t,kind:t.isDemon?'demon':t.isProgram?'program':'ice',canMove:t.gmDraggable}))];
    // Consume only the already permission-filtered VM; never forward unavailable attachment fields.
    const isFile=!encrypted&&(f.kind==='file'||f.holdsFile);
    const finding=!encrypted&&f.contentsVisible?f.findings?.[0]:null;
    const findingPreview=finding?{image:['image','map'].includes(finding.kind)?finding.src:'',text:finding.text||({audio:'АУДИОЗАПИСЬ',message:'ПЕРЕПИСКА',dossier:'ДОСЬЕ'})[finding.kind]||'',label:finding.title,count:f.findings.length}:null;
    const preview=findingPreview??(!encrypted&&f.contentsVisible&&(f.contentsImage||f.contents)?{
      image:String(f.contentsImage||''),text:String(f.contents||'').slice(0,170),label:String(f.label||'Вложение'),
    }:null);
    const card=!!preview||isFile,perRow=4,tokenColumns=Math.min(perRow,tokens.length);
    const tokenWidth=tokenColumns?tokenColumns*108:0,cardWidth=card?200:0,gap=card&&tokens.length?20:0;
    const width=Math.max(320,tokenWidth+cardWidth+gap+120),height=Math.max(116,Math.ceil(tokens.length/perRow)*108+72,card?216:0);
    rowHeights[p.row]=Math.max(rowHeights[p.row]??0,height+42);
    const label=encrypted?'Неизвестный этаж':String(f.label??'Этаж');
    return {index:f.index,number:encrypted?'?':f.number??f.index+1,label,shortLabel:label.length>29?label.slice(0,28)+'…':label,
      ...p,width,height,encrypted,isEntry:!!f.isEntry,selected:f.index===index,current:occupants.some(t=>t.selected||t.isMine),glyph:glyph(f),
      tokens,preview,isFile,card,tokenWidth,cardWidth,gap,people:[],icons:[],
      objectLabel:encrypted?'Неизвестный этаж':card?'Открыть файл: '+label:'Открыть объект: '+label};
  });
  compactPositions(nodes,links);
  const byRow=new Map();for(const n of nodes){if(!byRow.has(n.row))byRow.set(n.row,[]);byRow.get(n.row).push(n);}
  for(const row of byRow.values())row.sort((a,b)=>a.x-b.x);
  const rows=[];let y=76;for(const h of rowHeights){rows.push(y);y+=(h??0)+100;}
  const baseWidth=Math.max(400,...nodes.map(n=>n.x+n.width/2))+80,baseHeight=y?y-65:230;
  const gutters=[...new Set([...byRow.values()].flatMap(row=>row.slice(1).map((n,i)=>(row[i].x+row[i].width/2+n.x-n.width/2)/2)))];
  for(const n of nodes){
    n.top=rows[n.row];n.y=n.top+n.height/2;n.left=n.x-n.width/2;
    const {left:l,top:t,width:w,height:h}=n;
    // A shallow oblique slab with a protected, axis-aligned inner rectangle.
    n.corners=[[l,t+30],[l+w-50,t],[l+w,t+h-30],[l+50,t+h]];
    n.points=polygon(n.corners);const [a,b,c,d]=n.corners;
    n.face=polygon([a,d,c,[c[0],c[1]+8],[d[0],d[1]+8],[a[0],a[1]+8]]);
    const project=(u,v)=>[a[0]+u*(b[0]-a[0])+v*(d[0]-a[0]),a[1]+u*(b[1]-a[1])+v*(d[1]-a[1])];
    const grid=[];for(let j=1;j<14;j++)for(const ends of [[[j/14,0],[j/14,1]],[[0,j/14],[1,j/14]]])grid.push(`M${point(...project(...ends[0]))}L${point(...project(...ends[1]))}`);
    n.grid=grid.join('');n.labelX=n.x;n.labelY=t+h+29;n.subtitleY=n.labelY+21;n.routeBottom=n.subtitleY+10;
    n.captionX=n.x-Math.max(90,n.shortLabel.length*5+10);n.captionY=n.labelY-23;
    n.captionWidth=(n.x-n.captionX)*2;n.captionHeight=n.routeBottom-n.captionY;
    n.objectX=l+w/2-30;n.objectY=t+h/2-30;
    n.previewX=l+60;n.previewY=t+36;
    const start=l+(w-(n.tokenWidth+n.cardWidth+n.gap))/2+n.cardWidth+n.gap;
    n.tokens=n.tokens.map((p,k)=>({...p,floorIndex:n.index,
      img:(p.tokenImg&&!p.tokenImg.endsWith('mystery-man.svg')?p.tokenImg:p.img)||'icons/svg/mystery-man.svg',
      kindLabel:p.kind==='runner'?'НЕТРАННЕР':p.kind==='demon'?'ДЕМОН':p.kind==='program'?'ПРОГРАММА':'ЛЁД',
      shortName:String(p.name??'').length>12?String(p.name).slice(0,11)+'…':p.name,
      x:start+(k%4)*108,y:t+36+Math.floor(k/4)*108}));
    // The object badge stays on its slab even when tokens occupy its centre.
    if(n.tokens.length&&!n.card){n.objectX=l+24;n.objectY=t+64;n.smallObject=true;}
    const boxes=n.tokens.map(t=>[t.x-6,t.y-6,120,116]);
    boxes.push(n.card?[n.previewX-6,n.previewY-6,212,156]:[n.objectX-6,n.objectY-6,n.smallObject?44:76,n.smallObject?44:76]);
    boxes.push([n.captionX,n.captionY,n.captionWidth,n.captionHeight]);
    n.wireMasks=boxes.map(([x,y,width,height])=>({x,y,width,height}));
  }
  const byIndex=new Map(nodes.map(n=>[n.index,n]));
  const masked=q=>nodes.some(n=>n.wireMasks.some(r=>q[0]>=r.x&&q[0]<=r.x+r.width&&q[1]>=r.y&&q[1]<=r.y+r.height));
  const routed=[];
  const edges=[...links].sort((a,b)=>Number(a.extra===true)-Number(b.extra===true)||a.from-b.from||a.to-b.to).map((l,i)=>{
    const a=byIndex.get(l.from),b=byIndex.get(l.to),others=nodes.filter(n=>n!==a&&n!==b);
    const begin=[a.x,a.y],end=[b.x,b.y],reverse=links.some(e=>e.from===l.to&&e.to===l.from);
    let points=[begin,end];
    if(reverse){const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
      points=[begin,[a.x+dx/3-dy/length*20,a.y+dy/3+dx/length*20],[a.x+dx*2/3-dy/length*20,a.y+dy*2/3+dx/length*20],end];}
    const samplesOf=ps=>Array.from({length:ps.length===2?2:33},(_,k)=>sampleCurve(ps,k/(ps.length===2?1:32)));
    const score=ps=>{
      const samples=samplesOf(ps);let obstacles=0,crossings=0;
      for(let k=1;k<80;k++){const q=sampleCurve(ps,k/80);for(const n of others)if(q[0]>n.left-10&&q[0]<n.left+n.width+10&&q[1]>n.top-10&&q[1]<n.routeBottom+10)obstacles++;}
      for(const prior of routed)for(let j=1;j<samples.length;j++)for(let k=1;k<prior.samples.length;k++){
        const at=crossing(samples[j-1],samples[j],prior.samples[k-1],prior.samples[k]);
        if(at&&!masked(at))crossings++;
      }
      let length=0;for(let k=1;k<samples.length;k++)length+=Math.hypot(samples[k][0]-samples[k-1][0],samples[k][1]-samples[k-1][1]);
      return {obstacles,crossings,cost:obstacles*1e7+crossings*1e5+length+(ps.length===2?0:20)};
    };
    let best=score(points);
    if(best.obstacles||best.crossings){
      const candidates=[];
      for(const band of [Math.max(24,Math.min(a.top,b.top)-64),Math.min(baseHeight-24,Math.max(a.routeBottom,b.routeBottom)+24)])
        candidates.push([begin,[a.x,band],[b.x,band],end]);
      for(const lane of [...gutters,24+i%4*10,baseWidth-24-i%4*10]){
        const dy=b.y-a.y;
        candidates.push([begin,[lane,a.y+dy*.28],[lane,b.y-dy*.28],end]);
      }
      for(const candidate of candidates){const candidateScore=score(candidate);if(candidateScore.cost<best.cost){points=candidate;best=candidateScore;}}
    }
    routed.push({from:l.from,to:l.to,samples:samplesOf(points)});
    const samples=Array.from({length:81},(_,k)=>sampleCurve(points,k/80));
    // Continue onto the receiving slab and stop the visible arrow just before
    // its content. The actual path still ends at the geometric centre.
    const boxes=b.tokens.map(t=>[t.x-6,t.y-6,t.x+114,t.y+110]);
    if(b.card)boxes.push([b.previewX-6,b.previewY-6,b.previewX+206,b.previewY+150]);
    else boxes.push([b.objectX-6,b.objectY-6,b.objectX+(b.smallObject?38:70),b.objectY+(b.smallObject?38:70)]);
    const inContent=q=>boxes.some(([l,t,r,bottom])=>q[0]>=l&&q[0]<=r&&q[1]>=t&&q[1]<=bottom);
    let entry=samples.length-1;while(entry>0&&insidePolygon(samples[entry-1],b.corners))entry--;
    let arrowT=Math.max(0,1-14/Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)));
    for(let k=Math.max(1,entry);k<samples.length;k++)if(inContent(samples[k])){
      let lo=(k-1)/80,hi=k/80;
      for(let j=0;j<16;j++){const mid=(lo+hi)/2;if(inContent(sampleCurve(points,mid)))hi=mid;else lo=mid;}
      arrowT=lo;break;
    }
    const tip=sampleCurve(points,arrowT),before=sampleCurve(points,Math.max(0,arrowT-.005));
    return {from:l.from,to:l.to,sourceSurface:a.points,targetSurface:b.points,active:l.from===index||l.to===index,hidden:a.encrypted||b.encrypted,
      title:a.encrypted||b.encrypted?'Связь с неизвестным этажом':`Этаж ${a.number} → этаж ${b.number}`,
      points,samples,underpass:best.obstacles>0,crossings:best.crossings,direct:points.length===2,
      path:points.length===2?`M${point(...points[0])}L${point(...points[1])}`:`M${point(...points[0])}C${points.slice(1).map(p=>point(...p)).join(' ')}`,
      arrow:arrowAt(tip,before),arrowTip:tip,startX:begin[0],startY:begin[1]};
  });
  const adjacent=[...new Set(links.flatMap(l=>l.from===index?[l.to]:l.to===index?[l.from]:[]))];
  const ranksSeen=new Set(),levels=[];
  for(const n of nodes)if(layout.branched&&!ranksSeen.has(n.rank)){levels.push({y:n.top-24,label:nodes.some(f=>f.rank===n.rank&&f.isEntry)?'ВХОД':`ГЛУБИНА ${n.rank}`,end:baseWidth-40});ranksSeen.add(n.rank);}
  return {width:Math.max(480,baseWidth),height:Math.max(230,baseHeight),branched:layout.branched,linkCount:links.length,levels,
    selectedIndex:index,selectedLabel:chosen?.encrypted?'Неизвестный этаж':chosen?.label??'',
    count:nodes.length,nodes:[...nodes].sort((a,b)=>a.row-b.row||a.col-b.col),navigation:nodes,edges:edges.sort((a,b)=>Number(a.active)-Number(b.active)),
    connections:adjacent.map(i=>{const n=byIndex.get(i);return {index:i,label:`${n.number} · ${n.label}`};}),hasConnections:adjacent.length>0,
    currentIndex:nodes.find(n=>n.current)?.index??floors.find(f=>f.isEntry)?.index??floors[0]?.index??-1};
}

/** Width first; never compress a large architecture into one unreadable thumbnail. */
export function consoleGraphScale(width, height, graph, zoom = 1) {
  const fitWidth = Math.max(1, width - 12) / graph.width;
  const fit = fitWidth; // Interactive portraits stay readable; the whole-network button fits height explicitly.
  return Math.max(.65, Math.min(1.5, fit)) * Math.max(.25, Math.min(4, Number(zoom) || 1));
}

export const clampMapZoom = value => Math.max(.25,Math.min(4,Number(value)||1));
/** Keep the same point in the SVG under the cursor, including centring margins. */
export function mapZoomAnchor(scroll,cursor,oldScale,newScale,extent,viewport,centered=true){
  const oldMargin=centered?Math.max(0,(viewport-extent*oldScale)/2):0,newMargin=centered?Math.max(0,(viewport-extent*newScale)/2):0;
  return Math.max(0,(scroll+cursor-oldMargin)/oldScale*newScale+newMargin-cursor);
}
