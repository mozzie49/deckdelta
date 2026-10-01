import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageSnapshot } from './compare';
GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_PAGES = 50;
export const MAX_BYTES = 25 * 1024 * 1024;
export interface LoadedDeck {name:string; pages:PageSnapshot[]; warnings:string[]}
export class DeckError extends Error { constructor(public code:string, message:string) { super(message); } }
function abortCheck(signal:AbortSignal) { if(signal.aborted) throw new DOMException('Cancelled', 'AbortError'); }

/** Files are read directly into memory. No PDF URL is ever sent to a remote service. */
export async function loadDeck(file:File, signal:AbortSignal, progress:(page:number,total:number)=>void):Promise<LoadedDeck> {
  if(file.size > MAX_BYTES) throw new DeckError('size','This PDF exceeds the 25 MB limit. Export a smaller deck and try again.');
  if(file.size === 0) throw new DeckError('empty','This file is empty. Choose a PDF deck.');
  if(!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') throw new DeckError('type','Choose a PDF file.');
  abortCheck(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  abortCheck(signal);
  const signature = new TextDecoder().decode(bytes.slice(0,1024));
  if(!signature.includes('%PDF-')) throw new DeckError('invalid','This file does not look like a valid PDF.');
  const localAssets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  const task = getDocument({data:bytes,cMapUrl:`${localAssets}cmaps/`,cMapPacked:true,standardFontDataUrl:`${localAssets}standard_fonts/`,wasmUrl:`${localAssets}wasm/`,iccUrl:`${localAssets}iccs/`,enableXfa:false,stopAtErrors:true});
  const cancel=()=>{ void task.destroy().catch(()=>{}); };
  signal.addEventListener('abort', cancel, {once:true});
  const pages:PageSnapshot[]=[];
  try {
    const doc=await task.promise;
    abortCheck(signal);
    if(doc.numPages > MAX_PAGES) throw new DeckError('pages',`This PDF has ${doc.numPages} pages. The limit is ${MAX_PAGES} pages per deck.`);
    progress(0, doc.numPages);
    for(let n=1;n<=doc.numPages;n++) {
      abortCheck(signal);
      const page=await doc.getPage(n);
      const base=page.getViewport({scale:1});
      if(!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width<=0 || base.height<=0) throw new DeckError('dimensions',`Page ${n} has unsupported dimensions.`);
      const viewport=page.getViewport({scale:Math.min(1200/base.width,900/base.height,2)});
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx) throw new DeckError('canvas','Your browser could not create a canvas. Try a current desktop browser.');
      try {
        const text=await page.getTextContent();
        abortCheck(signal);
        const parts=text.items.map(item => 'str' in item ? item.str + (item.hasEOL?'\n':' ') : '').join('').trim();
        if(parts.length>100_000) throw new DeckError('text',`Page ${n} contains too much text for this deck reviewer.`);
        await page.render({canvas,canvasContext:ctx,viewport,background:'#ffffff'}).promise;
        abortCheck(signal);
        const small=document.createElement('canvas');small.width=256;small.height=144;
        const sc=small.getContext('2d',{willReadFrequently:true})!;
        sc.fillStyle='#fff';sc.fillRect(0,0,256,144);sc.drawImage(canvas,0,0,256,144);
        pages.push({pageNumber:n,text:parts,width:base.width,height:base.height,thumbnail:canvas.toDataURL('image/png'),pixels:sc.getImageData(0,0,256,144).data,pixelWidth:256,pixelHeight:144});
        small.width=0;small.height=0;
      } finally {canvas.width=0;canvas.height=0;page.cleanup();}
      progress(n,doc.numPages);
      // Yield between slides so Cancel, replacement uploads, and the UI stay responsive.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    abortCheck(signal);
    if(pages.every(p=>!p.text.trim())) throw new DeckError('scan','No extractable text was found. Scanned or image-only decks are not supported. Use a born-digital PDF export.');
    const sparse=pages.filter(p=>p.text.replace(/\s/g,'').length<12).map(p=>p.pageNumber);
    return {name:file.name,pages,warnings:sparse.length?[`Little or no extractable text on pages ${sparse.join(', ')}. Inspect those matches manually; OCR is not included.`]:[]};
  } catch(error) {
    if(signal.aborted) throw new DOMException('Cancelled','AbortError');
    if(error instanceof DeckError) throw error;
    const name=error instanceof Error?error.name:'';
    if(name==='PasswordException') throw new DeckError('password','Password-protected PDFs are not supported. Choose an unlocked copy.');
    throw new DeckError('parse','This PDF could not be fully read. It may be damaged or use unsupported content. Try exporting it again.');
  } finally {signal.removeEventListener('abort',cancel);await task.destroy().catch(()=>{});}
}
