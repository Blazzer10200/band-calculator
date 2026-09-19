// Reads band names and "xN" counts out of inventory screenshots, entirely in the browser.
// The OCR engine (Tesseract.js, Apache-2.0) is vendored as ocr-engine.js / ocr-worker.js / ocr-core.js
// plus eng.traineddata.gz, so nothing leaves the device and no CDN is contacted.
import Tesseract from './ocr-engine.js';
const {createWorker,PSM}=Tesseract;

const here=new URL('.',import.meta.url).href.replace(/\/$/,'');
const ALIAS_KEY='pto-scan-aliases';
let engine=null,report=()=>{};

function reader(){
  if(!engine)engine=createWorker('eng',1,{
    workerPath:new URL('./ocr-worker.js',import.meta.url).href,
    corePath:new URL('./ocr-core.js',import.meta.url).href,
    langPath:here,
    workerBlobURL:false,
    logger:m=>report(m)
  }).catch(e=>{engine=null;throw e;});
  return engine;
}

// Grayscale + contrast stretch at a working scale where item text is ~20px tall.
export async function raster(file){
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(3,Math.max(1,2900/bitmap.width)),canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const image=ctx.getImageData(0,0,canvas.width,canvas.height),d=image.data,hist=new Uint32Array(256);
  for(let i=0;i<d.length;i+=4){const g=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;d[i]=g;hist[g]++;}
  const cut=d.length/400;let lo=0,hi=255,acc=0;
  for(;lo<254&&acc+hist[lo]<cut;lo++)acc+=hist[lo];acc=0;
  for(;hi>1&&acc+hist[hi]<cut;hi--)acc+=hist[hi];
  const range=Math.max(1,hi-lo);
  for(let i=0;i<d.length;i+=4){const g=Math.max(0,Math.min(255,Math.round((d[i]-lo)*255/range)));d[i]=d[i+1]=d[i+2]=g;}
  ctx.putImageData(image,0,0);
  return {canvas,ctx,scale};
}
const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not read the screenshot.')),'image/png'));

// --- name matching -------------------------------------------------------
export const normalizeName=text=>text.toLowerCase().replace(/[^a-z0-9$ ]+/g,' ').trim().split(/\s+/).filter(Boolean);
function distance(a,b){
  const m=a.length,n=b.length,row=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){let prev=row[0];row[0]=i;for(let j=1;j<=n;j++){const tmp=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=tmp;}}
  return row[n];
}
const tokenMatch=(a,b)=>a===b||(Math.min(a.length,b.length)>=4&&distance(a,b)<=(Math.max(a.length,b.length)>6?2:1));
export function matchBand(text,bands,aliases={}){
  const words=normalizeName(text),key=words.join(' ');
  if(!words.length)return null;
  if(aliases[key]){const b=bands.find(b=>b.id===aliases[key]);if(b)return b;}
  let best=null,score=0;
  for(const band of bands){
    const tokens=normalizeName(band.name);
    if(tokens.length&&tokens.length>score&&tokens.every(t=>words.some(w=>tokenMatch(w,t)))){best=band;score=tokens.length;}
  }
  return best;
}
export function readAliases(){try{const v=JSON.parse(localStorage.getItem(ALIAS_KEY)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}}
export function saveAlias(text,bandId){
  const aliases=readAliases(),key=normalizeName(text).join(' ');
  if(!key)return aliases;
  if(bandId)aliases[key]=bandId;else delete aliases[key];
  try{localStorage.setItem(ALIAS_KEY,JSON.stringify(aliases));}catch{}
  return aliases;
}

// --- quantity ------------------------------------------------------------
// In the inventory grid the item name sits bottom-left of its slot and the "xN" count top-left,
// roughly 4-7 name-heights above the name. Nothing is drawn when the count is 1.
// Look above-left of the name for a short cluster of bright rows about 6 name-heights up: the
// count text. Wide bright bands (the rarity bar of the slot above, header rules) and the item
// icon lower down are skipped. Returns null when nothing is drawn there (count is 1), else a crop
// box; `guess` marks a cluster that was there but did not look like text.
export function quantityBox(line,src){
  // Work in name-text heights; the shared unit ignores descenders on any one name.
  const h=Math.max(8,src.unit||line.y1-line.y0),{canvas,ctx}=src;
  const x0=Math.max(0,Math.round(line.x0-h)),x1=Math.min(canvas.width,Math.round(line.x0+3.8*h));
  const y0=Math.max(0,Math.round(line.y0-9.5*h)),y1=Math.min(canvas.height,Math.round(line.y0-3*h));
  const w=x1-x0,ht=y1-y0;if(w<8||ht<8)return null;
  const d=ctx.getImageData(x0,y0,w,ht).data,hist=new Uint32Array(256);
  for(let i=0;i<d.length;i+=4)hist[d[i]]++;
  let median=0;for(let n=0;median<255&&n+hist[median]<d.length/8;median++)n+=hist[median];
  const cut=Math.max(120,median+70),at=(x,y)=>d[(y*w+x)*4]>cut;
  // Bright vertical edges (highlighted slot border) and wide bright bands are not text.
  const expected=line.y0-6.3*h-y0,bs=Math.max(0,Math.round(expected-1.6*h)),be=Math.min(ht,Math.round(expected+1.6*h));
  const cols=new Uint16Array(w),rows=new Uint16Array(ht);
  for(let y=bs;y<be;y++)for(let x=0;x<w;x++)if(at(x,y))cols[x]++;
  const edge=x=>cols[x]>=(be-bs)*.6;
  for(let y=0;y<ht;y++){let n=0;for(let x=0;x<w;x++)if(!edge(x)&&at(x,y))n++;rows[y]=n>=w*.5||n<2?0:n;}
  // Runs of bright rows; a single dark row ends a run so the item icon below never merges in.
  const clusters=[];let s=-1,e=-1;
  for(let y=0;y<=ht;y++){
    if(s>=0&&(y===ht||!rows[y])){clusters.push({s,e});s=e=-1;}
    if(y<ht&&rows[y]){if(s<0)s=y;e=y;}
  }
  const near=c=>Math.abs((c.s+c.e)/2-expected)<=1.6*h;
  const text=clusters.filter(c=>near(c)&&c.e-c.s+1>=h*.3&&c.e-c.s+1<=1.3*h).sort((a,b)=>Math.abs((a.s+a.e)/2-expected)-Math.abs((b.s+b.e)/2-expected))[0];
  if(!text)return clusters.some(near)?{guess:true,empty:true}:null;
  // Split the run into glyphs (column runs with bright pixels), noting where each one starts vertically.
  const top=new Int16Array(w).fill(-1);
  for(let x=0;x<w;x++){if(edge(x))continue;for(let y=text.s;y<=text.e;y++)if(at(x,y)){top[x]=y;break;}}
  const glyphs=[];
  for(let x=0;x<=w;x++){
    const on=x<w&&top[x]>=0;
    if(on){const g=glyphs[glyphs.length-1];if(g&&g.x1===x-1){g.x1=x;g.top=Math.min(g.top,top[x]);}else glyphs.push({x0:x,x1:x,top:top[x]});}
  }
  const real=glyphs.filter(g=>g.x1-g.x0>=2);
  if(!real.length)return {guess:false,empty:true};
  // Hotbar slots draw their key number in this corner too, same size as the count but sitting higher
  // and often touching the "x". Drop it when a lower glyph follows; alone, a narrow glyph is just the key.
  if(real.length>1&&real[0].top<=Math.min(...real.slice(1).map(g=>g.top))-.25*h)real.shift();
  if(real.length===1&&real[0].x1-real[0].x0+1<.8*h)return {guess:false,empty:true};
  const left=real[0].x0,right=real[real.length-1].x1,ys=Math.min(...real.map(g=>g.top));
  const pad=Math.round(h*.35),ax0=Math.max(0,left-pad),ay0=Math.max(0,ys-pad);
  return {guess:false,x0:x0+ax0,y0:y0+ay0,w:Math.min(w,right+1+pad)-ax0,h:Math.min(ht,text.e+1+pad)-ay0,glyphWidth:(right-left+1)/h};
}
// The digits are tiny (about 6px in a 1080p shot). Blow them up with a wide margin, inverted to dark
// text on a light page, which the reader is far happier with. Which zoom works varies per crop, so
// try a few and stop at the first clean read.
const ZOOMS=[[4,60],[3,40],[5,80]];
async function readQuantity(worker,src,box){
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,tessedit_char_whitelist:'x0123456789'});
  let last={qty:null,raw:'',confidence:0};
  for(const [k,pad] of ZOOMS){
    const canvas=document.createElement('canvas');
    canvas.width=box.w*k+2*pad;canvas.height=box.h*k+2*pad;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';
    ctx.drawImage(src.canvas,box.x0,box.y0,box.w,box.h,pad,pad,box.w*k,box.h*k);
    const image=ctx.getImageData(0,0,canvas.width,canvas.height),d=image.data;
    for(let i=0;i<d.length;i+=4){const v=255-d[i];d[i]=d[i+1]=d[i+2]=v;}
    ctx.putImageData(image,0,0);
    const {data}=await worker.recognize(await toBlob(canvas));
    // The "x" is often too small to survive; the digits after it are what matter.
    const text=(data.text||'').replace(/\s+/g,'').toLowerCase(),m=text.match(/^x?(\d{1,6})$/);
    last={qty:m?Number(m[1]):null,raw:text,confidence:data.confidence,sure:!!m&&!box.guess&&data.confidence>=45};
    if(m&&data.confidence>=45)break;
  }
  return last;
}

// --- main entry ----------------------------------------------------------
export async function scanImage(file,bands,{onProgress}={}){
  const started=performance.now();
  report=m=>{
    if(!onProgress)return;
    const pct=Math.round((m.progress||0)*100);
    if(m.status==='loading tesseract core'||m.status==='loading language traineddata'||m.status==='initializing tesseract')onProgress({phase:'load',text:'Loading the reader (about 7 MB, one time only)…'});
    else if(m.status==='recognizing text')onProgress({phase:'read',text:'Reading… '+pct+'%'});
  };
  const worker=await reader();
  const src=await raster(file),aliases=readAliases();
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''});
  const {data}=await worker.recognize(await toBlob(src.canvas),{},{blocks:true});
  const lines=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines)).map(l=>({text:l.text.trim(),confidence:l.confidence,x0:l.bbox.x0,y0:l.bbox.y0,x1:l.bbox.x1,y1:l.bbox.y1})).filter(l=>l.confidence>=55&&/[a-z]{3}/i.test(l.text));
  // Item names share one font: their typical height is the yardstick for everything around them.
  const heights=lines.map(l=>l.y1-l.y0).sort((a,b)=>a-b);
  src.unit=heights.length?heights[heights.length>>1]:0;
  const items=[],others=[],seen=new Set();
  for(const line of lines){
    const band=matchBand(line.text,bands,aliases);
    if(!band){const key=normalizeName(line.text).join(' ');if(key&&!seen.has(key)){seen.add(key);others.push(line.text.replace(/\s+/g,' '));}continue;}
    const box=quantityBox(line,src);
    let qty={qty:1,sure:!box?.guess,raw:''};
    if(box&&!box.empty){onProgress?.({phase:'count',text:'Counting '+band.name+'…'});qty=await readQuantity(worker,src,box);}
    items.push({text:line.text,bandId:band.id,name:band.name,qty:qty.qty,sure:!!qty.sure,raw:qty.raw,x:Math.round(line.x0/src.scale),y:Math.round(line.y0/src.scale)});
  }
  src.canvas.width=src.canvas.height=0;
  return {items,others,ms:Math.round(performance.now()-started)};
}
