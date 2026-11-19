import { mountTitleTooltips } from './components/ui/title-tooltips';
import { DesktopVideoTimeline } from './components/DesktopVideoTimeline';
import { exportEditedVideoAsset, insertExportedAssetIntoSources } from './lib/videoEditorService';
import { ChoiceMenu } from './components/ui/choice-menu';
import { reorderSourceAssets, mergeAnnotationNote } from './logic';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Badge} from './components/ui/badge';
import {Separator} from './components/ui/separator';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './components/ui/dialog';
import {Popover,PopoverTrigger,PopoverContent} from './components/ui/popover';
import {ToggleGroup,ToggleGroupItem} from './components/ui/toggle-group';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuGroup,DropdownMenuItem} from './components/ui/dropdown-menu';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription} from './components/ui/empty';
import {Tabs,TabsList,TabsTrigger,TabsContent} from './components/ui/tabs';
import {Field,FieldGroup,FieldLabel} from './components/ui/field';
import {Camera as CameraIcon,Sun,Moon,Settings2,MoreHorizontal,Library} from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { Aperture, Archive, ArrowUpRight, Boxes, Grip, GripHorizontal, GripVertical, Keyboard, LayoutGrid, Pause, Plus, Repeat, Search, SkipBack, SkipForward, Sparkles, Square, Type, Video, X, FolderOpen, Tags, ArrowRight, HardDrive, Check, SlidersHorizontal, Play, Globe, ExternalLink, ChevronDown, ChevronLeft, ChevronRight, Grid3X3, List, Palette, ArrowDownWideNarrow, Tag, PanelsTopLeft, Paintbrush, Film, Shapes, Trash2, RotateCcw, Copy, Heart, Pencil, ExternalLink as OpenIcon, CalendarDays, Eye, EyeOff, MessageSquarePlus, Check as CheckIcon, Image } from 'lucide-react';
import 'plyr/dist/plyr.css';
import Plyr from 'plyr';
import '@fontsource-variable/inter';
import './theme.css';
import './app.css';
import './media.css';
import './surfaces.css';
import {sameInstagramPost,inspirationUrlKey,sameSource,matches,displayUrl,toggleFavorite as favoriteItem,paginationPages,shuffleRank,matchesReference,matchesPaletteColors,getDiscoverFilterOptions,filterDiscoverSites,sortDiscoverSites,safeHttpUrl,sourceFolder,renameFolderReferences,FONT_EXTENSIONS,getFileExtension,groupFontAssets,isFontFilename,parseFontFilenameMeta,capturedFontAssetFields,getFontFaceWeightDescriptor,getAvailableFontWeightPills,isFileInTrashStorage,isTrashExpired,trashDaysRemaining,TRASH_RETENTION_DAYS,type FontFamilyGroup,type FontWeightPill} from './logic';
import {trashItems,restoreFromTrash,permanentlyDeleteTrashed,clearTrash,purgeExpiredLibraryTrash,resolveAssetDiskUrl,resolveThumbDiskUrl,resolvePreviewVideoDiskUrl,revealAssetFile,getAssetDiskPath,copyAssetImageToClipboard,formatTrashExpiryLabel,type TrashTarget} from './lib/trashService';
import {InfiniteCanvas,type CanvasItem,type CanvasDiscoverItem} from './InfiniteCanvas';
import {FilterMenu,type FilterGroup} from './components/FilterMenu';
import {loadPersisted,savePersisted} from './lib/persistedState';
import {CANVAS_FILTERS_KEY,isCanvasFilters,normalizeCanvasFilters} from './lib/canvasFilters';
import {ScrollCoverImage} from './components/ScrollCoverImage';
import {VideoPlaybackProvider,VideoPlaybackToggle,LoopingPreview} from './video/playback';
import {loadDiscoverCatalog,invalidateDiscoverCatalog,discoverCoverSrc,attachDiscoverPalettes} from './lib/discoverCatalog';
import {installAppEffects} from './lib/appEffects';
import {gridColumnsCss,pageSizeOptions,snapPageSize,useGridColumnsMeasure,useGridColumnsValue} from './lib/gridColumns';
import {AddInspirationModal,type AddInspirationPayload} from './AddInspirationModal';
import {AddFontDialog,type AddFontTab,type SystemFontVariant} from './AddFontDialog';
import {type Annotation,type Asset,type Capture,type Source,CATEGORIES} from './types';
const categories:string[]=[...CATEGORIES];
const categoryIcons=[PanelsTopLeft,Paintbrush,Film,Sparkles,Shapes];
const colors=[{name:'Red',value:'#d84c4c'},{name:'Orange',value:'#e98b3d'},{name:'Yellow',value:'#e4c750'},{name:'Green',value:'#56a963'},{name:'Teal',value:'#50aaa4'},{name:'Blue',value:'#4c85cf'},{name:'Purple',value:'#926ec5'},{name:'Pink',value:'#d888a8'},{name:'Brown',value:'#986e51'},{name:'Black',value:'#202020'},{name:'Gray',value:'#909090'},{name:'White',value:'#eeeeee'}];
const colorSwatchByName=(name:string)=>colors.find(c=>c.name===name)?.value;
type GridView='compact'|'small'|'medium'|'large'|'list';
const uid=()=>crypto.randomUUID();
const native=()=> '__TAURI_INTERNALS__' in window;
async function toggleWindowFullscreen(){
  try{
    if(native()){const win=getCurrentWindow();await win.setFullscreen(!(await win.isFullscreen()))}
    else if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }catch{}
}
async function openLink(url:string){const valid=safeHttpUrl(url);if(!valid)throw Error('Only http and https links can be opened.');if(native())await invoke('open_url',{url:valid});else window.open(valid,'_blank','noopener,noreferrer')}
async function imageUrlToPngBytes(url:string):Promise<Uint8Array|null>{
  try{
    const img=new window.Image();
    img.crossOrigin='anonymous';
    await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('load failed'));img.src=url});
    const w=img.naturalWidth||img.width||1200,h=img.naturalHeight||img.height||800;
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    ctx.drawImage(img,0,0,w,h);
    const blob=await new Promise<Blob|null>(res=>canvas.toBlob(res,'image/png'));
    if(!blob)return null;
    return new Uint8Array(await blob.arrayBuffer());
  }catch{return null}
}
async function copyImageUrlToClipboard(url:string){
  const bytes=await imageUrlToPngBytes(url);
  if(native()){
    await invoke('copy_image_to_clipboard',{file:null,pngBytes:bytes?Array.from(bytes):null});
    return;
  }
  if(!bytes||typeof ClipboardItem==='undefined')throw new Error('Image clipboard is unavailable.');
  await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(bytes)],{type:'image/png'})})]);
}
const isTextEntryElement=(el:EventTarget|null):el is HTMLElement=>{
  if(!(el instanceof HTMLElement))return false;
  if(el.isContentEditable)return true;
  if(/^(TEXTAREA|SELECT)$/.test(el.tagName))return true;
  if(el instanceof HTMLInputElement)return !/^(range|button|checkbox|radio|submit|reset|color|file)$/i.test(el.type);
  return false;
};
function getContextCoordinates(e:React.MouseEvent<Element>){
  if(e.clientX===0&&e.clientY===0){
    const rect=e.currentTarget.getBoundingClientRect();
    if(rect.width||rect.height){
      return {
        x:Math.max(8,Math.min(rect.right-4,window.innerWidth-8)),
        y:Math.max(8,Math.min(rect.bottom+4,window.innerHeight-8))
      };
    }
  }
  return {
    x:Math.max(8,Math.min(e.clientX,window.innerWidth-8)),
    y:Math.max(8,Math.min(e.clientY,window.innerHeight-8))
  };
}
const isAnnotationToggleShortcut=(e:KeyboardEvent)=>(e.ctrlKey||e.metaKey)&&e.shiftKey&&!e.altKey&&(e.key==='.'||e.key==='>'||e.code==='Period');
const isTimelineToggleShortcut=(e:KeyboardEvent)=>(e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&(e.key==='`'||e.key==='~'||e.code==='Backquote');
function formatTimecode(seconds:number):string{
  if(!Number.isFinite(seconds)||seconds<0)return '00:00.00';
  const mins=Math.floor(seconds/60);
  const secs=Math.floor(seconds%60);
  const centis=Math.floor((seconds%1)*100);
  return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(centis).padStart(2,'0')}`;
}
function pickNextPreviewAfterAssetRemoval(sourcesList:Source[],sourceId:string,removedAssetId:string,currentPreview:Asset|null):Asset|null{
  if(!currentPreview||currentPreview.id!==removedAssetId)return currentPreview;
  const owner=sourcesList.find(s=>s.id===sourceId&&!s.trashedAt);
  if(!owner)return null;
  const activeAssets=owner.assets.filter(a=>!a.trashedAt);
  const removedIndex=activeAssets.findIndex(a=>a.id===removedAssetId);
  const removedAsset=removedIndex>=0?activeAssets[removedIndex]:currentPreview;
  if(removedAsset.kind==='image'||removedAsset.kind==='video'){
    const visuals=activeAssets.filter(a=>a.kind==='image'||a.kind==='video');
    const visualIndex=visuals.findIndex(a=>a.id===removedAssetId);
    const remainingVisuals=visuals.filter(a=>a.id!==removedAssetId);
    if(remainingVisuals.length>0)return remainingVisuals[Math.min(Math.max(0,visualIndex),remainingVisuals.length-1)];
  }
  const remainingAssets=activeAssets.filter(a=>a.id!==removedAssetId);
  if(!remainingAssets.length)return null;
  return remainingAssets[Math.min(Math.max(0,removedIndex),remainingAssets.length-1)];
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const stringList=(v:unknown,fallback:string[]=[]):string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string')?v:fallback;
const LIBRARY_FILTERS_KEY='sightline:library-filters';
const DISCOVER_FILTERS_KEY='sightline:discover-filters';
function loadLibraryFilters(){
  const v=loadPersisted<Record<string,unknown>>(LIBRARY_FILTERS_KEY,{},isRecord);
  return {tags:stringList(v.tags),categories:stringList(v.categories),fontFormats:stringList(v.fontFormats),colors:stringList(v.colors),sortBy:typeof v.sortBy==='string'&&['newest','oldest','name','shuffle'].includes(v.sortBy)?v.sortBy:'newest'};
}
function loadDiscoverFilters(){
  const v=loadPersisted<Record<string,unknown>>(DISCOVER_FILTERS_KEY,{},isRecord);
  return {industries:stringList(v.industries),sources:stringList(v.sources),tags:stringList(v.tags),statuses:stringList(v.statuses,['Unvisited']),years:stringList(v.years),colors:stringList(v.colors)};
}
const SHORTCUT_GROUPS:{title:string;items:{label:string;keys:string[]}[]}[]=[
  {title:'Workspace',items:[
    {label:'Focus search',keys:['Ctrl','K']},
    {label:'Undo last action',keys:['Ctrl','Z']},
    {label:'Keyboard shortcuts',keys:['?']},
    {label:'Toggle shortcuts',keys:['Ctrl','/']},
    {label:'Toggle full screen',keys:['F11']},
    {label:'Close dialog or menu',keys:['Esc']}
  ]},
  {title:'Media Viewer',items:[
    {label:'Previous / Next visual',keys:['←','→']},
    {label:'Toggle annotation mode',keys:['Ctrl','Shift','.']},
    {label:'Save annotation note',keys:['Ctrl','Enter']},
    {label:'Paste file into source',keys:['Ctrl','V']}
  ]},
  {title:'Video & Timeline',items:[
    {label:'Play / Pause',keys:['Space']},
    {label:'Toggle video timeline',keys:['Ctrl','`']},
    {label:'Trim to playhead',keys:['Q','W']},
    {label:'Split clip',keys:['Ctrl','Alt','B']},
    {label:'Jump to first / last clip',keys:['Ctrl','Alt','Left / Right']},
    {label:'Remove selected clip',keys:['Del']},
    {label:'Step 1 frame (×10 Shift)',keys:[',','.']},
    {label:'Jump to start / end',keys:['Home','End']}
  ]},
  {title:'Infinite Canvas',items:[
    {label:'Toggle fullscreen canvas',keys:['F']},
    {label:'Exit fullscreen canvas',keys:['Esc']},
    {label:'Zoom in / out / reset',keys:['+','-','0']}
  ]}
];
type UndoEntry={id:string;message:string;undo:()=>Promise<void>|void};
type ConfirmTrashAction=
  |{kind:'delete-item';sourceId:string;assetId?:string;title:string;isSource:boolean;assetCount:number}
  |{kind:'clear-trash';itemCount:number};
function App(){
 const [dark,setDark]=useState(()=>localStorage.getItem('sightline-theme')==='dark');
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('sightline-theme',dark?'dark':'light')},[dark]);
 const [root,setRoot]=useState(''); const sourcesRef=useRef<Source[]>([]); const rootRef=useRef(''); const writeQueue=useRef<Promise<boolean>>(Promise.resolve(true)); const importing=useRef(false); const switching=useRef(false); const [allSources,setSources]=useState<Source[]>([]); const sources=useMemo(()=>allSources.filter(s=>!s.trashedAt).map(s=>({...s,assets:s.assets.filter(a=>!a.trashedAt)})),[allSources]); const [ready,setReady]=useState(false); const [error,setError]=useState(''); const [backupBusy,setBackupBusy]=useState(false); const [backupStatus,setBackupStatus]=useState(''); const [instagramOpen,setInstagramOpen]=useState(false); const [instagramBusy,setInstagramBusy]=useState(false); const [instagramStatus,setInstagramStatus]=useState(''); const [instagramConfig,setInstagramConfig]=useState<{postIdeas:string;webDesign:string}>(()=>{try{return {...{postIdeas:'',webDesign:''},...JSON.parse(localStorage.getItem('sightline-instagram-config')||'{}')}}catch{return {postIdeas:'',webDesign:''}}});
 const [view,setView]=useState('Library');
 const [libraryCategory,setLibraryCategory]=useState<string>(()=>{try{const saved=localStorage.getItem('sightline-library-category');return saved&&['All',...categories].includes(saved)?saved:'All'}catch{return 'All'}});
 const [savedCanvasFilters]=useState(()=>normalizeCanvasFilters(loadPersisted(CANVAS_FILTERS_KEY,{},isCanvasFilters)));
 const canvasSavedTagsRef=useRef<string[]>(savedCanvasFilters.tags);
 const pendingDiscoverAddRef=useRef(false);
 const [canvasCategoryFilter,setCanvasCategoryFilter]=useState<string[]>(savedCanvasFilters.category);
 const [canvasMediaFilter,setCanvasMediaFilter]=useState<string[]>(savedCanvasFilters.media);
 const [discoverStats,setDiscoverStats]=useState<{total:number;filtered:number;refreshing:boolean}|null>(null);
 const discoverActionsRef=useRef<{add:()=>void;refresh:()=>void}>({add:()=>{},refresh:()=>{}});
 const category=view==='Library'?libraryCategory:'All';
 const setCategory=(next:string)=>{setLibraryCategory(next);try{localStorage.setItem('sightline-library-category',next)}catch{/* display preference is optional */}};
 const [canvasMode,setCanvasMode]=useState<'library'|'discover'>(()=>{try{return localStorage.getItem('sightline-canvas-mode')==='discover'?'discover':'library'}catch{return 'library'}});
 const chooseCanvasMode=(next:'library'|'discover')=>{setCanvasMode(next);try{localStorage.setItem('sightline-canvas-mode',next)}catch{/* display preference is optional */}};
 const [canvasMinimized,setCanvasMinimized]=useState<boolean>(()=>{try{return localStorage.getItem('sightline-canvas-minimized')==='true'}catch{return false}});
 const toggleCanvasMinimized=()=>setCanvasMinimized(prev=>{const next=!prev;try{localStorage.setItem('sightline-canvas-minimized',String(next))}catch{/* display preference is optional */}return next});
 const [canvasInfiniteLoop,setCanvasInfiniteLoop]=useState<boolean>(()=>{try{return localStorage.getItem('sightline-canvas-loop')!=='false'}catch{return true}});
 const toggleCanvasInfiniteLoop=()=>setCanvasInfiniteLoop(prev=>{const next=!prev;try{localStorage.setItem('sightline-canvas-loop',String(next))}catch{/* display preference is optional */}return next});
 const [canvasDiscoverSites,setCanvasDiscoverSites]=useState<StudySite[]>([]);
 const [canvasDiscoverImageDir,setCanvasDiscoverImageDir]=useState('');
 const [canvasDiscoverLoading,setCanvasDiscoverLoading]=useState(false);
 const [canvasRemovedVersion,setCanvasRemovedVersion]=useState(0);
 const [canvasDiscoverMenu,setCanvasDiscoverMenu]=useState<{x:number;y:number;site:StudySite}|null>(null);
 const [canvasDiscoverSeed,setCanvasDiscoverSeed]=useState(()=>Math.floor(Math.random()*0xffffffff));
 const [canvasDiscoverSort,setCanvasDiscoverSort]=useState<'catalog'|'newest'|'oldest'|'name'|'shuffle'>('catalog');
 const [canvasDiscoverColors,setCanvasDiscoverColors]=useState<string[]>(savedCanvasFilters.colors);
 const [canvasDiscoverYears,setCanvasDiscoverYears]=useState<string[]>(savedCanvasFilters.years);
 const [canvasDiscoverSources,setCanvasDiscoverSources]=useState<string[]>(savedCanvasFilters.sources);
 const [canvasDiscoverIndustries,setCanvasDiscoverIndustries]=useState<string[]>(savedCanvasFilters.industries);
 const [canvasDiscoverTags,setCanvasDiscoverTags]=useState<string[]>(savedCanvasFilters.discoverTags);
 const [canvasDiscoverStatuses,setCanvasDiscoverStatuses]=useState<string[]>(savedCanvasFilters.statuses);
 useEffect(()=>{if(view==='Discover'&&pendingDiscoverAddRef.current){pendingDiscoverAddRef.current=false;discoverActionsRef.current.add()}},[view]);
 const [canvasVisited,setCanvasVisited]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('sightline-study-visited')||'{}')}catch{return {}}});
 const canvasVisitedRef=useRef(canvasVisited); canvasVisitedRef.current=canvasVisited;
 const [savedClip,setSavedClip]=useState<Asset|null>(null);
 const [undoToast,setUndoToast]=useState<UndoEntry|null>(null);
 const undoTimerRef=useRef<number|null>(null);
 const undoToastRef=useRef<UndoEntry|null>(null); undoToastRef.current=undoToast;
 const undoBusyRef=useRef(false);
 const dismissUndo=useCallback(()=>{if(undoTimerRef.current!==null){window.clearTimeout(undoTimerRef.current);undoTimerRef.current=null}setUndoToast(null)},[]);
 const pushUndo=useCallback((message:string,undo:()=>Promise<void>|void)=>{
   if(undoTimerRef.current!==null)window.clearTimeout(undoTimerRef.current);
   const entry:UndoEntry={id:uid(),message,undo};
   setUndoToast(entry);
   undoTimerRef.current=window.setTimeout(()=>{undoTimerRef.current=null;setUndoToast(current=>current?.id===entry.id?null:current)},8000);
 },[]);
 useEffect(()=>()=>{if(undoTimerRef.current!==null)window.clearTimeout(undoTimerRef.current)},[]);
 const triggerUndo=useCallback(async()=>{
   const entry=undoToastRef.current;
   if(!entry||undoBusyRef.current)return;
   undoBusyRef.current=true;
   dismissUndo();
   try{await entry.undo()}
   catch(e){setError('Could not undo action: '+String(e))}
   finally{undoBusyRef.current=false}
 },[dismissUndo]);
 const [confirmTrashAction,setConfirmTrashAction]=useState<ConfirmTrashAction|null>(null);
 const [trashBusy,setTrashBusy]=useState(false);
 const trashBusyRef=useRef(false);
 const [initialFilters]=useState(loadLibraryFilters); const [query,setQuery]=useState(''); const [tagFilter,setTagFilter]=useState<string[]>(initialFilters.tags); const [categoryFilter,setCategoryFilter]=useState<string[]>(initialFilters.categories); const [fontFormatFilter,setFontFormatFilter]=useState<string[]>(initialFilters.fontFormats); const [selected,setSelected]=useState<string|null>(null); const selectedRef=useRef<string|null>(null); selectedRef.current=selected; const [editing,setEditing]=useState(false); const [editingId,setEditingId]=useState<string|null>(null); const [formError,setFormError]=useState('');
 useEffect(()=>{if(view==='Canvas')canvasSavedTagsRef.current=tagFilter;savePersisted(CANVAS_FILTERS_KEY,{media:canvasMediaFilter,category:canvasCategoryFilter,tags:canvasSavedTagsRef.current,colors:canvasDiscoverColors,years:canvasDiscoverYears,sources:canvasDiscoverSources,industries:canvasDiscoverIndustries,discoverTags:canvasDiscoverTags,statuses:canvasDiscoverStatuses})},[view,tagFilter,canvasMediaFilter,canvasCategoryFilter,canvasDiscoverColors,canvasDiscoverYears,canvasDiscoverSources,canvasDiscoverIndustries,canvasDiscoverTags,canvasDiscoverStatuses]);
 const [librarySeed,setLibrarySeed]=useState(()=>Math.floor(Math.random()*0xffffffff)); const [assetView,setAssetView]=useState(false); const [sortBy,setSortBy]=useState(initialFilters.sortBy); const faviconAttempts=useRef(new Set<string>()); const [gridView,setGridView]=useState<GridView>(()=>{try{const saved=localStorage.getItem('sightline-grid-view');return saved==='grid'?'large':saved==='masonry'?'compact':(['compact','small','medium','large','list'].includes(saved||'')?saved as GridView:'medium')}catch{return 'medium'}}); const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(30);
 function chooseGridView(next:GridView){setGridView(next);try{localStorage.setItem('sightline-grid-view',next)}catch{/* display preference is optional */}}
 useGridColumnsMeasure(gridView);const gridColumns=useGridColumnsValue();useEffect(()=>{setPageSize(p=>snapPageSize(p,gridColumns))},[gridColumns]);
 const [contextMenu,setContextMenu]=useState<{x:number;y:number;sourceId?:string;assetId?:string;copyText?:string}|null>(null); const [fontStatus,setFontStatus]=useState(''); const [colorFilter,setColorFilter]=useState<string[]>(initialFilters.colors); useEffect(()=>{savePersisted(LIBRARY_FILTERS_KEY,{tags:tagFilter,categories:categoryFilter,fontFormats:fontFormatFilter,colors:colorFilter,sortBy})},[tagFilter,categoryFilter,fontFormatFilter,colorFilter,sortBy]); const [indexingColors]=useState(false); const [preview,setPreview]=useState<Asset|null>(null); const previewRef=useRef<Asset|null>(null); previewRef.current=preview; const previewOpenRef=useRef(false); previewOpenRef.current=!!preview; const [fontToLink,setFontToLink]=useState(''); const [downloading,setDownloading]=useState(false);
 const [addInspirationOpen,setAddInspirationOpen]=useState(false); const [inspirationSaving,setInspirationSaving]=useState(false);
 const [addFontOpen,setAddFontOpen]=useState(false); const [addFontTab,setAddFontTab]=useState<AddFontTab>('google');
 const [annotationsVisibleBySource,setAnnotationsVisibleBySource]=useState<Record<string,boolean>>({});
 const [draftAnnotationsVisible,setDraftAnnotationsVisible]=useState(false);
 const [viewerTimelineOpen,setViewerTimelineOpen]=useState(false);const [noteRequest,setNoteRequest]=useState<{id:string;n:number}|null>(null);
 const [shortcutsOpen,setShortcutsOpen]=useState(false);
 const livePreview=useMemo(()=>preview?(sources.flatMap(s=>s.assets).find(a=>a.id===preview.id)||preview):null,[preview,sources]);
 const closePreview=()=>{previewOpenRef.current=false;setPreview(null);setViewerTimelineOpen(false);setAnnotationsVisibleBySource({});setFontStatus('');setFontToLink('')};
 async function revealAsset(file:string,trashed?:boolean){
   const inTrash=trashed??isFileInTrashStorage(sourcesRef.current,file);
   try{await revealAssetFile(file,inTrash)}
   catch(e){setError(String(e).includes('Open Sightline on your desktop')?String(e):'Could not open asset location: '+String(e))}
 }
 async function copyAsset(asset:Asset,trashed?:boolean){
   const inTrash=trashed??isFileInTrashStorage(sourcesRef.current,asset.file);
   try{
     if(asset.kind==='image'){
       const assetUrl=resolveAssetDiskUrl(rootRef.current,asset.file,sourcesRef.current);
       if(native()){
         const direct=/\.(png|jpe?g|bmp|gif)$/i.test(asset.file);
         const bytes=direct?null:await imageUrlToPngBytes(assetUrl);
         await copyAssetImageToClipboard({file:asset.file,pngBytes:bytes?Array.from(bytes):null,trashed:inTrash});
         return;
       }
       const bytes=await imageUrlToPngBytes(assetUrl);
       if(!bytes||typeof ClipboardItem==='undefined')throw new Error('Image clipboard is unavailable.');
       await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(bytes)],{type:'image/png'})})]);
       return;
     }
     const fallbackPath=inTrash?`${rootRef.current}\\trash\\assets\\${asset.file.replace(/\//g,'\\')}`:`${rootRef.current}\\assets\\${asset.file.replace(/\//g,'\\')}`;
     const localPath=native()?await getAssetDiskPath(asset.file,inTrash).catch(()=>fallbackPath):asset.file;
     await navigator.clipboard.writeText(localPath);
   }catch(e){setError('Could not copy asset: '+String(e))}
 }
 const searchRef=useRef<HTMLInputElement>(null);
 const lastWorkspaceFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{const remember=()=>{const el=document.activeElement as HTMLElement|null;if(el&&!el.closest('.overlay,[role=dialog],[role=menu]'))lastWorkspaceFocus.current=el};document.addEventListener('focusin',remember);return()=>document.removeEventListener('focusin',remember)},[]);
 useEffect(()=>{setFontStatus('');setFontToLink('')},[preview?.id]);
 const onKey=(e:KeyboardEvent)=>{
   if(e.key==='F11'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){
     e.preventDefault();
     void toggleWindowFullscreen();
     return;
   }
   if(e.key==='Escape'&&!e.defaultPrevented){setContextMenu(null);setCanvasDiscoverMenu(null)}
   if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='z'){
     const targetEl=e.target instanceof HTMLElement?e.target:null;
     if(undoToastRef.current&&!isTextEntryElement(e.target)&&!targetEl?.closest('.annotation-note-editor')&&!document.querySelector('[role="dialog"]:not(.media-viewer)')){
       e.preventDefault();
       void triggerUndo();
       return;
     }
   }
   if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='k'){
     if(document.querySelector('[role="dialog"]'))return;
     const input=document.querySelector<HTMLInputElement>('.content .search input');
     if(!input)return;
     e.preventDefault();input.focus();input.select();
     return;
   }
   const toggleShortcutsKey=((e.key==='?'&&!e.ctrlKey&&!e.metaKey&&!e.altKey)||((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key==='/'));
   if(toggleShortcutsKey&&!isTextEntryElement(e.target)){
     const blockingDialog=document.querySelector('[role="dialog"]:not(.media-viewer):not(.shortcut-dialog)');
     if(!blockingDialog){
       e.preventDefault();
       setShortcutsOpen(prev=>!prev);
       return;
     }
   }
   if(!isTextEntryElement(e.target)&&!document.querySelector('.shortcut-dialog,[role="menu"]')){
     if(isAnnotationToggleShortcut(e)){
       const scope=document.querySelector('.media-viewer')||document.querySelector('[role="dialog"]');
       const btn=scope?.querySelector<HTMLButtonElement>('.annotation-toolbar button[data-action="add-annotation"]');
       if(btn){e.preventDefault();e.stopPropagation();btn.click();return}
     }
     if(isTimelineToggleShortcut(e)){
       const scope=document.querySelector('.media-viewer')||document.querySelector('[role="dialog"]');
       const btn=scope?.querySelector<HTMLButtonElement>('.annotation-toolbar button[data-action="toggle-timeline"]');
       if(btn){e.preventDefault();e.stopPropagation();btn.click()}
     }
   }
 };
 useEffect(()=>{window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 useEffect(()=>{
   if(view!=='Canvas'||canvasMode!=='discover')return;
   const syncVisited=()=>{try{setCanvasVisited(JSON.parse(localStorage.getItem('sightline-study-visited')||'{}'))}catch{setCanvasVisited({})}};
   syncVisited();
   window.addEventListener('focus',syncVisited);
   let live=true;
   setCanvasDiscoverLoading(true);
   const load=async()=>{
     try{
       const {sites,imageDir}=await loadDiscoverCatalog<StudySite>();
       if(!live)return;
       setCanvasDiscoverImageDir(imageDir);
       setCanvasDiscoverSites(sites);
     }catch(e){
       if(live)setError('Could not load the website catalog: '+String(e));
     }finally{
       if(live)setCanvasDiscoverLoading(false);
     }
   };
   void load();
   return()=>{live=false;window.removeEventListener('focus',syncVisited)};
 },[view,canvasMode]);
 useEffect(()=>{
   if(!canvasDiscoverSites.length||!sources.length)return;
   const keys=new Set(sources.flatMap(source=>source.assets.flatMap(asset=>[inspirationUrlKey(source.url),inspirationUrlKey(asset.sourceUrl||'')])).filter(Boolean));
   setCanvasVisited(previous=>{
     const next={...previous};
     let changed=false;
     for(const site of canvasDiscoverSites){
       if(next[site.url]===undefined&&keys.has(inspirationUrlKey(site.url))){next[site.url]=true;changed=true}
     }
     if(!changed)return previous;
     try{localStorage.setItem('sightline-study-visited',JSON.stringify(next))}catch{}
     return next;
   });
 },[canvasDiscoverSites,sources]);
 const toggleCanvasVisited=(url:string,label?:string)=>{
   const prev=canvasVisitedRef.current;
   const hadKey=Object.prototype.hasOwnProperty.call(prev,url);
   const prevVal=prev[url];
   const nextVal=!prevVal;
   const next={...prev,[url]:nextVal};
   canvasVisitedRef.current=next;
   setCanvasVisited(next);
   try{localStorage.setItem('sightline-study-visited',JSON.stringify(next))}catch{setError('Could not save visit status.')}
   const name=label||canvasDiscoverSites.find(s=>s.url===url)?.title||displayUrl(url);
   pushUndo(nextVal?`Marked "${name}" as visited`:`Marked "${name}" as unvisited`,()=>{
     let current:Record<string,boolean>={};
     try{current=JSON.parse(localStorage.getItem('sightline-study-visited')||'{}')}catch{current={...canvasVisitedRef.current}}
     if(hadKey)current[url]=prevVal;else delete current[url];
     canvasVisitedRef.current=current;
     setCanvasVisited(current);
     try{localStorage.setItem('sightline-study-visited',JSON.stringify(current))}catch{setError('Could not save visit status.')}
   });
 };
 const removeCanvasDiscoverSite=(site:StudySite)=>{
   const url=site.url;
   try{
     const removed=JSON.parse(localStorage.getItem('sightline-study-removed')||'{}') as Record<string,boolean>;
     removed[url]=true;
     localStorage.setItem('sightline-study-removed',JSON.stringify(removed));
   }catch{setError('Could not save this change.');return}
   setCanvasRemovedVersion(v=>v+1);
   pushUndo(`Removed "${site.title}" from Discover`,()=>{
     try{
       const removed=JSON.parse(localStorage.getItem('sightline-study-removed')||'{}') as Record<string,boolean>;
       delete removed[url];
       localStorage.setItem('sightline-study-removed',JSON.stringify(removed));
     }catch{setError('Could not restore website.');return}
     setCanvasRemovedVersion(v=>v+1);
   });
 };
 const [reorderUi,setReorderUi]=useState<{dragId:string;overId:string|null;after:boolean}|null>(null);
 const suppressAssetClickRef=useRef(false);
 function startAssetPointerDrag(e:React.PointerEvent<HTMLElement>,sourceId:string,dragId:string,axis:'x'|'y',onCommit:(sourceId:string,dragId:string,targetId:string,after:boolean)=>void){
   if(e.button!==0)return;
   if((e.target as HTMLElement|null)?.closest('.reveal-asset,.remove-asset'))return;
   const containerEl=e.currentTarget.parentElement;
   if(!containerEl)return;
   const startX=e.clientX,startY=e.clientY;
   let active=false,overId:string|null=null,after=false;
   const pickTarget=(cx:number,cy:number)=>{
     const nodes=Array.from(containerEl.querySelectorAll<HTMLElement>('[data-reorder-id]'));
     if(!nodes.length)return null;
     const coord=axis==='x'?cx:cy;
     let bestId:string|null=null,bestAfter=false,bestDist=Infinity;
     for(const node of nodes){
       const id=node.dataset.reorderId;
       if(!id)continue;
       const r=node.getBoundingClientRect();
       const start=axis==='x'?r.left:r.top;
       const end=axis==='x'?r.right:r.bottom;
       const mid=(start+end)/2;
       const dist=coord<start?start-coord:coord>end?coord-end:0;
       if(dist<bestDist){
         bestDist=dist;
         bestId=id;
         bestAfter=coord>mid;
         if(dist===0)break;
       }
     }
     return bestId?{id:bestId,after:bestAfter}:null;
   };
   const onMove=(ev:PointerEvent)=>{
     if(!active){
       if(Math.hypot(ev.clientX-startX,ev.clientY-startY)<5)return;
       active=true;
       suppressAssetClickRef.current=true;
       document.body.classList.add('reordering-assets');
     }
     const target=pickTarget(ev.clientX,ev.clientY);
     overId=target?.id??null;
     after=target?.after??false;
     setReorderUi(prev=>(prev?.dragId===dragId&&prev?.overId===overId&&prev?.after===after)?prev:{dragId,overId,after});
   };
   const cleanup=(commit:boolean)=>{
     window.removeEventListener('pointermove',onMove);
     window.removeEventListener('pointerup',onUp);
     window.removeEventListener('pointercancel',onCancel);
     document.body.classList.remove('reordering-assets');
     setReorderUi(null);
     if(active){
       window.setTimeout(()=>{suppressAssetClickRef.current=false},0);
       if(commit&&overId&&overId!==dragId)onCommit(sourceId,dragId,overId,after);
     }
   };
   const onUp=()=>cleanup(true);
   const onCancel=()=>cleanup(false);
   window.addEventListener('pointermove',onMove);
   window.addEventListener('pointerup',onUp);
   window.addEventListener('pointercancel',onCancel);
 }
 const [draft,setDraft]=useState({title:'',url:'',category:'Web design',tags:'',notes:''});
 useEffect(()=>{
   if(!preview||editing||instagramOpen||addInspirationOpen||addFontOpen||shortcutsOpen||!!confirmTrashAction)return;
   const previous=lastWorkspaceFocus.current;
   const dialog=document.querySelector<HTMLElement>('.media-viewer');if(!dialog)return;
   const selector='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"],summary';
   const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(el=>el.getClientRects().length>0);
   const background=Array.from(document.querySelectorAll<HTMLElement>('.app > .sidebar,.app > .main'));
   background.forEach(el=>el.inert=true);
   if(!dialog.contains(document.activeElement))(dialog.querySelector<HTMLElement>('[autofocus]')||focusable()[0])?.focus();
   const key=(event:KeyboardEvent)=>{
     if(event.key==='Escape'&&!event.defaultPrevented){
       if(document.querySelector('.reference-context,[role="menu"]'))return;
       const activeTarget=(event.target instanceof HTMLElement?event.target:null)||((document.activeElement instanceof HTMLElement)?document.activeElement:null);
       if(activeTarget&&dialog.contains(activeTarget)&&isTextEntryElement(activeTarget)&&!activeTarget.closest('.annotation-note-editor')){
         event.preventDefault();
         activeTarget.blur();
         return;
       }
       event.preventDefault();if(editing)setEditing(false);else if(instagramOpen&&!instagramBusy)setInstagramOpen(false);else if(preview)closePreview();return
     }
     if(!isTextEntryElement(event.target)){
       if(isAnnotationToggleShortcut(event)){
         const btn=dialog.querySelector<HTMLButtonElement>('.annotation-toolbar button[data-action="add-annotation"]');
         if(btn){event.preventDefault();event.stopPropagation();btn.click();return}
       }
       if(isTimelineToggleShortcut(event)){
         const btn=dialog.querySelector<HTMLButtonElement>('.annotation-toolbar button[data-action="toggle-timeline"]');
         if(btn){event.preventDefault();event.stopPropagation();btn.click();return}
       }
       const target=event.target as HTMLElement|null;
       if(preview.kind==='video'&&viewerVideoRef.current&&!target?.closest('.annotation-note-editor')){
         const video=viewerVideoRef.current;
         if((event.key===','||event.key==='<'||event.key==='.'||event.key==='>')&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
           event.preventDefault();
           video.pause();
           const step=(event.shiftKey?10:1)/60;
           const dir=(event.key==='.'||event.key==='>')?1:-1;
           const maxDur=Number.isFinite(video.duration)?video.duration:Infinity;
           video.currentTime=Math.max(0,Math.min(maxDur,video.currentTime+dir*step));
           return;
         }
         if((event.key==='Home'||event.key==='End')&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!target?.closest('.viewer-strip,.asset-list')){
           event.preventDefault();
           video.currentTime=event.key==='Home'?0:(Number.isFinite(video.duration)?video.duration:0);
           return;
         }
       }
     }
     if((event.key==='ArrowLeft'||event.key==='ArrowRight')&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
       const target=event.target as HTMLElement|null;
       if(!target||(!target.isContentEditable&&!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)&&!target.closest('[role="slider"],.annotation-note-editor,.plyr__controls,.annotation-video-track'))){
         const owner=sourcesRef.current.find(s=>!s.trashedAt&&s.assets.some(a=>!a.trashedAt&&a.id===preview.id));
         const visuals=owner?.assets.filter(a=>!a.trashedAt&&(a.kind==='image'||a.kind==='video'))||[];
         const index=visuals.findIndex(a=>a.id===preview.id);
         if(index>=0&&visuals.length>1){
           event.preventDefault();
           const next=visuals[(index+(event.key==='ArrowRight'?1:visuals.length-1))%visuals.length];
           setPreview(next);
           return;
         }
       }
     }
     if(event.key!=='Tab')return;
     const items=focusable(),first=items[0],last=items[items.length-1];
     if(!first){event.preventDefault();return}
     if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus()}
     else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus()}
   };
   document.addEventListener('keydown',key);
   return()=>{background.forEach(el=>el.inert=false);document.removeEventListener('keydown',key);if(!previewOpenRef.current&&previous?.isConnected)previous.focus()};
 },[editing,instagramOpen,addInspirationOpen,addFontOpen,shortcutsOpen,!!confirmTrashAction,preview?.id,preview?.kind,instagramBusy]);

 useEffect(()=>{if(!native()){setReady(true);return} invoke<string>('get_library').then(async p=>{const loaded=JSON.parse(await invoke<string>('load_library')) as Source[];setRoot(p);rootRef.current=p;setSources(loaded);sourcesRef.current=loaded;}).catch(e=>{if(!String(e).includes('Choose a library folder first'))setError('Could not open the library: '+String(e))}).finally(()=>setReady(true))},[]);
 async function flushPendingWrites():Promise<boolean>{const ok=await writeQueue.current;if(ok)return true;if(!rootRef.current)return false;return save(sourcesRef.current,true)}
 async function chooseLibrary(){
   if(!native()){setError('Open Sightline on your desktop to choose a local library. You can browse Discover here.');return}
   if(importing.current){setError('A capture is being imported. Try changing folders again in a moment.');return}
   switching.current=true;
   try{
     const p=await open({directory:true,multiple:false,title:'Choose your Sightline library folder'});if(!p)return;
     if(rootRef.current&&!await flushPendingWrites()){setError('Save your pending changes before switching libraries.');return}
     await invoke('set_library',{path:p});
     const loaded=JSON.parse(await invoke<string>('load_library')) as Source[];
     writeQueue.current=Promise.resolve(true);
     setRoot(p);rootRef.current=p;setSources(loaded);sourcesRef.current=loaded;setSelected(null);closePreview();setError('');
   }catch(e){setError(String(e))}finally{switching.current=false}
 }

 const backupUiKeys=['sightline-study-visited','sightline-study-removed','sightline-grid-view','sightline-instagram-config','sightline-library-category','sightline-canvas-mode','sightline-canvas-minimized','sightline-canvas-loop','sightline:library-filters','sightline:discover-filters'];
 async function driveBackup(){if(!root||backupBusy||importing.current||switching.current)return;const folder=await open({directory:true,multiple:false,title:'Choose a Google Drive for desktop folder for Sightline backups'});if(!folder)return;switching.current=true;setBackupBusy(true);setBackupStatus('Creating backup...');try{if(!await flushPendingWrites())throw Error('Save pending library changes before backing up.');const state:Record<string,string>={};for(const key of backupUiKeys){const value=localStorage.getItem(key);if(value!==null)state[key]=value}await invoke<string>('backup_to_drive',{folder,uiState:JSON.stringify(state)});setBackupStatus('Backup created. Google Drive for desktop will upload it if the folder is synced.')}catch(e){setError('Backup failed: '+String(e));setBackupStatus('')}finally{switching.current=false;setBackupBusy(false)}}
 async function driveRestore(){if(backupBusy||importing.current||switching.current)return;const snapshot=await open({directory:true,multiple:false,title:'Choose a completed Sightline backup folder'});if(!snapshot)return;const target=await open({directory:true,multiple:false,title:'Choose an empty local folder for the restored library'});if(!target)return;switching.current=true;setBackupBusy(true);setBackupStatus('Restoring backup...');try{if(rootRef.current&&!await flushPendingWrites())throw Error('Save pending library changes before restoring.');const result=await invoke<{libraryPath:string;uiState:string}>('restore_drive_backup',{snapshot,target});const state=JSON.parse(result.uiState) as Record<string,string>;for(const key of backupUiKeys){if(typeof state[key]==='string')localStorage.setItem(key,state[key]);else localStorage.removeItem(key)}try{setInstagramConfig({...{postIdeas:'',webDesign:''},...JSON.parse(state['sightline-instagram-config']||'{}')})}catch{setInstagramConfig({postIdeas:'',webDesign:''})}const savedCat=state['sightline-library-category'];setLibraryCategory(savedCat&&['All',...categories].includes(savedCat)?savedCat:'All');setCanvasMode(state['sightline-canvas-mode']==='discover'?'discover':'library');setCanvasMinimized(state['sightline-canvas-minimized']==='true');setCanvasInfiniteLoop(state['sightline-canvas-loop']!=='false');const loaded=JSON.parse(await invoke<string>('load_library')) as Source[];writeQueue.current=Promise.resolve(true);rootRef.current=result.libraryPath;setRoot(result.libraryPath);sourcesRef.current=loaded;setSources(loaded);setSelected(null);closePreview();setView('Library');setBackupStatus('Backup restored. Your original library folder was left in place.')}catch(e){setError('Restore failed: '+String(e));setBackupStatus('')}finally{switching.current=false;setBackupBusy(false)}}
 async function save(next:Source[], retryPending=false):Promise<boolean>{
   if(trashBusyRef.current&&!retryPending){setError('Trash is updating. Try the library change again in a moment.');return false}
   if(!rootRef.current){setError('Choose a library folder first.');return false}
   sourcesRef.current=next;setSources(next);
   const operation=writeQueue.current.then(async()=>{try{await invoke('save_library',{data:JSON.stringify(next,null,2)});setError('');return true}catch(e){setError('Could not save the library. Changes remain on screen: '+String(e));return false}});
   writeQueue.current=operation;return operation;
 }
 function saveDiscoverSite(site:StudySite,navigateIfExisting=false){
   if(!root){setError('Choose a library folder first to save references from Discover.');return}
   const existing=sourcesRef.current.find(s=>!s.trashedAt&&sameSource(s.url,site.url));
   if(existing){
     if(navigateIfExisting){
       if(libraryCategory!=='All'&&existing.category!==libraryCategory){setLibraryCategory('All');try{localStorage.setItem('sightline-library-category','All')}catch{}}
       setSelected(existing.id);setView('Library');
     }
     return;
   }
   const item:Source={id:uid(),title:site.title,url:site.url,category:'Web design',tags:site.tags.slice(0,5),notes:'',assets:[],x:Math.max(100,...sourcesRef.current.map(s=>s.x+Math.max(700,480+Math.ceil(s.assets.length/2)*220))),y:100,created:new Date().toISOString()};
   item.folder=sourceFolder(item,sourcesRef.current);
   void save([item,...sourcesRef.current]);
 }
 useEffect(()=>{
   if(!root||!native())return;
   let alive=true;
   const process=async()=>{
     if(importing.current||switching.current||trashBusyRef.current)return;importing.current=true;
     try{
       const captures=await invoke<Capture[]>('pending_captures');
       for(const capture of captures){
         if(!alive)break;
         let current=sourcesRef.current;
         if(current.some(s=>s.assets.some(a=>a.id===capture.id))){if(await save(current))await invoke('acknowledge_capture',{capture});else break;continue}
         const foundPre=capture.url?current.find(s=>!s.trashedAt&&sameSource(s.url,capture.url)):undefined;
         const draftSource:Source=foundPre||{id:uid(),title:capture.title||'Untitled capture',url:capture.url,category:categories.includes(capture.category||'')?capture.category!:'Web design',tags:[],notes:'',assets:[],x:Math.max(100,...current.map(s=>s.x+Math.max(700,480+Math.ceil(s.assets.length/2)*220))),y:100,created:new Date().toISOString()};
         const folder=sourceFolder(draftSource,current);
         const file=await invoke<string>('import_capture',{capture,folder});
         const info=capture.kind==='font'?{thumbnail:null,palette:[]}:await invoke<{thumbnail:string|null;palette:string[]}>('prepare_preview',{file}).catch(()=>null);
         current=sourcesRef.current;
         const found=capture.url?current.find(s=>!s.trashedAt&&sameSource(s.url,capture.url)):undefined;
         const fontFields=capture.kind==='font'?capturedFontAssetFields({...capture,file}):undefined;
         const asset:Asset={id:capture.id,name:capture.kind==='font'?(capture.name||fontFields?.family||'Font'):capture.kind==='video'?'Recorded clip':(capture.name||'Screenshot'),file,kind:capture.kind,sourceUrl:capture.url,tags:capture.tags||[],notes:capture.notes||'',annotations:capture.annotations||[],...(fontFields||{}),thumbnail:info?.thumbnail||undefined};
         const next=found?current.map(s=>s.id===found.id?{...s,folder:s.folder||folder,assets:[...s.assets,asset]}:s):[{...draftSource,folder,assets:[asset]},...current];
         if(await save(next)){if(asset.kind==='video')setSavedClip(asset);await invoke('acknowledge_capture',{capture})}else break;
       }
       const ids=await invoke<string[]>('capture_open_requests');
       for(const id of ids){
         const asset=sourcesRef.current.filter(s=>!s.trashedAt).flatMap(s=>s.assets).find(a=>a.id===id&&!a.trashedAt);
         if(asset&&await invoke<boolean>('take_capture_open_request',{id})&&alive){setPreview(asset);setSavedClip(null)}
       }
     }catch(e){if(alive)setError('Capture import failed: '+String(e))}finally{importing.current=false}
   };
   void process();const timer=window.setInterval(process,4000);return()=>{alive=false;clearInterval(timer)};
 },[root]);

 useEffect(()=>{if(!root||!native())return;for(const source of sources){if(!source.url||source.favicon)continue;const key=`${root}:${source.id}:${source.url}`;if(faviconAttempts.current.has(key))continue;faviconAttempts.current.add(key);void invoke<string>('fetch_favicon',{sourceId:source.id,sourceUrl:source.url}).then(name=>{if(rootRef.current!==root)return;const current=sourcesRef.current.find(s=>s.id===source.id);if(current&&current.url===source.url&&!current.favicon)void save(sourcesRef.current.map(s=>s.id===source.id?{...s,favicon:name}:s))}).catch(()=>{})}},[root,sources]);
 const mediaBackfillKey=useMemo(()=>sources.reduce((n,s)=>n+s.assets.filter(a=>a.kind==='video'&&(!a.thumbnail||!a.previewVideo?.endsWith('.v2.mp4'))).length,0),[sources]);
 useEffect(()=>{if(!root||!native())return;let cancelled=false;
   const pending=sourcesRef.current.flatMap(s=>s.assets.filter(a=>a.kind==='video'&&(!a.thumbnail||!a.previewVideo?.endsWith('.v2.mp4'))&&!thumbBackfillTried.current.has(a.id)).map(a=>({sourceId:s.id,id:a.id,file:a.file,needThumb:!a.thumbnail,needPreview:!a.previewVideo?.endsWith('.v2.mp4')})));
   if(!pending.length)return;
   void (async()=>{for(const item of pending){
     if(cancelled||rootRef.current!==root)break;
     thumbBackfillTried.current.add(item.id);
     let thumbnail:string|undefined;let previewVideo:string|undefined;
     if(item.needThumb){try{thumbnail=(await invoke<{thumbnail:string|null;palette:string[]}>('prepare_preview',{file:item.file})).thumbnail||undefined}catch{ /* Retry on the next launch. */ }}
     if(item.needPreview){try{previewVideo=(await invoke<string|null>('prepare_video_proxy',{file:item.file}))||undefined}catch{ /* Falls back to the original file. */ }}
     if(rootRef.current!==root)break;
     if(thumbnail||previewVideo)await save(sourcesRef.current.map(s=>s.id===item.sourceId?{...s,assets:s.assets.map(a=>a.id===item.id?{...a,...(!a.thumbnail&&thumbnail?{thumbnail}:{}),...(previewVideo?{previewVideo}:{})}:a)}:s));
   }})();
   return()=>{cancelled=true}},[root,ready,mediaBackfillKey]);

 function reorderThumbnails(sourceId:string,dragId:string,targetId:string,after:boolean){
   void save(sourcesRef.current.map(source=>source.id===sourceId?reorderSourceAssets(source,dragId,targetId,after):source));
 }
 function setCover(sourceId:string,assetId:string){void save(sourcesRef.current.map(s=>s.id===sourceId?{...s,coverId:assetId}:s))}
 async function create(){const rawUrl=draft.url.trim();const normalizedUrl=rawUrl?safeHttpUrl(rawUrl):'';if(rawUrl&&!normalizedUrl){setFormError('Enter a valid http:// or https:// URL.');return}if(!draft.title.trim()&&!normalizedUrl&&draft.category!=='Post Ideas')return;setFormError('');if(editingId){const nextTitle=draft.title.trim()||(normalizedUrl?displayUrl(normalizedUrl):'Untitled idea');const nextUrl=normalizedUrl||'';let list=sourcesRef.current;const target=list.find(s=>s.id===editingId);if(target&&(target.title!==nextTitle||target.url!==nextUrl)){const oldFolder=sourceFolder(target,list);const usedFolders=list.filter(s=>s.id!==editingId).map(s=>sourceFolder(s,list));let newFolder=oldFolder;if(native()){try{newFolder=await invoke<string>('rename_source_folder',{oldFolder,newTitle:nextTitle,url:nextUrl,sourceId:editingId,usedFolders})}catch(e){setError(String(e));return}}else{newFolder=sourceFolder({...target,folder:undefined,title:nextTitle,url:nextUrl},list)}list=renameFolderReferences(list,editingId,oldFolder,newFolder)}void save(list.map(s=>s.id===editingId?{...s,title:nextTitle,url:nextUrl,favicon:s.url===nextUrl?s.favicon:undefined,category:draft.category,tags:draft.tags.split(',').map(t=>t.trim()).filter(Boolean),notes:draft.notes}:s));setEditingId(null);setEditing(false);return}const item:Source={id:uid(),title:draft.title.trim()||(normalizedUrl?displayUrl(normalizedUrl):'Untitled idea'),url:normalizedUrl||'',category:draft.category,tags:draft.tags.split(',').map(t=>t.trim()).filter(Boolean),notes:draft.notes,assets:[],x:Math.max(100,...sources.map(s=>s.x+Math.max(700,480+Math.ceil(s.assets.length/2)*220))),y:100,created:new Date().toISOString()};item.folder=sourceFolder(item,sourcesRef.current);const saved=await save([item,...sourcesRef.current]);setSelected(item.id);setEditing(false);setDraft({title:'',url:'',category:'Web design',tags:'',notes:''});if(saved&&item.category==='Post Ideas'&&/^https:\/\/(?:www\.)?(?:instagram\.com|pinterest\.com|pin\.it|x\.com|twitter\.com)(?:[\/:?#]|$)/i.test(item.url))void downloadPost(item)}
 const active=sources.find(s=>s.id===selected);
 async function importFiles(sourceId:string, files:File[]){if(importing.current||switching.current){setError('Another import or library action is in progress. Please try again in a moment.');return}importing.current=true;try{const owner=sourcesRef.current.find(s=>s.id===sourceId);const folder=owner?sourceFolder(owner,sourcesRef.current):undefined;for(const input of files){const ext=getFileExtension(input.name);const isFont=isFontFilename(input.name);if(!isFont&&!['png','jpg','jpeg','webp','gif','svg','mp4','webm','mov','mkv'].includes(ext)){setError(`Unsupported file: ${input.name}`);break}const kind:Asset['kind']=['mp4','mov','webm','mkv'].includes(ext)?'video':isFont?'font':'image';const file=await invoke<string>('import_asset_bytes',{name:input.name,bytes:Array.from(new Uint8Array(await input.arrayBuffer())),folder});const info=kind==='font'?{thumbnail:null,palette:[]}:await invoke<{thumbnail:string|null;palette:string[]}>('prepare_preview',{file}).catch(()=>null);const fontMeta=kind==='font'?parseFontFilenameMeta(input.name):null;const item:Asset={id:uid(),name:input.name,file,kind,tags:[],notes:'',...(fontMeta?{family:fontMeta.family,weight:fontMeta.weight,style:fontMeta.style,fontSource:'upload' as const}:{}),thumbnail:info?.thumbnail||undefined};if(!await save(sourcesRef.current.map(s=>s.id===sourceId?{...s,folder:s.folder||folder,assets:[...s.assets,item]}:s)))break}}catch(e){setError(String(e))}finally{importing.current=false}}
 async function addFiles(sourceId=active?.id){if(!sourceId)return;if(importing.current||switching.current){setError('Another import or library action is in progress. Please try again in a moment.');return}importing.current=true;try{const owner=sourcesRef.current.find(s=>s.id===sourceId);const folder=owner?sourceFolder(owner,sourcesRef.current):undefined;const paths=await open({multiple:true,directory:false,filters:[{name:'Images, video and fonts',extensions:['png','jpg','jpeg','webp','gif','svg','mp4','webm','mov','mkv',...FONT_EXTENSIONS]}]});if(!paths)return;for(const path of paths as string[]){const name=path.split(/[\\/]/).pop()||'Untitled';const ext=getFileExtension(name);const isFont=isFontFilename(name);const kind:Asset['kind']=['mp4','mov','webm','mkv'].includes(ext)?'video':isFont?'font':'image';const file=await invoke<string>('import_asset',{path,folder});const info=kind==='font'?{thumbnail:null,palette:[]}:await invoke<{thumbnail:string|null;palette:string[]}>('prepare_preview',{file}).catch(()=>null);const fontMeta=kind==='font'?parseFontFilenameMeta(name):null;const item:Asset={id:uid(),name,file,kind,tags:[],notes:'',...(fontMeta?{family:fontMeta.family,weight:fontMeta.weight,style:fontMeta.style,fontSource:'upload' as const}:{}),thumbnail:info?.thumbnail||undefined};if(!await save(sourcesRef.current.map(s=>s.id===sourceId?{...s,folder:s.folder||folder,assets:[...s.assets,item]}:s)))break}}catch(e){setError(String(e))}finally{importing.current=false}}
 async function saveNewInspiration(payload:AddInspirationPayload){
   if(!rootRef.current){setError('Choose a library folder first.');return}
   if(importing.current||switching.current){setError('Another import or library action is in progress. Please try again in a moment.');return}
   importing.current=true;setInspirationSaving(true);
   try{
     const id=uid();
     const draftSource:Source={id,title:payload.title,url:payload.url,category:payload.category,tags:payload.tags,notes:payload.notes,assets:[],x:Math.max(100,...sourcesRef.current.map(s=>s.x+Math.max(700,480+Math.ceil(s.assets.length/2)*220))),y:100,created:new Date().toISOString()};
     const folder=sourceFolder(draftSource,sourcesRef.current);
     draftSource.folder=folder;
     const importedAssets:Asset[]=[];
     let mappedCoverId:string|undefined;
     for(const staged of payload.assets){
       const file=staged.nativePath
         ?await invoke<string>('import_asset',{path:staged.nativePath,folder})
         :staged.fileObj
           ?await invoke<string>('import_asset_bytes',{name:staged.name,bytes:Array.from(new Uint8Array(await staged.fileObj.arrayBuffer())),folder})
           :'';
       if(!file)continue;
       const info=await invoke<{thumbnail:string|null;palette:string[]}>('prepare_preview',{file}).catch(()=>null);
       const assetId=uid();
       if(payload.coverId===staged.id)mappedCoverId=assetId;
       importedAssets.push({id:assetId,name:staged.name,file,kind:staged.kind,tags:staged.tags,notes:staged.notes,annotations:staged.annotations,thumbnail:info?.thumbnail||undefined});
     }
     draftSource.assets=importedAssets;
     if(mappedCoverId)draftSource.coverId=mappedCoverId;
     const ok=await save([draftSource,...sourcesRef.current]);
     if(ok){
       if(libraryCategory!=='All'&&draftSource.category!==libraryCategory){setLibraryCategory('All');try{localStorage.setItem('sightline-library-category','All')}catch{}}
       setSelected(draftSource.id);
       setAddInspirationOpen(false);
       if(draftSource.category==='Post Ideas'&&draftSource.url&&/^https:\/\/(?:www\.)?(?:instagram\.com|pinterest\.com|pin\.it|x\.com|twitter\.com)(?:[\/:?#]|$)/i.test(draftSource.url))void downloadPost(draftSource);
     }
   }catch(e){setError(String(e))}finally{importing.current=false;setInspirationSaving(false)}
 }
 function ensureFontSource(family:string,url='',tags:string[]=[],notes=''){
   const existing=sourcesRef.current.find(s=>!s.trashedAt&&s.title.toLowerCase()===family.toLowerCase()&&s.assets.some(a=>a.kind==='font'));
   if(existing){return {source:existing,isNew:false,folder:sourceFolder(existing,sourcesRef.current)}}
   const draftSource:Source={id:uid(),title:family,url,category:'Other',tags,notes,assets:[],x:Math.max(100,...sourcesRef.current.map(s=>s.x+Math.max(700,480+Math.ceil(s.assets.length/2)*220))),y:100,created:new Date().toISOString()};
   const folder=sourceFolder(draftSource,sourcesRef.current);
   draftSource.folder=folder;
   return {source:draftSource,isNew:true,folder};
 }
 async function importGoogleFontHandler(family:string,variants:string[]){
   if(!rootRef.current)throw new Error('Choose a library folder first.');
   if(importing.current||switching.current)throw new Error('Another import is currently in progress.');
   importing.current=true;
   try{
     const url=`https://fonts.google.com/specimen/${encodeURIComponent(family).replace(/%20/g,'+')}`;
     const target=ensureFontSource(family,url,['Google Fonts']);
     const imported=await invoke<Array<{file:string;name:string;family:string;weight:number;style:string}>>('import_google_font',{family,variants,folder:target.folder});
     const newAssets:Asset[]=imported.map(v=>({id:uid(),name:v.name,file:v.file,kind:'font',family:v.family,weight:v.weight,style:v.style==='italic'?'italic':'normal',fontSource:'google',sourceUrl:url,tags:['Google Fonts'],notes:''}));
     const next=target.isNew
       ?[{...target.source,assets:newAssets},...sourcesRef.current]
       :sourcesRef.current.map(s=>s.id===target.source.id?{...s,folder:s.folder||target.folder,assets:[...s.assets,...newAssets]}:s);
     await save(next);
   }finally{importing.current=false}
 }
 async function importSystemFontHandler(family:string,variants:SystemFontVariant[]){
   if(!rootRef.current)throw new Error('Choose a library folder first.');
   if(importing.current||switching.current)throw new Error('Another import is currently in progress.');
   importing.current=true;
   try{
     const target=ensureFontSource(family,'',['System Font']);
     const newAssets:Asset[]=[];
     for(const v of variants){
       const file=await invoke<string>('import_system_font',{path:v.path,folder:target.folder});
       newAssets.push({id:uid(),name:v.fullName||`${family} ${v.weight}`,file,kind:'font',family:v.family||family,weight:v.weight,style:v.style==='italic'?'italic':'normal',fontSource:'local',tags:['System Font'],notes:''});
     }
     const next=target.isNew
       ?[{...target.source,assets:newAssets},...sourcesRef.current]
       :sourcesRef.current.map(s=>s.id===target.source.id?{...s,folder:s.folder||target.folder,assets:[...s.assets,...newAssets]}:s);
     await save(next);
   }finally{importing.current=false}
 }
 async function importManualFontFilesHandler(payload:{family:string;tags:string[];notes:string;rows:Array<{name:string;weight:number;style:'normal'|'italic';fileObj?:File;nativePath?:string}>}){
   if(!rootRef.current)throw new Error('Choose a library folder first.');
   if(importing.current||switching.current)throw new Error('Another import is currently in progress.');
   importing.current=true;
   try{
     const target=ensureFontSource(payload.family,'',payload.tags,payload.notes);
     const newAssets:Asset[]=[];
     for(const row of payload.rows){
       const file=row.nativePath
         ?await invoke<string>('import_asset',{path:row.nativePath,folder:target.folder})
         :row.fileObj
           ?await invoke<string>('import_asset_bytes',{name:row.name,bytes:Array.from(new Uint8Array(await row.fileObj.arrayBuffer())),folder:target.folder})
           :'';
       if(!file)continue;
       newAssets.push({id:uid(),name:row.name,file,kind:'font',family:payload.family,weight:row.weight,style:row.style,fontSource:'upload',tags:payload.tags,notes:payload.notes});
     }
     if(!newAssets.length)throw new Error('No font files were imported.');
     const next=target.isNew
       ?[{...target.source,assets:newAssets},...sourcesRef.current]
       :sourcesRef.current.map(s=>s.id===target.source.id?{...s,folder:s.folder||target.folder,tags:Array.from(new Set([...s.tags,...payload.tags])),notes:s.notes||payload.notes,assets:[...s.assets,...newAssets]}:s);
     await save(next);
   }finally{importing.current=false}
 }
 useEffect(()=>{if(!preview)return;const owner=sourcesRef.current.find(s=>s.assets.some(a=>a.id===preview.id));if(!owner)return;const paste=(e:ClipboardEvent)=>{const target=e.target as HTMLElement;if(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))return;const files=Array.from(e.clipboardData?.files||[]);if(files.length){e.preventDefault();void importFiles(owner.id,files)}};window.addEventListener('paste',paste);return()=>window.removeEventListener('paste',paste)},[preview?.id]);
 async function downloadPost(source:Source,useBrave=false):Promise<boolean>{if(!source.url||downloading)return false;setDownloading(true);const library=rootRef.current;try{const folder=sourceFolder(source,sourcesRef.current);const files=await invoke<string[]>('download_post_media',{sourceUrl:source.url,useBrave,folder});if(rootRef.current!==library)return false;const assets:Asset[]=[];for(const file of files){const kind=/\.(mp4|mov|webm|mkv)$/i.test(file)?'video':'image';const info=await invoke<{thumbnail:string|null;palette:string[]}>('prepare_preview',{file}).catch(()=>null);assets.push({id:uid(),name:kind==='video'?'Post video':'Post image',file,kind,sourceUrl:source.url,tags:[],notes:'',thumbnail:info?.thumbnail||undefined})}return await save(sourcesRef.current.map(s=>s.id===source.id?{...s,folder:s.folder||folder,assets:[...s.assets,...assets]}:s))}catch(e){setError('Post saved. '+String(e));return false}finally{setDownloading(false)}}
 async function syncInstagram(queueOnly=false){if(!root||instagramBusy||importing.current||switching.current)return;let collections=[{name:'post-ideas',category:'Post Ideas',url:instagramConfig.postIdeas.trim()},{name:'web-design',category:'Web design',url:instagramConfig.webDesign.trim()}].filter(c=>c.url);try{collections=collections.map(c=>{const url=new URL(c.url);if(url.hostname==='instagram.com')url.hostname='www.instagram.com';return {...c,url:url.toString()}})}catch{setInstagramStatus('Enter valid Instagram saved collection links.');return}if(!collections.length){setInstagramStatus('Add at least one saved collection link.');return}try{localStorage.setItem('sightline-instagram-config',JSON.stringify(instagramConfig))}catch{}importing.current=true;setInstagramBusy(true);setInstagramStatus('Checking saved collections...');try{const state=await invoke<{posts:Record<string,{url:string;category:string;collection:string;collection_url?:string;status:string}>;collections:Record<string,{status:string}>}|null>(queueOnly?'load_instagram_queue':'scan_instagram_collections',queueOnly?{}:{collections});if(!state)return;const failed=!queueOnly&&collections.some(c=>state.collections[c.name]?.status!=='complete');if(failed){setInstagramStatus('Could not read a collection. Sign in to Instagram in Brave and check your gallery-dl setup, then retry.');return}const pending=Object.entries(state.posts).filter(([,post])=>post.status==='pending'&&collections.some(c=>c.name===post.collection&&c.category===post.category&&(!post.collection_url||c.url===post.collection_url)));let imported=0;for(const [key,post] of pending.slice(0,10)){setInstagramStatus(`Importing ${imported+1} of ${Math.min(pending.length,10)}...`);let source=sourcesRef.current.find(s=>s.category===post.category&&(s.url===post.url||sameInstagramPost(s.url,post.url)));if(source?.trashedAt){await invoke('acknowledge_instagram_posts',{keys:[key]});continue}if(!source){source={id:uid(),title:'Instagram post',url:post.url,category:post.category,tags:[],notes:'',assets:[],x:Math.max(100,...sourcesRef.current.map(s=>s.x+Math.max(700,480+Math.ceil(s.assets.length/2)*220))),y:100,created:new Date().toISOString()};source.folder=sourceFolder(source,sourcesRef.current);if(!await save([source,...sourcesRef.current]))throw Error('Could not save the post link.')}if(!source.assets.length&&!await downloadPost(source,true)){setInstagramStatus('Post link saved, but media could not be downloaded. Retry sync to try again.');try{localStorage.setItem('sightline-instagram-retry-after',String(Date.now()+86400000))}catch{}return}await invoke('acknowledge_instagram_posts',{keys:[key]});imported++}const remaining=Math.max(0,pending.length-10);try{localStorage.removeItem('sightline-instagram-retry-after')}catch{}setInstagramStatus(`${imported} posts imported${remaining?`; ${remaining} remain; sync again to continue`:''}.`)}catch(e){setInstagramStatus('Instagram sync failed: '+String(e))}finally{importing.current=false;setInstagramBusy(false)}}

 useEffect(()=>{if(!root||!native())return;const check=()=>{try{const stored=JSON.parse(localStorage.getItem('sightline-instagram-config')||'null');const retry=Number(localStorage.getItem('sightline-instagram-retry-after'))||0;if(!stored||(!stored.postIdeas&&!stored.webDesign)||stored.postIdeas!==instagramConfig.postIdeas||stored.webDesign!==instagramConfig.webDesign||Date.now()<retry||!navigator.onLine)return;void syncInstagram(true)}catch{}};check();window.addEventListener('online',check);const timer=window.setInterval(check,900000);return()=>{window.removeEventListener('online',check);clearInterval(timer)}},[root,instagramConfig.postIdeas,instagramConfig.webDesign]);

 useEffect(()=>{if(!root||!native()||instagramBusy)return;let cancelled=false;void invoke<{posts:Record<string,{url:string;category:string;username?:string}>}|null>('load_instagram_queue').then(async state=>{if(cancelled||!state)return;const posts=Object.values(state.posts);let next=sourcesRef.current;let changed=false;for(const source of sourcesRef.current){if(source.title!=='Instagram post')continue;const post=posts.find(p=>p.username&&p.category===source.category&&sameInstagramPost(p.url,source.url));if(!post?.username)continue;const newTitle=`@${post.username}`;const oldFolder=sourceFolder(source,next);const usedFolders=next.filter(s=>s.id!==source.id).map(s=>sourceFolder(s,next));let newFolder=oldFolder;try{newFolder=await invoke<string>('rename_source_folder',{oldFolder,newTitle,url:source.url,sourceId:source.id,usedFolders})}catch{}next=renameFolderReferences(next,source.id,oldFolder,newFolder).map(s=>s.id===source.id?{...s,title:newTitle,folder:newFolder}:s);changed=true}if(!cancelled&&changed)void save(next)}).catch(()=>{});return()=>{cancelled=true}},[root,allSources,instagramBusy]);

 const allFonts=Array.from(new Map(sources.flatMap(s=>s.assets.filter(a=>a.kind==='font').map(a=>[a.file,a] as const))).values());
 async function restoreTargets(targets:readonly TrashTarget[]){
  if(!targets.length||trashBusyRef.current)return;
  if(importing.current||switching.current){setError('A library operation is in progress. Try again in a moment.');return}
  trashBusyRef.current=true;setTrashBusy(true);
  try{
    const outcome=await restoreFromTrash(targets,sourcesRef.current,{flushPendingWrites});
    sourcesRef.current=outcome.sources;
    setSources(outcome.sources);
    if(outcome.result.warnings.length)setError(outcome.result.warnings[0]);
  }catch(e){
    setError('Could not restore from Trash: '+String(e));
  }finally{
    trashBusyRef.current=false;setTrashBusy(false);
  }
 }
 async function trashTargets(targets:readonly TrashTarget[],label?:string){
  if(!targets.length||trashBusyRef.current)return;
  if(importing.current||switching.current){setError('A library operation is in progress. Try again in a moment.');return}
  const preSources=sourcesRef.current;
  const activePreview=previewRef.current;
  const replacement=targets.length===1&&targets[0].assetId&&activePreview?.id===targets[0].assetId
    ?pickNextPreviewAfterAssetRemoval(preSources,targets[0].sourceId,targets[0].assetId,activePreview)
    :null;
  let description=label;
  if(!description){
    if(targets.length===1){
      const t=targets[0];
      const srcItem=preSources.find(s=>s.id===t.sourceId);
      const assetItem=t.assetId?srcItem?.assets.find(a=>a.id===t.assetId):undefined;
      description=assetItem?.name||srcItem?.title||'item';
    }else{
      description=`${targets.length} items`;
    }
  }
  trashBusyRef.current=true;setTrashBusy(true);
  try{
    const outcome=await trashItems(targets,preSources,{flushPendingWrites});
    sourcesRef.current=outcome.sources;
    setSources(outcome.sources);
    const activeSourcesAfter=outcome.sources.filter(s=>!s.trashedAt);
    if(selectedRef.current&&!activeSourcesAfter.some(s=>s.id===selectedRef.current))setSelected(null);
    if(activePreview){
      const stillActive=activeSourcesAfter.some(s=>s.assets.some(a=>!a.trashedAt&&a.id===activePreview.id));
      if(!stillActive){
        if(replacement&&activeSourcesAfter.some(s=>s.assets.some(a=>!a.trashedAt&&a.id===replacement.id)))setPreview(replacement);
        else closePreview();
      }
    }
    if(outcome.result.warnings.length)setError(outcome.result.warnings[0]);
    if(outcome.result.trashedCount>0){
      pushUndo(`Moved "${description}" to Trash`,()=>restoreTargets(targets));
    }
  }catch(e){
    setError('Could not move to Trash: '+String(e));
  }finally{
    trashBusyRef.current=false;setTrashBusy(false);
  }
 }
 function trashItem(sourceId:string,assetId?:string){void trashTargets([{sourceId,assetId}])}
 function restoreItem(sourceId:string,assetId?:string){void restoreTargets([{sourceId,assetId}])}
 function requestDeletePermanently(sourceId:string,assetId?:string){
  const current=sourcesRef.current;
  const targetSource=current.find(s=>s.id===sourceId);
  if(!targetSource)return;
  const targetAsset=assetId?targetSource.assets.find(a=>a.id===assetId):undefined;
  const title=targetAsset?targetAsset.name:targetSource.title;
  setConfirmTrashAction({
    kind:'delete-item',
    sourceId,
    assetId,
    title,
    isSource:!assetId,
    assetCount:targetSource.assets.length
  });
 }
 function requestClearTrash(){
  const itemCount=sourcesRef.current.reduce((sum,s)=>sum+(s.trashedAt?1:s.assets.filter(a=>Boolean(a.trashedAt)).length),0);
  if(itemCount>0)setConfirmTrashAction({kind:'clear-trash',itemCount});
 }
 async function executeConfirmedTrashAction(){
  const action=confirmTrashAction;
  if(!action||trashBusyRef.current)return;
  if(importing.current||switching.current){setError('A library operation is in progress. Try again in a moment.');return}
  trashBusyRef.current=true;setTrashBusy(true);
  try{
    if(action.kind==='delete-item'){
      const preSources=sourcesRef.current;
      const activePreview=previewRef.current;
      const replacement=action.assetId&&activePreview?.id===action.assetId
        ?pickNextPreviewAfterAssetRemoval(preSources,action.sourceId,action.assetId,activePreview)
        :null;
      const outcome=await permanentlyDeleteTrashed([{sourceId:action.sourceId,assetId:action.assetId}],preSources,{flushPendingWrites});
      sourcesRef.current=outcome.sources;
      setSources(outcome.sources);
      const activeSourcesAfter=outcome.sources.filter(s=>!s.trashedAt);
      if(selectedRef.current&&!outcome.sources.some(s=>s.id===selectedRef.current))setSelected(null);
      if(activePreview){
        const stillActive=activeSourcesAfter.some(s=>s.assets.some(a=>!a.trashedAt&&a.id===activePreview.id));
        if(!stillActive){
          if(replacement&&activeSourcesAfter.some(s=>s.assets.some(a=>!a.trashedAt&&a.id===replacement.id)))setPreview(replacement);
          else closePreview();
        }
      }
      if(outcome.result.warnings.length)setError(outcome.result.warnings[0]);
    }else{
      const outcome=await clearTrash(sourcesRef.current,{flushPendingWrites});
      sourcesRef.current=outcome.sources;
      setSources(outcome.sources);
      if(outcome.result.warnings.length)setError(outcome.result.warnings[0]);
    }
    setConfirmTrashAction(null);
  }catch(e){
    setError('Could not permanently delete from Trash: '+String(e));
  }finally{
    trashBusyRef.current=false;setTrashBusy(false);
  }
 }
 const hasExpiredTrash=useMemo(()=>allSources.some(s=>isTrashExpired(s.trashedAt)||s.assets.some(a=>isTrashExpired(a.trashedAt))),[allSources]);
 useEffect(()=>{
  if(!root||!hasExpiredTrash||trashBusyRef.current||importing.current||switching.current)return;
  trashBusyRef.current=true;
  void purgeExpiredLibraryTrash(sourcesRef.current,{flushPendingWrites}).then(outcome=>{
    if(outcome.result.deletedSources>0||outcome.result.deletedAssets>0){
      sourcesRef.current=outcome.sources;
      setSources(outcome.sources);
    }
  }).catch(error=>setError('Could not empty expired trash: '+String(error)))
    .finally(()=>{trashBusyRef.current=false});
 },[root,hasExpiredTrash,view]);
 function toggleFavorite(sourceId:string,assetId?:string){void save(favoriteItem(sourcesRef.current,sourceId,assetId));if(assetId)setPreview(current=>current?.id===assetId?{...current,favorite:!current.favorite}:current)}
 async function dropFontFiles(files:File[]){
    const fonts=files.filter(f=>isFontFilename(f.name));
    const skipped=files.length-fonts.length;
    if(!fonts.length){if(files.length)setError('Drop font files (TTF, OTF, WOFF, WOFF2, ...) to add them.');return}
    const families=new Map<string,File[]>();
    for(const file of fonts){const family=parseFontFilenameMeta(file.name).family||'Custom Font';families.set(family,[...(families.get(family)||[]),file])}
    try{
      for(const [family,group] of families)await importManualFontFilesHandler({family,tags:[],notes:'',rows:group.map(file=>{const meta=parseFontFilenameMeta(file.name);return {name:file.name,weight:meta.weight,style:meta.style,fileObj:file}})});
      if(skipped)setError(`${skipped} dropped ${skipped===1?'file was':'files were'} not fonts and skipped.`);
    }catch(e){setError('Could not import the dropped fonts: '+String(e))}
  }
  const thumbBackfillTried=useRef(new Set<string>());
  const viewerVideoRef=useRef<HTMLVideoElement|null>(null);
  const [thumbBusy,setThumbBusy]=useState(false);
  const [thumbNote,setThumbNote]=useState('');
  const thumbNoteTimer=useRef<number|null>(null);
  function flashThumbNote(text:string){setThumbNote(text);if(thumbNoteTimer.current)window.clearTimeout(thumbNoteTimer.current);thumbNoteTimer.current=window.setTimeout(()=>setThumbNote(''),2200)}
  async function patchAsset(sourceId:string,assetId:string,patch:Partial<Asset>){await save(sourcesRef.current.map(s=>s.id===sourceId?{...s,assets:s.assets.map(a=>a.id===assetId?{...a,...patch}:a)}:s))}
  async function setVideoThumbnail(asset:Asset){
    const owner=sourcesRef.current.find(s=>s.assets.some(a=>a.id===asset.id));
    const video=viewerVideoRef.current;
    if(!owner||!video||thumbBusy)return;
    video.pause();
    const time=video.currentTime;
    setThumbBusy(true);
    try{
      const name=await invoke<string>('set_video_thumbnail',{file:asset.file,time,previous:asset.customThumbnail?asset.thumbnail||null:null});
      await patchAsset(owner.id,asset.id,{thumbnail:name,posterTime:time,customThumbnail:true});
      flashThumbNote('Thumbnail updated');
    }catch(e){setError('Could not set the thumbnail: '+String(e))}
    finally{setThumbBusy(false)}
  }
  async function resetVideoThumbnail(asset:Asset){
    const owner=sourcesRef.current.find(s=>s.assets.some(a=>a.id===asset.id));
    if(!owner)return;
    try{
      const name=await invoke<string|null>('reset_video_thumbnail',{file:asset.file});
      await patchAsset(owner.id,asset.id,{thumbnail:name||undefined,posterTime:undefined,customThumbnail:false});
    }catch(e){setError('Could not reset the thumbnail: '+String(e))}
  }
function showContext(e:React.MouseEvent<Element>,sourceId?:string,assetId?:string){const element=e.target as HTMLElement;if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element.isContentEditable){setContextMenu(null);return}e.preventDefault();e.stopPropagation();const target=e.target as HTMLElement;const link=target.closest('a') as HTMLAnchorElement|null;const copyText=link?.href||window.getSelection()?.toString();const {x,y}=getContextCoordinates(e);setCanvasDiscoverMenu(null);setContextMenu({x,y,sourceId,assetId,copyText})}
 function linkFont(sourceId:string){if(!fontToLink)return;const font=allFonts.find(a=>a.file===fontToLink);if(!font)return;void save(sourcesRef.current.map(s=>s.id===sourceId?{...s,assets:[...s.assets,{...font,id:uid()}]}:s));setFontToLink('')}
 const sourceTags=(s:Source)=>Array.from(new Set([...s.tags,...s.assets.flatMap(a=>a.tags||[])]));
 const fontOnly=(s:Source)=>s.assets.length>0&&s.assets.every(a=>a.kind==='font');
 const fontTagList=Array.from(new Set(sources.flatMap(s=>[...(fontOnly(s)?s.tags:[]),...s.assets.filter(a=>a.kind==='font').flatMap(a=>a.tags||[])]))).sort();
 const referenceTagList=Array.from(new Set(sources.flatMap(s=>[...(fontOnly(s)?[]:s.tags),...s.assets.filter(a=>a.kind!=='font').flatMap(a=>a.tags||[])]))).sort();
 const tags=view==='Fonts'?fontTagList:referenceTagList;
 const filtered=useMemo(()=>{let a=sources.filter(s=>(category==='All'||s.category===category)&&(view!=='Favorites'||!categoryFilter.length||categoryFilter.includes(s.category))&&tagFilter.every(t=>sourceTags(s).includes(t))&&[s.title,s.url,s.notes,...sourceTags(s),...s.assets.flatMap(a=>[a.notes||'',a.name])].some(v=>matches(v,query))&&(view==='Fonts'||s.assets.some(a=>matchesPaletteColors(a.palette,colorFilter,colorSwatchByName))));if(view==='Favorites')a=a.filter(s=>s.favorite||s.assets.some(x=>x.favorite));if(view==='Fonts')a=a.filter(s=>s.assets.some(x=>x.kind==='font'));if(sortBy==='shuffle')a=[...a].sort((x,y)=>shuffleRank(x.id,librarySeed)-shuffleRank(y.id,librarySeed));else a=[...a].sort((x,y)=>sortBy==='name'?x.title.localeCompare(y.title):sortBy==='oldest'?x.created.localeCompare(y.created):y.created.localeCompare(x.created));return a},[sources,category,categoryFilter,tagFilter,query,view,colorFilter,sortBy,librarySeed]);
 const allFontFamilies=useMemo(()=>groupFontAssets(sources.flatMap(s=>s.assets.filter(a=>a.kind==='font').map(asset=>({sourceId:s.id,asset})))),[sources]);
 const availableFontFormats=useMemo(()=>Array.from(new Set(allFontFamilies.flatMap(g=>g.formats))).sort(),[allFontFamilies]);
 const fontFamilies=useMemo(()=>{const pairs=filtered.flatMap(s=>s.assets.filter(a=>a.kind==='font'&&matchesReference(s,a,query,tagFilter)&&(!fontFormatFilter.length||fontFormatFilter.includes((getFileExtension(a.file)||getFileExtension(a.name)||'font').toUpperCase()))).map(asset=>({sourceId:s.id,asset})));const groups=groupFontAssets(pairs);if(sortBy==='name')groups.sort((a,b)=>a.family.localeCompare(b.family));return groups},[filtered,query,tagFilter,fontFormatFilter,sortBy]);
 const trashEntries=useMemo(()=>allSources.flatMap(s=>s.trashedAt?[{source:s,asset:undefined as Asset|undefined}]:s.assets.filter(a=>a.trashedAt).map(asset=>({source:s,asset:asset as Asset|undefined}))),[allSources]);
 const trashListing=useMemo(()=>trashEntries.filter(({source,asset})=>{
   const candidates=asset?[asset]:source.assets;
   return (!categoryFilter.length||categoryFilter.includes(source.category))&&(matchesReference(source,asset,query,tagFilter)||!asset&&candidates.some(a=>matchesReference(source,a,query,tagFilter)))&&(!colorFilter.length||candidates.some(a=>matchesPaletteColors(a.palette,colorFilter,colorSwatchByName)));
 }).sort((a,b)=>{const ta=a.asset?.trashedAt||a.source.trashedAt||a.source.created,tb=b.asset?.trashedAt||b.source.trashedAt||b.source.created;return sortBy==='name'?(a.asset?.name||a.source.title).localeCompare(b.asset?.name||b.source.title):sortBy==='shuffle'?shuffleRank(a.asset?.id||a.source.id,librarySeed)-shuffleRank(b.asset?.id||b.source.id,librarySeed):sortBy==='oldest'?ta.localeCompare(tb):tb.localeCompare(ta)}),[trashEntries,categoryFilter,query,tagFilter,colorFilter,sortBy,librarySeed]);
 const cards=assetView?filtered.flatMap(s=>s.assets.filter(a=>(view!=='Favorites'||s.favorite||a.favorite)&&matchesPaletteColors(a.palette,colorFilter,colorSwatchByName)&&matchesReference(s,a,query,tagFilter)).map(a=>({source:s,asset:a}))):filtered.map(s=>({source:s,asset:undefined as Asset|undefined}));
 const totalItems=view==='Fonts'?fontFamilies.length:view==='Trash'?trashListing.length:cards.length;const safePage=Math.min(page,Math.max(1,Math.ceil(totalItems/pageSize)));const pageStart=(safePage-1)*pageSize;
 useEffect(()=>{setPage(1)},[view,category,query,tagFilter,colorFilter,categoryFilter,fontFormatFilter,sortBy,pageSize,assetView]);
 const openExternal=(event:React.MouseEvent<HTMLAnchorElement>,url:string)=>{event.preventDefault();openLink(url).catch(e=>setError(String(e)))};
 const src=(file:string)=>resolveAssetDiskUrl(root,file,allSources);
 const thumb=(file:string,assetFile?:string)=>resolveThumbDiskUrl(root,file,allSources,assetFile);
 const loopSrc=(a:Asset)=>resolvePreviewVideoDiskUrl(root,a,allSources);
 const canvasDiscoverAvailable=useMemo(()=>{
   let removed:Record<string,boolean>={};
   try{removed=JSON.parse(localStorage.getItem('sightline-study-removed')||'{}')}catch{removed={}}
   return canvasDiscoverSites.filter(site=>!removed[site.url]&&!!site.image);
 },[canvasDiscoverSites,canvasRemovedVersion]);
 const canvasDiscoverOptions=useMemo(()=>getDiscoverFilterOptions(canvasDiscoverAvailable),[canvasDiscoverAvailable]);
 const canvasDiscoverFiltered=useMemo(()=>sortDiscoverSites(filterDiscoverSites(canvasDiscoverAvailable,{
   query,
   colors:canvasDiscoverColors,
   years:canvasDiscoverYears,
   sources:canvasDiscoverSources,
   industries:canvasDiscoverIndustries,
   tags:canvasDiscoverTags,
   statuses:canvasDiscoverStatuses,
   visited:canvasVisited,
   paletteSwatches:colors
 }),canvasDiscoverSort,canvasDiscoverSeed),[canvasDiscoverAvailable,query,canvasDiscoverColors,canvasDiscoverYears,canvasDiscoverSources,canvasDiscoverIndustries,canvasDiscoverTags,canvasDiscoverStatuses,canvasVisited,canvasDiscoverSort,canvasDiscoverSeed]);
 const canvasItems:CanvasItem[]=useMemo(()=>{
   if(view!=='Canvas')return [];
   if(canvasMode==='discover'){
     const savedUrlKeys=new Set(sources.flatMap(s=>[inspirationUrlKey(s.url),...s.assets.map(a=>inspirationUrlKey(a.sourceUrl||''))]).filter(Boolean));
     return canvasDiscoverFiltered.map((site):CanvasDiscoverItem=>({
       kind:'discover',
       id:site.url,
       title:site.title,
       url:site.url,
       domain:displayUrl(site.url),
       imageSrc:discoverCoverSrc(site.image,canvasDiscoverImageDir),
       tags:site.tags,
       saved:savedUrlKeys.has(inspirationUrlKey(site.url))
     }));
   }
   if(!root)return [];
    const allowedKind=(k:Asset['kind'])=>(!canvasMediaFilter.length||canvasMediaFilter.length===2)?(k==='image'||k==='video'):canvasMediaFilter[0]==='Images'?k==='image':k==='video';
    const items:CanvasItem[]=filtered.filter(s=>!canvasCategoryFilter.length||canvasCategoryFilter.includes(s.category)).flatMap((s):CanvasItem[]=>{
      const visuals=s.assets.filter(a=>allowedKind(a.kind)&&matchesPaletteColors(a.palette,colorFilter,colorSwatchByName)&&((!query.trim()&&!tagFilter.length)||matchesReference(s,a,query,tagFilter)));
      if(!visuals.length){
        if(s.assets.length||query.trim()||colorFilter.length||tagFilter.length||canvasMediaFilter.length)return [];
        return [{
          kind:'library' as const,
          id:`source:${s.id}`,
          sourceId:s.id,
          title:s.title,
          subtitle:s.url?displayUrl(s.url):s.category,
          mediaType:'empty' as const
        }];
      }
      return visuals.map(a=>({
        kind:'library' as const,
        id:a.id,
        sourceId:s.id,
        assetId:a.id,
        title:a.name||s.title,
        subtitle:s.title,
        mediaType:(a.kind==='video'?'video':a.kind==='font'?'font':'image') as 'image'|'video'|'font',
        imageSrc:a.thumbnail?thumb(a.thumbnail,a.file):a.kind==='image'?src(a.file):undefined,
        videoSrc:a.kind==='video'?loopSrc(a):undefined
      }));
    });
    if(sortBy==='shuffle')items.sort((a,b)=>shuffleRank(a.id,librarySeed)-shuffleRank(b.id,librarySeed));
    return items;
  },[view,canvasMode,canvasMediaFilter,canvasCategoryFilter,canvasDiscoverFiltered,canvasDiscoverImageDir,allSources,sources,filtered,root,query,colorFilter,tagFilter,sortBy,librarySeed]);
 const canvasHandlers=useRef<{open:(item:CanvasItem)=>void;context:(e:React.MouseEvent,item:CanvasItem)=>void;url:(url:string)=>void}>({open:()=>{},context:()=>{},url:()=>{}});
 canvasHandlers.current={
   open:item=>{
     if(item.kind!=='library')return;
     if(item.mediaType==='empty'){setSelected(item.sourceId);void addFiles(item.sourceId);return}
     const asset=sourcesRef.current.find(s=>s.id===item.sourceId)?.assets.find(a=>a.id===item.assetId);
     setSelected(item.sourceId);
     if(asset)setPreview(asset);
   },
   context:(e,item)=>{
     if(item.kind==='library'){showContext(e,item.sourceId,item.assetId);return}
     e.preventDefault();e.stopPropagation();
     const site=canvasDiscoverSites.find(x=>x.url===item.id);
     if(!site)return;
     setContextMenu(null);
     setCanvasDiscoverMenu({...getContextCoordinates(e),site});
   },
   url:url=>{openLink(url).catch(e=>setError(String(e)))}
 };
 const onCanvasOpen=useCallback((item:CanvasItem)=>canvasHandlers.current.open(item),[]);
 const onCanvasContext=useCallback((e:React.MouseEvent,item:CanvasItem)=>canvasHandlers.current.context(e,item),[]);
 const onCanvasUrl=useCallback((url:string)=>canvasHandlers.current.url(url),[]);
 const isCanvasDiscover=view==='Canvas'&&canvasMode==='discover';
 const onCanvasAddSource=useCallback(()=>{pendingDiscoverAddRef.current=true;setView('Discover')},[]);
 const toolbarFilterGroups:FilterGroup[]=isCanvasDiscover?[
   {key:'color',label:'Color',icon:<Palette size={15}/>,options:colors.map(c=>c.name),selected:canvasDiscoverColors,onChange:setCanvasDiscoverColors,getSwatch:colorSwatchByName},
   {key:'year',label:'Year',icon:<CalendarDays size={15}/>,options:[...canvasDiscoverOptions.years,...(canvasDiscoverOptions.hasUnknownYear?['Unknown']:[])],selected:canvasDiscoverYears,onChange:setCanvasDiscoverYears},
   {key:'source',label:'Source',icon:<Globe size={15}/>,options:canvasDiscoverOptions.names,selected:canvasDiscoverSources,onChange:setCanvasDiscoverSources},
   {key:'industry',label:'Industry',icon:<Boxes size={15}/>,options:canvasDiscoverOptions.industries,selected:canvasDiscoverIndustries,onChange:setCanvasDiscoverIndustries},
   {key:'tags',label:'Other tags',icon:<Tag size={15}/>,options:canvasDiscoverOptions.tags,selected:canvasDiscoverTags,onChange:setCanvasDiscoverTags},
   {key:'status',label:'Visit status',icon:<Check size={15}/>,options:['Unvisited','Visited'],selected:canvasDiscoverStatuses,onChange:setCanvasDiscoverStatuses}
 ]:view==='Canvas'?[
   {key:'media',label:'Media type',icon:<Film size={15}/>,options:['Images','Videos'],selected:canvasMediaFilter,onChange:setCanvasMediaFilter},
   {key:'category',label:'Category',icon:<Boxes size={15}/>,options:categories,selected:canvasCategoryFilter,onChange:setCanvasCategoryFilter},
   {key:'tags',label:'Tags',icon:<Tag size={15}/>,options:referenceTagList,selected:tagFilter,onChange:setTagFilter}
 ]:view==='Fonts'?[
   {key:'format',label:'Format',icon:<Type size={15}/>,options:availableFontFormats,selected:fontFormatFilter,onChange:setFontFormatFilter},
   {key:'tags',label:'Tags',icon:<Tag size={15}/>,options:fontTagList,selected:tagFilter,onChange:setTagFilter}
 ]:view==='Favorites'||view==='Trash'?[
   {key:'category',label:'Category',icon:<Boxes size={15}/>,options:categories,selected:categoryFilter,onChange:setCategoryFilter},
   {key:'tags',label:'Tags',icon:<Tag size={15}/>,options:referenceTagList,selected:tagFilter,onChange:setTagFilter}
 ]:[
   {key:'tags',label:'Tags',icon:<Tag size={15}/>,options:tags,selected:tagFilter,onChange:setTagFilter}
 ];
 const activeToolbarFilterCount=toolbarFilterGroups.reduce((sum,g)=>sum+g.selected.length,0);
 const clearToolbarFilters=()=>{
   if(isCanvasDiscover){
     setCanvasDiscoverColors([]);setCanvasDiscoverYears([]);setCanvasDiscoverSources([]);setCanvasDiscoverIndustries([]);setCanvasDiscoverTags([]);setCanvasDiscoverStatuses([]);
     return;
   }
   setTagFilter([]);setColorFilter([]);setCategoryFilter([]);setFontFormatFilter([]);
   if(view==='Canvas'){setCanvasCategoryFilter([]);setCanvasMediaFilter([])}
 };
 const singleColorHex=colorFilter.length===1?(colorSwatchByName(colorFilter[0])||null):null;
 const singleCanvasDiscoverColorHex=isCanvasDiscover&&canvasDiscoverColors.length===1?(colorSwatchByName(canvasDiscoverColors[0])||null):null;
 return <div className={view==='Canvas'&&canvasMinimized?'app canvas-fullscreen':'app'} onContextMenu={e=>showContext(e)} onPointerDown={e=>{setContextMenu(null);setCanvasDiscoverMenu(null);if(!(e.target as HTMLElement).closest('.source-card,.inspector,.overlay,.context-menu,.canvas-tile,.infinite-canvas,.reference-context'))setSelected(null)}}><div className="workspace-bar"><div className="workspace-identity"><img src="/brand/sightline-icon-color.svg" alt=""/><strong>Sightline</strong><span className="workspace-slash">/</span><span>Personal workspace</span></div><div className="workspace-bar-actions"><Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={()=>setShortcutsOpen(true)}><Keyboard size={16}/></Button><Button variant="ghost" size="icon" aria-label={dark?'Switch to light mode':'Switch to dark mode'} title={dark?'Switch to light mode':'Switch to dark mode'} onClick={()=>setDark(!dark)}>{dark?<Sun size={16}/>:<Moon size={16}/>}</Button></div></div>
 <aside className="sidebar"><nav aria-label="Workspaces">{[['Library',Library],['Discover',Globe],['Canvas',Boxes],['Favorites',Heart],['Fonts',Type]].map(([name,Icon])=><Button variant="ghost" className={view===name?'rail-link active':'rail-link'} key={name as string} aria-label={name as string} aria-current={view===name?'page':undefined} title={name as string} onClick={()=>{setView(name as string);setQuery('');setTagFilter(name==='Canvas'?canvasSavedTagsRef.current:[]);setColorFilter([]);setCategoryFilter([]);setFontFormatFilter([])}}><Icon/><span>{name as string}</span></Button>)}</nav><div className="rail-bottom"><Button variant="ghost" className={view==='Trash'?'rail-link active':'rail-link'} aria-label="Trash" aria-current={view==='Trash'?'page':undefined} title="Trash" onClick={()=>{setView('Trash');setQuery('');setTagFilter([]);setColorFilter([]);setCategoryFilter([]);setFontFormatFilter([])}}><Trash2/><span>Trash</span></Button><span className="rail-avatar" title="Personal workspace">S</span></div></aside>
 <main className="main"><header className={view==='Discover'?'workspace-header is-discover':'workspace-header'}><div className="page-heading"><h1 className="breadcrumbs">{view === 'Library' ? (category === 'All' ? 'Your library' : category) : view}{view==='Discover'?(discoverStats&&<Badge variant="secondary" className="header-count">{discoverStats.filtered.toLocaleString()}</Badge>):<Badge variant="secondary" className="header-count">{(view==='Canvas'?canvasItems.length:totalItems).toLocaleString()}</Badge>}</h1></div><div className="header-right">{view==='Discover'&&native()&&<><Button variant="outline" size="sm" className="header-action" disabled={!!discoverStats?.refreshing} onClick={()=>discoverActionsRef.current.refresh()} title="Refresh websites"><RotateCcw size={14}/> {discoverStats?.refreshing?'Refreshing...':'Refresh'}</Button><Button className="add-button" size="sm" onClick={()=>discoverActionsRef.current.add()}><Plus size={15}/> Add source</Button></>}{isCanvasDiscover&&native()&&<Button className="add-button" size="sm" onClick={onCanvasAddSource}><Plus size={15}/> Add source</Button>}{view==='Trash'&&!!root&&<span className="trash-delete-wrap" title={`Deleted items are removed permanently after ${TRASH_RETENTION_DAYS} days.`}><Button variant="outline" size="sm" className="header-action trash-delete-all" disabled={trashBusy||trashEntries.length===0} onClick={requestClearTrash}><Trash2 size={14}/> Delete all</Button></span>}{view!=='Discover'&&view!=='Canvas'&&(native()||root)&&<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="header-action"><Settings2 size={14}/> Library tools</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{native()&&<DropdownMenuItem disabled={!root||instagramBusy} onSelect={()=>setInstagramOpen(true)}><Image/> Instagram collections</DropdownMenuItem>}{native()&&<><DropdownMenuItem disabled={backupBusy||!root} onSelect={()=>void driveBackup()}><HardDrive/> Back up library</DropdownMenuItem><DropdownMenuItem disabled={backupBusy} onSelect={()=>void driveRestore()}><RotateCcw/> Restore backup</DropdownMenuItem></>}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}{root&&view!=='Discover'&&view!=='Canvas'&&<Button variant="outline" size="sm" className="header-action" title="Change library folder" aria-label="Library folder" onClick={chooseLibrary}><Archive size={14}/> Library folder</Button>}{root&&(view==='Library'||(view==='Canvas'&&canvasMode==='library'))&&<Button className="add-button" size="sm" onClick={()=>setAddInspirationOpen(true)}><Plus size={15}/> Add inspiration</Button>}{root&&view==='Fonts'&&<Button className="add-button" size="sm" onClick={()=>{setAddFontTab('google');setAddFontOpen(true)}}><Plus size={15}/> Add font</Button>}</div></header>{view==='Library'&&root&&<div className="collection-tabs"><ToggleGroup type="single" value={category} onValueChange={value=>{if(value)setCategory(value)}} aria-label="Collections">{['All',...categories].map((name,i)=><ToggleGroupItem key={name} value={name}>{i===0?'All references':name}<span>{name==='All'?sources.length:sources.filter(s=>s.category===name).length}</span></ToggleGroupItem>)}</ToggleGroup></div>}<section className="content" onPointerDown={e=>{if(e.target===e.currentTarget)setSelected(null)}} onDragOver={e=>{if(view==='Fonts'&&!!root&&e.dataTransfer.types.includes('Files'))e.preventDefault()}} onDrop={e=>{if(view!=='Fonts'||!root)return;e.preventDefault();void dropFontFiles(Array.from(e.dataTransfer.files))}}>{backupStatus&&<div className="backup-status" role="status">{backupStatus}{!backupBusy&&<Button variant="ghost" aria-label="Dismiss backup status" onClick={()=>setBackupStatus('')}><X size={15}/></Button>}</div>}
 {error&&<div className="error" role="alert">{error}<Button variant="ghost" aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></Button></div>}
 {!root&&ready&&view!=='Discover'&&view!=='Canvas'&&<div className="welcome"><div className="setup-layout"><div className="setup-copy"><div className="setup-symbol"><img src="/brand/sightline-icon-color.svg" alt=""/></div><h2>Your eye for detail.<br/>A home for it all.</h2><p>Collect websites, motion, typography and ideas in one local library.</p><div className="setup-features"><div><CameraIcon/><span><strong>Capture what matters</strong><small>Save images, page details, clips and fonts.</small></span></div><div><Tags/><span><strong>Give ideas context</strong><small>Organize collections, tags and observations.</small></span></div><div><Boxes/><span><strong>Connect the dots</strong><small>Bring references together on your canvas.</small></span></div></div></div><div className="setup-card"><FolderOpen/><h3>Make room for inspiration.</h3><p>Choose a folder for your library. Sightline keeps your original files and notes together on your computer.</p><Button className="welcome-action" onClick={chooseLibrary}><FolderOpen/> Choose a library folder <ArrowRight/></Button><Separator/><div className="setup-note"><HardDrive/><span>Local by default.<br/>Your files stay in a folder you own.</span></div></div></div></div>}
 {(!!root||isCanvasDiscover)&&view!=='Discover'&&<div className="toolbar"><div className="toolbar-main"><div className="search"><Search size={16}/><Input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder={isCanvasDiscover?'Search websites or tags':'Search your library'} aria-label="Search sources, links and notes"/>{query&&<Button variant="ghost" className="search-clear" onClick={()=>setQuery('')} aria-label="Clear search"><X size={14}/></Button>}</div><FilterMenu groups={toolbarFilterGroups} activeCount={activeToolbarFilterCount} onClearAll={clearToolbarFilters}/>{isCanvasDiscover?<Dropdown label="Sort" icon={<ArrowDownWideNarrow size={15}/>} value={{catalog:'Catalog order',newest:'Newest',oldest:'Oldest',name:'Name',shuffle:'Shuffled'}[canvasDiscoverSort]}><div className="menu-heading">Sort by</div>{([['catalog','Catalog order'],['newest','Newest first'],['oldest','Oldest first'],['name','Name'],['shuffle','Shuffled']] as const).map(([value,label])=><Button variant="ghost" key={value} className="menu-option" aria-pressed={canvasDiscoverSort===value} onClick={e=>{setCanvasDiscoverSort(value);if(value==='shuffle')setCanvasDiscoverSeed(Math.floor(Math.random()*0xffffffff));closeMenu(e)}}>{label}{canvasDiscoverSort===value&&<Check size={14}/>}</Button>)}</Dropdown>:<Dropdown label="Sort" icon={<ArrowDownWideNarrow size={15}/>} value={sortBy==='name'?'Name':sortBy==='oldest'?'Oldest':sortBy==='shuffle'?'Shuffled':'Newest'}><div className="menu-heading">Sort by</div>{[['newest','Newest first'],['oldest','Oldest first'],['name','Name'],['shuffle','Shuffled']].map(([value,label])=><Button variant="ghost" key={value} className="menu-option" aria-pressed={sortBy===value} onClick={e=>{setSortBy(value);if(value==='shuffle')setLibrarySeed(Math.floor(Math.random()*0xffffffff));closeMenu(e)}}>{label}{sortBy===value&&<Check size={14}/>}</Button>)}</Dropdown>}<div className="toolbar-spacer"/>{['Library','Favorites','Fonts'].includes(view)&&<>{view!=='Fonts'&&<VideoPlaybackToggle className="video-playback-toggle"/>}{view!=='Fonts'&&<ToggleGroup type="single" value={assetView?'assets':'sources'} onValueChange={value=>{if(value)setAssetView(value==='assets')}} className="group-switch" aria-label="Group library items"><ToggleGroupItem value="sources">Sources</ToggleGroupItem><ToggleGroupItem value="assets">Assets</ToggleGroupItem></ToggleGroup>}<ViewSwitch value={gridView} onChange={chooseGridView}/></>}</div>{activeToolbarFilterCount>0&&<div className="active-filters"><span>Filtering by</span>{toolbarFilterGroups.flatMap(g=>g.selected.map(value=>{const swatch=g.getSwatch?.(value);return <Button variant="ghost" key={`${g.key}-${value}`} onClick={()=>g.onChange(g.selected.filter(x=>x!==value))}>{swatch&&<span className="color-swatch" style={{background:swatch}}/>}{value}<X size={12}/></Button>}))}<Button variant="ghost" className="clear-filters" onClick={clearToolbarFilters}>Clear</Button>{!isCanvasDiscover&&indexingColors&&<span role="status">Indexing colors...</span>}</div>}</div>}
 <DiscoverNotifications/>{view==='Discover'&&<DiscoverWorkspace sources={sources} gridView={gridView} onViewChange={chooseGridView} pageSize={pageSize} onPageSizeChange={setPageSize} onOpen={openExternal} onSaveSite={site=>saveDiscoverSite(site,true)} onShowSource={id=>{const target=sources.find(s=>s.id===id);if(target&&libraryCategory!=='All'&&target.category!==libraryCategory){setLibraryCategory('All');try{localStorage.setItem('sightline-library-category','All')}catch{}}setSelected(id);setView('Library');const asset=target?.assets.find(a=>a.id===target.coverId)||target?.assets[0];if(asset)setPreview(asset);else void addFiles(id)}} onStatsChange={setDiscoverStats} onPushUndo={pushUndo} onVisitedSync={setCanvasVisited} actionsRef={discoverActionsRef}/>}
 {view==='Canvas'?<InfiniteCanvas mode={canvasMode} onModeChange={chooseCanvasMode} headerMinimized={canvasMinimized} onToggleHeader={toggleCanvasMinimized} infiniteLoop={canvasInfiniteLoop} onToggleInfiniteLoop={toggleCanvasInfiniteLoop} onShuffle={()=>{if(canvasMode==='discover'){setCanvasDiscoverSort('shuffle');setCanvasDiscoverSeed(Math.floor(Math.random()*0xffffffff))}else{setSortBy('shuffle');setLibrarySeed(Math.floor(Math.random()*0xffffffff))}}} shuffledActive={canvasMode==='discover'?canvasDiscoverSort==='shuffle':sortBy==='shuffle'} items={canvasItems} selectedSourceId={selected} onOpenItem={onCanvasOpen} onItemContextMenu={onCanvasContext} onOpenUrl={onCanvasUrl} filterGroups={toolbarFilterGroups} activeFilterCount={activeToolbarFilterCount} onClearFilters={clearToolbarFilters} loading={canvasMode==='discover'&&canvasDiscoverLoading} emptyState={(!root&&canvasMode==='library')?<Empty className="empty"><EmptyScene kind="canvas"/><EmptyHeader><EmptyTitle>Choose a library folder</EmptyTitle><EmptyDescription>Choose a library folder to see your sources here, or browse Discover.</EmptyDescription></EmptyHeader><div className="empty-actions">{native()&&<Button size="sm" onClick={chooseLibrary}><FolderOpen size={15}/> Choose a library folder</Button>}<Button variant="outline" size="sm" onClick={()=>chooseCanvasMode('discover')}><Globe size={14}/> Switch to Discover</Button></div></Empty>:(()=>{const hasFilter=!!query.trim()||activeToolbarFilterCount>0;const allVisitedOnly=isCanvasDiscover&&canvasDiscoverStatuses.length===1&&canvasDiscoverStatuses[0]==='Unvisited'&&!query.trim()&&activeToolbarFilterCount===1;return <Empty className="empty"><EmptyScene kind={hasFilter?'search':'canvas'} color={isCanvasDiscover?singleCanvasDiscoverColorHex:singleColorHex}/><EmptyHeader><EmptyTitle>{hasFilter?(canvasMode==='discover'?'No matching website covers':'No matching canvas items'):canvasMode==='discover'?'No website covers available':'A blank canvas for your ideas'}</EmptyTitle><EmptyDescription>{allVisitedOnly?'All matching sites are marked visited. Clear the Visit status filter to see them.':hasFilter?'Try adjusting your search or clearing the active filters.':canvasMode==='discover'?'All Discover covers may be hidden or the catalog is empty.':'References you add to your library appear here in an infinite grid.'}</EmptyDescription></EmptyHeader><div className="empty-actions">{hasFilter&&<Button variant="outline" size="sm" onClick={()=>{setQuery('');clearToolbarFilters()}}><RotateCcw size={14}/> Clear filters</Button>}{!hasFilter&&canvasMode==='library'&&!!root&&<><Button size="sm" onClick={()=>setAddInspirationOpen(true)}><Plus size={15}/> Add inspiration</Button><Button variant="outline" size="sm" onClick={()=>chooseCanvasMode('discover')}><Globe size={14}/> Browse Discover</Button></>}</div></Empty>})()} />:!!root&&view!=='Discover'&&(view==='Trash'?<div className="trash-list"><h2>Trash</h2>{!trashListing.length&&<Empty className="empty"><EmptyScene kind={query||activeToolbarFilterCount?'search':'trash'} color={singleColorHex}/><EmptyHeader><EmptyTitle>{query||activeToolbarFilterCount?'No matching deleted items':'Trash is empty'}</EmptyTitle><EmptyDescription>{query||activeToolbarFilterCount?'Try adjusting your search or clearing the active filters.':`Items you move to Trash appear here and are deleted permanently after ${TRASH_RETENTION_DAYS} days.`}</EmptyDescription></EmptyHeader>{(!!query||activeToolbarFilterCount>0)&&<div className="empty-actions"><Button variant="outline" size="sm" onClick={()=>{setQuery('');clearToolbarFilters()}}><RotateCcw size={14}/> Clear filters</Button></div>}</Empty>}{trashListing.slice(pageStart,pageStart+pageSize).map(({source:s,asset:a})=>{const previewAsset=a||s.assets.find(x=>x.id===s.coverId)||s.assets.find(x=>x.kind==='image'||x.kind==='video')||s.assets[0];const trashedAt=a?.trashedAt||s.trashedAt;const expiryLabel=formatTrashExpiryLabel(trashedAt);const remainingDays=trashDaysRemaining(trashedAt);const urgentExpiry=remainingDays!==null&&remainingDays<=3;const previewInTrash=previewAsset?isFileInTrashStorage(allSources,previewAsset.file):undefined;return <div className="trash-row" key={a?.id||s.id} onContextMenu={e=>showContext(e,s.id,a?.id)}><div className="trash-row-info"><div className="trash-thumb">{previewAsset&&(previewAsset.kind==='image'||previewAsset.kind==='video')?(previewAsset.thumbnail?<img src={thumb(previewAsset.thumbnail,previewAsset.file)} alt=""/>:previewAsset.kind==='video'?<video src={src(previewAsset.file)} muted preload="metadata"/>:<img src={src(previewAsset.file)} alt=""/>):previewAsset?.kind==='font'?<Type size={22}/>:<Archive size={22}/>}<span className="trash-kind">{a?a.kind:'source'}</span></div><span className="trash-row-text"><strong>{a?.name||s.title}</strong><div className="trash-row-meta"><small>{a?`${s.title} \u00B7 ${a.kind}`:`Source \u00B7 ${s.assets.length} ${s.assets.length===1?'item':'items'}`}</small>{expiryLabel&&<span className={urgentExpiry?'trash-expiry urgent':'trash-expiry'}>{expiryLabel}</span>}</div></span></div><div className="trash-actions"><Button variant="ghost" size="sm" className="trash-restore" disabled={trashBusy} onClick={()=>restoreItem(s.id,a?.id)}><RotateCcw size={15}/> Restore</Button>{previewAsset&&native()&&<Button variant="ghost" size="icon" className="trash-icon-btn" title="Open location" aria-label="Open location" onClick={()=>void revealAsset(previewAsset.file,previewInTrash)}><FolderOpen size={15}/></Button>}<Button variant="ghost" size="icon" className="trash-icon-btn danger" title="Delete permanently" aria-label="Delete permanently" disabled={trashBusy} onClick={()=>requestDeletePermanently(s.id,a?.id)}><Trash2 size={15}/></Button></div></div>})}</div>:view==='Fonts'&&fontFamilies.length>0?<div className={`font-list view-${gridView}`} style={gridView==='list'?undefined:{gridTemplateColumns:gridColumnsCss(gridView)}}>{fontFamilies.slice(pageStart,pageStart+pageSize).map(group=><FontCard key={group.key} group={group} src={src} onOpen={asset=>setPreview(asset)} onContextMenu={(e,asset)=>showContext(e,group.primarySourceId,asset.id)}/>)}</div>:totalItems===0?(()=>{const hasSearchOrFilter=!!query.trim()||activeToolbarFilterCount>0;const isEmptyCategory=view==='Library'&&category!=='All'&&sources.length>0&&!hasSearchOrFilter;const catIndex=categories.indexOf(category);const CategoryIcon=catIndex>=0?categoryIcons[catIndex]:Sparkles;if(view==='Fonts'&&!hasSearchOrFilter){return <Empty className="empty"><EmptyScene kind="fonts"/><EmptyHeader><EmptyTitle>No fonts yet</EmptyTitle><EmptyDescription>Add fonts from Google Fonts, your installed fonts, or font files.</EmptyDescription></EmptyHeader><div className="empty-actions"><Button size="sm" onClick={()=>{setAddFontTab('google');setAddFontOpen(true)}}><Plus size={15}/> Add fonts</Button></div></Empty>}const kind=hasSearchOrFilter?'search':view==='Fonts'?'fonts':view==='Favorites'?'favorites':isEmptyCategory?'category':'library';const emptyTitle=hasSearchOrFilter?`No matching ${view==='Fonts'?'fonts':'references'}`:view==='Fonts'?'No matching fonts':view==='Favorites'?'No favorites yet':isEmptyCategory?`No ${category.toLowerCase()} yet`:'Your visual library starts here';const emptyDesc=hasSearchOrFilter?'Try adjusting your search terms or clearing the active filters.':view==='Fonts'?'Try adjusting your search terms or add a new font family.':view==='Favorites'?'Click the heart on any reference or media item to keep your top inspiration within reach.':isEmptyCategory?`Save your first ${category.toLowerCase()} reference here, or switch back to all references.`:'Collect websites, screenshots, motion clips, and typefaces in one calm local space.';return <Empty className="empty"><EmptyScene kind={kind} color={singleColorHex} icon={isEmptyCategory?<CategoryIcon/>:undefined}/><EmptyHeader><EmptyTitle>{emptyTitle}</EmptyTitle><EmptyDescription>{emptyDesc}</EmptyDescription></EmptyHeader><div className="empty-actions">{hasSearchOrFilter&&<Button variant="outline" size="sm" onClick={()=>{setQuery('');clearToolbarFilters()}}><RotateCcw size={14}/> Clear filters</Button>}{!hasSearchOrFilter&&view==='Library'&&!!root&&<Button size="sm" onClick={()=>setAddInspirationOpen(true)}><Plus size={15}/> {isEmptyCategory?(category==='Post Ideas'?'Add idea':'Add inspiration'):'Add inspiration'}</Button>}{!hasSearchOrFilter&&isEmptyCategory&&<Button variant="outline" size="sm" onClick={()=>setCategory('All')}>View all references</Button>}{!hasSearchOrFilter&&view==='Library'&&!sources.length&&<Button variant="outline" size="sm" onClick={()=>setView('Discover')}><Globe size={14}/> Browse Discover</Button>}{!hasSearchOrFilter&&view==='Favorites'&&<Button variant="outline" size="sm" onClick={()=>{setCategory('All');setView('Library')}}>Explore Library <ArrowRight size={14}/></Button>}</div></Empty>})():<div className={`reference-grid view-${gridView} mode-${gridView==='list'?'list':'masonry'}`} onPointerDown={e=>{if(e.target===e.currentTarget)setSelected(null)}} style={gridView==='list'?undefined:{gridTemplateColumns:gridColumnsCss(gridView)}}>{cards.slice(pageStart,pageStart+pageSize).map(({source:s,asset:individual})=>{const visuals=s.assets.filter(a=>a.kind==='image'||a.kind==='video');const a=individual||visuals.find(a=>a.id===s.coverId)||visuals[0]||s.assets[0];return <article className={'source-card '+(selected===s.id?'current':'')} key={individual?.id||s.id} onClick={e=>{if((e.target as HTMLElement).closest('button,a'))return;setSelected(s.id);if(a)setPreview(a);else void addFiles(s.id)}} onContextMenu={e=>showContext(e,s.id,individual?.id)}><div className="cover-wrap" data-preview-host><Button variant="ghost" className="cover-button" onClick={()=>{setSelected(s.id);if(a)setPreview(a);else void addFiles(s.id)}} aria-label={`Open ${individual?individual.name:s.title}`}><div className="cover">{a&&(a.kind==='image'||a.kind==='video')?(a.kind==='video'?<LoopingPreview videoSrc={loopSrc(a)} posterSrc={a.thumbnail?thumb(a.thumbnail,a.file):undefined}/>:<img src={src(a.file)} loading="lazy" alt=""/>):a?.kind==='font'?<div className="cover-empty cover-font"><strong>Aa</strong><span>{a.name}</span></div>:<div className="cover-empty"><Aperture size={24}/><span>ADD VISUALS</span></div>}{(individual||s.assets.length>0)&&<span className="asset-count">{a?.kind==='video'&&<Play size={10} fill="currentColor"/>}{individual?'1 item':`${s.assets.length} ${s.assets.length===1?'item':'items'}`}</span>}</div></Button><Button variant="ghost" className="card-favorite" aria-label={(individual?.favorite??s.favorite)?`Remove ${s.title} from favorites`:`Add ${s.title} to favorites`} aria-pressed={!!(individual?.favorite??s.favorite)} onClick={()=>toggleFavorite(s.id,individual?.id)}><Heart size={15} fill={(individual?.favorite??s.favorite)?"currentColor":"none"}/></Button></div><div className="card-body"><div className="card-heading"><SiteIcon source={s} root={root}/><div className="card-title" title={individual?`${individual.name} — ${s.title}`:s.title}>{individual?individual.name:s.title}</div><Button variant="ghost" className="card-more" aria-label={`More actions for ${individual?individual.name:s.title}`} title="More actions" onClick={e=>showContext(e,s.id,individual?.id)}><MoreHorizontal size={14}/></Button></div><div className="card-meta">{individual?s.title:s.category}{s.url&&<><span aria-hidden="true"> &middot; </span><a href={s.url} onClick={e=>{e.stopPropagation();openExternal(e,s.url)}}>{displayUrl(s.url)} <ExternalLink size={11}/></a></>}</div><CardTags tags={individual?(individual.tags?.length?individual.tags:s.tags):sourceTags(s)}/>{!individual&&visuals.length>1&&<CoverOptions items={visuals} selected={a?.id} onSelect={id=>setCover(s.id,id)} onContext={(e,id)=>showContext(e,s.id,id)} src={src} thumb={thumb}/>}</div></article>})}</div>)}
 {root&&['Library','Favorites','Fonts','Trash'].includes(view)&&totalItems>0&&<Pagination total={totalItems} page={safePage} pageSize={pageSize} onPage={n=>{setPage(n);document.querySelector('.content')?.scrollTo({top:0})}} onPageSize={setPageSize}/>}
 </section></main>
 {savedClip&&<div className="discover-notice saved-clip-notice" role="status"><span>Clip saved</span><Button variant="ghost" size="sm" onClick={()=>{setPreview(savedClip);setSavedClip(null)}}>Open clip</Button><Button variant="ghost" size="icon" aria-label="Dismiss saved clip notification" onClick={()=>setSavedClip(null)}><X size={14}/></Button></div>}
 {livePreview&&(()=>{const owner=sources.find(s=>s.assets.some(a=>a.id===livePreview.id));const visuals=owner?.assets.filter(a=>a.kind==='image'||a.kind==='video')||[];const visualIndex=visuals.findIndex(a=>a.id===livePreview.id);const coverVisualId=visuals.find(a=>a.id===owner?.coverId)?.id||visuals[0]?.id;const noteCount=livePreview.annotations?.length||0;const fontGroup=livePreview.kind==='font'?allFontFamilies.find(g=>g.variants.some(v=>v.asset.id===livePreview.id||v.asset.file===livePreview.file)):undefined;return <div className="overlay" onMouseDown={()=>{if(!contextMenu)closePreview()}}><div className="preview-dialog media-viewer" role="dialog" aria-modal="true" aria-label={livePreview.name} onMouseDown={e=>e.stopPropagation()} onPointerDownCapture={e=>{const active=document.activeElement;if(!isTextEntryElement(active))return;const t=e.target as HTMLElement|null;if(!t||t===active||t.closest('input:not([type="range"]),textarea,select,.viewer-tag-field,.viewer-tag-suggestions,.annotation-note-editor,[contenteditable="true"]'))return;active.blur()}}><div className="preview-header"><div className="preview-header-left">{owner?.url&&<SiteIcon source={owner} root={root}/>}<div className="preview-header-title"><strong>{fontGroup?fontGroup.family:livePreview.name}</strong><span>{owner?`${owner.title} · ${livePreview.kind}`:livePreview.kind}</span></div></div><div className="preview-actions">{visuals.length>1&&visualIndex>=0&&<span className="viewer-counter" aria-label={`Item ${visualIndex+1} of ${visuals.length}`}>{visualIndex+1} / {visuals.length}</span>}{native()&&livePreview.kind==='video'&&<Button variant="ghost" className="viewer-thumb-btn" aria-label="Set current frame as thumbnail" title="Use the current frame as this video's thumbnail" disabled={thumbBusy} onClick={()=>void setVideoThumbnail(livePreview)}><Image size={16}/><span>{thumbNote||'Set as thumbnail'}</span></Button>}{native()&&<Button variant="ghost" aria-label="Open asset location" title="Open asset location in File Explorer" onClick={()=>void revealAsset(livePreview.file)}><FolderOpen size={16}/></Button>}<Button variant="ghost" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={()=>setShortcutsOpen(true)}><Keyboard size={16}/></Button>{owner&&<Button variant="ghost" className={livePreview.favorite?"media-favorite active":"media-favorite"} aria-label={livePreview.favorite?"Remove item from favorites":"Add item to favorites"} title={livePreview.favorite?"Remove from favorites":"Add to favorites"} onClick={()=>{toggleFavorite(owner.id,livePreview.id)}}><Heart size={16} fill={livePreview.favorite?"currentColor":"none"}/></Button>}<Button variant="ghost" aria-label="Close preview" title="Close" onClick={closePreview}><X size={17}/></Button></div></div><><div className="viewer-body" key={livePreview.id}><div className="viewer-main"><div className="viewer-stage" onContextMenu={e=>owner&&showContext(e,owner.id,livePreview.id)}>{owner&&(livePreview.kind==='image'||livePreview.kind==='video')&&<Annotations key={livePreview.id} asset={livePreview} visible={Boolean(annotationsVisibleBySource[owner.id])} onVisibleChange={next=>setAnnotationsVisibleBySource(prev=>({...prev,[owner.id]:next}))} timingOpen={viewerTimelineOpen} onTimingOpenChange={setViewerTimelineOpen} desktopTimeline={native()&&livePreview.kind==='video'} openNote={noteRequest} onSave={annotations=>save(sourcesRef.current.map(s=>s.id===owner.id?{...s,assets:s.assets.map(a=>a.id===livePreview.id?{...a,annotations}:a)}:s))}/>} {livePreview.kind==='image'?<img src={src(livePreview.file)} alt={livePreview.name}/>:livePreview.kind==='video'?<ThemedPlayer key={livePreview.id} url={src(livePreview.file)} onVideo={video=>{viewerVideoRef.current=video}}/>:<div className="viewer-font"><FontPreview group={fontGroup} selectedAsset={livePreview} src={src} nativeApp={native()} fontStatus={fontStatus} onSelectVariant={setPreview} onInstall={async asset=>{setFontStatus('Installing...');try{setFontStatus(await invoke<string>('install_font',{file:asset.file,name:asset.name}))}catch(e){setFontStatus(String(e))}}} onReveal={file=>void revealAsset(file)}/></div>}{visuals.length>1&&visualIndex>=0&&<><Button variant="ghost" className="stage-nav prev" aria-label="Previous item" title="Previous item" onClick={()=>setPreview(visuals[(visualIndex+visuals.length-1)%visuals.length])}><ChevronLeft size={18}/></Button><Button variant="ghost" className="stage-nav next" aria-label="Next item" title="Next item" onClick={()=>setPreview(visuals[(visualIndex+1)%visuals.length])}><ChevronRight size={18}/></Button></>}</div>{native()&&owner&&livePreview.kind==='video'&&<DesktopVideoTimeline enabled={viewerTimelineOpen} onAnnotationOpen={id=>setNoteRequest(prev=>({id,n:(prev?.n||0)+1}))} getVideo={()=>viewerVideoRef.current} annotations={livePreview.annotations||[]} annotationsVisible={Boolean(annotationsVisibleBySource[owner.id])} onAnnotationsVisibleChange={next=>setAnnotationsVisibleBySource(prev=>({...prev,[owner.id]:next}))} onAnnotationRange={(id,start,end)=>{void save(sourcesRef.current.map(s=>s.id===owner.id?{...s,assets:s.assets.map(a=>a.id===livePreview.id?{...a,annotations:(a.annotations||[]).map(n=>n.id===id?{...n,start,end,time:undefined}:n)}:a)}:s))}} onExport={async state=>{
      const library=rootRef.current;
      const {asset}=await exportEditedVideoAsset({state,source:owner,originalAsset:livePreview,sources:sourcesRef.current});
      if(rootRef.current!==library||!sourcesRef.current.some(s=>s.id===owner.id&&!s.trashedAt&&s.assets.some(a=>a.id===livePreview.id&&!a.trashedAt)))throw Error('The source changed while the clip was rendering.');
      if(!await save(insertExportedAssetIntoSources(sourcesRef.current,owner.id,asset,livePreview.id)))throw Error('The clip rendered, but the library could not be saved.');
      setPreview(asset);
    }}/>}<div className="viewer-timing-slot" id="viewer-timing-slot"/></div><aside className="viewer-details"><Tabs defaultValue="details" className="viewer-tabs-root"><div className="viewer-details-head"><TabsList className="viewer-tabs"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="assets">Assets{owner&&owner.assets.length>0&&<span className="viewer-tab-count">{owner.assets.length}</span>}</TabsTrigger><TabsTrigger value="notes">Notes{noteCount>0&&<span className="viewer-tab-count">{noteCount}</span>}</TabsTrigger></TabsList></div><div className="viewer-details-scroll"><TabsContent value="details" forceMount>{owner&&<ViewerDetails key={livePreview.id} source={owner} asset={livePreview} knownTags={livePreview.kind==='font'?fontTagList:referenceTagList} onSaveSource={changes=>save(sourcesRef.current.map(s=>s.id===owner.id?{...s,...changes,favicon:changes.url!==undefined&&changes.url!==s.url?undefined:s.favicon}:s))} onSaveAsset={changes=>save(sourcesRef.current.map(s=>s.id===owner.id?{...s,assets:s.assets.map(a=>a.id===livePreview.id?{...a,...changes}:a)}:s))} onOpen={openExternal} onReveal={()=>void revealAsset(livePreview.file)}/>}</TabsContent><TabsContent value="assets" forceMount>{owner&&<div className="viewer-assets"><div className="detail-head"><span>All assets</span><span className="viewer-kind-pill">{owner.assets.length} {owner.assets.length===1?'item':'items'}</span></div><div className="viewer-assets-actions"><Button variant="outline" size="sm" className="upload" onClick={()=>void addFiles(owner.id)}><Plus size={14}/> Import files</Button>{owner.category==='Post Ideas'&&owner.url&&<Button variant="outline" size="sm" className="post-download" disabled={downloading} onClick={()=>void downloadPost(owner)}>{downloading?'Downloading media...':'Download post media'}</Button>}</div>{allFonts.some(font=>!owner.assets.some(a=>a.file===font.file))&&<div className="link-font"><label htmlFor="font-link">Link an existing font</label><div><ChoiceMenu id="font-link" label="Link an existing font" value={fontToLink} onChange={setFontToLink} options={allFonts.filter(font=>!owner.assets.some(a=>a.file===font.file)).map(font=>({value:font.file,label:font.name}))}/><Button variant="outline" size="sm" disabled={!fontToLink} onClick={()=>linkFont(owner.id)}>Link</Button></div></div>}<div className="asset-list">{owner.assets.map(a=><div className={'asset-row'+(a.id===livePreview.id?' active':'')+(reorderUi?.dragId===a.id?' is-reordering':'')+(reorderUi&&reorderUi.dragId!==a.id&&reorderUi.overId===a.id?(reorderUi.after?' drop-after':' drop-before'):'')} key={a.id} data-reorder-id={a.id} title="Drag to reorder" onPointerDown={e=>startAssetPointerDrag(e,owner.id,a.id,'y',reorderThumbnails)} onContextMenu={e=>showContext(e,owner.id,a.id)}><span className="asset-drag-handle" aria-hidden="true"><GripVertical size={14}/></span><Button variant="ghost" className="asset" onClick={()=>{if(suppressAssetClickRef.current){suppressAssetClickRef.current=false;return}setPreview(a)}}><span className="asset-thumb">{a.thumbnail?<img draggable={false} src={thumb(a.thumbnail,a.file)} alt=""/>:a.kind==='image'?<img draggable={false} src={src(a.file)} alt=""/>:a.kind==='video'?<Video size={16}/>:<span className="asset-font-glyph">Aa</span>}{a.kind==='video'&&a.thumbnail&&<span className="play-badge row-play-badge" aria-hidden="true"><Play fill="currentColor"/></span>}</span><div><strong>{a.name}</strong><span>{a.kind}</span></div></Button>{native()&&<Button variant="ghost" className="reveal-asset" aria-label={`Open location of ${a.name}`} title="Open asset location" onClick={()=>void revealAsset(a.file)}><FolderOpen size={14}/></Button>}<Button variant="ghost" className="remove-asset" aria-label={`Move ${a.name} to trash`} title="Move to trash" onClick={()=>trashItem(owner.id,a.id)}><X size={15}/></Button></div>)}</div><Button variant="ghost" className="remove-source" onClick={()=>trashItem(owner.id)}><Trash2 size={14}/> Move source to trash</Button></div>}</TabsContent><TabsContent value="notes" forceMount><div className="viewer-notes-intro"><div className="viewer-notes-icon"><MessageSquarePlus size={18}/></div><h2>What stands out?</h2><p>Pin notes to a frame or a point on the video timeline.</p>{(livePreview.kind==='image'||livePreview.kind==='video')&&<Button variant="outline" size="sm" className="viewer-notes-start" onClick={()=>{const btn=document.querySelector<HTMLButtonElement>('.annotation-toolbar button[data-action="add-annotation"]');if(btn&&btn.getAttribute('aria-pressed')!=='true')btn.click()}}><MessageSquarePlus size={14}/> {noteCount?'Add annotation':'Start annotating'}</Button>}</div><div id="viewer-annotation-list"/></TabsContent></div></Tabs></aside></div>{owner&&<div className="viewer-strip" aria-label="Assets from this source" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('dragging')}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as globalThis.Node))e.currentTarget.classList.remove('dragging')}} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');if(owner)void importFiles(owner.id,Array.from(e.dataTransfer.files))}}>{visuals.map(a=><Button variant="ghost" key={a.id} data-reorder-id={a.id} title="Drag to reorder; the first item is the card cover" onPointerDown={e=>startAssetPointerDrag(e,owner.id,a.id,'x',reorderThumbnails)} onContextMenu={e=>owner&&showContext(e,owner.id,a.id)} aria-label={`View ${a.name}`} aria-pressed={a.id===livePreview.id} className={(a.id===livePreview.id?'active':'')+(reorderUi?.dragId===a.id?' is-reordering':'')+(reorderUi&&reorderUi.dragId!==a.id&&reorderUi.overId===a.id?(reorderUi.after?' drop-after':' drop-before'):'')} onClick={()=>{if(suppressAssetClickRef.current){suppressAssetClickRef.current=false;return}setPreview(a)}}><span className="strip-drag-indicator" aria-hidden="true"><GripHorizontal size={12}/></span>{a.thumbnail?<img draggable={false} src={thumb(a.thumbnail,a.file)} alt=""/>:a.kind==='video'?<video src={src(a.file)} muted preload="metadata"/>:<img draggable={false} src={src(a.file)} alt=""/>}{a.kind==='video'&&<span className="play-badge strip-play-badge" aria-hidden="true"><Play fill="currentColor"/></span>}{a.id===coverVisualId&&<span className="strip-cover-badge" aria-hidden="true">Cover</span>}</Button>)}<Button variant="ghost" type="button" className="viewer-add" aria-label="Add files" title="Add files" onClick={()=>void addFiles(owner.id)}><Plus size={18}/></Button><span className="viewer-drop-hint">Drag to reorder. The first item is the cover.</span></div>}</></div></div>})()}
 {canvasDiscoverMenu&&<DropdownMenu key={`${canvasDiscoverMenu.x}-${canvasDiscoverMenu.y}`} open onOpenChange={open=>{if(!open)setCanvasDiscoverMenu(null)}}><DropdownMenuTrigger asChild><span aria-hidden="true" style={{position:'fixed',left:canvasDiscoverMenu.x,top:canvasDiscoverMenu.y,width:1,height:1,pointerEvents:'none'}}/></DropdownMenuTrigger><DropdownMenuContent className="reference-context" align="start" sideOffset={2} collisionPadding={10} onPointerDown={e=>e.stopPropagation()}><DropdownMenuGroup><DropdownMenuItem onSelect={()=>{openLink(canvasDiscoverMenu.site.url).catch(e=>setError(String(e)));setCanvasDiscoverMenu(null)}}><OpenIcon size={15}/>Open website</DropdownMenuItem>{root&&<DropdownMenuItem onSelect={()=>{saveDiscoverSite(canvasDiscoverMenu.site);setCanvasDiscoverMenu(null)}}><Plus size={15}/>Save to library</DropdownMenuItem>}<DropdownMenuItem onSelect={()=>{toggleCanvasVisited(canvasDiscoverMenu.site.url,canvasDiscoverMenu.site.title);setCanvasDiscoverMenu(null)}}><Check size={15}/>{canvasVisited[canvasDiscoverMenu.site.url]?'Mark as unvisited':'Mark as visited'}</DropdownMenuItem>{canvasDiscoverMenu.site.image&&<DropdownMenuItem onSelect={()=>{const imgSrc=canvasDiscoverMenu.site.image.startsWith('local:')&&canvasDiscoverImageDir?convertFileSrc(`${canvasDiscoverImageDir}\\${canvasDiscoverMenu.site.image.slice(6)}`):canvasDiscoverMenu.site.image;setCanvasDiscoverMenu(null);if(imgSrc)void copyImageUrlToClipboard(imgSrc).catch(e=>setError('Could not copy image to clipboard: '+String(e)))}}><Copy size={15}/>Copy cover image</DropdownMenuItem>}<DropdownMenuItem onSelect={()=>{void navigator.clipboard.writeText(canvasDiscoverMenu.site.url).catch(()=>setError('Could not copy the link.'));setCanvasDiscoverMenu(null)}}><Copy size={15}/>Copy website link</DropdownMenuItem><div className="context-divider"/><DropdownMenuItem className="context-danger" onSelect={()=>{removeCanvasDiscoverSite(canvasDiscoverMenu.site);setCanvasDiscoverMenu(null)}}><Trash2 size={15}/>Move to trash</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
 {contextMenu&&<DropdownMenu key={`${contextMenu.x}-${contextMenu.y}`} open onOpenChange={open=>{if(!open)setContextMenu(null)}}><DropdownMenuTrigger asChild><span aria-hidden="true" style={{position:'fixed',left:contextMenu.x,top:contextMenu.y,width:1,height:1,pointerEvents:'none'}}/></DropdownMenuTrigger><DropdownMenuContent align="start" sideOffset={2} collisionPadding={10} className="reference-context" onPointerDown={e=>e.stopPropagation()}><DropdownMenuGroup>{contextMenu.sourceId?(()=>{const source=allSources.find(s=>s.id===contextMenu.sourceId);const asset=source?.assets.find(a=>a.id===contextMenu.assetId);if(!source)return null;const cover=source.assets.find(a=>!a.trashedAt&&a.id===source.coverId)||source.assets.find(a=>!a.trashedAt&&(a.kind==='image'||a.kind==='video'))||source.assets.find(a=>!a.trashedAt)||source.assets[0];const targetAsset=asset||cover;const isTrashed=Boolean(source.trashedAt||asset?.trashedAt);const assetInTrash=targetAsset?isFileInTrashStorage(allSources,targetAsset.file):undefined;const fontFamily=!isTrashed&&asset?.kind==='font'?allFontFamilies.find(g=>g.variants.some(v=>v.asset.id===asset.id)):undefined;return <><div className="context-heading">{asset?'Item':'Source'}</div>{!isTrashed&&<DropdownMenuItem onSelect={()=>{setSelected(source.id);if(targetAsset)setPreview(targetAsset);else void addFiles(source.id);setContextMenu(null)}}><Play size={15}/>Open {asset?'item':'group'}</DropdownMenuItem>}{targetAsset&&<DropdownMenuItem onSelect={()=>{setContextMenu(null);void copyAsset(targetAsset,assetInTrash)}}><Copy size={15}/>{targetAsset.kind==='image'?'Copy image':targetAsset.kind==='video'?'Copy video path':'Copy file path'}</DropdownMenuItem>}{targetAsset&&<DropdownMenuItem onSelect={()=>{setContextMenu(null);void revealAsset(targetAsset.file,assetInTrash)}}><FolderOpen size={15}/>Open asset location</DropdownMenuItem>}{!isTrashed&&<DropdownMenuItem onSelect={()=>{toggleFavorite(source.id,asset?.id);setContextMenu(null)}}><Heart size={15}/>{(asset?.favorite??(!asset&&source.favorite))?'Remove from favorites':'Add to favorites'}</DropdownMenuItem>}{!isTrashed&&asset&&(asset.kind==='image'||asset.kind==='video')&&<DropdownMenuItem onSelect={()=>{setCover(source.id,asset.id);setContextMenu(null)}}><Image size={15}/>Set as cover</DropdownMenuItem>}{native()&&asset?.kind==='video'&&!isTrashed&&<><DropdownMenuItem onSelect={()=>{setSelected(source.id);setPreview(asset);setContextMenu(null)}}><Image size={15}/>Choose thumbnail...</DropdownMenuItem>{asset.customThumbnail&&<DropdownMenuItem onSelect={()=>{setContextMenu(null);void resetVideoThumbnail(asset)}}><RotateCcw size={15}/>Reset thumbnail</DropdownMenuItem>}</>}{!isTrashed&&<><DropdownMenuItem onSelect={()=>{setContextMenu(null);void addFiles(source.id)}}><Plus size={15}/>Import files</DropdownMenuItem><DropdownMenuItem onSelect={()=>{setEditingId(source.id);setFormError('');setDraft({title:source.title,url:source.url,category:source.category,tags:source.tags.join(', '),notes:source.notes});setEditing(true);setContextMenu(null)}}><Pencil size={15}/>Edit group details</DropdownMenuItem></>}{source.url&&<><DropdownMenuItem onSelect={()=>{openLink(source.url).catch(e=>setError(String(e)));setContextMenu(null)}}><OpenIcon size={15}/>Open website</DropdownMenuItem><DropdownMenuItem onSelect={()=>{void navigator.clipboard.writeText(source.url).catch(()=>setError('Could not copy the link.'));setContextMenu(null)}}><Copy size={15}/>Copy website link</DropdownMenuItem></>}<div className="context-divider"/>{isTrashed?<><DropdownMenuItem disabled={trashBusy} onSelect={()=>{restoreItem(source.id,asset?.id);setContextMenu(null)}}><RotateCcw size={15}/>Restore</DropdownMenuItem><DropdownMenuItem className="context-danger" disabled={trashBusy} onSelect={()=>{requestDeletePermanently(source.id,asset?.id);setContextMenu(null)}}><Trash2 size={15}/>Delete permanently</DropdownMenuItem></>:<DropdownMenuItem className="context-danger" disabled={trashBusy} onSelect={()=>{if(fontFamily){const seen=new Set<string>();const targets:TrashTarget[]=[];for(const v of fontFamily.variants){const k=`${v.sourceId}:${v.asset.id}`;if(!seen.has(k)){seen.add(k);targets.push({sourceId:v.sourceId,assetId:v.asset.id})}}void trashTargets(targets,fontFamily.family)}else trashItem(source.id,asset?.id);setContextMenu(null)}}><Trash2 size={15}/>{fontFamily?(fontFamily.variants.length>1?`Move ${fontFamily.family} (${fontFamily.variants.length} styles) to Trash`:`Move ${fontFamily.family} to Trash`):asset?'Move this item to Trash':`Move source and ${source.assets.filter(a=>!a.trashedAt).length} ${source.assets.filter(a=>!a.trashedAt).length===1?'item':'items'} to Trash`}</DropdownMenuItem>}</>})():contextMenu.copyText?<DropdownMenuItem onSelect={()=>{void navigator.clipboard.writeText(contextMenu.copyText!);setContextMenu(null)}}><Copy size={15}/>Copy</DropdownMenuItem>:<DropdownMenuItem onSelect={()=>{setSelected(null);setContextMenu(null)}}>Clear selection</DropdownMenuItem>}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
 <Dialog open={instagramOpen} onOpenChange={next=>{if(!instagramBusy)setInstagramOpen(next)}}><DialogContent className="source-dialog" onCloseAutoFocus={e=>{e.preventDefault();if(previewOpenRef.current)document.querySelector<HTMLElement>('.media-viewer')?.focus();else lastWorkspaceFocus.current?.focus()}}><div className="dialog-title"><div><DialogTitle id="instagram-title">Instagram collections</DialogTitle><DialogDescription>Connect saved collections using your signed-in Brave session.</DialogDescription></div></div><label>Post Ideas collection<Input value={instagramConfig.postIdeas} onChange={e=>setInstagramConfig({...instagramConfig,postIdeas:e.target.value})} placeholder="https://www.instagram.com/.../saved/..."/></label><label>Web design collection<Input value={instagramConfig.webDesign} onChange={e=>setInstagramConfig({...instagramConfig,webDesign:e.target.value})} placeholder="https://www.instagram.com/.../saved/..."/></label><p role="status">{instagramStatus}</p><div className="dialog-actions"><Button variant="ghost" onClick={()=>setInstagramOpen(false)} disabled={instagramBusy}>Close</Button><Button onClick={()=>void syncInstagram()} disabled={instagramBusy||!root}>{instagramBusy?'Syncing...':'Sync now'}</Button></div></DialogContent></Dialog>
 <Dialog open={editing} onOpenChange={next=>{setEditing(next);if(!next)setFormError('')}}><DialogContent className="source-dialog" onCloseAutoFocus={e=>{e.preventDefault();if(previewOpenRef.current)document.querySelector<HTMLElement>('.media-viewer')?.focus();else lastWorkspaceFocus.current?.focus()}}><div><DialogTitle>{editingId?'Edit reference':draft.category==='Post Ideas'?'New post idea':'New reference'}</DialogTitle><DialogDescription className="mt-2">Save a source first, then collect its images, motion and type.</DialogDescription></div><form onSubmit={e=>{e.preventDefault();void create()}}><FieldGroup><Field><FieldLabel htmlFor="source-title">Name</FieldLabel><Input id="source-title" autoFocus value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="A website, a studio, an idea?"/></Field><Field><FieldLabel htmlFor="source-url">Website <span>optional</span></FieldLabel><Input id="source-url" value={draft.url} onChange={e=>{setDraft({...draft,url:e.target.value});if(formError)setFormError('')}} placeholder="https://"/></Field><div className="form-row"><Field><FieldLabel htmlFor="source-category">Collection</FieldLabel><ChoiceMenu id="source-category" label="Category" value={draft.category} onChange={category=>setDraft({...draft,category})} options={categories.map(c=>({value:c,label:c}))}/></Field><Field><FieldLabel htmlFor="source-tags">Tags</FieldLabel><Input id="source-tags" value={draft.tags} onChange={e=>setDraft({...draft,tags:e.target.value})} placeholder="Editorial, playful"/></Field></div><Field><FieldLabel htmlFor="source-notes">Notes</FieldLabel><Textarea id="source-notes" value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="What caught your eye?"/></Field></FieldGroup>{formError&&<p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions mt-6"><Button type="button" variant="outline" onClick={()=>setEditing(false)}>Cancel</Button><Button type="submit" disabled={(!draft.title.trim()&&!draft.url.trim()&&draft.category!=='Post Ideas')||!root}>{editingId?'Save changes':'Create reference'}</Button></div></form></DialogContent></Dialog>
 <AddInspirationModal open={addInspirationOpen} defaultCategory={category==='All'?'Web design':category} knownTags={referenceTagList} nativeApp={native()} saving={inspirationSaving} onClose={()=>{setAddInspirationOpen(false);setDraftAnnotationsVisible(false)}} onSave={saveNewInspiration} renderAnnotations={({asset,onSave})=><Annotations key={asset.id} asset={asset} visible={draftAnnotationsVisible} onVisibleChange={setDraftAnnotationsVisible} onSave={onSave}/>} renderVideoPlayer={(url,keyId)=><ThemedPlayer key={keyId} url={url}/>}/>
 <AddFontDialog open={addFontOpen} initialTab={addFontTab} nativeApp={native()} rootReady={!!root} onOpenChange={setAddFontOpen} onImportGoogleFont={importGoogleFontHandler} onImportSystemFont={importSystemFontHandler} onImportManualFiles={importManualFontFilesHandler}/>
 <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}><DialogContent className="shortcut-dialog" onCloseAutoFocus={e=>{e.preventDefault();if(previewOpenRef.current)document.querySelector<HTMLElement>('.media-viewer')?.focus();else lastWorkspaceFocus.current?.focus()}}><div className="dialog-title"><div><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription className="mt-1">Quick navigation, review, and canvas controls.</DialogDescription></div></div><div className="shortcut-sections">{SHORTCUT_GROUPS.map(group=><section className="shortcut-group" key={group.title}><h3>{group.title}</h3>{group.items.map(item=><div className="shortcut-row" key={item.label}><span>{item.label}</span><span className="shortcut-keys">{item.keys.map(k=><kbd key={k}>{k}</kbd>)}</span></div>)}</section>)}</div><div className="dialog-actions"><Button variant="outline" size="sm" onClick={()=>setShortcutsOpen(false)}>Close</Button></div></DialogContent></Dialog>
 <Dialog open={!!confirmTrashAction} onOpenChange={open=>{if(!open&&!trashBusy)setConfirmTrashAction(null)}}><DialogContent className="source-dialog confirm-dialog" onCloseAutoFocus={e=>{e.preventDefault();if(previewOpenRef.current)document.querySelector<HTMLElement>('.media-viewer')?.focus();else lastWorkspaceFocus.current?.focus()}}><div className="dialog-title"><div><DialogTitle>{confirmTrashAction?.kind==='clear-trash'?'Delete all items permanently?':'Delete permanently?'}</DialogTitle><DialogDescription className="mt-2">{confirmTrashAction?.kind==='clear-trash'?`This will permanently delete ${confirmTrashAction.itemCount} ${confirmTrashAction.itemCount===1?'item':'items'} in Trash and remove their unshared files from disk. This action cannot be undone.`:confirmTrashAction?`This will permanently delete "${confirmTrashAction.title}"${confirmTrashAction.isSource&&confirmTrashAction.assetCount>0?` (${confirmTrashAction.assetCount} ${confirmTrashAction.assetCount===1?'item':'items'})`:''} from your library. This action cannot be undone.`:''}</DialogDescription></div></div><div className="dialog-actions"><Button type="button" variant="outline" disabled={trashBusy} onClick={()=>setConfirmTrashAction(null)}>Cancel</Button><Button type="button" variant="destructive" disabled={trashBusy} onClick={()=>void executeConfirmedTrashAction()}>{trashBusy?'Deleting...':confirmTrashAction?.kind==='clear-trash'?'Delete all':'Delete permanently'}</Button></div></DialogContent></Dialog>
 {undoToast&&<div className="undo-toast" role="status" aria-live="polite"><span className="undo-toast-msg">{undoToast.message}</span><div className="undo-toast-actions"><Button variant="ghost" size="sm" className="undo-toast-btn" onClick={()=>void triggerUndo()}>Undo</Button><Button variant="ghost" size="icon" className="undo-toast-close" aria-label="Dismiss" onClick={dismissUndo}><X size={14}/></Button></div></div>}</div>
}

type StudySite={title:string;url:string;image:string;tags:string[];colors?:string[];sources:{name:string;url:string;date:string|null;awards?:string[]}[]};
function DiscoverNotifications(){
 const [notice,setNotice]=useState('');
 useEffect(()=>{if(!native())return;let active=true;const check=async()=>{try{const raw=await invoke<string|null>('load_discover_catalog');if(!raw||!active)return;const urls=(JSON.parse(raw) as StudySite[]).map(s=>s.url);const previous=localStorage.getItem('sightline-discover-seen');if(previous){const old=new Set(JSON.parse(previous) as string[]);const count=urls.filter(url=>!old.has(url)).length;if(count)setNotice(`${count} new ${count===1?'website':'websites'} in Discover`)}localStorage.setItem('sightline-discover-seen',JSON.stringify(urls))}catch{}};void check();const timer=window.setInterval(check,60000);window.addEventListener('focus',check);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check)}},[]);
 return notice?<div className="discover-notice" role="status"><span>{notice}</span><Button variant="ghost" onClick={()=>setNotice('')} aria-label="Dismiss notification"><X size={14}/></Button></div>:null;
}
function DiscoverWorkspace({actionsRef,...props}:Omit<React.ComponentProps<typeof StudyCatalog>,'refreshKey'|'onBindRefresh'>&{actionsRef?:React.MutableRefObject<{add:()=>void;refresh:()=>void}>}){
 const discoverTrigger=useRef<HTMLElement|null>(null);
 const [open,setOpen]=useState(false);const [version,setVersion]=useState(0);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');const statusTimer=useRef<number|null>(null);
 const [draft,setDraft]=useState({title:'',url:'',image:'',tags:''});
 useEffect(()=>()=>{if(statusTimer.current)clearTimeout(statusTimer.current)},[]);
 const showStatus=(msg:string)=>{if(statusTimer.current){clearTimeout(statusTimer.current);statusTimer.current=null}setStatus(msg);if(msg)statusTimer.current=window.setTimeout(()=>setStatus(''),4500)};
 useEffect(()=>{if(actionsRef)actionsRef.current.add=()=>{discoverTrigger.current=document.activeElement as HTMLElement;setOpen(true)}},[actionsRef]);
 const add=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');showStatus('');try{await invoke('add_discover_site',{title:draft.title,url:draft.url,image:draft.image,tags:draft.tags.split(',')});invalidateDiscoverCatalog();try{const raw=await invoke<string|null>('load_discover_catalog');if(raw)localStorage.setItem('sightline-discover-seen',JSON.stringify((JSON.parse(raw) as StudySite[]).map(s=>s.url)))}catch{}showStatus(`${draft.title.trim()} added to Discover`);setDraft({title:'',url:'',image:'',tags:''});setOpen(false);setVersion(v=>v+1)}catch(e){setError(String(e))}finally{setBusy(false)}};
 return <><StudyCatalog refreshKey={version} {...props} onBindRefresh={fn=>{if(actionsRef)actionsRef.current.refresh=fn}}/>{status&&<div className="discover-notice" role="status"><span>{status}</span><Button variant="ghost" aria-label="Dismiss status" onClick={()=>showStatus('')}><X size={14}/></Button></div>}<Dialog open={open} onOpenChange={next=>{if(!busy)setOpen(next)}}><DialogContent className="source-dialog" onCloseAutoFocus={e=>{e.preventDefault();discoverTrigger.current?.focus()}}><div><DialogTitle>Add to Discover</DialogTitle><DialogDescription className="mt-2">Add a website to your Discover catalog.</DialogDescription></div><form onSubmit={e=>void add(e)}><FieldGroup><Field><FieldLabel htmlFor="discover-title">Website name</FieldLabel><Input id="discover-title" required value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></Field><Field><FieldLabel htmlFor="discover-url">Website URL</FieldLabel><Input id="discover-url" required type="url" placeholder="https://example.com" value={draft.url} onChange={e=>setDraft({...draft,url:e.target.value})}/></Field><Field><FieldLabel htmlFor="discover-image">Preview image URL</FieldLabel><Input id="discover-image" type="url" placeholder="https://example.com/image.jpg" value={draft.image} onChange={e=>setDraft({...draft,image:e.target.value})}/></Field><Field><FieldLabel htmlFor="discover-tags">Tags</FieldLabel><Input id="discover-tags" placeholder="Comma separated" value={draft.tags} onChange={e=>setDraft({...draft,tags:e.target.value})}/></Field></FieldGroup>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions mt-6"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Adding...':'Add website'}</Button></div></form></DialogContent></Dialog></>
}
function StudyCatalog({sources,gridView,onViewChange,pageSize,onPageSizeChange,onOpen,onShowSource,onSaveSite,onStatsChange,onBindRefresh,onPushUndo,onVisitedSync,refreshKey=0}:{sources:Source[];gridView:GridView;onViewChange:(v:GridView)=>void;pageSize:number;onPageSizeChange:(n:number)=>void;onOpen:(e:React.MouseEvent<HTMLAnchorElement>,url:string)=>void;onShowSource:(id:string)=>void;onSaveSite:(site:StudySite)=>void;onStatsChange?:(stats:{total:number;filtered:number;refreshing:boolean}|null)=>void;onBindRefresh?:(fn:()=>void)=>void;onPushUndo?:(message:string,undo:()=>Promise<void>|void)=>void;onVisitedSync?:(next:Record<string,boolean>)=>void;refreshKey?:number}){
 const [initialDiscoverFilters]=useState(loadDiscoverFilters); const [discoverSort,setDiscoverSort]=useState<'catalog'|'newest'|'oldest'|'name'|'shuffle'>(()=>{const value=localStorage.getItem('sightline-discover-sort');return value==='newest'||value==='oldest'||value==='name'||value==='shuffle'?value:'catalog'});const [discoverSeed,setDiscoverSeed]=useState(()=>Number(localStorage.getItem('sightline-discover-seed'))||Math.floor(Math.random()*0xffffffff));const [selectedIndustries,setSelectedIndustries]=useState<string[]>(initialDiscoverFilters.industries);const [sites,setSites]=useState<StudySite[]>([]);const [imageDir,setImageDir]=useState('');const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);const refreshBusy=useRef(false);const [refreshToast,setRefreshToast]=useState('');const refreshToastTimer=useRef<number|null>(null);const [error,setError]=useState('');const [query,setQuery]=useState('');const [selectedSources,setSelectedSources]=useState<string[]>(initialDiscoverFilters.sources);const [selectedTags,setSelectedTags]=useState<string[]>(initialDiscoverFilters.tags);const [statuses,setStatuses]=useState<string[]>(initialDiscoverFilters.statuses);const [selectedYears,setSelectedYears]=useState<string[]>(initialDiscoverFilters.years);const [selectedColors,setSelectedColors]=useState<string[]>(initialDiscoverFilters.colors);useEffect(()=>{savePersisted(DISCOVER_FILTERS_KEY,{industries:selectedIndustries,sources:selectedSources,tags:selectedTags,statuses,years:selectedYears,colors:selectedColors})},[selectedIndustries,selectedSources,selectedTags,statuses,selectedYears,selectedColors]);const [page,setPage]=useState(1);
 useEffect(()=>()=>{if(refreshToastTimer.current)clearTimeout(refreshToastTimer.current)},[]);
 const showRefreshToast=(msg:string,sticky=false)=>{if(refreshToastTimer.current){clearTimeout(refreshToastTimer.current);refreshToastTimer.current=null}setRefreshToast(msg);if(msg&&!sticky)refreshToastTimer.current=window.setTimeout(()=>setRefreshToast(''),4500)};
 useEffect(()=>{localStorage.setItem('sightline-discover-sort',discoverSort);localStorage.setItem('sightline-discover-seed',String(discoverSeed))},[discoverSort,discoverSeed]);
 const [visited,setVisited]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('sightline-study-visited')||'{}')}catch{return {}}});
 const visitedRef=useRef(visited);visitedRef.current=visited;
 const mountedRef=useRef(true);
 useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false}},[]);
 const [removed,setRemoved]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('sightline-study-removed')||'{}')}catch{return {}}});
 const [menu,setMenu]=useState<{x:number;y:number;site:StudySite}|null>(null);
 useEffect(()=>{let live=true;const load=async()=>{try{if(native()){const dir=await invoke<string>('discover_images_dir');if(live)setImageDir(dir);const saved=await invoke<string|null>('load_discover_catalog');if(saved!==null){const catalog=await attachDiscoverPalettes(JSON.parse(saved) as StudySite[]);if(live)setSites(catalog);return}}const response=await fetch('/study-sites.json');if(!response.ok)throw Error('Bundled catalog unavailable');const data=await response.text();if(native()){await invoke('initialize_discover_catalog',{data});const saved=await invoke<string|null>('load_discover_catalog');const catalog=await attachDiscoverPalettes(JSON.parse(saved||data) as StudySite[]);if(live)setSites(catalog)}else if(live)setSites(JSON.parse(data))}catch(e){if(live)setError('Could not load the website catalog: '+String(e))}finally{if(live)setLoading(false)}};void load();const focus=()=>void load();const timer=window.setInterval(focus,60000);window.addEventListener('focus',focus);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',focus)}},[refreshKey]);
 useEffect(()=>{if(!native()||!sites.length)return;void invoke('setup_discover_schedule').catch(e=>setError('Could not set up scheduled Discover refresh: '+String(e)))},[sites.length>0]);
 useEffect(()=>{if(!sites.length||!sources.length)return;const keys=new Set(sources.flatMap(source=>source.assets.flatMap(asset=>[inspirationUrlKey(source.url),inspirationUrlKey(asset.sourceUrl||'')])).filter(Boolean));setVisited(previous=>{const next={...previous};let changed=false;for(const site of sites){if(next[site.url]===undefined&&keys.has(inspirationUrlKey(site.url))){next[site.url]=true;changed=true}}if(!changed)return previous;try{localStorage.setItem('sightline-study-visited',JSON.stringify(next))}catch{setError('Could not save visit status.')}return next})},[sites,sources]);
 useEffect(()=>{const dismiss=()=>setMenu(null);const key=(e:KeyboardEvent)=>{if(e.key==='Escape')dismiss()};window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',key);return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',key)}},[]);
 const refresh=async()=>{if(!native()||refreshBusy.current)return;refreshBusy.current=true;setRefreshing(true);try{localStorage.setItem('sightline-discover-attempt',String(Date.now()))}catch{}showRefreshToast('Refreshing Discover...',true);setError('');try{const result=JSON.parse(await invoke<string>('refresh_discover_catalog'));invalidateDiscoverCatalog();const data=await invoke<string|null>('load_discover_catalog');if(data){const catalog=await attachDiscoverPalettes(JSON.parse(data) as StudySite[]);setSites(catalog);try{localStorage.setItem('sightline-discover-seen',JSON.stringify(catalog.map(s=>s.url)))}catch{}}if(!result.lapaFeedError&&!result.bookmarkErrors&&!result.indexErrors&&!result.cssErrors&&!result.possibleGap)try{localStorage.setItem('sightline-discover-refreshed',String(Date.now()))}catch{}const added=(result.added||0)+(result.bookmarkAdded||0)+(result.indexAdded||0)+(result.cssAdded||0);const issues=[result.lapaFeedError&&'Lapa',result.bookmarkErrors&&'Bookmarkify',result.indexErrors&&'Awwwards',result.cssErrors&&'CSS Design Awards'].filter(Boolean);if(added>0&&issues.length)showRefreshToast(`${added} added (${issues.join(', ')} offline)`);else if(added>0)showRefreshToast(`${added} new ${added===1?'website':'websites'} added`);else if(issues.length)showRefreshToast(`Refresh failed for ${issues.join(', ')}`);else if(result.errors)showRefreshToast('Some sources could not update');else if(result.indexStale||result.possibleGap)showRefreshToast('Discover updated (some sources behind)');else showRefreshToast('Discover is up to date')}catch(e){setError(String(e));showRefreshToast('Discover refresh failed')}finally{refreshBusy.current=false;setRefreshing(false)}};
 onBindRefresh?.(()=>{void refresh()});
 useEffect(()=>{if(!native()||!sites.length)return;const check=()=>{const now=Date.now();let last=0,attempt=0;try{last=Number(localStorage.getItem('sightline-discover-refreshed'))||0;attempt=Number(localStorage.getItem('sightline-discover-attempt'))||0}catch{}if(navigator.onLine&&now-last>=86400000&&now-attempt>=3600000)void refresh()};check();window.addEventListener('online',check);window.addEventListener('focus',check);return()=>{window.removeEventListener('online',check);window.removeEventListener('focus',check)}},[sites.length]);
 const toggle=(url:string,title?:string)=>{
   const prev=visitedRef.current;
   const hadKey=Object.prototype.hasOwnProperty.call(prev,url);
   const prevVal=prev[url];
   const nextVal=!prevVal;
   const next={...prev,[url]:nextVal};
   visitedRef.current=next;
   setVisited(next);
   onVisitedSync?.(next);
   try{localStorage.setItem('sightline-study-visited',JSON.stringify(next))}catch{setError('Could not save visit status.')}
   const label=title||sites.find(s=>s.url===url)?.title||displayUrl(url);
   onPushUndo?.(nextVal?`Marked "${label}" as visited`:`Marked "${label}" as unvisited`,()=>{
     let current:Record<string,boolean>={};
     try{current=JSON.parse(localStorage.getItem('sightline-study-visited')||'{}')}catch{current={...visitedRef.current}}
     if(hadKey)current[url]=prevVal;else delete current[url];
     try{localStorage.setItem('sightline-study-visited',JSON.stringify(current))}catch{if(mountedRef.current)setError('Could not save visit status.')}
     onVisitedSync?.(current);
     if(mountedRef.current){visitedRef.current=current;setVisited(current)}
   });
 };
 const remove=(url:string,title?:string)=>{
   let nextRemoved:Record<string,boolean>={};
   try{nextRemoved=JSON.parse(localStorage.getItem('sightline-study-removed')||'{}')}catch{nextRemoved={}}
   nextRemoved[url]=true;
   try{localStorage.setItem('sightline-study-removed',JSON.stringify(nextRemoved))}catch{setError('Could not save this change.');setMenu(null);return}
   setRemoved(nextRemoved);
   setMenu(null);
   const label=title||sites.find(s=>s.url===url)?.title||displayUrl(url);
   onPushUndo?.(`Removed "${label}" from Discover`,()=>{
     let restored:Record<string,boolean>={};
     try{restored=JSON.parse(localStorage.getItem('sightline-study-removed')||'{}')}catch{restored={}}
     delete restored[url];
     try{localStorage.setItem('sightline-study-removed',JSON.stringify(restored))}catch{if(mountedRef.current)setError('Could not restore website.');return}
     if(mountedRef.current)setRemoved(restored);
   });
 };
 const available=useMemo(()=>sites.filter(s=>!removed[s.url]),[sites,removed]);
 const {names,tags,industries,years,hasUnknownYear}=useMemo(()=>getDiscoverFilterOptions(available),[available]);
 useEffect(()=>{setPage(1)},[pageSize,query,selectedSources,selectedTags,selectedIndustries,statuses,selectedYears,selectedColors,discoverSort,discoverSeed]);
 const filtered=useMemo(()=>sortDiscoverSites(filterDiscoverSites(available,{query,colors:selectedColors,years:selectedYears,sources:selectedSources,industries:selectedIndustries,tags:selectedTags,statuses,visited,paletteSwatches:colors}),discoverSort,discoverSeed),[available,query,selectedColors,selectedYears,selectedSources,selectedIndustries,selectedTags,statuses,visited,discoverSort,discoverSeed]);
 useEffect(()=>{onStatsChange?.({total:available.length,filtered:filtered.length,refreshing})},[available.length,filtered.length,refreshing,onStatsChange]);
 useEffect(()=>()=>onStatsChange?.(null),[onStatsChange]);
 const discoverGroups:FilterGroup[]=[
    {key:'color',label:'Color',icon:<Palette size={15}/>,options:colors.map(c=>c.name),selected:selectedColors,onChange:setSelectedColors,getSwatch:colorSwatchByName},
    {key:'year',label:'Year',icon:<CalendarDays size={15}/>,options:[...years,...(hasUnknownYear?['Unknown']:[])],selected:selectedYears,onChange:setSelectedYears},
    {key:'source',label:'Source',icon:<Globe size={15}/>,options:names,selected:selectedSources,onChange:setSelectedSources},
    {key:'industry',label:'Industry',icon:<Boxes size={15}/>,options:industries,selected:selectedIndustries,onChange:setSelectedIndustries},
    {key:'tags',label:'Other tags',icon:<Tag size={15}/>,options:tags,selected:selectedTags,onChange:setSelectedTags},
    {key:'status',label:'Visit status',icon:<Check size={15}/>,options:['Unvisited','Visited'],selected:statuses,onChange:setStatuses}
 ];
 const hasFilters=discoverGroups.reduce((sum,g)=>sum+g.selected.length,0);
 const clearFilters=()=>{setSelectedYears([]);setSelectedSources([]);setSelectedTags([]);setSelectedIndustries([]);setStatuses([]);setSelectedColors([])};
 return <div className="study"><div className="toolbar study-toolbar"><div className="toolbar-main"><div className="search"><Search size={16}/><Input aria-label="Search Discover" placeholder="Search websites or tags" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<Button variant="ghost" className="search-clear" aria-label="Clear search" onClick={()=>setQuery('')}><X size={14}/></Button>}</div><FilterMenu activeCount={hasFilters} onClearAll={clearFilters} groups={discoverGroups}/><Dropdown label="Sort" icon={<ArrowDownWideNarrow size={15}/>} value={{catalog:"Catalog order",newest:"Newest",oldest:"Oldest",name:"Name",shuffle:"Shuffled"}[discoverSort]}><div className="menu-heading">Sort by</div>{([["catalog","Catalog order"],["newest","Newest first"],["oldest","Oldest first"],["name","Name"],["shuffle","Shuffled"]] as const).map(([value,label])=><Button variant="ghost" key={value} className="menu-option" aria-pressed={discoverSort===value} onClick={e=>{setDiscoverSort(value);if(value==="shuffle")setDiscoverSeed(Math.floor(Math.random()*0xffffffff));closeMenu(e)}}>{label}{discoverSort===value&&<Check size={14}/>}</Button>)}</Dropdown><div className="toolbar-spacer"/><ViewSwitch value={gridView} onChange={onViewChange}/></div>{!!hasFilters&&<div className="active-filters"><span>Filtering by</span>{discoverGroups.flatMap(g=>g.selected.map(value=>{const swatch=g.getSwatch?.(value);return <Button variant="ghost" key={`${g.key}-${value}`} onClick={()=>g.onChange(g.selected.filter(x=>x!==value))}>{swatch&&<span className="color-swatch" style={{background:swatch}}/>}{value}<X size={12}/></Button>}))}<Button variant="ghost" className="clear-filters" onClick={clearFilters}>Clear</Button></div>}</div><div className="study-content">{error&&<Empty className="empty" role="alert"><EmptyScene kind="search"/><EmptyHeader><EmptyTitle>Catalog unavailable</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader></Empty>}{loading?<div className={`study-grid view-${gridView}`} role="status" aria-label="Loading websites" style={gridView==='list'?undefined:{gridTemplateColumns:gridColumnsCss(gridView)}}>{Array.from({length:6},(_,i)=><div className="study-card study-skeleton" key={i} aria-hidden="true"><div className="study-cover"><div className="study-image"/></div><div className="study-card-body"><div className="study-skeleton-line"/><div className="study-skeleton-line short"/></div></div>)}</div>:<>
 <div className={`study-grid view-${gridView}`} style={gridView==='list'?undefined:{gridTemplateColumns:gridColumnsCss(gridView)}}>{filtered.slice((Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)))-1)*pageSize,Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)))*pageSize).map(site=>{const saved=sources.find(s=>s.assets.length>0&&s.assets.some(a=>[s.url,a.sourceUrl||''].some(url=>inspirationUrlKey(url)!==''&&inspirationUrlKey(url)===inspirationUrlKey(site.url))));return <article className="study-card" key={site.url} onContextMenu={e=>{e.preventDefault();e.stopPropagation();setMenu({...getContextCoordinates(e),site})}}><div className="study-cover"><a className="study-image" href={site.url} onClick={e=>onOpen(e,site.url)} aria-label={`Open ${site.title}`}><Globe className="study-image-placeholder" size={24} aria-hidden="true"/>{site.image&&<ScrollCoverImage src={discoverCoverSrc(site.image,imageDir)} loading="lazy" alt="" onError={e=>{e.currentTarget.style.display='none'}}/>}</a><Button variant="ghost" className={visited[site.url]?'visited active':'visited'} aria-label={visited[site.url]?'Mark unvisited':'Mark visited'} aria-pressed={!!visited[site.url]} title={visited[site.url]?'Mark unvisited':'Mark visited'} onClick={()=>toggle(site.url,site.title)}><Check size={15}/></Button></div><div className="study-card-body"><div className="study-card-title"><a href={site.url} onClick={e=>onOpen(e,site.url)}><span>{site.title}</span><ArrowUpRight size={14}/></a></div><div className="study-domain"><span>{displayUrl(site.url)}</span>{site.colors&&site.colors.length>0&&<span className="study-swatches" aria-label="Dominant colors">{site.colors.slice(0,2).map(hex=><i key={hex} style={{background:hex}} title={hex}/>)}</span>}</div>{site.tags.length>0&&<div className="card-tags">{site.tags.slice(0,3).map(t=><span key={t}>{t}</span>)}</div>}{saved&&<Button variant="ghost" className="study-saved" onClick={()=>onShowSource(saved.id)}>View saved assets <ArrowRight size={13}/></Button>}</div></article>})}</div>{filtered.length>0&&<Pagination total={filtered.length} page={Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)))} pageSize={pageSize} onPage={n=>{setPage(n);document.querySelector('.study')?.scrollTo({top:0})}} onPageSize={onPageSizeChange}/>}{!filtered.length&&!error&&<Empty className="empty"><EmptyScene kind="search"/><EmptyHeader><EmptyTitle>No matching websites</EmptyTitle><EmptyDescription>{statuses.length===1&&statuses[0]==='Unvisited'&&!query&&hasFilters===1?'All matching sites are marked visited. Clear the Visit status filter to see them.': 'No sites match the current search or filters.'}</EmptyDescription></EmptyHeader><div className="empty-actions">{(!!query||hasFilters>0)&&<Button variant="outline" size="sm" onClick={()=>{setQuery('');clearFilters()}}><RotateCcw size={14}/> Reset filters</Button>}</div></Empty>}</>}</div>{refreshToast&&<div className="discover-notice" role="status"><span>{refreshToast}</span><Button variant="ghost" aria-label="Dismiss refresh status" onClick={()=>showRefreshToast('')}><X size={14}/></Button></div>}{menu&&<DropdownMenu key={`${menu.x}-${menu.y}`} open onOpenChange={open=>{if(!open)setMenu(null)}}><DropdownMenuTrigger asChild><span aria-hidden="true" style={{position:'fixed',left:menu.x,top:menu.y,width:1,height:1,pointerEvents:'none'}}/></DropdownMenuTrigger><DropdownMenuContent className="reference-context" align="start" sideOffset={2} collisionPadding={10} onPointerDown={e=>e.stopPropagation()}><DropdownMenuGroup><DropdownMenuItem onSelect={()=>{openLink(menu.site.url).catch(e=>setError(String(e)));setMenu(null)}}><OpenIcon size={15}/>Open website</DropdownMenuItem><DropdownMenuItem onSelect={()=>{onSaveSite(menu.site);setMenu(null)}}><Plus size={15}/>Save to library</DropdownMenuItem><DropdownMenuItem onSelect={()=>{toggle(menu.site.url,menu.site.title);setMenu(null)}}><Check size={15}/>{visited[menu.site.url]?'Mark as unvisited':'Mark as visited'}</DropdownMenuItem>{menu.site.image&&<DropdownMenuItem onSelect={()=>{const imgSrc=menu.site.image.startsWith('local:')&&imageDir?convertFileSrc(`${imageDir}\\${menu.site.image.slice(6)}`):menu.site.image;setMenu(null);if(imgSrc)void copyImageUrlToClipboard(imgSrc).catch(e=>setError('Could not copy image to clipboard: '+String(e)))}}><Copy size={15}/>Copy cover image</DropdownMenuItem>}<DropdownMenuItem onSelect={()=>{void navigator.clipboard.writeText(menu.site.url).catch(()=>{});setMenu(null)}}><Copy size={15}/>Copy website link</DropdownMenuItem><div className="context-divider"/><DropdownMenuItem className="context-danger" onSelect={()=>remove(menu.site.url,menu.site.title)}><Trash2 size={15}/>Remove website</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}</div>
}

function CoverOptions({items,selected,onSelect,onContext,src,thumb}:{items:Asset[];selected?:string;onSelect:(id:string)=>void;onContext:(e:React.MouseEvent,id:string)=>void;src:(file:string)=>string;thumb:(file:string,assetFile?:string)=>string}){const ref=useRef<HTMLDivElement>(null);const [edges,setEdges]=useState({left:false,right:false});useEffect(()=>{const el=ref.current;if(!el)return;const update=()=>setEdges({left:el.scrollLeft>1,right:el.scrollLeft+el.clientWidth<el.scrollWidth-1});const observer=new ResizeObserver(update);observer.observe(el);el.addEventListener('scroll',update);update();return()=>{observer.disconnect();el.removeEventListener('scroll',update)}},[items.length]);const scroll=(direction:number)=>ref.current?.scrollBy({left:direction*100,behavior:'smooth'});return <div className="cover-picker"><Button variant="ghost" type="button" className="cover-scroll" aria-label="Previous covers" disabled={!edges.left} hidden={!edges.left&&!edges.right} onClick={()=>scroll(-1)}><ChevronLeft size={13}/></Button><div className="cover-options" ref={ref} aria-label="Choose cover">{items.map(item=><Button variant="ghost" key={item.id} aria-label={`Set ${item.name} as cover`} aria-pressed={item.id===selected} title={`Set ${item.name} as cover`} onContextMenu={e=>onContext(e,item.id)} className={item.id===selected?'active':''} onClick={()=>onSelect(item.id)}>{item.kind==='video'?(item.thumbnail?<img src={thumb(item.thumbnail,item.file)} loading="lazy" alt=""/>:<video src={src(item.file)} muted preload="metadata"/>):<img src={src(item.file)} loading="lazy" alt=""/>}{item.kind==='video'&&<span className="play-badge cover-play-badge" aria-hidden="true"><Play fill="currentColor"/></span>}</Button>)}</div><Button variant="ghost" type="button" className="cover-scroll" aria-label="Next covers" disabled={!edges.right} hidden={!edges.left&&!edges.right} onClick={()=>scroll(1)}><ChevronRight size={13}/></Button></div>}
function ViewSwitch({value,onChange}:{value:GridView;onChange:(v:GridView)=>void}){return <ToggleGroup type="single" value={value} onValueChange={next=>{if(next)onChange(next as GridView)}} className="view-switch" aria-label="Listing view">{([['compact','Extra small',Grip],['small','Small',Grid3X3],['medium','Medium',LayoutGrid],['large','Large',Square],['list','List',List]] as const).map(([key,label,Icon])=><ToggleGroupItem key={key} value={key} aria-label={`${label} view`} title={`${label} view`}><Icon/></ToggleGroupItem>)}</ToggleGroup>}

function Pagination({total,page,pageSize,onPage,onPageSize}:{total:number;page:number;pageSize:number;onPage:(n:number)=>void;onPageSize:(n:number)=>void}){const pages=Math.max(1,Math.ceil(total/pageSize));const sizeOptions=pageSizeOptions(useGridColumnsValue());return <nav className="pagination" aria-label="Pagination"><span className="pagination-count">{(total?((page-1)*pageSize+1):0).toLocaleString()} - {Math.min(page*pageSize,total).toLocaleString()} of {total.toLocaleString()}</span><div className="pagination-pages"><Button variant="ghost" aria-label="Previous page" disabled={page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={16}/></Button>{paginationPages(page,pages).map((item,i)=>item==='ellipsis'?<span className="pagination-ellipsis" key={`ellipsis-${i}`}>...</span>:<Button variant="ghost" key={item} aria-label={`Page ${item}`} aria-current={item===page?'page':undefined} className={item===page?'active':''} onClick={()=>onPage(item)}>{item}</Button>)}<Button variant="ghost" aria-label="Next page" disabled={page>=pages} onClick={()=>onPage(page+1)}><ChevronRight size={16}/></Button></div><label className="pagination-size">Per page <ChoiceMenu label="Cards per page" value={String(pageSize)} onChange={value=>onPageSize(Number(value))} options={sizeOptions.map(n=>({value:String(n),label:String(n)}))}/></label></nav>}

function closeMenu(_event:React.MouseEvent<HTMLElement>){document.dispatchEvent(new Event('sightline-close-menus'))}
function Dropdown({label,icon,value,active,onOpenChange,children}:{label:string;icon:React.ReactNode;value?:string;active?:boolean;onOpenChange?:(open:boolean)=>void;children:React.ReactNode}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{const close=()=>{setOpen(false);onOpenChange?.(false)};document.addEventListener('sightline-close-menus',close);return()=>document.removeEventListener('sightline-close-menus',close)},[onOpenChange]);
 return <Popover open={open} onOpenChange={next=>{setOpen(next);onOpenChange?.(next)}}><PopoverTrigger asChild><Button variant={active?'secondary':'outline'} size="sm" className={active?'filter-trigger active':'filter-trigger'}>{icon}<span>{value||label}</span><ChevronDown/></Button></PopoverTrigger><PopoverContent align="start" className="menu-panel" aria-label={`${label} options`}>{children}</PopoverContent></Popover>
}

function EmptyScene({kind,color,icon}:{kind:'library'|'category'|'search'|'favorites'|'fonts'|'canvas'|'trash';color?:string|null;icon?:React.ReactNode}){
 if(kind==='fonts')return <div className="empty-scene" aria-hidden="true"><div className="empty-specimen"><span className="empty-specimen-glyph">Aa</span><div className="empty-specimen-meta">TYPE SPECIMEN <span>WOFF2</span></div></div></div>;
 if(kind==='canvas')return <div className="empty-scene" aria-hidden="true"><div className="empty-canvas-scene"><svg className="empty-canvas-line" viewBox="0 0 144 86" fill="none"><path d="M44 26 C72 26, 72 60, 100 60" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3"/></svg><div className="empty-node a"><i/>Source</div><div className="empty-node b"><i/>Visual</div></div></div>;
 if(kind==='search')return <div className="empty-scene" aria-hidden="true"><div className="empty-pill-orb accent"><Search/></div>{color&&<span className="empty-color-dot" style={{background:color}}/>}</div>;
 if(kind==='trash')return <div className="empty-scene trash-scene" aria-hidden="true"><div className="empty-card back-left"/><div className="empty-card back-right"/><div className="empty-card front"><div className="empty-card-thumb"><Trash2/></div><div className="empty-card-bars"><i/><i/></div></div><div className="empty-badge"><Check/></div></div>;
 return <div className="empty-scene" aria-hidden="true"><div className="empty-card back-left"/><div className="empty-card back-right"/><div className="empty-card front"><div className="empty-card-thumb">{kind==='favorites'?<Heart fill="currentColor"/>:icon||<Aperture/>}</div><div className="empty-card-bars"><i/><i/></div></div>{kind==='library'&&<div className="empty-badge"><Sparkles/></div>}</div>;
}

function CardTags({tags}:{tags:string[]}){
 const ref=useRef<HTMLDivElement>(null);const [overflow,setOverflow]=useState(false),[more,setMore]=useState(false);
 useEffect(()=>{const el=ref.current;if(!el)return;const update=()=>{setOverflow(el.scrollWidth>el.clientWidth+1);setMore(el.scrollLeft+el.clientWidth<el.scrollWidth-1)};const observer=new ResizeObserver(update);observer.observe(el);update();return()=>observer.disconnect()},[tags.join('\0')]);
 if(!tags.length)return null;
 return <div ref={ref} className={'card-tags card-tags-scroll'+(more?' has-more':'')} tabIndex={overflow?0:undefined} aria-label={overflow?'Tags, scroll horizontally for more':undefined} onScroll={e=>{const el=e.currentTarget;setMore(el.scrollLeft+el.clientWidth<el.scrollWidth-1)}} onClick={e=>e.stopPropagation()} onWheel={e=>{const el=e.currentTarget;if(e.shiftKey&&Math.abs(e.deltaY)>Math.abs(e.deltaX)&&((e.deltaY>0&&el.scrollLeft+el.clientWidth<el.scrollWidth-1)||(e.deltaY<0&&el.scrollLeft>0))){el.scrollLeft+=e.deltaY;e.stopPropagation()}}}>{tags.map(tag=><span key={tag}>{tag}</span>)}</div>
}
function SiteIcon({source,root}:{source:Source;root:string}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[source.favicon,root]);return <span className="site-icon">{source.favicon&&!failed?<img src={convertFileSrc(`${root}\\favicons\\${source.favicon}`)} alt="" onError={()=>setFailed(true)}/>:<Globe size={13} aria-hidden="true"/>}</span>}
function Annotations({asset,visible:controlledVisible,onVisibleChange,timingOpen:controlledTimingOpen,onTimingOpenChange,desktopTimeline,openNote,onSave}:{asset:Asset;openNote?:{id:string;n:number}|null;visible?:boolean;onVisibleChange?:(visible:boolean)=>void;timingOpen?:boolean;onTimingOpenChange?:(open:boolean)=>void;desktopTimeline?:boolean;onSave:(annotations:Annotation[])=>Promise<boolean>}){
 const host=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null);const [bounds,setBounds]=useState({left:0,top:0,width:0,height:0});const [duration,setDuration]=useState(0);const [rangeDraft,setRangeDraft]=useState<{id:string;start:number;end:number}|null>(null);const rangeDraftRef=useRef<{id:string;start:number;end:number}|null>(null);const rangeDrag=useRef<{id:string;side:string;x:number;start:number;end:number;width:number}|null>(null);const [draftBox,setDraftBox]=useState<{x:number;y:number;w:number;h:number}|null>(null);const [drawing,setDrawing]=useState(false),[innerVisible,setInnerVisible]=useState(false),[innerTimingOpen,setInnerTimingOpen]=useState(false),[time,setTime]=useState(0),[status,setStatus]=useState('');
 const [playing,setPlaying]=useState(false);const [looping,setLooping]=useState(false);const videoScrubbing=useRef(false);
 const visible=controlledVisible??innerVisible;const timingOpen=controlledTimingOpen??innerTimingOpen;
 const setVisible=(next:boolean)=>{if(onVisibleChange)onVisibleChange(next);else setInnerVisible(next)};
 const setTimingOpen=(next:boolean)=>{if(onTimingOpenChange)onTimingOpenChange(next);else setInnerTimingOpen(next)};
 const areaDrag=useRef<{item:Annotation;x:number;y:number;width:number;height:number;resize:boolean;moved:boolean;next:Annotation}|null>(null);const suppressAreaClick=useRef(false);
 const annotations=asset.annotations||[];const [mounted,setMounted]=useState(false);useEffect(()=>setMounted(true),[]);const [editingNote,setEditingNote]=useState<{item:Annotation;isNew:boolean}|null>(null);const [noteText,setNoteText]=useState('');
 useEffect(()=>{if(!visible){setDrawing(false);setEditingNote(null)}},[visible]);
 useEffect(()=>{setPlaying(false)},[asset.id]);
 useEffect(()=>{const v=host.current?.parentElement?.querySelector('video');if(v)v.loop=looping},[looping,asset.id]);
 useEffect(()=>{const stage=host.current?.parentElement;if(!stage)return;let media:HTMLImageElement|HTMLVideoElement|null=null;const events=['timeupdate','seeked','play','pause','durationchange'] as const;const detach=(el:HTMLImageElement|HTMLVideoElement)=>{events.forEach(ev=>el.removeEventListener(ev,tick));observer.unobserve(el)};const refresh=()=>{const target=stage.querySelector(':scope > img, :scope > .themed-player video') as HTMLImageElement|HTMLVideoElement|null;if(!target)return;if(target!==media){if(media)detach(media);media=target;if(media instanceof HTMLVideoElement)media.loop=looping;events.forEach(ev=>media!.addEventListener(ev,tick));observer.observe(media);tick()}const r=target.getBoundingClientRect(),p=stage.getBoundingClientRect();let width=r.width,height=r.height;const iw=target instanceof HTMLVideoElement?target.videoWidth:target.naturalWidth,ih=target instanceof HTMLVideoElement?target.videoHeight:target.naturalHeight;if(target instanceof HTMLVideoElement&&Number.isFinite(target.duration))setDuration(target.duration);if(iw&&ih){const scale=Math.min(width/iw,height/ih);width=iw*scale;height=ih*scale}setBounds(old=>{const next={left:r.left-p.left+(r.width-width)/2,top:r.top-p.top+(r.height-height)/2,width,height};return old.left===next.left&&old.top===next.top&&old.width===next.width&&old.height===next.height?old:next})};const tick=()=>{if(media instanceof HTMLVideoElement){setTime(media.currentTime);setPlaying(!media.paused&&!media.ended);if(Number.isFinite(media.duration))setDuration(media.duration)}else{setTime(0);setPlaying(false)}};const observer=new ResizeObserver(refresh),mutation=new MutationObserver(refresh);observer.observe(stage);mutation.observe(stage,{childList:true,subtree:true});stage.addEventListener('load',refresh,true);stage.addEventListener('loadedmetadata',refresh,true);refresh();return()=>{observer.disconnect();mutation.disconnect();stage.removeEventListener('load',refresh,true);stage.removeEventListener('loadedmetadata',refresh,true);if(media)detach(media)}},[asset.id]);
 useEffect(()=>{if(asset.kind!=='video'||!duration)return;const fixed=annotations.map(a=>a.start===undefined?a:{...a,start:Math.max(0,Math.min(duration,a.start)),end:Math.max(0,Math.min(duration,a.end??duration))}).map(a=>a.start===undefined?a:{...a,end:Math.max(a.start,a.end??duration)});if(fixed.some((a,i)=>a.start!==annotations[i].start||a.end!==annotations[i].end))void onSave(fixed)},[duration,asset.id]);
 useEffect(()=>{if(!openNote)return;const item=(asset.annotations||[]).find(a=>a.id===openNote.id);if(item)edit(item)},[openNote]);const FRAME_STEP=1/60;
 const getVideo=()=>host.current?.parentElement?.querySelector('video')||null;
 const seekVideoTo=(target:number)=>{const video=getVideo();if(!video)return;const max=Number.isFinite(video.duration)&&video.duration>0?video.duration:duration;const clamped=Math.max(0,Math.min(max||0,target));video.currentTime=clamped;setTime(clamped)};
 const togglePlayPause=()=>{const video=getVideo();if(!video)return;if(video.paused)void video.play().catch(()=>{});else video.pause()};
 const stepVideo=(frames:number)=>{const video=getVideo();if(!video)return;video.pause();seekVideoTo(video.currentTime+frames*FRAME_STEP)};
 const save=(items:Annotation[])=>{setEditingNote(current=>{if(!current||current.isNew)return current;const item=items.find(a=>a.id===current.item.id);return item?{...current,item}:null});setStatus('Saving...');void onSave(items).then(ok=>setStatus(ok?'Saved':'Could not save'))};
 const edit=(item:Annotation,isNew=false)=>{setVisible(true);getVideo()?.pause();setNoteText(item.text);setEditingNote({item,isNew})};
 const point=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}};
 const seek=(item:Annotation)=>{setVisible(true);const video=getVideo();if(video&&(item.start!==undefined||item.time!==undefined)){const at=item.start??item.time??0;video.pause();video.currentTime=at;setTime(at)}edit(item)};
 const stageRect=host.current?.getBoundingClientRect();
 const stageWidth=stageRect?.width||bounds.left+bounds.width;
 const stageHeight=stageRect?.height||bounds.top+bounds.height;
 return <div className="annotation-ui" ref={host}><div className="annotation-toolbar"><Button variant="ghost" type="button" data-action="add-annotation" className="annotation-icon-button" aria-label={drawing?'Finish annotating':'Add annotation'} title={drawing?'Finish annotating':'Add annotation'} aria-pressed={drawing} onClick={()=>{const next=!drawing;setDrawing(next);if(next)setVisible(true);getVideo()?.pause()}}><MessageSquarePlus size={16}/></Button><Button variant="ghost" type="button" className="annotation-icon-button" title={visible?'Hide annotations':'Show annotations'} aria-label={visible?'Hide annotations':'Show annotations'} aria-pressed={visible} onClick={()=>{const next=!visible;setVisible(next);if(!next)setDrawing(false)}}>{visible?<Eye size={16}/>:<EyeOff size={16}/>}</Button>{asset.kind==='video'&&<Button variant="ghost" type="button" data-action="toggle-timeline" className="annotation-icon-button" aria-label={timingOpen?'Hide video timeline':'Show video timeline'} title={timingOpen?'Hide video timeline':'Show video timeline'} aria-pressed={timingOpen} onClick={()=>setTimingOpen(!timingOpen)}><SlidersHorizontal size={16}/></Button>}<span role="status">{status}</span></div><div className={'annotation-canvas'+(drawing?' drawing':'')} style={{...bounds}} onPointerDown={e=>{if(!drawing||e.button!==0)return;e.preventDefault();start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(!start.current)return;const p=start.current,q=point(e);setDraftBox({x:Math.min(p.x,q.x),y:Math.min(p.y,q.y),w:Math.abs(p.x-q.x),h:Math.abs(p.y-q.y)})}} onPointerCancel={()=>{start.current=null;setDraftBox(null)}} onPointerUp={e=>{if(!start.current)return;setDraftBox(null);const end=point(e),p=start.current;start.current=null;const w=Math.abs(end.x-p.x),h=Math.abs(end.y-p.y);edit({id:crypto.randomUUID(),x:Math.min(end.x,p.x),y:Math.min(end.y,p.y),w:w>.01&&h>.01?w:0,h:w>.01&&h>.01?h:0,text:'',...(asset.kind==='video'?{start:time,end:duration>0?duration:undefined}:{})},true)}}>{draftBox&&<div className="annotation-draft" style={{left:`${draftBox.x*100}%`,top:`${draftBox.y*100}%`,width:`${draftBox.w*100}%`,height:`${draftBox.h*100}%`}}/>}{visible&&annotations.map((a,i)=>(a.start!==undefined?(time<a.start||time>(a.end??a.start+2)):a.time!==undefined&&Math.abs(a.time-time)>1)?null:<Button variant="ghost" key={a.id} type="button" className={'annotation-pin'+(a.w&&a.h?' area':'')} style={{left:`${a.x*100}%`,top:`${a.y*100}%`,width:a.w?`${a.w*100}%`:undefined,height:a.h?`${a.h*100}%`:undefined}} title={a.text} aria-label={`Annotation ${i+1}: ${a.text}`} onPointerDown={e=>{e.stopPropagation();if(!a.w||!a.h||e.button!==0)return;getVideo()?.pause();const rect=e.currentTarget.parentElement!.getBoundingClientRect();areaDrag.current={item:a,x:e.clientX,y:e.clientY,width:rect.width,height:rect.height,resize:(e.target as HTMLElement).classList.contains('annotation-resize'),moved:false,next:a};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const d=areaDrag.current;if(!d||d.item.id!==a.id)return;const dx=(e.clientX-d.x)/d.width,dy=(e.clientY-d.y)/d.height;if(Math.abs(e.clientX-d.x)+Math.abs(e.clientY-d.y)>3)d.moved=true;if(!d.moved)return;d.next=d.resize?{...d.item,w:Math.max(.01,Math.min(1-d.item.x,d.item.w+dx)),h:Math.max(.01,Math.min(1-d.item.y,d.item.h+dy))}:{...d.item,x:Math.max(0,Math.min(1-d.item.w,d.item.x+dx)),y:Math.max(0,Math.min(1-d.item.h,d.item.y+dy))};Object.assign(e.currentTarget.style,{left:`${d.next.x*100}%`,top:`${d.next.y*100}%`,width:`${d.next.w*100}%`,height:`${d.next.h*100}%`})}} onPointerUp={e=>{const d=areaDrag.current;if(!d||d.item.id!==a.id)return;e.stopPropagation();areaDrag.current=null;suppressAreaClick.current=d.moved;if(d.moved)save(annotations.map(item=>item.id===a.id?d.next:item))}} onPointerCancel={e=>{areaDrag.current=null;Object.assign(e.currentTarget.style,{left:`${a.x*100}%`,top:`${a.y*100}%`,width:`${a.w*100}%`,height:`${a.h*100}%`})}} onClick={e=>{e.stopPropagation();if(suppressAreaClick.current){suppressAreaClick.current=false;return}edit(a)}}>{i+1}{!!a.w&&!!a.h&&<span className="annotation-resize" aria-hidden="true"/>}</Button>)}</div>{editingNote&&<form className="annotation-note-editor" aria-label={editingNote.isNew?'New annotation':'Edit annotation'} style={{left:Math.max(8,Math.min(bounds.left+bounds.width*editingNote.item.x,stageWidth-292)),top:Math.max(58,Math.min(bounds.top+bounds.height*(editingNote.item.y+(editingNote.item.h||0))+8,stageHeight-196))}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();setEditingNote(null)}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter')e.currentTarget.requestSubmit()}} onSubmit={e=>{e.preventDefault();const text=noteText.trim();if(!text)return;const item=mergeAnnotationNote(annotations,editingNote.item,text);save(editingNote.isNew?[...annotations,item]:annotations.map(a=>a.id===item.id?item:a));setEditingNote(null)}}><div className="annotation-note-heading"><strong>{editingNote.isNew?'New annotation':'Annotation'}</strong><Button variant="ghost" type="button" aria-label="Close annotation" onClick={()=>setEditingNote(null)}><X size={16}/></Button></div><Textarea autoFocus aria-label="Annotation note" placeholder="What caught your eye?" value={noteText} onChange={e=>setNoteText(e.target.value)}/><div className="annotation-note-actions">{!editingNote.isNew&&<Button variant="ghost" type="button" className="annotation-note-delete" onClick={()=>{save(annotations.filter(a=>a.id!==editingNote.item.id));setEditingNote(null)}}><Trash2 size={14}/> Delete</Button>}<span/><Button variant="ghost" type="button" onClick={()=>setEditingNote(null)}>Cancel</Button><Button variant="ghost" type="submit" disabled={!noteText.trim()}><CheckIcon size={14}/> Save</Button></div></form>}{mounted&&annotations.length>0&&document.getElementById('viewer-annotation-list')&&createPortal(<details className="annotation-index" open><summary>Annotations <span>{annotations.length}</span></summary>{annotations.map((a,i)=><Button variant="ghost" key={a.id} onClick={()=>seek(a)}>{i+1}. {a.text}{(a.start!==undefined||a.time!==undefined)&&<small> {(a.start??a.time??0).toFixed(1)} - {(a.end??((a.time??0)+2)).toFixed(1)}s</small>}</Button>)}</details>,document.getElementById('viewer-annotation-list')!)}{timingOpen&&!desktopTimeline&&asset.kind==='video'&&duration>0&&document.getElementById('viewer-timing-slot')&&createPortal(<div className="annotation-timeline"><div className="annotation-timeline-heading"><div className="annotation-timeline-title"><span>Video timeline</span><small>Drag bars or scrub playhead</small></div><div className="annotation-timeline-transport"><Button variant="ghost" type="button" aria-label={playing?'Pause':'Play'} title={playing?'Pause':'Play'} onClick={togglePlayPause}>{playing?<Pause size={13}/>:<Play size={13}/>}</Button><Button variant="ghost" type="button" aria-label="Jump to start" title="Jump to start" onClick={()=>{getVideo()?.pause();seekVideoTo(0)}}><SkipBack size={13}/></Button><Button variant="ghost" type="button" aria-label="Previous frame" title="Previous frame" onClick={()=>stepVideo(-1)}><ChevronLeft size={13}/></Button><Button variant="ghost" type="button" aria-label="Next frame" title="Next frame" onClick={()=>stepVideo(1)}><ChevronRight size={13}/></Button><Button variant="ghost" type="button" aria-label="Jump to end" title="Jump to end" onClick={()=>{getVideo()?.pause();seekVideoTo(duration)}}><SkipForward size={13}/></Button><Button variant="ghost" type="button" aria-label={looping?'Disable loop':'Loop playback'} title={looping?'Disable loop':'Loop playback'} aria-pressed={looping} onClick={()=>setLooping(v=>!v)}><Repeat size={13}/></Button><span className="annotation-timeline-clock">{formatTimecode(time)} / {formatTimecode(duration)}</span></div></div><div className="annotation-timeline-lanes">{annotations.map((item,i)=>{const legacyStart=Math.max(0,(item.time??0)-1),originalStart=Math.max(0,Math.min(duration,item.start??legacyStart)),originalEnd=Math.max(originalStart,Math.min(duration,item.end??(legacyStart+2))),range=rangeDraft?.id===item.id?rangeDraft:{start:originalStart,end:originalEnd};return <div className="annotation-timeline-lane" key={item.id}><div className="annotation-timeline-bar" role="slider" tabIndex={0} aria-label={`Annotation ${i+1}: ${item.text}. Use arrow keys to move; Shift and arrows resize the end.`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={range.start} title={`${item.text} - ${range.start.toFixed(2)} - ${range.end.toFixed(2)}s`} style={{left:`${range.start/duration*100}%`,width:`${Math.max(0,(range.end-range.start)/duration)*100}%`}} onDoubleClick={()=>edit(item)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const d=(e.key==='ArrowRight'?1:-1)*.1,len=originalEnd-originalStart;const nextStart=e.shiftKey?originalStart:Math.max(0,Math.min(duration-len,originalStart+d)),nextEnd=e.shiftKey?Math.max(Math.min(duration,nextStart+.1),Math.min(duration,originalEnd+d)):nextStart+len;save(annotations.map(a=>a.id===item.id?{...a,start:nextStart,end:nextEnd,time:undefined}:a))}} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();e.preventDefault();getVideo()?.pause();const lane=e.currentTarget.parentElement!;rangeDrag.current={id:item.id,side:(e.target as HTMLElement).dataset.side||'move',x:e.clientX,start:range.start,end:range.end,width:lane.getBoundingClientRect().width};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const drag=rangeDrag.current;if(!drag||drag.id!==item.id)return;const d=(e.clientX-drag.x)/drag.width*duration,min=Math.min(.1,duration),length=drag.end-drag.start;let begin=drag.start,end=drag.end;if(drag.side==='left')begin=Math.max(0,Math.min(end-min,begin+d));else if(drag.side==='right')end=Math.min(duration,Math.max(begin+min,end+d));else{begin=Math.max(0,Math.min(duration-length,begin+d));end=begin+length}rangeDraftRef.current={id:item.id,start:begin,end};setRangeDraft(rangeDraftRef.current)}} onPointerUp={()=>{const draft=rangeDraftRef.current;if(draft?.id===item.id)save(annotations.map(a=>a.id===item.id?{...a,start:draft.start,end:draft.end,time:undefined}:a));rangeDrag.current=null;rangeDraftRef.current=null;setRangeDraft(null)}} onPointerCancel={()=>{rangeDrag.current=null;rangeDraftRef.current=null;setRangeDraft(null)}}><span data-side="left" className="annotation-timeline-edge left"/><span className="annotation-timeline-label">{i+1}. {item.text}</span><span data-side="right" className="annotation-timeline-edge right"/></div></div>})}</div><div className="annotation-timeline-ruler" onPointerDown={e=>{const r=e.currentTarget.getBoundingClientRect();getVideo()?.pause();seekVideoTo((e.clientX-r.left)/r.width*duration)}}>{[0,.25,.5,.75,1].map(ratio=><span className="annotation-timeline-tick" key={ratio} style={{left:`${ratio*100}%`}}>{formatTimecode(duration*ratio)}</span>)}</div><div className="annotation-video-track" role="slider" tabIndex={0} aria-label="Video playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();getVideo()?.pause();const step=e.shiftKey?.1:1;seekVideoTo(time+(e.key==='ArrowRight'?step:-step))}} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();videoScrubbing.current=true;getVideo()?.pause();e.currentTarget.setPointerCapture(e.pointerId);const r=e.currentTarget.getBoundingClientRect();seekVideoTo((e.clientX-r.left)/r.width*duration)}} onPointerMove={e=>{if(!videoScrubbing.current)return;const r=e.currentTarget.getBoundingClientRect();seekVideoTo((e.clientX-r.left)/r.width*duration)}} onPointerUp={()=>{videoScrubbing.current=false}} onPointerCancel={()=>{videoScrubbing.current=false}}><div className="annotation-video-fill" style={{width:`${Math.min(100,Math.max(0,time/duration*100))}%`}}/><span>Video</span><span>{annotations.length?`${annotations.length} ${annotations.length===1?'note':'notes'}`:'Click or drag to scrub'}</span><i style={{left:`${Math.min(100,Math.max(0,time/duration*100))}%`}}/></div><div className="annotation-timeline-times"><span>{formatTimecode(0)}</span><span>{formatTimecode(duration)}</span></div></div>,document.getElementById('viewer-timing-slot')!)}</div>
}
function ThemedPlayer({url,onVideo}:{url:string;onVideo?:(video:HTMLVideoElement|null)=>void}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{const host=ref.current;if(!host)return;const video=document.createElement('video');video.src=url;video.playsInline=true;host.append(video);onVideo?.(video);const player=new Plyr(video,{iconUrl:'/brand/plyr.svg',autoplay:true,keyboard:{focused:false,global:false},controls:['play-large','play','progress','current-time','mute','volume','settings','fullscreen'],settings:['speed']});const blocked=(target:EventTarget|null)=>{if(document.querySelector('[role="dialog"]:not(.media-viewer)'))return true;if(isTextEntryElement(target))return true;return target instanceof HTMLElement&&Boolean(target.closest('.annotation-note-editor,[role="dialog"]:not(.media-viewer)'))};const onKeyDown=(event:KeyboardEvent)=>{if(event.code!=='Space'||event.ctrlKey||event.metaKey||event.altKey)return;if(document.querySelector('.desktop-timeline')||blocked(event.target)||!video.isConnected)return;event.preventDefault();event.stopPropagation();if(event.repeat)return;if(video.paused)void video.play().catch(()=>{});else video.pause()};const onKeyUp=(event:KeyboardEvent)=>{if(event.code!=='Space'||event.ctrlKey||event.metaKey||event.altKey)return;if(document.querySelector('.desktop-timeline')||blocked(event.target)||!video.isConnected)return;event.preventDefault();event.stopPropagation()};window.addEventListener('keydown',onKeyDown,true);window.addEventListener('keyup',onKeyUp,true);return()=>{window.removeEventListener('keydown',onKeyDown,true);window.removeEventListener('keyup',onKeyUp,true);onVideo?.(null);player.destroy();host.replaceChildren()}},[url]);return <div className="themed-player" ref={ref}/>}

function ViewerDetails({source,asset,knownTags,onSaveSource,onSaveAsset,onOpen,onReveal}:{source:Source;asset:Asset;knownTags:string[];onSaveSource:(changes:Partial<Source>)=>Promise<boolean>;onSaveAsset:(changes:Partial<Asset>)=>Promise<boolean>;onOpen:(event:React.MouseEvent<HTMLAnchorElement>,url:string)=>void;onReveal:()=>void}){
 const resolveTags=()=>asset.tags&&asset.tags.length?asset.tags:source.tags;
 const resolveNotes=()=>asset.notes&&asset.notes.trim()?asset.notes:source.notes;
 const [draft,setDraft]=useState({title:source.title,url:source.url,category:source.category,assetName:asset.name,tags:resolveTags(),notes:resolveNotes()});
 useEffect(()=>{setDraft({title:source.title,url:source.url,category:source.category,assetName:asset.name,tags:resolveTags(),notes:resolveNotes()});setDismissed(false)},[source.id,asset.id]);
 const [input,setInput]=useState('');const [state,setState]=useState('');const [active,setActive]=useState(0);const [dismissed,setDismissed]=useState(false);
 const options=dismissed?[]:knownTags.filter(t=>input.trim()&&t.toLowerCase().includes(input.trim().toLowerCase())&&!draft.tags.some(x=>x.toLowerCase()===t.toLowerCase()));
 const updateSource=(changes:Partial<Source>)=>{setDraft(d=>({...d,...changes}));setState('Saving...');void onSaveSource(changes).then(ok=>setState(ok?'Saved':'Could not save'))};
 const updateAsset=(changes:Partial<Asset>)=>{setDraft(d=>({...d,...(changes.name!==undefined?{assetName:changes.name}:{}),...(changes.tags!==undefined?{tags:changes.tags}:{}),...(changes.notes!==undefined?{notes:changes.notes}:{})}));setState('Saving...');void onSaveAsset(changes).then(ok=>setState(ok?'Saved':'Could not save'))};
 const addTag=(value:string)=>{const tag=value.trim();if(tag&&!draft.tags.some(t=>t.toLowerCase()===tag.toLowerCase()))updateAsset({tags:[...draft.tags,tag]});setInput('');setActive(0);setDismissed(false)};
 const kindLabel=asset.kind==='video'?'Video':asset.kind==='image'?'Image':asset.kind==='font'?'Font':'Asset';
 return <div className="viewer-form"><div className="viewer-status-bar"><span className="viewer-status-hint">Changes save automatically</span><span className={state?'viewer-save-pill active':'viewer-save-pill'} role="status">{state||'Ready'}</span></div><div className="viewer-section-head"><span>Source</span>{draft.url&&<a href={draft.url} className="viewer-open-link" onClick={e=>onOpen(e,draft.url)}>Open source <ArrowUpRight size={13}/></a>}</div><div className="viewer-field-group"><label><span>Name</span><Input value={draft.title} onChange={e=>updateSource({title:e.target.value})}/></label><label><span>Link</span><Input value={draft.url} onChange={e=>updateSource({url:e.target.value})} placeholder="https://"/></label><label><span>Category</span><ChoiceMenu label="Category" value={draft.category} onChange={category=>updateSource({category})} options={categories.map(c=>({value:c,label:c}))}/></label></div><div className="viewer-section-head asset-section"><span>Reference</span><span className="viewer-kind-pill">{kindLabel}</span></div><div className="viewer-field-group"><label><span>Item name</span><Input value={draft.assetName} onChange={e=>updateAsset({name:e.target.value})}/></label><div className="viewer-tags-wrap"><label htmlFor="viewer-tags"><span>Tags</span></label><div className="viewer-tags"><div className="viewer-tag-field">{draft.tags.map(tag=><span className="viewer-tag" key={tag}>{tag}<Button variant="ghost" type="button" aria-label={`Remove ${tag}`} onClick={()=>updateAsset({tags:draft.tags.filter(t=>t!==tag)})}><X size={12} aria-hidden="true"/></Button></span>)}<Input id="viewer-tags" value={input} placeholder="Add a tag..." autoComplete="off" aria-autocomplete="list" aria-controls="viewer-tag-suggestions" onChange={e=>{setInput(e.target.value);setActive(0);setDismissed(false)}} onKeyDown={e=>{if(e.key==='ArrowDown'&&options.length){e.preventDefault();setActive((active+1)%options.length)}else if(e.key==='ArrowUp'&&options.length){e.preventDefault();setActive((active+options.length-1)%options.length)}else if(e.key==='Escape'&&options.length){e.preventDefault();setDismissed(true)}else if(['Enter','Tab',','].includes(e.key)&&input.trim()){e.preventDefault();addTag(options[active]||input)}else if(e.key==='Backspace'&&!input&&draft.tags.length)updateAsset({tags:draft.tags.slice(0,-1)})}} onBlur={()=>{if(input.trim())addTag(input);setDismissed(false)}}/></div>{options.length>0&&<div id="viewer-tag-suggestions" className="viewer-tag-suggestions" role="listbox">{options.map((tag,i)=><Button variant="ghost" type="button" role="option" aria-selected={i===active} key={tag} onMouseDown={e=>e.preventDefault()} onClick={()=>addTag(tag)}>{tag}</Button>)}</div>}</div></div><label><span>Notes</span><Textarea value={draft.notes} placeholder="What caught your eye?" onChange={e=>updateAsset({notes:e.target.value})}/></label></div>{native()&&<Button variant="outline" size="sm" type="button" className="viewer-reveal-btn" onClick={onReveal}><FolderOpen size={14}/> Open asset location</Button>}</div>
}

function FontCard({group,src,onOpen,onContextMenu}:{group:FontFamilyGroup<Asset>;src:(file:string)=>string;onOpen:(asset:Asset)=>void;onContextMenu?:(e:React.MouseEvent,asset:Asset)=>void}){
 const [loaded,setLoaded]=useState<boolean|null>(null);
 const pills=useMemo(()=>getAvailableFontWeightPills(group.variants),[group.variants]);
 const [selectedPillKey,setSelectedPillKey]=useState<string>(()=>(pills.find(p=>p.asset.id===group.primaryAsset.id)||pills[0])?.key||'');
 useEffect(()=>{
  setSelectedPillKey((pills.find(p=>p.asset.id===group.primaryAsset.id)||pills[0])?.key||'');
 },[group.key,group.primaryAsset.id]);
 const activePill=pills.find(p=>p.key===selectedPillKey)||pills.find(p=>p.asset.id===group.primaryAsset.id)||pills[0];
 const activeVariant=(activePill&&group.variants.find(v=>v.asset.id===activePill.asset.id))||group.variants.find(v=>v.asset.id===group.primaryAsset.id)||group.variants[0];
 const cssFamily=`SightlineFont-${group.primaryAsset.id.replace(/[^a-zA-Z0-9_-]/g,'')}`;
 const variantKey=group.variants.map(v=>`${v.asset.file}:${v.weight}:${v.weightMin??''}:${v.weightMax??''}:${v.isVariable?1:0}:${v.style}`).join('|');
 useEffect(()=>{
  let alive=true;
  const faces:FontFace[]=[];
  setLoaded(null);
  Promise.allSettled(group.variants.map(v=>{
   const face=new FontFace(cssFamily,`url("${src(v.asset.file)}")`,{weight:getFontFaceWeightDescriptor(v),style:v.style});
   faces.push(face);
   return face.load().then(f=>{if(alive)document.fonts.add(f);return f});
  })).then(results=>{
   if(!alive)return;
   setLoaded(results.some(r=>r.status==='fulfilled'));
  });
  return()=>{alive=false;faces.forEach(f=>document.fonts.delete(f))};
 },[cssFamily,variantKey]);
 const specimenStyle=loaded?{fontFamily:`"${cssFamily}", sans-serif`,fontWeight:activePill?.weight??activeVariant.weight,fontStyle:activePill?.style??activeVariant.style}:undefined;
 const formatLabel=group.formats.length>1?`${group.formats[0]} +${group.formats.length-1}`:(group.formats[0]||'FONT');
 const variantMeta=`${pills.length} ${pills.length===1?'weight':'weights'} · ${group.linkedSources} linked ${group.linkedSources===1?'source':'sources'}`;
 return <article className="font-item" onContextMenu={e=>onContextMenu?.(e,activeVariant.asset)}><Button variant="ghost" className="font-card-open" onClick={()=>onOpen(activeVariant.asset)} aria-label={`Open ${group.family}`}><div className="font-card-top"><span className="font-glyph" style={specimenStyle}>Aa</span><Badge variant="secondary" className="font-format-badge">{formatLabel}</Badge></div><span className="font-specimen" style={specimenStyle}>{loaded?'The quick brown fox jumps over the lazy dog.':loaded===null?'Loading font...':'Preview unavailable in browser'}</span><span className="font-card-name"><strong>{group.family}</strong><small>{variantMeta}</small></span><ArrowUpRight size={16}/></Button><div className="font-weight">{pills.length>1?<div className="font-weight-pills" role="group" aria-label={`Available weights for ${group.family}`}>{pills.map(p=><button key={p.key} type="button" className={'font-weight-pill'+(p.key===activePill?.key?' active':'')} aria-pressed={p.key===activePill?.key} title={p.label} onClick={e=>{e.stopPropagation();setSelectedPillKey(p.key)}}>{p.shortLabel}</button>)}</div>:<span className="font-weight-single">{activePill?.label||`${activeVariant.weight}`}</span>}</div></article>;
}

function FontPreview({group,selectedAsset,src,nativeApp,fontStatus,onSelectVariant,onInstall,onReveal}:{group?:FontFamilyGroup<Asset>;selectedAsset:Asset;src:(file:string)=>string;nativeApp:boolean;fontStatus:string;onSelectVariant:(asset:Asset)=>void;onInstall:(asset:Asset)=>Promise<void>;onReveal:(file:string)=>void}){
 const variants=useMemo(()=>{
  if(group&&group.variants.length)return group.variants;
  const meta=parseFontFilenameMeta(selectedAsset.name||selectedAsset.file);
  const weight=selectedAsset.weight||meta.weight||400;
  const weightMin=selectedAsset.weightMin??weight;
  const weightMax=selectedAsset.weightMax??weight;
  return [{asset:selectedAsset,sourceId:'',weight,weightMin,weightMax,isVariable:Boolean(selectedAsset.isVariable)||weightMax>weightMin,style:selectedAsset.style||meta.style||'normal',format:(getFileExtension(selectedAsset.file)||'FONT').toUpperCase()}];
 },[group,selectedAsset]);
 const pills=useMemo(()=>getAvailableFontWeightPills(variants),[variants]);
 const activeVariant=variants.find(v=>v.asset.id===selectedAsset.id||v.asset.file===selectedAsset.file)||variants[0];
 const familyName=group?.family||selectedAsset.family||parseFontFilenameMeta(selectedAsset.name).family||selectedAsset.name;
 const [loaded,setLoaded]=useState<boolean|null>(null);
 const [sample,setSample]=useState('The quick brown fox jumps over the lazy dog.');
 const [selectedPillKey,setSelectedPillKey]=useState<string>(()=>(pills.find(p=>p.asset.id===activeVariant.asset.id)||pills[0])?.key||'');
 const [size,setSize]=useState(44);
 useEffect(()=>{
  setSelectedPillKey(prev=>pills.some(p=>p.key===prev&&p.asset.id===activeVariant.asset.id)?prev:((pills.find(p=>p.asset.id===activeVariant.asset.id)||pills[0])?.key||''));
 },[activeVariant.asset.id,group?.key,pills]);
 const activePill=pills.find(p=>p.key===selectedPillKey)||pills.find(p=>p.asset.id===activeVariant.asset.id)||pills[0];
 const selectPill=(pill:FontWeightPill<Asset>)=>{
  setSelectedPillKey(pill.key);
  if(pill.asset.id!==activeVariant.asset.id)onSelectVariant(pill.asset);
 };
 const cssFamily=`SightlinePreview-${(group?.key||selectedAsset.id).replace(/[^a-zA-Z0-9_-]/g,'')}`;
 const variantKey=variants.map(v=>`${v.asset.file}:${v.weight}:${v.weightMin??''}:${v.weightMax??''}:${v.isVariable?1:0}:${v.style}`).join('|');
 useEffect(()=>{
  let alive=true;
  const faces:FontFace[]=[];
  setLoaded(null);
  Promise.allSettled(variants.map(v=>{
   const face=new FontFace(cssFamily,`url("${src(v.asset.file)}")`,{weight:getFontFaceWeightDescriptor(v),style:v.style});
   faces.push(face);
   return face.load().then(f=>{if(alive)document.fonts.add(f);return f});
  })).then(results=>{
   if(!alive)return;
   setLoaded(results.some(r=>r.status==='fulfilled'));
  });
  return()=>{alive=false;faces.forEach(f=>document.fonts.delete(f))};
 },[cssFamily,variantKey]);
 const activeStyle=loaded?{fontFamily:`"${cssFamily}", sans-serif`,fontWeight:activePill?.weight??activeVariant.weight,fontStyle:activePill?.style??activeVariant.style}:undefined;
 const formats=Array.from(new Set(variants.map(v=>v.format))).join(' · ');
 const targetAsset=activePill?.asset||activeVariant.asset;
 return <div className="font-preview"><div className="font-preview-head"><div><small>{loaded?`Type specimen · ${pills.length} ${pills.length===1?'weight':'weights'}`:loaded===null?'Loading font...':'Preview unavailable for this font format'}</small><h3>{familyName}</h3></div><Badge variant="secondary">{formats||'FONT'}</Badge></div><div className="font-preview-controls"><Input aria-label="Specimen text" value={sample} onChange={e=>setSample(e.target.value)} placeholder="Type to test this font..."/><label className="font-size-control"><span>{size}px</span><input type="range" min={20} max={72} value={size} onChange={e=>setSize(Number(e.target.value))}/></label>{pills.length>1?<div className="font-preview-weights" role="group" aria-label="Available weights">{pills.map(p=><button key={p.key} type="button" className={'font-weight-pill'+(p.key===activePill?.key?' active':'')} aria-pressed={p.key===activePill?.key} onClick={()=>selectPill(p)}>{p.label}</button>)}</div>:<span className="font-weight-single">{activePill?.label||`${activeVariant.weight}`}</span>}</div><p className="font-preview-sample" style={{...activeStyle,fontSize:`${size}px`}}>{sample||'The quick brown fox jumps over the lazy dog.'}</p><div className="font-charset" style={activeStyle}><div>ABCDEFGHIJKLMNOPQRSTUVWXYZ</div><div>abcdefghijklmnopqrstuvwxyz</div><div>0123456789 !@#$%^&amp;*()_+-=[]&#123;&#125;;':&quot;,.&lt;&gt;/?</div></div>{pills.length>1&&<div className="font-waterfall"><div className="font-waterfall-head"><span>All weights &amp; styles ({pills.length})</span></div>{pills.map(p=>{const isCurrent=p.key===activePill?.key;const vFormat=variants.find(v=>v.asset.id===p.asset.id)?.format||'FONT';return <div className={'font-waterfall-row'+(isCurrent?' active':'')} key={p.key}><button type="button" className="font-waterfall-select" onClick={()=>selectPill(p)}><div className="font-waterfall-meta"><strong>{p.label}</strong><Badge variant="secondary">{vFormat}</Badge></div><span className="font-waterfall-line" style={loaded?{fontFamily:`"${cssFamily}", sans-serif`,fontWeight:p.weight,fontStyle:p.style}:undefined}>{sample||'The quick brown fox jumps over the lazy dog.'}</span></button>{nativeApp&&<div className="font-waterfall-actions"><Button variant="ghost" size="sm" onClick={()=>void onReveal(p.asset.file)} title="Open file location"><FolderOpen size={14}/></Button></div>}</div>})}</div>}<div className="font-install"><Button onClick={()=>void onInstall(targetAsset)}>Install {activePill?.label||'font'} on Windows</Button>{nativeApp&&<Button variant="outline" onClick={()=>onReveal(targetAsset.file)}><FolderOpen size={15}/> Open asset location</Button>}<span role="status">{fontStatus}</span></div></div>;
}

installAppEffects();
mountTitleTooltips();
createRoot(document.getElementById('root')!).render(<VideoPlaybackProvider><App/></VideoPlaybackProvider>);
