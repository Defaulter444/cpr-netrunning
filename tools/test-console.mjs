import assert from 'node:assert/strict';
import fs from 'node:fs';
import {consoleGraph, consoleGraphScale, slabPoint, clampMapZoom, mapZoomAnchor} from '../scripts/apps/console-graph.mjs';
const c={floors:[{index:0,number:1,row:0,label:'Вход',icon:'entry.svg',participants:[],entities:[]},{index:1,row:1,encrypted:true,label:'SECRET',entities:[{name:'SECRET ICE'}]}],links:[{from:0,to:1},{from:1,to:2}]};
const g=consoleGraph(c,0);assert.equal(g.nodes.length,2);assert.equal(g.edges.length,1);assert.equal(g.nodes.find(n=>n.index===0).selected,true);
assert.ok(!JSON.stringify(g).includes('SECRET'));assert.equal(g.nodes.find(n=>n.index===1).number,'?');assert.equal(g.nodes.find(n=>n.index===1).icons.length,0);
assert.equal(consoleGraph({empty:true,floors:c.floors}).nodes.length,0);
assert.deepEqual(c.floors[1].label,'SECRET');console.log('Console: filtered graph, hidden content, empty state, immutability passed');
const long=consoleGraph({floors:Array.from({length:20},(_,index)=>({index,depth:index,label:'Этаж '+index})),links:[]});
assert.ok(long.height>2000,'long architectures have distinct vertical layers');
assert.deepEqual(long.nodes.map(n=>n.index),Array.from({length:20},(_,i)=>i),'linear floors descend from entry at the top');
assert.ok(long.nodes.every((n,i)=>i===0||n.y>long.nodes[i-1].y),'each later floor is below its predecessor');
const branches=consoleGraph({floors:Array.from({length:6},(_,index)=>({index,depth:1,label:'Ветка '+index})),links:[]});
assert.equal(new Set(branches.nodes.map(n=>n.y)).size,6);
assert.equal(new Set(branches.nodes.map(n=>n.x)).size,1);
assert.equal(branches.width,g.width,'branch count must not increase map width');
const [a,b,d]=[[0,0],[1,0],[0,1]].map(([u,v])=>slabPoint(0,0,u,v));
assert.ok(b[1]<a[1]&&d[1]>a[1],'both edges must tilt in opposite directions');
assert.notEqual(Math.abs(b[0]-a[0]),Math.abs(d[0]-a[0]),'oblique rectangle, not a flat symmetric diamond');
const actual=JSON.parse(fs.readFileSync(new URL('./fixtures/console-234.json',import.meta.url)));
const before=structuredClone(actual), fanout=consoleGraph(actual,0);
assert.equal(fanout.nodes.length,17);
assert.ok(fanout.branched,'real fanout must have a branch layout');
assert.ok(fanout.width>1500,'wide primary branches retain their horizontal room');
assert.equal(fanout.edges.length,actual.links.length,'all genuine links are visible');
assert.equal(fanout.edges.filter(e=>e.active).length,actual.links.filter(l=>l.from===0||l.to===0).length);
const rows=new Map();for(const n of fanout.nodes){if(!rows.has(n.y))rows.set(n.y,[]);rows.get(n.y).push(n);}
assert.equal(Math.max(...[...rows.values()].map(a=>a.length)),14,'all fourteen primary siblings remain on one row');
assert.equal(new Set(fanout.nodes.map(n=>`${n.x}:${n.y}`)).size,17,'no coincident floors');
assert.ok(actual.links.filter(l=>l.from===0).every(l=>fanout.nodes.find(n=>n.index===l.to).rank===1),'primary children stay immediately beneath the entry');
assert.equal(fanout.nodes.find(n=>n.index===3).row,fanout.nodes.find(n=>n.index===9).row,'secondary 4→10 entrance does not push primary sibling down');
assert.equal(fanout.nodes[0].index,0,'entry is the first visible floor at the top');
assert.ok(fanout.edges.every(e=>actual.links.some(l=>l.from===e.from&&l.to===e.to)),'no invented sequential links');
const branch=consoleGraph(actual,8);
assert.ok(branch.connections.some(n=>n.index===16),'real 9→17 connection remains navigable');
assert.ok(!branch.connections.some(n=>n.index===9),'visual neighbour does not become a network neighbour');
const scale=consoleGraphScale(750,570,fanout);
assert.ok(scale>=.5&&scale<1,'wide tree remains readable at width fit');
assert.ok(fanout.width*scale>750,'wide tree scrolls horizontally, never shrinks to a miniature');
assert.ok(fanout.nodes.every(n=>n.points.split(' ').every(p=>{const [x,y]=p.split(',').map(Number);return x>=0&&x<=fanout.width&&y>=0&&y<=fanout.height;})));
assert.deepEqual(actual,before,'layout must not migrate the saved architecture');
assert.equal(consoleGraph(actual,999).selectedIndex,0,'stale selection falls back to entry');
const six={floors:Array.from({length:6},(_,index)=>({index,number:index+1,label:'Этаж '+index})),links:[{from:0,to:1},{from:0,to:2},{from:1,to:3},{from:2,to:4},{from:4,to:5}]};
const fork=consoleGraph(six,1);assert.ok(fork.branched);assert.notEqual(fork.nodes.find(n=>n.index===1).x,fork.nodes.find(n=>n.index===2).x);
assert.ok(six.links.every(l=>fork.nodes.find(n=>n.index===l.from).y<fork.nodes.find(n=>n.index===l.to).y),'both branches lead downwards');
assert.equal(fork.edges.filter(e=>e.active).length,2);
assert.equal(consoleGraph({floors:c.floors,links:[...c.links,c.links[0]]}).edges.length,1,'duplicate and invisible links removed');
const cyclic=consoleGraph({floors:six.floors,links:[...six.links,{from:3,to:1}]});assert.equal(cyclic.nodes.length,6);assert.ok(cyclic.nodes.every(n=>Number.isFinite(n.x+n.y)));
assert.equal(clampMapZoom(10),4);assert.equal(clampMapZoom(.01),.25);assert.equal(clampMapZoom(NaN),1);
assert.equal(mapZoomAnchor(200,150,1,2,1000,500),550,'cursor position remains over same graph point');
assert.equal(mapZoomAnchor(0,250,1,2,300,500),50,'account for centred SVG margins');
assert.equal(mapZoomAnchor(200,150,2,1,1000,500,false),25,'vertical zoom has no centring margin');
assert.equal(mapZoomAnchor(0,50,1,.25,1000,500,false),0,'scroll is clamped at origin');
assert.equal(consoleGraphScale(750,570,fanout,4)/consoleGraphScale(750,570,fanout),4);
console.log('Perspective: 234/17 floors, true forks and merges, primary-tree fanout, all links, zoom anchors and limits passed');

// Regression from the user's classic diagram: 4 above 10 and 7, with an extra 10→7.
const siblings={unit:2,floors:[
  {index:3,number:4,row:3,col:4,layoutOrder:1,isEntry:false},
  {index:9,number:10,row:4,col:0,layoutOrder:0,entities:Array.from({length:5},(_,i)=>({ref:`ice:${i}`}))},
  {index:6,number:7,row:4,col:8,layoutOrder:2},
],links:[{from:3,to:9,extra:false},{from:3,to:6,extra:false},{from:9,to:6,extra:true}]};
const siblingGraph=consoleGraph(siblings,3),node=n=>siblingGraph.nodes.find(f=>f.number===n);
assert.equal(node(10).row,node(7).row);assert.equal(node(10).top,node(7).top);
assert.equal(node(10).rank,node(4).rank+1);
assert.ok(node(10).x<node(7).x,'classic left-to-right ordering is preserved');
assert.equal(node(4).x,(node(10).x+node(7).x)/2,'parent stays above the same classic midpoint');
assert.ok(node(10).left+node(10).width+72<=node(7).left,'large token slab has room beside sibling');
assert.equal(siblingGraph.edges.length,3);assert.equal(siblingGraph.connections.length,2);
const withoutExtra=consoleGraph({...siblings,links:siblings.links.slice(0,2)});
assert.deepEqual(withoutExtra.nodes.map(n=>[n.index,n.x,n.top]),siblingGraph.nodes.map(n=>[n.index,n.x,n.top]),'extra entrance never changes placement');
const shifted=consoleGraph({...siblings,floors:siblings.floors.map(f=>({...f,col:f.col+100,row:f.row+100}))});
assert.deepEqual(shifted.nodes.map(n=>[n.x,n.top]),siblingGraph.nodes.map(n=>[n.x,n.top]),'empty rows and leading columns are removed');
const fog={...siblings,layoutVisibleOnly:true};
const fogChanged={...fog,floors:fog.floors.map(f=>({...f,col:f.col*1000+72,row:f.row+20}))};
assert.deepEqual(consoleGraph(fog),consoleGraph(fogChanged),'player layout ignores coordinates derived from hidden branches');
for(const input of [
  {...siblings,floors:siblings.floors.map(({row,col,...f})=>f)},
  {...siblings,floors:siblings.floors.map((f,i)=>i===0?{...f,col:undefined}:f)},
  {...siblings,floors:siblings.floors.map(f=>({...f,col:0}))},
]){
  const graph=consoleGraph(input),at=i=>graph.nodes.find(n=>n.index===i);
  assert.equal(at(6).row,at(9).row,'fallback primary children share a row');
  assert.ok(at(6).top>at(3).top);assert.ok(graph.nodes.every(n=>Number.isFinite(n.x+n.y)));
}
const extraRoot=consoleGraph({floors:[{index:0},{index:1},{index:2}],links:[{from:0,to:1,extra:false},{from:1,to:2,extra:true}]});
assert.equal(extraRoot.nodes.length,3);assert.equal(extraRoot.edges.length,2);
console.log('Classic topology: 4→{10,7}, secondary entrance, variable slab sizes, fractional columns, filtered coordinates and legacy fallback passed');

const playerSiblingGraph=consoleGraph(fog);
assert.ok(playerSiblingGraph.nodes.find(n=>n.number===10).x<playerSiblingGraph.nodes.find(n=>n.number===7).x,'player preserves classic visible sibling order');
assert.equal(extraRoot.nodes.find(n=>n.index===2).rank,extraRoot.nodes.find(n=>n.index===1).rank+1,'extra-only visible entrance anchors the discovered floor');
const sideways=consoleGraph({floors:[{index:0,row:0,col:0},{index:1,row:1,col:0},{index:2,row:1,col:1},{index:3,row:1,col:2}],links:[{from:0,to:1},{from:0,to:2},{from:0,to:3},{from:1,to:3,extra:true}]});
assert.equal(sideways.edges.find(e=>e.from===1&&e.to===3).underpass,false,'sideways entrance bypasses the intervening sibling');
const corrupt=consoleGraph({floors:[{index:0,row:0,col:10},{index:1,row:1,col:0},{index:2,row:1,col:.001}],links:[{from:0,to:1},{from:0,to:2}]});
assert.ok(corrupt.width<2000,'nearly coincident corrupt columns use a safe tree');
const unnamed=JSON.parse(fs.readFileSync(new URL('./fixtures/console-unnamed.json',import.meta.url)));
const unnamedGraph=consoleGraph(unnamed,3),real=n=>unnamedGraph.nodes.find(f=>f.number===n);
assert.equal(real(10).top,real(7).top);assert.equal(real(10).x,real(4).x);
assert.ok(real(7).x>real(10).x&&real(7).top>real(4).top);
assert.equal(unnamedGraph.edges.length,unnamed.links.length);
console.log('Live 24-floor architecture: 10 and 7 beneath 4, all primary and extra links retained');
