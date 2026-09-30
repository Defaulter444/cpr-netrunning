/** Portable, plain-data findings. Never render authored text as HTML. */
export const FINDING_KINDS = Object.freeze({dossier:'Досье',message:'Переписка',image:'Изображение',audio:'Аудиозапись',map:'План объекта'});
const extensions={image:/\.(png|jpe?g|webp|gif|avif)$/i,map:/\.(png|jpe?g|webp|gif|avif)$/i,audio:/\.(ogg|mp3|wav|m4a|flac|webm)$/i};
const cut=(value,n)=>String(value??'').slice(0,n).trim();
export function findingSource(value,kind){
  const src=cut(value,2048);if(!src||!extensions[kind])return '';
  let decoded;try{decoded=decodeURIComponent(src);}catch{return '';}
  if(/[\x00-\x1f<>\\]/.test(decoded)||decoded.split(/[/?#]/).includes('..'))return '';
  if(/^[a-z][a-z\d+.-]*:/i.test(src)&&!/^https:\/\//i.test(src))return '';
  if(src.startsWith('/')||src.startsWith('//'))return '';
  if(/^https:/i.test(src)){try{const u=new URL(src);if(u.username||u.password||!u.hostname)return '';}catch{return '';}}
  return extensions[kind].test(decoded.split(/[?#]/)[0])?src:'';
}
export function normalizeFindings(input){
  const ids=new Set();return (Array.isArray(input)?input:[]).slice(0,12).filter(f=>f&&typeof f==='object').map((f,i)=>{
    let id=cut(f.id,64).replace(/[^\w-]/g,'')||`file${i+1}`;while(ids.has(id))id+='x';ids.add(id);
    const kind=Object.hasOwn(FINDING_KINDS,f.kind)?f.kind:'dossier';
    return {id,kind,title:cut(f.title,120)||FINDING_KINDS[kind],text:cut(f.text,8000),src:findingSource(f.src,kind),from:cut(f.from,120),to:cut(f.to,120)};
  });
}
export function floorFindings(floor){
  if(Array.isArray(floor?.findings))return normalizeFindings(floor.findings);
  const out=[];
  if(String(floor?.contents||'').trim())out.push({id:'legacy',kind:'dossier',title:floor.label||'Файл',text:floor.contents});
  if(floor?.contentsImage)out.push({id:'legacy-image',kind:'image',title:floor.label||'Вложение',src:floor.contentsImage});
  return normalizeFindings(out);
}
export function findingKey({archId,floorId,findingId,userId}){return JSON.stringify([archId,floorId,findingId,userId]);}
