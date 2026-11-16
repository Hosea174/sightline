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

export function renameFolderReferences<T extends {id:string;folder?:string;assets:A[]},A extends {file:string}>(sources:T[],sourceId:string,oldFolder:string,newFolder:string):T[] {
 const cleanOld=oldFolder.replace(/\\/g,'/');
 const cleanNew=newFolder.replace(/\\/g,'/');
 if(!cleanOld||!cleanNew||cleanOld===cleanNew)return sources.map(s=>s.id===sourceId?{...s,folder:cleanNew}:s);
 const prefix=cleanOld+'/';
 return sources.map(s=>{
  let changed=false;
  const assets=s.assets.map(a=>{
   const norm=a.file.replace(/\\/g,'/');
   if(norm.startsWith(prefix)){changed=true;return {...a,file:`${cleanNew}/${norm.slice(prefix.length)}`}}
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

export function groupFontAssets<
  A extends { id: string; name: string; file: string; family?: string; weight?: number; style?: 'normal' | 'italic' },
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
    const weight = asset.weight || parsed.weight || 400;
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
      group.variantsByFile.set(asset.file, { asset, sourceId, weight, style, format });
    }
  }

  const out: FontFamilyGroup<A>[] = [];
  for (const [key, g] of groups.entries()) {
    const variants = Array.from(g.variantsByFile.values()).sort(
      (a, b) => (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1) || a.weight - b.weight
    );
    const preferred =
      variants.find((v) => v.style === 'normal' && v.weight === 400) ||
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