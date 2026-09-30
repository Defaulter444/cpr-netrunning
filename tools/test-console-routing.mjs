import assert from 'node:assert/strict';
import fs from 'node:fs';
import {consoleGraph,insidePolygon} from '../scripts/apps/console-graph.mjs';
const floors=n=>Array.from({length:n},(_,index)=>({index,number:index+1,label:`Floor ${index+1}`}));
const fork={floors:floors(6),links:[{from:0,to:1},{from:0,to:2},{from:1,to:3},{from:2,to:4},{from:3,to:5},{from:4,to:5}]};
const actual=JSON.parse(fs.readFileSync(new URL('./fixtures/console-234.json',import.meta.url)));
const crowded=structuredClone(fork);
crowded.floors[0].entities=Array.from({length:24},(_,i)=>({ref:`ice:a:f0:i${i}`,name:`ICE ${i}`}));
Object.assign(crowded.floors[0],{kind:'file',contentsVisible:true,contentsImage:'test/image.jpg',contents:'Readable file'});
const cycle={floors:floors(3),links:[{from:0,to:1},{from:1,to:2},{from:2,to:0}]};
const bidirectional={floors:floors(3),links:[{from:0,to:1},{from:1,to:0},{from:1,to:2}]};
const chain={floors:floors(17),links:Array.from({length:16},(_,i)=>({from:i,to:i+1}))};
const star={floors:floors(17),links:Array.from({length:16},(_,i)=>({from:0,to:i+1}))};
const unnamed=JSON.parse(fs.readFileSync(new URL('./fixtures/console-unnamed.json',import.meta.url)));
const filled=structuredClone(unnamed);
Object.assign(filled.floors[2],{kind:'file',contentsVisible:true,contentsImage:'test.jpg',entities:[{ref:'demon:3',isDemon:true}]});
filled.floors[9].participants=[{ref:'runner:test'}];filled.floors[9].entities=Array.from({length:3},(_,i)=>({ref:'ice:'+i}));
filled.floors.push({index:24,number:25,row:3,col:64,kind:'file',contentsVisible:true,contentsImage:'test.jpg'});
filled.links.push({from:4,to:24,extra:false});
for(const input of [fork,actual,unnamed,filled,crowded,cycle,bidirectional,chain,star]){
  const before=structuredClone(input),graph=consoleGraph(input,0);
  assert.deepEqual(input,before,'layout must be read-only');
  assert.equal(graph.edges.length,input.links.length,'every true link is drawn');
  assert.equal(new Set(graph.nodes.map(n=>`${n.row}:${n.col}`)).size,graph.nodes.length,'each primary-tree slot is distinct');
  for(const edge of graph.edges){
    assert.ok(edge.path&&edge.arrow&&!edge.path.includes('NaN'));
    const source=graph.nodes.find(n=>n.index===edge.from),target=graph.nodes.find(n=>n.index===edge.to);
    assert.deepEqual(edge.points[0],[source.x,source.y],'path starts at floor centre');
    assert.deepEqual(edge.points.at(-1),[target.x,target.y],'path ends at floor centre');
    assert.equal('portal' in edge,false,'no navigation portal substitutes for a connection');
    assert.ok(edge.points.every(([x,y])=>x>=0&&x<=graph.width&&y>=0&&y<=graph.height),'control points within SVG bounds');
    if(!edge.underpass)for(const n of graph.nodes.filter(n=>n.index!==edge.from&&n.index!==edge.to))
      assert.ok(edge.samples.every(p=>!insidePolygon(p,n.corners)),'clear paths avoid every other slab');
  }
  for(const n of graph.nodes){
    assert.ok(n.corners.every(([x,y])=>x>=0&&x<=graph.width&&y>=0&&y<=graph.height));
    assert.ok(n.subtitleY<graph.height);
    for(const other of graph.nodes.filter(o=>o.index!==n.index))assert.ok(n.left+n.width<=other.left||other.left+other.width<=n.left||n.top+n.height<other.top||other.top+other.height<n.top,'adaptive slabs never overlap');
    const contained=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].every(p=>insidePolygon(p,n.corners));
    for(const t of n.tokens)assert.ok(contained(t.x,t.y,104,104),'each entire token stays on its floor');
    if(n.card)assert.ok(contained(n.previewX,n.previewY,200,144),'whole attachment card stays on its floor');
  }
}
assert.ok(consoleGraph(chain).edges.every(e=>e.direct),'simple chains connect directly');
assert.ok(consoleGraph(fork).edges.filter(e=>e.direct).length>=4,'ordinary branches predominantly connect directly');
const empty=consoleGraph(fork).nodes[0],full=consoleGraph(crowded).nodes[0];
assert.ok(full.width>empty.width&&full.height>empty.height,'floor surface grows with contents');
const locked={floors:[{index:0,kind:'file',contentsVisible:false,contents:'SECRET TEXT',contentsImage:'SECRET.png'},{index:1,encrypted:true,label:'SECRET NAME',contentsVisible:true,contentsImage:'SECRET2.jpg',entities:[{name:'SECRET ICE'}]}],links:[{from:0,to:1}]};
assert.ok(!JSON.stringify(consoleGraph(locked)).includes('SECRET'),'no attachment metadata in denied VM');
const known=consoleGraph({floors:[{index:0,kind:'file',contentsVisible:true,contents:'Open text',contentsImage:'test.jpg'}]});
assert.equal(known.nodes[0].preview.image,'test.jpg');
const opposite=consoleGraph(bidirectional).edges.filter(e=>e.from===0||e.to===0);
assert.notDeepEqual(opposite[0].points,opposite[1].points.toReversed(),'opposite arrows are distinct');
console.log('Routing: all direct/curved links, 17-floor fanout, cycles, merges, 24 tokens + attachment contained, dynamic pitches, fog and bounds passed');

// Independent segment test for the reported architecture, including its crowded variant.
const side=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const intersects=(a,b,c,d)=>side(a,b,c)*side(a,b,d)<-1e-6&&side(c,d,a)*side(c,d,b)<-1e-6;
for(const [input,maxWidth] of [[unnamed,1500],[filled,1800]]){
  const graph=consoleGraph(input),node=i=>graph.nodes.find(n=>n.index===i);
  assert.ok(graph.width<maxWidth,'short branches do not inherit deep subtree widths');
  assert.equal(node(3).x,node(9).x,'4 to 10 remains vertical');
  assert.equal(node(9).row,node(6).row,'10 and 7 remain siblings on the same visual level');
  for(let i=0;i<graph.edges.length;i++)for(let j=i+1;j<graph.edges.length;j++){
    const a=graph.edges[i],b=graph.edges[j];
    for(let k=1;k<a.samples.length;k++)for(let l=1;l<b.samples.length;l++)
      assert.ok(!intersects(a.samples[k-1],a.samples[k],b.samples[l-1],b.samples[l]),`no crossing: ${a.from}->${a.to}, ${b.from}->${b.to}`);
  }
}
const shuffled={floors:[{index:0,row:0,col:0},{index:1,row:0,col:1},{index:2,row:1,col:1},{index:3,row:1,col:0},{index:4,row:2,col:1},{index:5,row:2,col:0}],links:[{from:0,to:2},{from:1,to:3},{from:2,to:4},{from:3,to:5}]};
const reordered=consoleGraph(shuffled),rn=i=>reordered.nodes.find(n=>n.index===i);
assert.equal(rn(2).x,rn(4).x,'row correction shifts the whole descendant chain');
assert.equal(rn(3).x,rn(5).x,'the other chain stays aligned');
console.log('Centre endpoints, independent crossing regression, compact mixed sizes and subtree translation passed');
