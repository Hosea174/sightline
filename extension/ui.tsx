import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Button} from '../src/components/ui/button';
import {Input} from '../src/components/ui/input';
import {Textarea} from '../src/components/ui/textarea';
import {Badge} from '../src/components/ui/badge';
import {Separator} from '../src/components/ui/separator';
import {Field,FieldGroup,FieldLabel,FieldDescription} from '../src/components/ui/field';
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from '../src/components/ui/tooltip';
import {Camera,Scan,ScanLine,Video,Type,ArrowUpRight,ChevronRight,Undo2,Redo2,RotateCcw,Scissors,Trash2,Play,Sun,Moon,Keyboard,Film,Save,Image,Check} from 'lucide-react';
import '@fontsource-variable/inter';
import '../src/theme.css';
import './interaction.css';
import './ui.css';

const root=document.getElementById('extension-root')!;
const mode=root.dataset.surface||'popup';
const recording=mode==='review';
function ThemeToggle(){
 const [dark,setDark]=useState(()=>localStorage.getItem('sightline-theme')==='dark');
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('sightline-theme',dark?'dark':'light')},[dark]);
 return <Button variant="ghost" size="icon" className="theme-toggle" aria-label={dark?'Switch to light mode':'Switch to dark mode'} onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</Button>;
}
function IconButton({id,label,children}:{id:string;label:string;children:React.ReactNode}){
 return <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" id={id} aria-label={label} title={label}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
function Popup(){return <div className="capture-popup">
 <header className="popup-header"><div className="extension-brand"><img src="icons/icon-48.png" alt=""/><strong>Sightline</strong><Badge variant="secondary">Capture</Badge></div><ThemeToggle/></header>
 <main><section className="popup-intro"><h1>Save your next<br/>source of inspiration.</h1><p>Keep the details. Come back to the ideas.</p></section>
 <div className="tools">
  <Button id="screenshot" className="capture-primary" aria-label="Capture visible tab" title="Capture visible tab"><Camera/><span className="action-label">Capture visible tab</span><span className="capture-key">Alt Shift S</span></Button>
  <div className="capture-options">
   <Button variant="ghost" id="full-page" className="capture-option" aria-label="Capture full page"><span className="option-icon"><ScanLine/></span><span><strong>Full page</strong><small>Everything, from top to bottom</small></span><ChevronRight/></Button>
   <Button variant="ghost" id="area" className="capture-option" aria-label="Capture area"><span className="option-icon"><Scan/></span><span><strong>Select an area</strong><small>Frame only what matters</small></span><ChevronRight/></Button>
   <Button variant="ghost" id="record" className="capture-option" aria-label="Start recording"><span className="option-icon"><Video/></span><span><strong className="action-label">Record tab</strong><small>Capture motion and interactions</small></span><ChevronRight/></Button>
  </div>
 </div>
 <div className="popup-secondary"><Separator/><Button variant="ghost" id="fonts" className="capture-option"><span className="option-icon"><Type/></span><span><strong>Explore page fonts</strong><small>Find and collect typefaces</small></span><ChevronRight/></Button></div>
 <section className="popup-results"><div id="fontList"/><p id="status" role="status" aria-live="polite">Captures open in an editor before saving.</p></section></main>
 <footer className="popup-footer"><Button variant="ghost" size="sm" id="recordings"><Film/> Recordings</Button><Button variant="ghost" size="sm" id="shortcuts"><Keyboard/> Shortcuts</Button></footer>
 </div>}
function Details(){return <aside className="capture-details"><div className="details-heading"><h2>Reference details</h2><p>A little context goes a long way.</p></div>
 <FieldGroup>
  <Field><FieldLabel htmlFor="title">Source name</FieldLabel><Input id="title" placeholder="Give your reference a name"/></Field>
  <Field><FieldLabel htmlFor="url">Website</FieldLabel><Input id="url" type="url" placeholder="https://"/></Field>
  <Field><FieldLabel htmlFor="category">Collection</FieldLabel><select id="category" defaultValue="Web design" onChange={e=>e.currentTarget.dataset.changed='true'}>{['Web design','Illustration','Motion graphics','Post Ideas','Other'].map(c=><option key={c}>{c}</option>)}</select><span id="category-label" hidden/></Field>
  <Field><FieldLabel htmlFor="tags">Tags</FieldLabel><div className="tags-field"><span id="tag-pills"/><Input id="tags" placeholder="Add a tag…" aria-autocomplete="list" aria-controls="tag-suggestions" autoComplete="off"/></div><div id="tag-suggestions" className="tag-suggestions" hidden role="listbox" aria-label="Suggested tags"/><FieldDescription>Press Enter to add a tag.</FieldDescription></Field>
  <Field><FieldLabel htmlFor="notes">Notes</FieldLabel><Textarea id="notes" placeholder="What makes this worth keeping?"/></Field>
 </FieldGroup>
 <Separator className="details-separator"/>
 <div className="annotations-heading"><h3>Annotations</h3><span>Select the pen to leave a note.</span></div>
 </aside>}
function Editor(){return <div className={recording?'capture-editor recording-editor':'capture-editor image-editor'}>
 <header className="editor-header"><div className="extension-brand"><img src="icons/icon-48.png" alt=""/><strong>Sightline</strong><ChevronRight/><span>{recording?'Recording editor':'Capture editor'}</span></div><div className="header-actions"><ThemeToggle/>{recording&&<Button variant="ghost" size="sm" id="discard"><Trash2/> Delete original</Button>}<Button id="save" size="sm" disabled><Save/>{recording?'Save clip':'Save capture'}</Button></div></header>
 <div className="editor-body"><main className="editor-main"><section className="preview">
  <div className="workspace-heading"><div><h1>{recording?'Make the moment yours.':'Focus on the detail.'}</h1><p>{recording?'Trim, crop and annotate your recording.':'Drag the crop handles. Leave a note on what stands out.'}</p></div><div className="edit-actions"><IconButton id="undo" label="Undo (Ctrl+Z)"><Undo2/></IconButton><IconButton id="redo" label="Redo (Ctrl+Y)"><Redo2/></IconButton><Separator orientation="vertical"/><Button variant="outline" size="sm" id="reset-crop"><RotateCcw/> Reset crop</Button></div></div>
  <div className="editor-stage"><div className="media-frame" id="media-frame">{recording?<video id="video" playsInline/>:<canvas id="canvas"/>}<div className="crop-overlay" id="crop-overlay"/></div></div>
  <div className="workspace-footer">{recording?<div className="transport"><Button variant="outline" size="icon" id="play" aria-label="Play or pause" title="Play / pause (Space)"><Play/></Button><span id="clock">00:00.00 / 00:00.00</span><span id="source"/></div>:<><span><Image/> Crop selection</span><span id="crop-size"/></>}<span id="status" role="status" aria-live="polite"/></div>
 </section>
 {recording&&<section className="timeline-panel"><div className="timeline-header"><div><Film/><strong>Timeline</strong><span id="duration"/></div><div className="timeline-actions"><IconButton id="split" label="Split at playhead (Ctrl+Alt+B)"><Scissors/></IconButton><IconButton id="delete" label="Delete selected clip"><Trash2/></IconButton><IconButton id="reset" label="Restore timeline"><RotateCcw/></IconButton></div></div><div className="timeline-scroll"><div className="ruler" id="ruler" aria-label="Timeline ruler"/><div className="track" id="track" aria-label="Video timeline"><div id="clips"/><div id="playhead" className="playhead" role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuenow={0}/></div></div><div className="help"><span><kbd>Space</kbd> Play</span><span><kbd>Q / W</kbd> Trim</span><span><kbd>Ctrl Alt B</kbd> Split</span><span><kbd>← / →</kbd> Frame</span></div></section>}
 </main><Details/></div><div id="toast" role="status" aria-live="polite"/>
 </div>}

flushSync(()=>createRoot(root).render(<TooltipProvider delayDuration={250}>{mode==='popup'?<Popup/>:<Editor/>}</TooltipProvider>));
// Keep the proven capture and editing engines; their DOM is mounted before they load.
const scripts=mode==='popup'?['recordings-db.js','popup.js']:mode==='review'?['recordings-db.js','tags.js','brand.js','crop-editor.js','annotations.js','review.js']:['tags.js','brand.js','crop-editor.js','annotations.js','crop.js'];
async function loadEngines(){for(const name of scripts){await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(name,document.baseURI).href;script.onload=()=>resolve();script.onerror=()=>reject(Error(`Could not load ${name}`));document.body.append(script)})}}
void loadEngines().catch(error=>{const status=document.getElementById('status');if(status)status.textContent=`Editor could not start. Reload this page. ${error.message}`});
