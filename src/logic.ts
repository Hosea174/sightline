export function sameInstagramPost(a:string,b:string):boolean {
 try {
  const post=(value:string)=>{const url=new URL(value);if(!['instagram.com','www.instagram.com'].includes(url.hostname.toLowerCase()))return '';return url.pathname.match(/^\/(?:p|reel|tv)\/([^/]+)/i)?.[1]||''};
  const id=post(a);return !!id&&id===post(b);
 } catch {return false}
}
export function inspirationUrlKey(value:string):string {
  try {const url=new URL(value);return url.hostname.toLowerCase().replace(/^www\./,'')+url.pathname.replace(/\/+$/,'')} catch {return ''}
}
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
function foldTagSeparators(value:string):string {
  return value.toLowerCase().replace(/[-_\s/.]+/g,' ').trim();
}
function compactTagText(value:string):string {
  return value.toLowerCase().replace(/[-_\s/.]+/g,'');
}
function isOrderedSubsequence(haystack:string,needle:string):boolean {
  if(!needle)return true;
  let i=0;
  for(const c of haystack){
    if(c===needle[i]){
      i++;
      if(i===needle.length)return true;
    }
  }
  return false;
}
function scoreSubsequence(rawCandidate:string,compactCandidate:string,compactQuery:string):number {
  const isWordStart:boolean[]=[];
  const lower=rawCandidate.toLowerCase();
  for(let idx=0;idx<lower.length;idx++){
    if(!/[-_\s/.]/.test(lower[idx])){
      isWordStart.push(idx===0||/[-_\s/.]/.test(lower[idx-1]));
    }
  }
  const positions:number[]=[];
  let qi=0;
  for(let ci=0;ci<compactCandidate.length&&qi<compactQuery.length;ci++){
    if(compactCandidate[ci]===compactQuery[qi]){
      positions.push(ci);
      qi++;
    }
  }
  if(qi<compactQuery.length)return 0;
  let boundaryHits=0,consecutive=0,maxConsecutive=0;
  for(let i=0;i<positions.length;i++){
    if(isWordStart[positions[i]])boundaryHits++;
    if(i>0&&positions[i]===positions[i-1]+1){
      consecutive++;
      if(consecutive>maxConsecutive)maxConsecutive=consecutive;
    }else{
      consecutive=1;
      if(maxConsecutive===0)maxConsecutive=1;
    }
  }
  const firstIdx=positions[0]??0;
  const lastIdx=positions[positions.length-1]??0;
  const span=lastIdx-firstIdx+1;
  const gapPenalty=Math.max(0,span-compactQuery.length);
  const rawScore=400+Math.min(150,boundaryHits*25)+Math.min(120,maxConsecutive*18)-Math.min(120,gapPenalty*4)-Math.min(40,firstIdx*2);
  return Math.max(1,rawScore);
}
/** Scores how closely a candidate tag or filter label matches a query, ignoring omitted hyphens or separators. */
export function scoreTagMatch(candidate:string,query:string):number {
  const rawQuery=query.trim().toLowerCase();
  if(!rawQuery)return 0;
  const rawCand=candidate.toLowerCase();
  const foldedCand=foldTagSeparators(rawCand);
  const foldedQuery=foldTagSeparators(rawQuery);
  const compactCand=compactTagText(rawCand);
  const compactQuery=compactTagText(rawQuery);
  if(!compactQuery)return rawCand.includes(rawQuery)?500:0;
  if(rawCand===rawQuery)return 1000;
  if(foldedCand===foldedQuery)return 960;
  if(compactCand===compactQuery)return 950;
  if(rawCand.startsWith(rawQuery))return 900;
  if(foldedCand.startsWith(foldedQuery))return 860;
  if(compactCand.startsWith(compactQuery))return 840;
  const words=foldedCand.split(' ').filter(Boolean);
  if(words.some(w=>w.startsWith(foldedQuery)||w.startsWith(compactQuery)))return 800;
  if(rawCand.includes(rawQuery))return 750;
  if(foldedCand.includes(foldedQuery))return 720;
  if(compactCand.includes(compactQuery))return 700;
  return scoreSubsequence(rawCand,compactCand,compactQuery);
}
/** Returns known tags matching a query (excluding already-selected tags), ranked by match quality. */
export function filterTagSuggestions(knownTags:readonly string[],query:string,excludedTags:readonly string[]=[]):string[] {
  if(!query.trim())return [];
  const excluded=new Set(excludedTags.map(t=>t.toLowerCase()));
  const scored:{tag:string;score:number}[]=[];
  for(const tag of knownTags){
    if(excluded.has(tag.toLowerCase()))continue;
    const score=scoreTagMatch(tag,query);
    if(score>0)scored.push({tag,score});
  }
  scored.sort((a,b)=>b.score-a.score||a.tag.localeCompare(b.tag));
  return scored.map(item=>item.tag);
}
export function matches(value:string,query:string):boolean {
  const hay=value.toLowerCase(),needle=query.trim().toLowerCase();
  if(!needle)return true;
  if(hay.includes(needle))return true;
  const foldedHay=foldTagSeparators(hay),foldedNeedle=foldTagSeparators(needle);
  if(foldedNeedle&&foldedHay.includes(foldedNeedle))return true;
  const compactHay=compactTagText(hay),compactNeedle=compactTagText(needle);
  if(compactNeedle&&(compactHay.includes(compactNeedle)||isOrderedSubsequence(compactHay,compactNeedle)))return true;
  return isOrderedSubsequence(hay,needle);
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

export function paginationPages(page:number,total:number):(number|'ellipsis')[]{
 const count=Math.max(1,total),current=Math.max(1,Math.min(count,page));const visible=Array.from(new Set([1,count,current-1,current,current+1].filter(n=>n>=1&&n<=count))).sort((a,b)=>a-b);const result:(number|'ellipsis')[]=[];for(let i=0;i<visible.length;i++){if(i&&visible[i]-visible[i-1]===2)result.push(visible[i]-1);else if(i&&visible[i]-visible[i-1]>2)result.push('ellipsis');result.push(visible[i])}return result;
}

export function shuffled<T>(items:T[],random:()=>number=Math.random):T[]{
 const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result;
}

// A seeded order remains stable as catalogs reload or filters change.
export function shuffleRank(value:string,seed:number):number {
 let hash=(2166136261 ^ seed) >>> 0;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;hash=Math.imul(hash,0x846ca68b);return (hash^(hash>>>16))>>>0;
}
export const industryTags:Record<string,string[]>={
 'Technology':['technology','saas','artificial intelligence','software','app','apps','startups','development tools','design tools','productivity'],
 'Fashion & beauty':['fashion','beauty','luxury','cosmetics'],
 'Food & drink':['food & drink','food drinks','food/drink','food','drinks','restaurants','restaurant'],
 'Arts & culture':['art & illustration','art','culture & education','culture','museums','museum','music & sound','music','film & tv','film','photography','photo & video'],
 'Design & creative':['design agencies','agency','studio','graphic design','web design/dev','architecture'],
 'Business & finance':['business & corporate','business','corporate','finance','fintech'],
 'Shopping':['ecommerce','e-commerce','e commerce','products','retail'],
 'Health & wellness':['health fitness','health','healthcare','wellness','fitness'],
 'Education':['education','culture & education'],
 'Entertainment & games':['games & entertainment','entertainment','games','gaming'],
 'Travel & hospitality':['travel','hospitality','hotels','hotel','tourism'],
 'Property':['real estate','architecture'],
 'Sports':['sports','sport'],
 'Social & environment':['social responsibility','non-profit','nonprofit','environment','sustainability']
};
export function matchesIndustry(tags:string[],industry:string):boolean {const values=industryTags[industry]||[];return tags.some(tag=>values.includes(tag.trim().toLowerCase()));}

/** Source context stays searchable when browsing individual assets. */
export function matchesReference(source:{title:string;url:string;notes:string;tags:string[]},asset:{name:string;notes?:string;tags?:string[]}|undefined,query:string,tags:string[]=[]):boolean {
 const combinedTags=[...source.tags,...(asset?.tags||[])];
 return tags.every(tag=>combinedTags.includes(tag))&&[source.title,source.url,source.notes,asset?.name||'',asset?.notes||'',...combinedTags].some(value=>matches(value,query));
}

export function safeHttpUrl(value:string):string|null {
 const trimmed=value.trim();
 if(!trimmed)return null;
 try {
  const parsed=new URL(trimmed);
  if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')return null;
  return parsed.toString();
 } catch {
  return null;
 }
}

const RESERVED_FOLDER_STEMS=new Set(['CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9','LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9']);

export function sanitizeFolderName(raw:string):string {
 const replaced=raw.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').replace(/^[.\s]+|[.\s]+$/g,'');
 let name=Array.from(replaced).slice(0,60).join('').replace(/^[.\s]+|[.\s]+$/g,'');
 if(!name)name='Untitled';
 const stem=name.split('.')[0].toUpperCase();
 if(RESERVED_FOLDER_STEMS.has(stem))name+=' source';
 return name;
}

export function assetFolderPrefix(file:string):string|null {
 const clean=file.replace(/\\/g,'/');
 const idx=clean.indexOf('/');
 if(idx<=0)return null;
 const folder=clean.slice(0,idx).trim();
 if(!folder||folder==='.'||folder==='..')return null;
 return folder;
}

export function sourceFolder<T extends {id:string;title:string;url:string;folder?:string;assets:Array<{file:string}>}>(source:T,allSources:T[]=[]):string {
 if(source.folder&&!source.folder.includes('/')&&!source.folder.includes('\\')&&source.folder!=='.'&&source.folder!=='..'){
  return sanitizeFolderName(source.folder);
 }
 for(const asset of source.assets){
  const existing=assetFolderPrefix(asset.file);
  if(existing)return existing;
 }
 const used=new Set<string>();
 const myIndex=allSources.findIndex(other=>other.id===source.id);
 for(let i=0;i<allSources.length;i++){
  const other=allSources[i];
  if(other.id===source.id)continue;
  if(other.folder){used.add(sanitizeFolderName(other.folder).toLowerCase());continue;}
  let hasPrefix=false;
  for(const asset of other.assets){
   const prefix=assetFolderPrefix(asset.file);
   if(prefix){used.add(prefix.toLowerCase());hasPrefix=true;}
  }
  if(!hasPrefix&&(myIndex===-1||i<myIndex)){
   const raw=other.title.trim()||(other.url?displayUrl(other.url):'')||'Untitled';
   used.add(sanitizeFolderName(raw).toLowerCase());
  }
 }
 const rawBase=source.title.trim()||(source.url?displayUrl(source.url):'')||'Untitled';
 const base=sanitizeFolderName(rawBase);
 if(!used.has(base.toLowerCase()))return base;
 const shortId=source.id.replace(/[^a-z0-9]/gi,'').slice(0,6)||'src';
 const tagged=`${sanitizeFolderName(Array.from(base).slice(0,48).join(''))} (${shortId})`;
 if(!used.has(tagged.toLowerCase()))return tagged;
 let n=2;
 while(used.has(`${tagged} ${n}`.toLowerCase()))n++;
 return `${tagged} ${n}`;
}

export function renameFolderReferences<T extends {id:string;folder?:string;assets:A[]},A extends {file:string}>(sources:T[],sourceId:string,oldFolder:string,newFolder:string,caseInsensitive=false):T[] {
 const cleanOld=normalizeAssetRelPath(oldFolder);
 const cleanNew=normalizeAssetRelPath(newFolder);
 if(!cleanOld||!cleanNew||cleanOld===cleanNew)return sources.map(s=>s.id===sourceId?{...s,folder:cleanNew}:s);
 const prefix=cleanOld+'/';
 const prefixMatch=caseInsensitive?prefix.toLowerCase():prefix;
 return sources.map(s=>{
  let changed=false;
  const assets=s.assets.map(a=>{
   const norm=normalizeAssetRelPath(a.file);
   const matchesPrefix=caseInsensitive?norm.toLowerCase().startsWith(prefixMatch):norm.startsWith(prefixMatch);
   if(matchesPrefix){changed=true;return {...a,file:`${cleanNew}/${norm.slice(prefix.length)}`}}
   return a;
  });
  if(s.id===sourceId)return {...s,folder:cleanNew,assets};
  return changed?{...s,assets}:s;
 });
}

export const CANVAS_MIN_ZOOM = 0.35;
export const CANVAS_MAX_ZOOM = 3;

export function clampCanvasZoom(zoom: number): number {
  return Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom));
}

export function computeCanvasGrid(count: number, cellW = 320, cellH = 232): { cols: number; rows: number } {
  if (count <= 0) return { cols: 0, rows: 0 };
  const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * (cellH / cellW) * 1.35))));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

export function wrapGridIndex(col: number, row: number, cols: number, rows: number, count: number): number {
  if (count <= 0 || cols <= 0 || rows <= 0) return 0;
  const wc = ((col % cols) + cols) % cols;
  const wr = ((row % rows) + rows) % rows;
  return (wr * cols + wc) % count;
}

export function finiteGridIndex(col: number, row: number, cols: number, count: number): number | null {
  if (count <= 0 || cols <= 0 || col < 0 || col >= cols || row < 0) return null;
  const index = row * cols + col;
  return index < count ? index : null;
}

export function clampFiniteCanvasView(
  view: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
  grid: { cols: number; rows: number },
  cellW: number,
  cellH: number,
  gap: number
): { x: number; y: number; zoom: number } {
  if (grid.cols <= 0 || grid.rows <= 0) return view;
  const boardW = (grid.cols * cellW - gap) * view.zoom;
  const boardH = (grid.rows * cellH - gap) * view.zoom;
  const marginX = Math.min(160, Math.max(48, viewport.width * 0.2));
  const marginY = Math.min(160, Math.max(48, viewport.height * 0.2));
  const minX = marginX - boardW;
  const maxX = viewport.width - marginX;
  const minY = marginY - boardH;
  const maxY = viewport.height - marginY;
  return {
    ...view,
    x: Math.max(minX, Math.min(maxX, view.x)),
    y: Math.max(minY, Math.min(maxY, view.y)),
  };
}

export function getVisibleCellRange(
  view: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
  cellW: number,
  cellH: number,
  overscan = 1
): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  const z = Math.max(CANVAS_MIN_ZOOM, view.zoom);
  const w = Math.max(1, viewport.width);
  const h = Math.max(1, viewport.height);
  const worldLeft = -view.x / z;
  const worldTop = -view.y / z;
  const worldRight = (w - view.x) / z;
  const worldBottom = (h - view.y) / z;
  return {
    minCol: Math.floor(worldLeft / cellW) - overscan,
    maxCol: Math.floor(worldRight / cellW) + overscan,
    minRow: Math.floor(worldTop / cellH) - overscan,
    maxRow: Math.floor(worldBottom / cellH) + overscan,
  };
}

export const FONT_EXTENSIONS = [
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'ttc', 'otc', 'dfont', 'pfb', 'pfm', 'afm', 'bdf',
  'pcf', 'snf', 'fon', 'fnt', 'sfd',
] as const;

export function getFileExtension(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isFontFilename(name: string): boolean {
  return (FONT_EXTENSIONS as readonly string[]).includes(getFileExtension(name));
}

const FONT_WEIGHT_LABELS: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  350: 'SemiLight',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

export function formatFontWeightLabel(weight: number): string {
  return FONT_WEIGHT_LABELS[weight] || `${weight}`;
}

export function parseFontFilenameMeta(filename: string): {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
} {
  const base = (filename.split(/[\\/]/).pop() || filename).trim();
  const ext = getFileExtension(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  const normalized = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = ` ${normalized.toLowerCase()} `;

  let style: 'normal' | 'italic' = 'normal';
  if (/(^|\s|[a-z])(italic|oblique)(\s|$)/i.test(normalized) || /\bital\b/i.test(normalized)) {
    style = 'italic';
  }

  let weight = 400;
  const weightRules: Array<[RegExp, number]> = [
    [/(extra\s*light|ultra\s*light|extralight|ultralight)/i, 200],
    [/(semi\s*light|semilight)/i, 350],
    [/(thin|hairline)/i, 100],
    [/(light)/i, 300],
    [/(semi\s*bold|demi\s*bold|semibold|demibold)/i, 600],
    [/(extra\s*bold|ultra\s*bold|extrabold|ultrabold)/i, 800],
    [/(bold)/i, 700],
    [/(medium)/i, 500],
    [/(black|heavy|poster|fat)/i, 900],
    [/(regular|normal|book|roman)/i, 400],
  ];
  for (const [pattern, w] of weightRules) {
    if (pattern.test(lower)) {
      weight = w;
      break;
    }
  }
  if (weight === 400) {
    const numMatch = normalized.match(/(?:^|\s)(100|200|300|350|400|500|600|700|800|900)(?:\s|$)/);
    if (numMatch) {
      weight = Number(numMatch[1]);
    }
  }

  let family = normalized
    .replace(/\b(extra\s*light|ultra\s*light|semi\s*light|semi\s*bold|demi\s*bold|extra\s*bold|ultra\s*bold)\b/gi, ' ')
    .replace(/\b(extralight|ultralight|semilight|semibold|demibold|extrabold|ultrabold|hairline|thin|light|regular|normal|book|roman|medium|bold|black|heavy|italic|oblique|ital)\b/gi, ' ')
    .replace(/(BoldItalic|SemiBoldItalic|ExtraBoldItalic|MediumItalic|LightItalic|BlackItalic|ThinItalic)/gi, ' ')
    .replace(/\b(100|200|300|350|400|500|600|700|800|900)\b/g, ' ')
    .replace(/(Italic|Oblique)$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!family) {
    family = normalized || base || 'Untitled font';
  }
  return { family, weight, style };
}

export function buildGoogleFontsCss2Url(family: string, variants: string[] = ['400']): string {
  const tuples = Array.from(
    new Map(
      (variants.length ? variants : ['400']).map((v) => {
        const clean = v.trim().toLowerCase();
        const italic = clean.endsWith('i') || clean.endsWith('italic');
        const digits = clean.match(/^\d+/)?.[0];
        const weight = digits ? Math.max(100, Math.min(1000, Number(digits))) : 400;
        return [`${italic ? 1 : 0}:${weight}`, { italic, weight }] as const;
      })
    ).values()
  ).sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);

  const hasItalic = tuples.some((t) => t.italic);
  const spec = hasItalic
    ? `ital,wght@${tuples.map((t) => `${t.italic ? 1 : 0},${t.weight}`).join(';')}`
    : `wght@${tuples.map((t) => `${t.weight}`).join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, '+')}:${spec}&display=swap`;
}

export type FontVariantItem<A> = {
  asset: A;
  sourceId: string;
  weight: number;
  weightMin?: number;
  weightMax?: number;
  isVariable?: boolean;
  style: 'normal' | 'italic';
  format: string;
};

export type FontFamilyGroup<A> = {
  key: string;
  family: string;
  primaryAsset: A;
  primarySourceId: string;
  variants: FontVariantItem<A>[];
  linkedSources: number;
  formats: string[];
};

export type FontWeightPill<A> = {
  key: string;
  weight: number;
  style: 'normal' | 'italic';
  label: string;
  shortLabel: string;
  asset: A;
  isVariable: boolean;
};

const STANDARD_CSS_WEIGHTS = [100, 200, 300, 350, 400, 500, 600, 700, 800, 900] as const;
const VALID_FONT_SOURCES = new Set(['local', 'google', 'upload', 'capture']);
const FONT_FORMAT_PILL_RANK: Record<string, number> = { WOFF2: 4, WOFF: 3, OTF: 2, TTF: 1 };

function normalizeFontWeightValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 1 || value > 1000) return null;
  return Math.round(value);
}

export function capturedFontAssetFields(capture: {
  name?: string;
  file: string;
  family?: string;
  weight?: number;
  weightMin?: number;
  weightMax?: number;
  isVariable?: boolean;
  style?: 'normal' | 'italic';
  fontSource?: 'local' | 'google' | 'upload' | 'capture';
}): {
  family: string;
  weight: number;
  weightMin: number;
  weightMax: number;
  isVariable: boolean;
  style: 'normal' | 'italic';
  fontSource: 'local' | 'google' | 'upload' | 'capture';
} {
  const parsed = parseFontFilenameMeta(capture.name || capture.file);
  const family =
    (capture.family && capture.family.trim()) ||
    (capture.name && isFontFilename(capture.name) ? parsed.family : capture.name?.trim()) ||
    parsed.family;
  const style: 'normal' | 'italic' =
    capture.style === 'italic' || (!capture.style && parsed.style === 'italic') ? 'italic' : 'normal';

  const w = normalizeFontWeightValue(capture.weight);
  const wMin = normalizeFontWeightValue(capture.weightMin);
  const wMax = normalizeFontWeightValue(capture.weightMax);

  let weightMin: number;
  let weightMax: number;
  let isVariable: boolean;
  let weight: number;

  if (wMin !== null && wMax !== null) {
    weightMin = Math.min(wMin, wMax);
    weightMax = Math.max(wMin, wMax);
    isVariable = weightMax > weightMin ? true : Boolean(capture.isVariable);
    if (w !== null && w >= weightMin && w <= weightMax) {
      weight = w;
    } else {
      weight = weightMin <= 400 && weightMax >= 400 ? 400 : weightMin;
    }
  } else if (w !== null) {
    weight = w;
    weightMin = w;
    weightMax = w;
    isVariable = Boolean(capture.isVariable);
  } else if (wMin !== null || wMax !== null) {
    const single = (wMin ?? wMax)!;
    weight = single;
    weightMin = single;
    weightMax = single;
    isVariable = Boolean(capture.isVariable);
  } else {
    weight = parsed.weight || 400;
    weightMin = weight;
    weightMax = weight;
    isVariable = false;
  }

  const fontSource: 'local' | 'google' | 'upload' | 'capture' =
    typeof capture.fontSource === 'string' && VALID_FONT_SOURCES.has(capture.fontSource)
      ? capture.fontSource
      : 'capture';

  return {
    family,
    weight,
    weightMin,
    weightMax,
    isVariable,
    style,
    fontSource,
  };
}

export function getFontFaceWeightDescriptor(variant: {
  weight: number;
  weightMin?: number;
  weightMax?: number;
  isVariable?: boolean;
}): string {
  const w = normalizeFontWeightValue(variant.weight) ?? 400;
  const rawMin = normalizeFontWeightValue(variant.weightMin) ?? w;
  const rawMax = normalizeFontWeightValue(variant.weightMax) ?? w;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  if ((variant.isVariable || max > min) && max > min) {
    return `${min} ${max}`;
  }
  return String(w >= min && w <= max ? w : min);
}

export function getAvailableFontWeightPills<A>(variants: FontVariantItem<A>[]): FontWeightPill<A>[] {
  const pills = new Map<string, { pill: FontWeightPill<A>; score: number }>();
  for (const v of variants) {
    const baseWeight = normalizeFontWeightValue(v.weight) ?? 400;
    const rawMin = normalizeFontWeightValue(v.weightMin) ?? baseWeight;
    const rawMax = normalizeFontWeightValue(v.weightMax) ?? baseWeight;
    const min = Math.min(rawMin, rawMax);
    const max = Math.max(rawMin, rawMax);
    const isVar = Boolean(v.isVariable) || max > min;
    const effectiveWeight = baseWeight >= min && baseWeight <= max ? baseWeight : (min <= 400 && max >= 400 ? 400 : min);
    const weights: number[] =
      isVar && max > min
        ? Array.from(
            new Set([
              ...STANDARD_CSS_WEIGHTS.filter((w) => w >= min && w <= max && (w !== 350 || min === 350 || max === 350)),
              ...(min < 100 || min % 100 !== 0 ? [min] : []),
              ...(max > 900 || max % 100 !== 0 ? [max] : []),
              ...(effectiveWeight !== 350 && effectiveWeight % 100 !== 0 ? [effectiveWeight] : []),
            ])
          ).sort((a, b) => a - b)
        : [effectiveWeight];

    const span = max - min;
    const formatRank = FONT_FORMAT_PILL_RANK[String(v.format || '').toUpperCase()] || 0;

    for (const w of weights) {
      const key = `${w}-${v.style}`;
      const score =
        (!isVar || max === min ? 1_000_000 : 0) +
        (effectiveWeight === w ? 10_000 : 0) +
        (1000 - span) * 10 +
        formatRank;
      const existing = pills.get(key);
      if (existing && score <= existing.score) continue;
      const weightName = formatFontWeightLabel(w);
      const italicSuffix = v.style === 'italic' ? ' Italic' : '';
      pills.set(key, {
        score,
        pill: {
          key,
          weight: w,
          style: v.style,
          label: `${w} ${weightName}${italicSuffix}`,
          shortLabel: `${w}${v.style === 'italic' ? 'i' : ''}`,
          asset: v.asset,
          isVariable: isVar,
        },
      });
    }
  }
  return Array.from(pills.values())
    .map((entry) => entry.pill)
    .sort((a, b) => (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1) || a.weight - b.weight);
}

export function groupFontAssets<
  A extends {
    id: string;
    name: string;
    file: string;
    family?: string;
    weight?: number;
    weightMin?: number;
    weightMax?: number;
    isVariable?: boolean;
    style?: 'normal' | 'italic';
  },
>(items: Array<{ sourceId: string; asset: A }>): FontFamilyGroup<A>[] {
  const groups = new Map<
    string,
    {
      family: string;
      variantsByFile: Map<string, FontVariantItem<A>>;
      sourceIds: Set<string>;
      formats: Set<string>;
    }
  >();

  for (const { sourceId, asset } of items) {
    const parsed = parseFontFilenameMeta(asset.name || asset.file);
    const familyName = (asset.family && asset.family.trim()) || (isFontFilename(asset.name) ? parsed.family : asset.name.trim()) || parsed.family;
    const key = familyName.toLowerCase();
    const w = normalizeFontWeightValue(asset.weight);
    const wMin = normalizeFontWeightValue(asset.weightMin);
    const wMax = normalizeFontWeightValue(asset.weightMax);

    let weightMin: number;
    let weightMax: number;
    let isVariable: boolean;
    let weight: number;

    if (wMin !== null && wMax !== null) {
      weightMin = Math.min(wMin, wMax);
      weightMax = Math.max(wMin, wMax);
      isVariable = weightMax > weightMin ? true : Boolean(asset.isVariable);
      weight = w !== null && w >= weightMin && w <= weightMax ? w : (weightMin <= 400 && weightMax >= 400 ? 400 : weightMin);
    } else {
      weight = w ?? wMin ?? wMax ?? parsed.weight ?? 400;
      weightMin = weight;
      weightMax = weight;
      isVariable = Boolean(asset.isVariable);
    }

    const style: 'normal' | 'italic' = asset.style === 'italic' || (!asset.style && parsed.style === 'italic') ? 'italic' : 'normal';
    const format = (getFileExtension(asset.file) || getFileExtension(asset.name) || 'font').toUpperCase();

    let group = groups.get(key);
    if (!group) {
      group = {
        family: familyName,
        variantsByFile: new Map(),
        sourceIds: new Set(),
        formats: new Set(),
      };
      groups.set(key, group);
    }
    group.sourceIds.add(sourceId);
    group.formats.add(format);
    if (!group.variantsByFile.has(asset.file)) {
      group.variantsByFile.set(asset.file, { asset, sourceId, weight, weightMin, weightMax, isVariable, style, format });
    }
  }

  const out: FontFamilyGroup<A>[] = [];
  for (const [key, g] of groups.entries()) {
    const variants = Array.from(g.variantsByFile.values()).sort(
      (a, b) =>
        (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1) ||
        a.weight - b.weight ||
        (a.weightMin ?? a.weight) - (b.weightMin ?? b.weight)
    );
    const preferred =
      variants.find((v) => v.style === 'normal' && !v.isVariable && v.weight === 400) ||
      variants.find((v) => v.style === 'normal' && v.weight === 400) ||
      variants.find((v) => v.style === 'normal' && (v.weightMin ?? v.weight) <= 400 && (v.weightMax ?? v.weight) >= 400) ||
      variants.find((v) => v.style === 'normal') ||
      variants[0];
    out.push({
      key,
      family: g.family,
      primaryAsset: preferred.asset,
      primarySourceId: preferred.sourceId,
      variants,
      linkedSources: g.sourceIds.size,
      formats: Array.from(g.formats),
    });
  }
  return out;
}




/** Zoom below which canvas tiles render only a thumbnail (no video, badge or controls). */
export const CANVAS_DETAIL_ZOOM = 0.5;

export type PlayableCell = { id: string; col: number; row: number; video: boolean };

/**
 * Choose which video cells may play. Only cells that intersect the viewport are eligible,
 * nearest to the viewport centre first, capped at `max`.
 */
export function pickPlayableCells(
  cells: PlayableCell[],
  view: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
  cellW: number,
  cellH: number,
  cardW: number,
  cardH: number,
  max = 6
): string[] {
  if (max <= 0) return [];
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const scored: { id: string; dist: number }[] = [];
  for (const cell of cells) {
    if (!cell.video) continue;
    const left = cell.col * cellW * view.zoom + view.x;
    const top = cell.row * cellH * view.zoom + view.y;
    const right = left + cardW * view.zoom;
    const bottom = top + cardH * view.zoom;
    if (right <= 0 || bottom <= 0 || left >= viewport.width || top >= viewport.height) continue;
    scored.push({ id: cell.id, dist: Math.hypot((left + right) / 2 - cx, (top + bottom) / 2 - cy) });
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, max).map((s) => s.id);
}
/** Keep mounted cells until the viewport approaches the buffer edge, or the buffer is oversized after zooming in. */
export function bufferCanvasRange(required: ReturnType<typeof getVisibleCellRange>, previous: ReturnType<typeof getVisibleCellRange>, padding: number) {
  const contains = previous.minCol <= required.minCol && previous.maxCol >= required.maxCol && previous.minRow <= required.minRow && previous.maxRow >= required.maxRow;
  const oversized = previous.maxCol - previous.minCol > required.maxCol - required.minCol + padding * 4 || previous.maxRow - previous.minRow > required.maxRow - required.minRow + padding * 4;
  if (contains && !oversized) return previous;
  return { minCol: required.minCol - padding, maxCol: required.maxCol + padding, minRow: required.minRow - padding, maxRow: required.maxRow + padding };
}

export function centerCanvasView(zoom: number, viewport: { width: number; height: number }, grid: { cols: number; rows: number }, cellW: number, cellH: number, gap: number) {
  return { zoom, x: (viewport.width - Math.max(0, grid.cols * cellW - gap) * zoom) / 2, y: (viewport.height - Math.max(0, grid.rows * cellH - gap) * zoom) / 2 };
}


export function reorderSourceAssets<T extends {assets: A[]; coverId?: string}, A extends {id: string; kind: string; trashedAt?: string}>(source: T, dragId: string, targetId: string, after: boolean): T {
  if (dragId === targetId || !source.assets.some(a=>a.id===dragId) || !source.assets.some(a=>a.id===targetId)) return source;
  const assets = [...source.assets];
  const [asset] = assets.splice(assets.findIndex(a=>a.id===dragId), 1);
  assets.splice(assets.findIndex(a=>a.id===targetId)+(after?1:0), 0, asset);
  return {...source, assets, coverId: assets.find(a=>!a.trashedAt&&(a.kind==='image'||a.kind==='video'))?.id};
}


/** A note editor owns text only; geometry and timing may change while it is open. */
export function mergeAnnotationNote<T extends {id: string; text: string}>(annotations: T[], draft: T, text: string): T {
 return {...(annotations.find(item=>item.id===draft.id)||draft),text};
}

/**
 * Forward spherical lens + velocity warp matching the WebGL vertex shader.
 * Normalizes radius by viewport diagonal so curvature spans the entire viewport smoothly
 * with zero inflection/pinch (exponent -0.44 > -0.5 guarantees strict monotonicity everywhere).
 */
export function warpCanvasPoint(
  nx: number,
  ny: number,
  warpStrength: number,
  aspect: number,
  velX = 0,
  velY = 0
): { x: number; y: number } {
  const s = Math.max(0, Math.min(1, warpStrength));
  const vx = Math.max(-0.08, Math.min(0.08, velX));
  const vy = Math.max(-0.08, Math.min(0.08, velY));
  if (s === 0 && vx === 0 && vy === 0) return { x: nx, y: ny };

  const safeAspect = Math.max(0.25, aspect);
  const ax = nx * safeAspect;
  const ay = ny;
  const diagSq = safeAspect * safeAspect + 1;
  const u = (ax * ax + ay * ay) / diagSq;
  const lens = (1 + s * 0.22) * Math.pow(1 + s * 1.45 * u, -0.44);
  const vFactor = Math.min(1.5, u) * 0.2;
  return {
    x: nx * lens - vx * vFactor,
    y: ny * lens - vy * vFactor,
  };
}

/**
 * Invert warpCanvasPoint using fixed-point iteration so pointer hit-testing on the WebGL canvas
 * maps warped screen pixels back to exact flat NDC coordinates.
 */
export function unwarpCanvasPoint(
  wx: number,
  wy: number,
  warpStrength: number,
  aspect: number,
  velX = 0,
  velY = 0
): { x: number; y: number } {
  const s = Math.max(0, Math.min(1, warpStrength));
  const vx = Math.max(-0.08, Math.min(0.08, velX));
  const vy = Math.max(-0.08, Math.min(0.08, velY));
  if (s === 0 && vx === 0 && vy === 0) return { x: wx, y: wy };

  let nx = wx;
  let ny = wy;
  for (let i = 0; i < 20; i++) {
    const forward = warpCanvasPoint(nx, ny, s, aspect, vx, vy);
    nx += wx - forward.x;
    ny += wy - forward.y;
  }
  return { x: nx, y: ny };
}

/**
 * Convert viewport-relative pointer coordinates (px, py) to world coordinates (worldX, worldY),
 * accounting for WebGL spherical/barrel distortion and velocity warp.
 */
export function screenToCanvasWorld(
  px: number,
  py: number,
  view: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
  warpStrength = 0,
  velX = 0,
  velY = 0
): { worldX: number; worldY: number } {
  const w = Math.max(1, viewport.width);
  const h = Math.max(1, viewport.height);
  const wx = (px / w) * 2 - 1;
  const wy = (py / h) * 2 - 1;
  const unwarped = unwarpCanvasPoint(wx, wy, warpStrength, w / h, velX, velY);
  const flatScreenX = ((unwarped.x + 1) * 0.5) * w;
  const flatScreenY = ((unwarped.y + 1) * 0.5) * h;
  return {
    worldX: (flatScreenX - view.x) / view.zoom,
    worldY: (flatScreenY - view.y) / view.zoom,
  };
}

/**
 * Compute UV scale & offset for sampling a texture of (texW, texH) inside a card of (cardW, cardH).
 * Supports 'contain' (letterboxed), 'cover' (centered crop), and 'cover-top' (top-aligned crop with scrollProgress in [0, 1] when height >= 2x width).
 */
export function computeTileUvTransform(
  texW: number,
  texH: number,
  cardW: number,
  cardH: number,
  fit: 'contain' | 'cover' | 'cover-top',
  scrollProgress = 0
): { scaleX: number; scaleY: number; offsetX: number; offsetY: number; scrollable: boolean } {
  if (texW <= 0 || texH <= 0 || cardW <= 0 || cardH <= 0) {
    return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, scrollable: false };
  }
  const texAspect = texW / texH;
  const cardAspect = cardW / cardH;

  if (fit === 'contain') {
    if (texAspect > cardAspect) {
      const scaleY = texAspect / cardAspect;
      return { scaleX: 1, scaleY, offsetX: 0, offsetY: (1 - scaleY) * 0.5, scrollable: false };
    } else {
      const scaleX = cardAspect / texAspect;
      return { scaleX, scaleY: 1, offsetX: (1 - scaleX) * 0.5, offsetY: 0, scrollable: false };
    }
  }

  // 'cover' or 'cover-top'
  if (texAspect > cardAspect) {
    const scaleX = cardAspect / texAspect;
    return { scaleX, scaleY: 1, offsetX: (1 - scaleX) * 0.5, offsetY: 0, scrollable: false };
  } else {
    const scaleY = texAspect / cardAspect;
    const maxOffset = Math.max(0, 1 - scaleY);
    const scrollable = texH / texW >= 2;
    const p = fit === 'cover-top' && scrollable ? Math.max(0, Math.min(1, scrollProgress)) : 0.5;
    return {
      scaleX: 1,
      scaleY,
      offsetX: 0,
      offsetY: maxOffset * p,
      scrollable,
    };
  }
}

export function matchesPaletteColors(
  palette: string[] | undefined,
  selectedColors: string[],
  resolveHex: (name: string) => string | undefined,
  threshold = 85
): boolean {
  if (!selectedColors.length) return true;
  if (!palette?.length) return false;
  return selectedColors.some((name) => {
    const target = resolveHex(name);
    return !!target && palette.some((p) => colorDistance(p, target) < threshold);
  });
}

export type DiscoverSiteLike = {
  title: string;
  url: string;
  image?: string;
  tags: string[];
  colors?: string[];
  sources: { name: string; url: string; date: string | null; awards?: string[] }[];
};

export const discoverSourceYear = (date: string | null): string | null =>
  date?.match(/^(\d{4})(?:-|$)/)?.[1] || null;

export function getDiscoverFilterOptions<T extends DiscoverSiteLike>(available: T[]) {
  const names = Array.from(new Set(available.flatMap((s) => s.sources.map((x) => x.name)))).sort();
  const industryKeys = Object.keys(industryTags);
  const tags = Array.from(new Set(available.flatMap((s) => s.tags)))
    .filter((tag) => !industryKeys.some((industry) => matchesIndustry([tag], industry)))
    .sort();
  const industries = industryKeys.filter((industry) => available.some((site) => matchesIndustry(site.tags, industry)));
  const years = Array.from(
    new Set(available.flatMap((s) => s.sources.map((x) => discoverSourceYear(x.date)).filter((y): y is string => !!y)))
  )
    .sort()
    .reverse();
  const hasUnknownYear = available.some((s) => !s.sources.some((x) => discoverSourceYear(x.date)));
  return { names, tags, industries, years, hasUnknownYear };
}

export function filterDiscoverSites<T extends DiscoverSiteLike>(
  available: T[],
  filters: {
    query: string;
    colors: string[];
    years: string[];
    sources: string[];
    industries: string[];
    tags: string[];
    statuses: string[];
    visited: Record<string, boolean>;
    paletteSwatches: ReadonlyArray<{ name: string; value: string }>;
  }
): T[] {
  const q = filters.query.toLowerCase().trim();
  return available.filter(
    (s) =>
      (!filters.colors.length ||
        s.colors?.some((hex) => {
          const nearest = filters.paletteSwatches.reduce((best, c) =>
            colorDistance(c.value, hex) < colorDistance(best.value, hex) ? c : best
          );
          return filters.colors.includes(nearest.name);
        })) &&
      (!filters.sources.length || s.sources.some((x) => filters.sources.includes(x.name))) &&
      (!filters.tags.length || s.tags.some((x) => filters.tags.includes(x))) &&
      (!filters.industries.length || filters.industries.some((industry) => matchesIndustry(s.tags, industry))) &&
      (!filters.statuses.length || filters.statuses.includes(filters.visited[s.url] ? 'Visited' : 'Unvisited')) &&
      (!filters.years.length ||
        s.sources.some((x) => {
          const y = discoverSourceYear(x.date);
          return y !== null && filters.years.includes(y);
        }) ||
        (filters.years.includes('Unknown') && !s.sources.some((x) => discoverSourceYear(x.date)))) &&
      (!q || [s.title, s.url, ...s.tags, ...s.sources.map((x) => x.name)].some((x) => matches(x, q)))
  );
}

export function sortDiscoverSites<T extends DiscoverSiteLike>(
  items: T[],
  sort: 'catalog' | 'newest' | 'oldest' | 'name' | 'shuffle',
  seed: number
): T[] {
  const next = [...items];
  const latestDate = (site: DiscoverSiteLike) => site.sources.map((source) => source.date || '').sort().at(-1) || '';
  if (sort === 'shuffle') next.sort((a, b) => shuffleRank(a.url, seed) - shuffleRank(b.url, seed));
  else if (sort === 'name') next.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'oldest') next.sort((a, b) => latestDate(a).localeCompare(latestDate(b)));
  else if (sort === 'newest') next.sort((a, b) => latestDate(b).localeCompare(latestDate(a)));
  return next;
}

export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 86_400_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInCalendarMonth(year: number, month: number): number | null {
  if (month < 1 || month > 12) return null;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Parses an ISO 8601 / RFC 3339 timestamp or `YYYY-MM-DD` date into UTC epoch milliseconds.
 * Rejects invalid calendar dates (e.g. `2025-02-29`) and malformed strings instead of rolling over.
 */
export function parseTrashTimestamp(trashedAt?: string): number | null {
  if (!trashedAt) return null;
  const s = trashedAt.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const maxDay = daysInCalendarMonth(year, month);
    if (!maxDay || day < 1 || day > maxDay) return null;
    return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  }

  const full = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?$/.exec(s);
  if (!full) return null;

  const year = Number(full[1]);
  const month = Number(full[2]);
  const day = Number(full[3]);
  const hour = Number(full[4]);
  const minute = Number(full[5]);
  const second = Number(full[6]);
  const fracRaw = full[7];
  const tzSign = full[9];
  const tzHours = full[10] !== undefined ? Number(full[10]) : 0;
  const tzMinutes = full[11] !== undefined ? Number(full[11]) : 0;

  const maxDay = daysInCalendarMonth(year, month);
  if (!maxDay || day < 1 || day > maxDay) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (tzSign && (tzHours > 23 || tzMinutes > 59)) return null;

  const ms = fracRaw ? Number(fracRaw.slice(0, 3).padEnd(3, '0')) : 0;
  let offsetMs = 0;
  if (tzSign) {
    const sign = tzSign === '+' ? 1 : -1;
    offsetMs = sign * (tzHours * 3_600_000 + tzMinutes * 60_000);
  }

  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMs;
}

export function isTrashExpired(
  trashedAt?: string,
  nowMs = Date.now(),
  retentionDays = TRASH_RETENTION_DAYS
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(retentionDays)) return false;
  const ts = parseTrashTimestamp(trashedAt);
  if (ts === null) return false;
  return nowMs - ts >= Math.max(0, retentionDays) * 86_400_000;
}

export function trashDaysRemaining(
  trashedAt?: string,
  nowMs = Date.now(),
  retentionDays = TRASH_RETENTION_DAYS
): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(retentionDays)) return null;
  const ts = parseTrashTimestamp(trashedAt);
  if (ts === null) return null;
  const retentionMs = Math.max(0, retentionDays) * 86_400_000;
  const elapsed = nowMs - ts;
  if (elapsed >= retentionMs) return 0;
  if (elapsed <= 0) return Math.max(0, retentionDays);
  return Math.ceil((retentionMs - elapsed) / 86_400_000);
}

function isTrashedFlag(trashedAt?: string): boolean {
  return typeof trashedAt === 'string' && trashedAt.trim().length > 0;
}

/**
 * Permanently removes a trashed source or trashed asset from `sources`.
 * Active (non-trashed) targets are left untouched.
 */
export function removeTrashedItem<
  T extends { id: string; coverId?: string; trashedAt?: string; assets: A[] },
  A extends { id: string; trashedAt?: string },
>(sources: readonly T[], sourceId: string, assetId?: string): T[] {
  const next: T[] = [];
  for (const source of sources) {
    if (source.id !== sourceId) {
      next.push(source);
      continue;
    }
    const sourceTrashed = isTrashedFlag(source.trashedAt);
    if (!assetId) {
      if (!sourceTrashed) next.push(source);
      continue;
    }
    const target = source.assets.find((a) => a.id === assetId);
    if (!target || (!sourceTrashed && !isTrashedFlag(target.trashedAt))) {
      next.push(source);
      continue;
    }
    const assets = source.assets.filter((a) => a.id !== assetId);
    const coverCleared = source.coverId === assetId;
    next.push({
      ...source,
      coverId: coverCleared ? undefined : source.coverId,
      assets,
    });
  }
  return next;
}

export function clearAllTrash<
  T extends { id: string; coverId?: string; trashedAt?: string; assets: A[] },
  A extends { id: string; trashedAt?: string },
>(sources: readonly T[]): T[] {
  const next: T[] = [];
  for (const source of sources) {
    if (isTrashedFlag(source.trashedAt)) continue;
    const assets = source.assets.filter((a) => !isTrashedFlag(a.trashedAt));
    const coverStillActive = source.coverId ? assets.some((a) => a.id === source.coverId) : false;
    next.push({
      ...source,
      coverId: coverStillActive ? source.coverId : undefined,
      assets,
    });
  }
  return next;
}

export function purgeExpiredTrash<
  T extends { id: string; coverId?: string; trashedAt?: string; assets: A[] },
  A extends { id: string; trashedAt?: string },
>(
  sources: readonly T[],
  nowMs = Date.now(),
  retentionDays = TRASH_RETENTION_DAYS
): { sources: T[]; removedSources: number; removedAssets: number } {
  const next: T[] = [];
  let removedSources = 0;
  let removedAssets = 0;

  for (const source of sources) {
    if (isTrashExpired(source.trashedAt, nowMs, retentionDays)) {
      removedSources += 1;
      removedAssets += source.assets.length;
      continue;
    }
    const keptAssets: A[] = [];
    let sourceAssetsRemoved = 0;
    for (const asset of source.assets) {
      if (isTrashExpired(asset.trashedAt, nowMs, retentionDays)) {
        removedAssets += 1;
        sourceAssetsRemoved += 1;
      } else {
        keptAssets.push(asset);
      }
    }
    if (sourceAssetsRemoved === 0) {
      next.push(source);
    } else {
      const coverValid = source.coverId
        ? keptAssets.some((a) => a.id === source.coverId && !isTrashedFlag(a.trashedAt))
        : false;
      next.push({
        ...source,
        coverId: coverValid ? source.coverId : undefined,
        assets: keptAssets,
      });
    }
  }

  return { sources: next, removedSources, removedAssets };
}

export function normalizeAssetRelPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

function refKey(value: string, caseInsensitive: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value;
}

export function assetFileStem(file: string): string | null {
  const norm = normalizeAssetRelPath(file);
  const base = norm.split('/').pop() || '';
  if (!base) return null;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem || null;
}

function thumbStemIfGenerated(name: string, caseInsensitive = false): string | null {
  const check = caseInsensitive ? name.toLowerCase() : name;
  if (!check.endsWith('.jpg')) return null;
  const base = name.slice(0, -4);
  if (!base) return null;
  const customMatch = caseInsensitive ? /^(.+)-t\d+$/i.exec(base) : /^(.+)-t\d+$/.exec(base);
  return customMatch ? customMatch[1] : base;
}

function previewStemIfGenerated(name: string, caseInsensitive = false): string | null {
  const check = caseInsensitive ? name.toLowerCase() : name;
  if (check.endsWith('.v2.mp4')) {
    const stem = name.slice(0, -7);
    return stem || null;
  }
  if (check.endsWith('.mp4')) {
    const stem = name.slice(0, -4);
    return stem || null;
  }
  return null;
}

/**
 * Returns `true` when `file` lives in `<library>/trash/assets/` (i.e. referenced by
 * at least one trashed entry and by zero active entries). Shared files stay in `assets/`.
 */
export function isFileInTrashStorage<
  T extends { trashedAt?: string; assets: ReadonlyArray<{ file: string; trashedAt?: string }> },
>(sources: readonly T[], file: string, caseInsensitive = false): boolean {
  const target = refKey(normalizeAssetRelPath(file), caseInsensitive);
  if (!target) return false;
  let hasTrashedRef = false;
  for (const source of sources) {
    const sourceTrashed = isTrashedFlag(source.trashedAt);
    for (const asset of source.assets) {
      if (refKey(normalizeAssetRelPath(asset.file), caseInsensitive) !== target) continue;
      if (sourceTrashed || isTrashedFlag(asset.trashedAt)) {
        hasTrashedRef = true;
      } else {
        return false;
      }
    }
  }
  return hasTrashedRef;
}

/**
 * Returns `true` when a thumbnail filename lives in `<library>/trash/thumbnails/`.
 */
export function isThumbnailInTrashStorage<
  T extends {
    trashedAt?: string;
    assets: ReadonlyArray<{ file: string; thumbnail?: string; trashedAt?: string }>;
  },
>(sources: readonly T[], thumbnail: string, assetFile?: string, caseInsensitive = false): boolean {
  if (!thumbnail) return false;
  const targetThumb = refKey(thumbnail, caseInsensitive);
  const activeThumbs = new Set<string>();
  const trashedThumbs = new Set<string>();
  const activeStems = new Set<string>();
  const trashedStems = new Set<string>();

  for (const source of sources) {
    const sourceTrashed = isTrashedFlag(source.trashedAt);
    for (const asset of source.assets) {
      const trashed = sourceTrashed || isTrashedFlag(asset.trashedAt);
      const stem = assetFileStem(asset.file);
      if (stem) {
        const stemKey = refKey(stem, caseInsensitive);
        if (trashed) trashedStems.add(stemKey);
        else activeStems.add(stemKey);
      }
      if (asset.thumbnail) {
        const thumbKey = refKey(asset.thumbnail, caseInsensitive);
        if (trashed) trashedThumbs.add(thumbKey);
        else activeThumbs.add(thumbKey);
      }
    }
  }

  if (activeThumbs.has(targetThumb)) return false;
  const genStemRaw = thumbStemIfGenerated(thumbnail, caseInsensitive);
  const genStem = genStemRaw ? refKey(genStemRaw, caseInsensitive) : null;
  if (genStem && activeStems.has(genStem)) return false;
  const fileStemRaw = assetFile ? assetFileStem(assetFile) : null;
  const fileStem = fileStemRaw ? refKey(fileStemRaw, caseInsensitive) : null;
  if (fileStem && activeStems.has(fileStem)) return false;

  return (
    trashedThumbs.has(targetThumb) ||
    (genStem !== null && trashedStems.has(genStem)) ||
    (fileStem !== null && trashedStems.has(fileStem))
  );
}

/**
 * Returns `true` when a preview video filename lives in `<library>/trash/previews/`.
 */
export function isPreviewInTrashStorage<
  T extends {
    trashedAt?: string;
    assets: ReadonlyArray<{ file: string; previewVideo?: string; trashedAt?: string }>;
  },
>(sources: readonly T[], previewVideo: string, assetFile?: string, caseInsensitive = false): boolean {
  if (!previewVideo) return false;
  const targetPreview = refKey(previewVideo, caseInsensitive);
  const activePreviews = new Set<string>();
  const trashedPreviews = new Set<string>();
  const activeStems = new Set<string>();
  const trashedStems = new Set<string>();

  for (const source of sources) {
    const sourceTrashed = isTrashedFlag(source.trashedAt);
    for (const asset of source.assets) {
      const trashed = sourceTrashed || isTrashedFlag(asset.trashedAt);
      const stem = assetFileStem(asset.file);
      if (stem) {
        const stemKey = refKey(stem, caseInsensitive);
        if (trashed) trashedStems.add(stemKey);
        else activeStems.add(stemKey);
      }
      if (asset.previewVideo) {
        const previewKey = refKey(asset.previewVideo, caseInsensitive);
        if (trashed) trashedPreviews.add(previewKey);
        else activePreviews.add(previewKey);
      }
    }
  }

  if (activePreviews.has(targetPreview)) return false;
  const genStemRaw = previewStemIfGenerated(previewVideo, caseInsensitive);
  const genStem = genStemRaw ? refKey(genStemRaw, caseInsensitive) : null;
  if (genStem && activeStems.has(genStem)) return false;
  const fileStemRaw = assetFile ? assetFileStem(assetFile) : null;
  const fileStem = fileStemRaw ? refKey(fileStemRaw, caseInsensitive) : null;
  if (fileStem && activeStems.has(fileStem)) return false;

  return (
    trashedPreviews.has(targetPreview) ||
    (genStem !== null && trashedStems.has(genStem)) ||
    (fileStem !== null && trashedStems.has(fileStem))
  );
}
