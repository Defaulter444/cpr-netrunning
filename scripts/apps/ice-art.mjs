import {iceProfile} from './ice-profiles.mjs';
const TAU=Math.PI*2;
const line=(c,points)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();};
const circle=(c,x,y,r)=>{c.beginPath();c.arc(x,y,Math.max(.1,r),0,TAU);c.stroke();};
/** Draw an original vector avatar in normalized -1..1 coordinates. */
export function iceGlyph(c,type,time=0){
  const p=iceProfile(type),wave=Math.sin(time*TAU);c.lineWidth=.055;c.lineCap='round';c.lineJoin='round';
  switch(p.shape){
    case 'serpent':c.beginPath();c.moveTo(-.8,.6);c.bezierCurveTo(1,.8,-1,-.5,.6,-.5);c.quadraticCurveTo(.9,-.9,.4,-.9);c.stroke();line(c,[[.6,-.5],[.8,-.25],[.4,-.28]]);break;
    case 'fist':line(c,[[-.6,.7],[-.75,-.3],[-.45,-.3],[-.45,-.8],[-.1,-.8],[-.1,-.9],[.23,-.9],[.23,-.75],[.55,-.75],[.7,-.2],[.5,.7],[-.6,.7]]);line(c,[[-.4,-.25],[.4,-.25],[.15,.3]]);break;
    case 'hound':line(c,[[-.8,-.8],[-.2,-.35],[.2,-.35],[.8,-.8],[.65,.2],[.3,.8],[-.3,.8],[-.65,.2],[-.8,-.8]]);line(c,[[-.6,-.1],[-.2,.12],[0,.65],[.2,.12],[.6,-.1]]);break;
    case 'tentacles':circle(c,0,-.45,.3);for(let i=0;i<6;i++){const x=(i-2.5)*.27;c.beginPath();c.moveTo(x*.35,-.3);c.bezierCurveTo(x+wave*.2,.2,x-wave*.3,1,x+(i%2?.18:-.18),.6);c.stroke();}break;
    case 'rune':for(let i=0;i<6;i++){const a=i*TAU/6+time*.6;line(c,[[Math.cos(a)*.4,Math.sin(a)*.4],[Math.cos(a+.3)*.8,Math.sin(a+.3)*.8],[Math.cos(a+.6)*.63,Math.sin(a+.6)*.63]]);}circle(c,0,0,.26);line(c,[[-.15,0],[.15,0],[0,.25]]);break;
    case 'wings':for(const sign of [-1,1])line(c,[[0,.6],[sign*.2,-.2],[sign*.9,-.65-wave*.15],[sign*.75,.15],[sign*.4,.05],[sign*.45,.4],[0,.6]]);line(c,[[0,-.15],[.2,-.45],[0,-.6],[-.1,-.25]]);break;
    case 'stinger':circle(c,0,.3,.25);for(const sign of [-1,1]){line(c,[[sign*.2,.2],[sign*.7,0],[sign*.8,-.4],[sign*.55,-.25]]);for(let i=0;i<3;i++)line(c,[[sign*.2,.3+i*.1],[sign*.55,.45+i*.15]]);}c.beginPath();c.moveTo(0,.1);c.bezierCurveTo(-.8,-.4,0,-1,.5,-.7);c.lineTo(.6,-.25);c.lineTo(.25,-.5);c.stroke();break;
    case 'cloud':for(let i=0;i<6;i++){const a=i*TAU/6;circle(c,Math.cos(a)*.43,Math.sin(a)*.35,.3+wave*.035);}line(c,[[-.15,-.4],[.15,0],[-.1,.4]]);break;
    case 'orb':for(let i=0;i<3;i++){c.save();c.rotate(i*TAU/3+time);c.beginPath();c.ellipse(0,0,.8,.25,0,0,TAU);c.stroke();c.restore();}circle(c,0,0,.16);break;
    case 'dragon':for(const sign of [-1,1])line(c,[[0,.3],[sign*.3,-.3],[sign*.95,-.9-wave*.08],[sign*.8,.2],[sign*.5,0],[sign*.25,.7],[0,.3]]);line(c,[[0,.3],[-.15,-.6],[.12,-.85],[.28,-.5],[0,-.3],[0,.3],[.2,.85]]);break;
    case 'blades':for(const sign of [-1,1])line(c,[[sign*.7,-.9],[sign*.4,.5],[sign*.1,.75],[sign*.1,.4],[sign*.7,-.9]]);line(c,[[-.6,.4],[-.1,.7],[.1,.7],[.6,.4]]);break;
    case 'fangs':line(c,[[-.85,-.65],[-.5,-.2],[0,-.4],[.5,-.2],[.85,-.65],[.65,.35],[.35,.9],[.25,.1],[-.25,.1],[-.35,.9],[-.65,.35],[-.85,-.65]]);break;
  }
}
/** Shared renderer for live cues and an isolated, non-gameplay preview. */
export function drawIceCue(c,{type,phase},t,a,b=a,r=36){
  const p=iceProfile(type),travel=Math.min(1,t/0.68),q=travel*travel*(3-2*travel),x=a.x+(b.x-a.x)*q,y=a.y+(b.y-a.y)*q;
  c.save();c.strokeStyle=p.color;c.fillStyle=p.accent;c.shadowColor=p.color;c.shadowBlur=13;
  c.globalAlpha=Math.min(1,t*9)*Math.min(1,(1-t)*5);
  if(phase==='attack'){drawAttack(c,type,t,a,b,r);c.restore();return;}
  if(phase==='pursuit'){
    // Character-specific trail: feathers, fire, venom, interference or metal shards.
    for(let i=0;i<18;i++){const u=Math.max(0,q-i*.027),side=Math.sin(i*2.4+t*12)*(p.shape==='dragon'?23:10)*(1-u);const px=a.x+(b.x-a.x)*u,py=a.y+(b.y-a.y)*u+side;c.globalAlpha*=.96;
      if(['blades','fangs','wings'].includes(p.shape))line(c,[[px-5,py-5],[px+5,py+6]]);else {c.beginPath();c.arc(px,py,Math.max(1,(1-i/20)*(p.shape==='cloud'?9:4)),0,TAU);c.fill();}}
    c.globalAlpha=Math.min(1,t*9)*Math.min(1,(1-t)*5);
    if(phase==='attack'&&t>.63){c.lineWidth=2;for(let i=0;i<3;i++)circle(c,b.x,b.y,(t-.63)*r*(3+i));}
  }
  if(phase==='derez'){
    for(let i=0;i<24;i++){const angle=i*2.39996,d=r*(.4+t*(1+i%4));c.save();c.translate(a.x+Math.cos(angle)*d,a.y+Math.sin(angle)*d);c.rotate(angle+t*4);c.globalAlpha*=1-t;line(c,[[-4,-3],[4,3],[2,5]]);c.restore();}
  }
  c.translate(phase==='attack'||phase==='pursuit'?x:a.x,phase==='attack'||phase==='pursuit'?y:a.y);
  const size=r*(phase==='appear'?.25+.75*Math.min(1,t*3):phase==='derez'?1-t*.6:1);
  c.scale(size,size);c.lineWidth=.04;
  if(phase==='appear'){c.save();c.rotate(t*1.5);for(let i=0;i<4;i++)c.strokeRect(-1-i*.13,-1-i*.13,2+i*.26,2+i*.26);c.restore();}
  if(phase==='derez')c.globalAlpha*=1-t;
  iceGlyph(c,type,t);c.restore();
}

function avatar(c,type,t,p,r){c.save();c.translate(p.x,p.y);c.scale(r,r);iceGlyph(c,type,t);c.restore();}
function drawAttack(c,type,t,a,b,r){
  const p=iceProfile(type),u=Math.min(1,t/.66),q=u*u*(3-2*u),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
  const at=(progress,side=0)=>({x:a.x+dx*progress+nx*side,y:a.y+dy*progress+ny*side});
  const head=at(q),hit=Math.max(0,(t-.6)/.4);c.lineWidth=2;
  if(p.shape==='tentacles'){
    avatar(c,type,t,a,r*.85);
    for(let i=0;i<5;i++){const side=(i-2)*r*.55,end=at(q,Math.sin(t*12+i)*r*.2),one=at(q*.35,side*2),two=at(q*.8,-side);c.beginPath();c.moveTo(a.x,a.y);c.bezierCurveTo(one.x,one.y,two.x,two.y,end.x,end.y);c.stroke();if(hit)circle(c,b.x+nx*side*.25,b.y+ny*side*.25,r*(.5+hit*.4));}
  }else if(p.shape==='stinger'){
    avatar(c,type,t,a,r*.8);const one=at(.1,-r*3),two=at(q*.7,-r*2);c.beginPath();c.moveTo(a.x,a.y);c.bezierCurveTo(one.x,one.y,two.x,two.y,head.x,head.y);c.stroke();line(c,[[head.x-nx*9-dx/len*12,head.y-ny*9-dy/len*12],[head.x,head.y],[head.x+nx*9-dx/len*12,head.y+ny*9-dy/len*12]]);
  }else if(p.shape==='dragon'||p.shape==='hound'){
    const dragon=p.shape==='dragon',origin=dragon?a:head;avatar(c,type,t,origin,r*(dragon?1:.85));
    for(let i=0;i<30;i++){const v=dragon?(i/30)*q:Math.max(0,q-i*.016),spread=(dragon?v:1-i/30)*r*.65,center=at(v,Math.sin(i*8.1+t*29)*spread);c.fillStyle=i%3===0?p.accent:p.color;c.beginPath();c.moveTo(center.x+dx/len*12,center.y+dy/len*12);c.lineTo(center.x+nx*5,center.y+ny*5);c.lineTo(center.x-nx*5-dx/len*8,center.y-ny*5-dy/len*8);c.fill();}
  }else if(p.shape==='cloud'){
    avatar(c,type,t,a,r*.8);for(let i=0;i<18;i++){const v=q*(i/18),center=at(v,Math.sin(i*3.4)*r*v);c.save();c.globalAlpha*=.22;c.fillStyle=i%2?p.color:p.accent;c.beginPath();c.arc(center.x,center.y,r*(.15+v*.45),0,TAU);c.fill();c.restore();}if(hit)avatar(c,type,t,b,r*(.8+hit));
  }else if(p.shape==='orb'){
    const points=Array.from({length:19},(_,i)=>{const v=q*i/18,center=at(v,(i===0||i===18?0:(i%2?1:-1))*r*.25);return [center.x,center.y];});line(c,points);avatar(c,type,t,head,r*.6);if(hit)circle(c,b.x,b.y,r*(1+hit));
  }else if(p.shape==='rune'){
    avatar(c,type,t,a,r*.7);circle(c,b.x,b.y,r*(1.7-q));for(let i=0;i<6;i++){const angle=i*TAU/6-t*2;avatar(c,type,t,{x:b.x+Math.cos(angle)*r*(2-q),y:b.y+Math.sin(angle)*r*(2-q)},r*.16);}if(hit){line(c,[[b.x-r,b.y],[b.x+r,b.y]]);line(c,[[b.x,b.y-r],[b.x,b.y+r]]);}
  }else if(p.shape==='blades'){
    const dash=at(Math.max(0,q-.2));line(c,[[dash.x,dash.y],[head.x,head.y]]);avatar(c,type,t,head,r*.8);
    if(hit)for(const sign of [-1,1])line(c,[[b.x-r*sign,b.y-r],[b.x+r*sign*hit,b.y+r*hit]]);
  }else if(p.shape==='serpent'){
    const points=Array.from({length:40},(_,i)=>{const v=q*i/39,center=at(v,Math.sin(v*18-t*12)*r*.25*Math.sin(Math.PI*v));return [center.x,center.y];});line(c,points);avatar(c,type,t,head,r*.75);
  }else if(p.shape==='fist'){
    const pos=at(q,-Math.sin(q*Math.PI)*r*.7);avatar(c,type,t,pos,r*(.6+.7*q));
    if(hit)for(let i=0;i<9;i++){const angle=i*TAU/9,d=r*(.5+hit*2);c.strokeRect(b.x+Math.cos(angle)*d-3,b.y+Math.sin(angle)*d-3,6,6);}
  }else{
    const pos=at(q,-Math.sin(q*Math.PI)*r*(p.shape==='wings'?1.8:1.2));avatar(c,type,t,pos,r);
    if(p.shape==='wings')for(let i=0;i<8;i++){const v=Math.max(0,q-i*.035),f=at(v,Math.sin(i*3)*r*.4);line(c,[[f.x-4,f.y-6],[f.x+4,f.y+6]]);}
    if(p.shape==='fangs'&&hit)for(const sign of [-1,1]){c.beginPath();c.arc(b.x+sign*r*.25,b.y,r*(1-hit*.3),sign<0?.4:2.7,sign<0?2.2:4.5);c.stroke();}
  }
}
