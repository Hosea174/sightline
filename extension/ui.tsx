import { mountTitleTooltips } from '../src/components/ui/title-tooltips';
import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Button} from '../src/components/ui/button';
import {Input} from '../src/components/ui/input';
import {Textarea} from '../src/components/ui/textarea';
import {Badge} from '../src/components/ui/badge';
import {Separator} from '../src/components/ui/separator';
import {Field,FieldGroup,FieldLabel,FieldDescription} from '../src/components/ui/field';
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from '../src/components/ui/tooltip';
import {DropdownMenu,DropdownMenuContent,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from '../src/components/ui/dropdown-menu';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '../src/components/ui/dialog';
import {Camera,Scan,ScanLine,Video,Type,ChevronRight,ChevronDown,Undo2,Redo2,RotateCcw,Scissors,Trash2,Play,Sun,Moon,Keyboard,Film,Save,Image,Crop,Gauge} from 'lucide-react';
import '@fontsource-variable/inter';
import '../src/theme.css';
import './interaction.css';
import './ui.css';

const root=document.getElementById('extension-root')!;
const mode=root.dataset.surface||'popup';
const recording=mode==='review';

type HoverTooltipProps={
 label:string;
 side?:'top'|'right'|'bottom'|'left';
 children:React.ReactElement<Record<string,unknown>>;
};

function HoverTooltip({label,side='top',children}:HoverTooltipProps){
 const [open,setOpen]=useState(false);
 return <Tooltip open={open} onOpenChange={()=>{}}>
  <TooltipTrigger asChild>
   {React.cloneElement(children,{
    'data-sightline-tooltip-trigger':'',
    onPointerEnter:(e:React.PointerEvent)=>{(children.props.onPointerEnter as ((ev:React.PointerEvent)=>void)|undefined)?.(e);setOpen(true)},
    onPointerLeave:(e:React.PointerEvent)=>{(children.props.onPointerLeave as ((ev:React.PointerEvent)=>void)|undefined)?.(e);setOpen(false)},
    onPointerDown:(e:React.PointerEvent)=>{(children.props.onPointerDown as ((ev:React.PointerEvent)=>void)|undefined)?.(e);setOpen(false)},
   })}
  </TooltipTrigger>
  <TooltipContent side={side} className="pointer-events-none extension-tooltip">
   {label}
  </TooltipContent>
 </Tooltip>;
}

function ThemeToggle(){
 const [dark,setDark]=useState(()=>localStorage.getItem('sightline-theme')==='dark');
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('sightline-theme',dark?'dark':'light')},[dark]);
 const label=dark?'Switch to light mode':'Switch to dark mode';
 return <HoverTooltip label={label} side="bottom">
  <Button variant="ghost" size="icon" className="theme-toggle" aria-label={label} onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</Button>
 </HoverTooltip>;
}

function IconButton({id,label,children,onClick}:{id?:string;label:string;children:React.ReactNode;onClick?:()=>void}){
 return <HoverTooltip label={label}>
  <Button variant="outline" size="icon" id={id} aria-label={label} onClick={onClick}>{children}</Button>
 </HoverTooltip>;
}

type SelectOption={value:string;label:string};
function CustomSelect({
 id,
 defaultValue,
 options,
 ariaLabel,
 triggerClassName,
 markChanged=false,
 formatValue,
 menuAlign='start',
}:{
 id:string;
 defaultValue:string;
 options:SelectOption[];
 ariaLabel:string;
 triggerClassName?:string;
 markChanged?:boolean;
 formatValue?:(value:string)=>string;
 menuAlign?:'start'|'end'|'center';
}){
 const [value,setValue]=useState(defaultValue);
 const inputRef=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{
  const input=inputRef.current;
  if(!input)return;
  const sync=()=>{if(input.value&&input.value!==value)setValue(input.value)};
  input.addEventListener('sightline:sync-value',sync);
  return()=>input.removeEventListener('sightline:sync-value',sync);
 },[value]);
 const handleChange=(next:string)=>{
  setValue(next);
  const input=inputRef.current;
  if(input){
   input.value=next;
   if(markChanged)input.dataset.changed='true';
   input.dispatchEvent(new Event('change',{bubbles:true}));
  }
 };
 const currentLabel=options.find(o=>o.value===value)?.label??(formatValue?formatValue(value):value);
 return <>
  <input ref={inputRef} type="hidden" id={id} defaultValue={defaultValue}/>
  <DropdownMenu>
   <DropdownMenuTrigger asChild>
    <button type="button" id={`${id}-trigger`} className={triggerClassName} aria-label={ariaLabel} data-value={value}>
     <span className="custom-select-value">{currentLabel}</span>
     <ChevronDown className="custom-select-chevron" aria-hidden="true"/>
    </button>
   </DropdownMenuTrigger>
   <DropdownMenuContent align={menuAlign} className="extension-select-menu">
    <DropdownMenuRadioGroup value={value} onValueChange={handleChange}>
     {options.map(opt=><DropdownMenuRadioItem key={opt.value} value={opt.value} className="extension-select-item">{opt.label}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
   </DropdownMenuContent>
  </DropdownMenu>
 </>;
}

type PopupStateDetail={recording?:boolean;shortcuts?:Record<string,string>};
function Popup(){
 const [popupState,setPopupState]=useState<{recording:boolean;shortcuts:Record<string,string>}>({recording:false,shortcuts:{}});
 useEffect(()=>{
  const onUpdate=(e:Event)=>{
   const detail=(e as CustomEvent<PopupStateDetail>).detail||{};
   setPopupState(prev=>({
    recording:detail.recording??prev.recording,
    shortcuts:detail.shortcuts?{...detail.shortcuts}:prev.shortcuts,
   }));
  };
  const onShortcut=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
   if(event.target instanceof HTMLElement&&event.target.closest('input, textarea, [contenteditable], [role=menu]'))return;
   const actions:Record<string,string>={s:'screenshot',f:'full-page',a:'area',v:'record',t:'fonts',r:'recordings',k:'shortcuts'};
   const action=actions[event.key.toLowerCase()];
   if(!action)return;
   const button=document.getElementById(action) as HTMLButtonElement|null;
   if(!button||button.disabled)return;
   event.preventDefault();
   button.click();
  };
  window.addEventListener('sightline:popup-state',onUpdate);
  window.addEventListener('keydown',onShortcut);
  return()=>{window.removeEventListener('sightline:popup-state',onUpdate);window.removeEventListener('keydown',onShortcut);};
 },[]);
 return <div className="capture-popup">
  <header className="popup-header"><div className="extension-brand"><img src="icons/icon-48.png" alt=""/><strong>Sightline</strong><Badge variant="secondary">Capture</Badge></div><ThemeToggle/></header>
  <main>
   <div className="tools">
    <HoverTooltip label="Capture visible tab" side="bottom">
     <Button id="screenshot" className="capture-primary" aria-label="Capture visible tab"><Camera/><span className="action-label">Capture visible tab</span></Button>
    </HoverTooltip>
    <div className="capture-options">
     <HoverTooltip label="Capture entire scrolling page" side="top">
      <Button variant="ghost" id="full-page" className="capture-option" aria-label="Capture full page"><span className="option-icon"><ScanLine/></span><span><strong>Full page</strong><small>Everything, top to bottom</small></span><ChevronRight/></Button>
     </HoverTooltip>
     <HoverTooltip label="Capture selected area" side="top">
      <Button variant="ghost" id="area" className="capture-option" aria-label="Capture area"><span className="option-icon"><Scan/></span><span><strong>Select an area</strong><small>Frame only what matters</small></span><ChevronRight/></Button>
     </HoverTooltip>
     <HoverTooltip label={popupState.recording?'Stop recording':'Record current tab'} side="top">
      <Button variant="ghost" id="record" className="capture-option" aria-label={popupState.recording?'Stop recording':'Start recording'}><span className="option-icon"><Video/></span><span><strong className="action-label">Record tab</strong><small>Capture motion &amp; interactions</small></span><ChevronRight/></Button>
     </HoverTooltip>
    </div>
   </div>
   <div className="popup-secondary"><Separator/>
    <HoverTooltip label="Inspect fonts used on this page" side="top">
     <Button variant="ghost" id="fonts" className="capture-option" aria-label="Explore page fonts"><span className="option-icon"><Type/></span><span><strong>Explore page fonts</strong><small>Collect webfonts &amp; weights</small></span><ChevronRight/></Button>
    </HoverTooltip>
   </div>
   <section className="popup-results"><div id="fontList"/><p id="status" role="status" aria-live="polite">Captures open in an editor before saving.</p></section>
  </main>
  <footer className="popup-footer">
   <HoverTooltip label="Open saved recordings" side="top"><Button variant="ghost" size="sm" id="recordings"><Film/> Recordings</Button></HoverTooltip>
   <HoverTooltip label="Customize extension shortcuts" side="top"><Button variant="ghost" size="sm" id="shortcuts"><Keyboard/> Shortcuts</Button></HoverTooltip>
  </footer>
 </div>;
}

const CATEGORY_OPTIONS:SelectOption[]=['Web design','Illustration','Motion graphics','Post Ideas','Other'].map(c=>({value:c,label:c}));
const SPEED_OPTIONS:SelectOption[]=['0.25','0.5','0.75','1','1.25','1.5','2','3','4'].map(v=>({value:v,label:`${v}×`}));

function Details(){return <aside className="capture-details"><div className="details-heading"><h2>Reference details</h2><p>A little context goes a long way.</p></div>
 <FieldGroup>
  <Field><FieldLabel htmlFor="title">Source name</FieldLabel><Input id="title" placeholder="Give your reference a name"/></Field>
  <Field><FieldLabel htmlFor="url">Website</FieldLabel><Input id="url" type="url" placeholder="https://"/></Field>
  <Field><FieldLabel htmlFor="category-trigger">Collection</FieldLabel><CustomSelect id="category" defaultValue="Web design" options={CATEGORY_OPTIONS} ariaLabel="Collection" triggerClassName="extension-select-trigger" markChanged/><span id="category-label" hidden/></Field>
  <Field><FieldLabel htmlFor="tags">Tags</FieldLabel><div className="tags-field"><span id="tag-pills"/><Input id="tags" placeholder="Add a tag…" aria-autocomplete="list" aria-controls="tag-suggestions" autoComplete="off"/></div><div id="tag-suggestions" className="tag-suggestions" hidden role="listbox" aria-label="Suggested tags"/></Field>
  <Field><FieldLabel htmlFor="notes">Notes</FieldLabel><Textarea id="notes" placeholder="What makes this worth keeping?"/></Field>
 </FieldGroup>
 <Separator className="details-separator"/>
 <div className="annotations-heading"><h3>Annotations</h3><span>Select the pen, then drag on the preview to leave a note.</span></div>
 </aside>}

const COMMON_SHORTCUTS:[string,string][]=[
 ['Toggle crop','C'],
 ['Add / finish annotation','A or Ctrl + Shift + .'],
 ['Show / hide annotations','H'],
 ['Save annotation note','Ctrl + Enter'],
 ['Undo','Ctrl + Z'],
 ['Redo','Ctrl + Y'],
 ['Exit tool / blur input','Esc'],
 ['Keyboard shortcuts','?'],
];
const VIDEO_SHORTCUTS:[string,string][]=[
 ['Play / pause','Space'],
 ['Step 1 / 10 frames','← / → or Shift + ← / →'],
 ['Jump to clip start / end','Home / End or Ctrl + Alt + ← / →'],
 ['Trim start / end to playhead','Q / W'],
 ['Retime clip speed','Drag an upper corner (Shift: 0.25× steps)'],
 ['Split clip at playhead','Ctrl + Alt + B'],
 ['Delete selected clip','Delete / Backspace'],
 ['Minimize / restore timeline','Ctrl + `'],
];

function ShortcutGuideDialog({open,onOpenChange}:{open:boolean;onOpenChange:(v:boolean)=>void}){
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="shortcut-dialog">
   <DialogHeader>
    <DialogTitle>Keyboard shortcuts</DialogTitle>
    <DialogDescription>Navigate, trim, crop, and annotate without leaving the keyboard.</DialogDescription>
   </DialogHeader>
   <div className="shortcut-sections">
    <div className="shortcut-group">
     <h4>Editor &amp; annotations</h4>
     <dl>{COMMON_SHORTCUTS.map(([label,keys])=><div className="shortcut-row" key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl>
    </div>
    {recording&&<div className="shortcut-group">
     <h4>Timeline &amp; playback</h4>
     <dl>{VIDEO_SHORTCUTS.map(([label,keys])=><div className="shortcut-row" key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl>
    </div>}
   </div>
  </DialogContent>
 </Dialog>;
}

type ConfirmOptions={title:string;description:string;confirmLabel?:string;destructive?:boolean};
function ConfirmDialog(){
 const [state,setState]=useState<(ConfirmOptions&{open:boolean})|null>(null);
 const resolverRef=useRef<((ok:boolean)=>void)|null>(null);
 useEffect(()=>{
  (window as unknown as {sightlineConfirm?:(opts:ConfirmOptions)=>Promise<boolean>}).sightlineConfirm=opts=>new Promise(resolve=>{
   resolverRef.current?.(false);
   resolverRef.current=resolve;
   setState({...opts,open:true});
  });
  return()=>{delete (window as unknown as {sightlineConfirm?:unknown}).sightlineConfirm};
 },[]);
 const settle=(ok:boolean)=>{
  const res=resolverRef.current;
  resolverRef.current=null;
  setState(prev=>prev?{...prev,open:false}:null);
  res?.(ok);
 };
 return <Dialog open={Boolean(state?.open)} onOpenChange={open=>{if(!open)settle(false)}}>
  <DialogContent className="confirm-dialog">
   <DialogHeader>
    <DialogTitle>{state?.title||'Confirm action'}</DialogTitle>
    <DialogDescription>{state?.description||''}</DialogDescription>
   </DialogHeader>
   <DialogFooter className="confirm-actions">
    <Button variant="outline" size="sm" onClick={()=>settle(false)}>Cancel</Button>
    <Button variant={state?.destructive?'destructive':'default'} size="sm" onClick={()=>settle(true)}>{state?.confirmLabel||'Confirm'}</Button>
   </DialogFooter>
  </DialogContent>
 </Dialog>;
}

function Editor(){
 const [shortcutsOpen,setShortcutsOpen]=useState(false);
 useEffect(()=>{
  const open=()=>setShortcutsOpen(prev=>!prev);
  window.addEventListener('sightline:shortcuts',open);
  return()=>window.removeEventListener('sightline:shortcuts',open);
 },[]);
 return <div className={recording?'capture-editor recording-editor':'capture-editor image-editor'}>
  <header className="editor-header"><div className="extension-brand"><img src="icons/icon-48.png" alt=""/><strong>Sightline</strong><ChevronRight/><span>{recording?'Recording editor':'Capture editor'}</span></div><div className="header-actions"><IconButton id="shortcuts-btn" label="Keyboard shortcuts" onClick={()=>setShortcutsOpen(true)}><Keyboard/></IconButton><ThemeToggle/><Button variant="ghost" size="sm" id="discard"><Trash2/>Discard</Button><Button id="save" size="sm" disabled><Save/>{recording?'Save clip':'Save capture'}</Button></div></header>
  <div className="editor-body"><main className="editor-main"><section className="preview">
   <div className="workspace-heading"><div><h1>{recording?'Make the moment yours.':'Focus on the detail.'}</h1><p>{recording?'Trim, adjust speed, crop, and annotate your recording.':'Crop if needed, or leave a note on what stands out.'}</p></div><div className="edit-actions"><IconButton id="undo" label="Undo"><Undo2/></IconButton><IconButton id="redo" label="Redo"><Redo2/></IconButton><Separator orientation="vertical"/><Button variant="outline" size="sm" id="crop-toggle" aria-pressed="false"><Crop/> Crop</Button><IconButton id="reset-crop" label="Reset crop"><RotateCcw/></IconButton></div></div>
   <div className="editor-stage"><div className="stage-viewport"><div className="media-frame" id="media-frame">{recording?<video id="video" playsInline/>:<canvas id="canvas"/>}<div className="crop-overlay" id="crop-overlay"/></div></div></div>
   <div className="workspace-footer">{recording?<div className="transport"><HoverTooltip label="Play / pause"><Button variant="outline" size="icon" id="play" aria-label="Play or pause"><Play/></Button></HoverTooltip><span id="clock">00:00.00 / 00:00.00</span><span id="source"/></div>:<><span><Image/> Capture preview</span><span id="crop-size"/></>}<span id="status" role="status" aria-live="polite"/></div>
  </section>
  {recording&&<section className="timeline-panel"><div id="timeline-resizer" className="timeline-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" tabIndex={0}><span className="timeline-resizer-grip" aria-hidden="true"/></div><div className="timeline-header"><div><Film/><strong>Timeline</strong><span id="duration"/></div><div className="timeline-actions"><HoverTooltip label="Clip playback speed (or drag an upper corner)"><div className="speed-control"><Gauge aria-hidden="true"/><CustomSelect id="speed" defaultValue="1" options={SPEED_OPTIONS} ariaLabel="Clip playback speed" triggerClassName="speed-select-trigger" menuAlign="end" formatValue={v=>`${v}×`}/></div></HoverTooltip><IconButton id="split" label="Split at playhead"><Scissors/></IconButton><IconButton id="delete" label="Delete selected clip"><Trash2/></IconButton><IconButton id="reset" label="Restore timeline"><RotateCcw/></IconButton><Separator orientation="vertical"/><IconButton id="timeline-toggle" label="Minimize timeline"><ChevronDown/></IconButton></div></div><div className="timeline-scroll"><div className="ruler" id="ruler" aria-label="Timeline ruler"/><div className="track" id="track" aria-label="Video timeline"><div id="clips"/></div><div id="playhead" className="playhead" role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuenow={0}><span className="playhead-cap"><span className="playhead-time" aria-hidden="true">00:00.00</span></span></div></div></section>}
  </main><Details/></div><div id="toast" role="status" aria-live="polite"/>
  <ShortcutGuideDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}/>
  <ConfirmDialog/>
 </div>;
}

mountTitleTooltips();
flushSync(()=>createRoot(root).render(<TooltipProvider delayDuration={220}>{mode==='popup'?<Popup/>:<Editor/>}</TooltipProvider>));
// Keep the proven capture and editing engines; their DOM is mounted before they load.
const scripts=mode==='popup'?['recordings-db.js','popup.js']:mode==='review'?['recordings-db.js','tags.js','brand.js','crop-editor.js','annotations.js','video-export.js','review.js']:['tags.js','brand.js','crop-editor.js','annotations.js','crop.js'];
async function loadEngines(){for(const name of scripts){await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(name,document.baseURI).href;script.onload=()=>resolve();script.onerror=()=>reject(Error(`Could not load ${name}`));document.body.append(script)})}}
void loadEngines().catch(error=>{const status=document.getElementById('status');if(status)status.textContent=`Editor could not start. Reload this page. ${error.message}`});
