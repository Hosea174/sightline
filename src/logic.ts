export function sameSource(saved:string,incoming:string):boolean {
  if(!saved||!incoming)return false;
  if(saved===incoming)return true;
  try {
    const a=new URL(saved),b=new URL(incoming);
    const social=['pinterest.com','x.com','twitter.com','instagram.com','behance.net','dribbble.com','youtube.com','vimeo.com'];
    const host=(s:string)=>s.toLowerCase().replace(/^www\./,'');
    const ah=host(a.hostname),bh=host(b.hostname);
    if(social.some(s=>ah===s||ah.endsWith('.'+s)))return false;
    return ah===bh;
  } catch {return false}
}
export function colorDistance(a:string,b:string):number {
  const rgb=(v:string)=>[1,3,5].map(i=>parseInt(v.slice(i,i+2),16));
  const x=rgb(a),y=rgb(b);
  return Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2]);
}
export function matches(value:string,query:string):boolean {
  const hay=value.toLowerCase(),needle=query.trim().toLowerCase();
  if(hay.includes(needle))return true;
  let i=0;for(const c of hay)if(c===needle[i])i++;
  return i===needle.length;
}

export function setTrash<T extends {id:string;trashedAt?:string;assets:A[]},A extends {id:string;trashedAt?:string}>(sources:T[],sourceId:string,assetId:string|undefined,trashedAt:string|undefined):T[]{
  return sources.map(s=>s.id!==sourceId?s:assetId?{...s,assets:s.assets.map(a=>a.id===assetId?{...a,trashedAt}:a)}:{...s,trashedAt});
}

export function displayUrl(value:string):string {
  try { const u=new URL(value); return (u.host.replace(/^www\./i,'')+u.pathname.replace(/\/$/,'')+u.search+u.hash) || value; } catch { return value.replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/$/,''); }
}

export function groupSourcesByUrl<T extends {url:string;assets:A[]},A>(sources:T[]):T[] {
 const groups:T[]=[];for(const source of sources){const index=source.url?groups.findIndex(group=>sameSource(group.url,source.url)):-1;if(index<0)groups.push({...source,assets:[...source.assets]});else groups[index]={...groups[index],assets:[...groups[index].assets,...source.assets]};}return groups;
}

export function toggleFavorite<T extends {id:string;favorite?:boolean;assets:A[]},A extends {id:string;favorite?:boolean}>(sources:T[],sourceId:string,assetId?:string):T[]{
 return sources.map(s=>s.id!==sourceId?s:assetId?{...s,assets:s.assets.map(a=>a.id===assetId?{...a,favorite:!a.favorite}:a)}:{...s,favorite:!s.favorite});
}
export function zoomAround(view:{x:number;y:number;zoom:number},point:{x:number;y:number},delta:number){
 const zoom=Math.max(.1,Math.min(4,view.zoom*Math.exp(-delta*.01)));return {x:point.x-(point.x-view.x)*zoom/view.zoom,y:point.y-(point.y-view.y)*zoom/view.zoom,zoom};
}
