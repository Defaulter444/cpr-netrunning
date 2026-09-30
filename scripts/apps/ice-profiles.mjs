/** Cosmetic profiles only. Combat stats remain in the system's BLACK_ICE table. */
const profile=(name,color,accent,shape,motion,frequency,description)=>({name,color,accent,shape,motion,frequency,description});
export const ICE_PROFILES=Object.freeze({
  asp:profile('Аспид','#8bea80','#d5ffd0','serpent','coil',310,'Свивается кольцами и бросается ядовитой стрелой.'),
  giant:profile('Гигант','#ffb668','#ffe2aa','fist','stomp',62,'Появляется тяжёлыми блоками; удар разгоняет кольцо обломков.'),
  hellhound:profile('Адская гончая','#ff683d','#ffd394','hound','prowl',110,'Рывок с огненным следом и вспышкой у цели.'),
  kraken:profile('Кракен','#78aaff','#b4e6ff','tentacles','float',85,'Разворачивает щупальца, захватывает цель и тянет след за собой.'),
  liche:profile('Лич','#b491ff','#ede0ff','rune','float',185,'Собирается из рун; выпускает кольцо призрачных печатей.'),
  raven:profile('Ворон','#96c3ff','#f0f7ff','wings','flutter',430,'Раскрывает крылья и рассыпает цифровые перья.'),
  scorpion:profile('Скорпион','#ffcf55','#fff1a5','stinger','coil',260,'Поднимает хвост и наносит точечный удар жалом.'),
  skunk:profile('Скунс','#b7ef81','#f1ffc8','cloud','prowl',135,'Оставляет полосу помех и распускает облако у цели.'),
  wisp:profile('Блуждающий огонёк','#59ece4','#d6ffff','orb','float',690,'Мерцает и перескакивает электрическим импульсом.'),
  dragon:profile('Дракон','#ff527a','#ffd68a','dragon','flutter',95,'Разворачивает крылья; выдыхает широкий поток пламени.'),
  killer:profile('Убийца','#ff5261','#e9f4ff','blades','prowl',520,'Возникает из помех и прорезает цель парными лезвиями.'),
  sabertooth:profile('Саблезуб','#ff9365','#fff0da','fangs','prowl',155,'Прыгает вперёд; две дуги клыков смыкаются на цели.'),
});
const UNKNOWN=profile('Неизвестный ЛЁД','#93a0b7','#d1d8e4','orb','float',180,'Неопознанный сетевой сигнал.');
const CUSTOM=profile('Особый ЛЁД','#e379ff','#f6d4ff','rune','float',210,'Индивидуальный образ из карточки; пульсирующий цифровой контур.');
export const iceProfile=type=>type==='unknown'?UNKNOWN:Object.hasOwn(ICE_PROFILES,type)?ICE_PROFILES[type]:CUSTOM;
export const ICE_PHASES=Object.freeze({appear:'Появление',attack:'Атака',pursuit:'Преследование',derez:'Уничтожение'});
export const ICE_DURATION={appear:1600,attack:1350,pursuit:1700,derez:1900};
export function stableIceRef(ref){const p=String(ref??'').split(':');return p[0]==='ice'?`${p[0]}:${p[1]}:${p[3]}`:String(ref??'');}
export function iceSnapshot(canvas,pid=''){
  return {scope:`${canvas?.archId??''}|${pid??''}`,items:(canvas?.empty?[]:canvas?.floors??[]).filter(f=>!f.encrypted).flatMap(f=>(f.entities??[]).filter(e=>e.iceType&&!e.isDemon).map(e=>({key:stableIceRef(e.ref),ref:e.ref,type:e.iceType,floor:f.index,dead:!!e.derezzed,chasing:!!(e.tether||e.isChasing)})))};
}
export function iceChanges(before,after){
  if(!before||before.scope!==after.scope)return [];
  const old=new Map(before.items.map(e=>[e.key,e]));
  return after.items.flatMap(e=>{const prev=old.get(e.key);
    if(!prev||prev.dead&&!e.dead)return e.dead?[]:[{...e,phase:'appear'}];
    if(!prev.dead&&e.dead)return [{...e,phase:'derez'}];
    if(!e.dead&&prev.floor!==e.floor&&e.chasing)return [{...e,phase:'pursuit',fromFloor:prev.floor}];
    return [];
  });
}
export function queueIceChanges(pending,changes,sameScope){
  const cues=new Map();for(const cue of [...(sameScope?pending??[]:[]),...changes])cues.set(`${cue.key}|${cue.phase}|${cue.fromFloor}|${cue.floor}`,cue);
  return [...cues.values()].slice(-8);
}
/** Shortest path through visible, rendered links. Never infer hidden floors. */
export function iceRoute(graph,from,to){
  const visible=new Set((graph?.nodes??[]).filter(n=>!n.encrypted).map(n=>n.index));
  if(!visible.has(from)||!visible.has(to))return [];
  const queue=[[from]],seen=new Set([from]);
  while(queue.length){const path=queue.shift(),last=path.at(-1);if(last===to)return path;
    for(const link of graph?.edges??[]){const next=link.from===last?link.to:link.to===last?link.from:null;if(next===null||!visible.has(next)||seen.has(next))continue;seen.add(next);queue.push([...path,next]);}
  }return [];
}
