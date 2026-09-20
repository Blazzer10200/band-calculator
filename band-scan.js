// Reads band names and "xN" counts out of inventory screenshots, entirely in the browser.
// The OCR engine (Tesseract.js, Apache-2.0) is vendored as ocr-engine.js / ocr-worker.js / ocr-core.js
// plus eng.traineddata.gz, so nothing leaves the device and no CDN is contacted.
//
// Two reads per screenshot. The first finds item names on a scaled-up grayscale copy. Every inventory
// slot draws its name bottom-left, the "xN" count top-left (only when N > 1) and the stack weight
// top-right, on one row about 6.4 name-heights above the name. The second read cuts that row out of
// every matched slot, blows the digits up, and reads them all in one go. The weight doubles as a
// check on the count: a Purple Stack weighs 100 g each, so "500 g" means five.
import Tesseract from './ocr-engine.js';
const {createWorker,PSM}=Tesseract;

const here=new URL('.',import.meta.url).href.replace(/\/$/,'');
const ALIAS_KEY='pto-scan-aliases',UNIT_KEY='pto-scan-units';
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
// Start the reader while the page is idle so the first screenshot does not wait for it.
export function warmReader(){reader().catch(()=>{});}

const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not read the screenshot.')),'image/png'));
// Grayscale + contrast stretch of one region, in place. `fromMedian` takes the region's median as the
// background, so white text stands out even on a grey hotbar slot; `invert` gives dark text on a light
// page, which the reader prefers for digits.
function enhance(ctx,x,y,w,h,{invert=false,fromMedian=false}={}){
  const image=ctx.getImageData(x,y,w,h),d=image.data,hist=new Uint32Array(256),px=d.length/4;
  for(let i=0;i<d.length;i+=4){const g=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;d[i]=g;hist[g]++;}
  const cut=px/100;let lo=0,hi=255,acc=0;
  for(;lo<254&&acc+hist[lo]<(fromMedian?px/2:cut);lo++)acc+=hist[lo];acc=0;
  for(;hi>1&&acc+hist[hi]<cut;hi--)acc+=hist[hi];
  const range=Math.max(32,hi-lo);
  for(let i=0;i<d.length;i+=4){let g=Math.max(0,Math.min(255,Math.round((d[i]-lo)*255/range)));if(invert)g=255-g;d[i]=d[i+1]=d[i+2]=g;}
  ctx.putImageData(image,x,y);
}
// The name pass works on a copy scaled so a full 1080p shot lands near 3000px wide and a cropped
// inventory near 3x: item names come out 18-35px tall. The original bitmap is kept for the count crops.
async function raster(file){
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(3,Math.max(1.5,3000/Math.max(bitmap.width,bitmap.height*.75))),canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  enhance(ctx,0,0,canvas.width,canvas.height);
  return {canvas,bitmap,scale};
}

// --- name matching -------------------------------------------------------
export const normalizeName=text=>text.toLowerCase().replace(/[^a-z0-9$ ]+/g,' ').trim().split(/\s+/).filter(Boolean);
function distance(a,b){
  const m=a.length,n=b.length,row=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){let prev=row[0];row[0]=i;for(let j=1;j<=n;j++){const tmp=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=tmp;}}
  return row[n];
}
const tokenMatch=(a,b)=>a===b||(Math.min(a.length,b.length)>=4&&distance(a,b)<=(Math.max(a.length,b.length)>6?2:1));
// "Purple band" in Settings is "Purple Stack" in the game: only the distinctive words have to match.
const GENERIC=new Set(['band','bands','stack','stacks','of','the','a']);
export function matchBand(text,bands,aliases={}){
  const words=normalizeName(text),key=words.join(' ');
  if(!words.length)return null;
  if(aliases[key]){const b=bands.find(b=>b.id===aliases[key]);if(b)return b;}
  let best=null,score=0;
  for(const band of bands){
    const all=normalizeName(band.name),tokens=all.filter(t=>!GENERIC.has(t)),need=tokens.length?tokens:all;
    if(need.length&&need.length>score&&need.every(t=>words.some(w=>tokenMatch(w,t)))){best=band;score=need.length;}
  }
  return best;
}
const readJson=(key)=>{try{const v=JSON.parse(localStorage.getItem(key)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}};
const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
export function readAliases(){return readJson(ALIAS_KEY);}
// What the scanner picked up can be wrong, and a wrong stack size quietly rewrites every later count, so it has to be forgettable.
export const hasLearned=()=>Object.keys(readJson(ALIAS_KEY)).length>0||Object.keys(readJson(UNIT_KEY)).length>0;
export function forgetLearned(){for(const key of [ALIAS_KEY,UNIT_KEY])try{localStorage.removeItem(key);}catch{}}
export function saveAlias(text,bandId){
  const aliases=readAliases(),key=normalizeName(text).join(' ');
  if(!key)return aliases;
  if(bandId)aliases[key]=bandId;else delete aliases[key];
  writeJson(ALIAS_KEY,aliases);
  return aliases;
}

// --- counts --------------------------------------------------------------
// One crop per matched name: from just left of the name to 90% of the column pitch, covering the
// count on the left and the weight on the right. The inventory panel is drawn in perspective, so the
// row's height above the name drifts (about 5.6-6.8 name-heights); when the first pass already read
// the weight (it usually does), the crop is centred on it, otherwise on the typical 6.2.
function slotRows(names,unit,anchors){
  const columns=[...new Set(names.map(n=>Math.round(n.x0/unit)))].sort((a,b)=>a-b);
  const gaps=columns.slice(1).map((x,i)=>(x-columns[i])*unit).filter(g=>g>4*unit);
  const pitch=gaps.length?Math.min(...gaps):11.5*unit;
  return names.map(n=>{
    const near=anchors.map(a=>({a,cy:(a.y0+a.y1)/2})).filter(({a,cy})=>a.x0>n.x0+.3*pitch&&a.x0<n.x0+pitch&&cy<n.y0-4*unit&&cy>n.y0-9.5*unit)
      .sort((p,q)=>Math.abs(p.cy-(n.y0-6.2*unit))-Math.abs(q.cy-(n.y0-6.2*unit)))[0];
    const cy=near?near.cy:n.y0-6.2*unit;
    return {x0:n.x0-.6*unit,x1:n.x0+.9*pitch,y0:cy-1.2*unit,y1:cy+1.2*unit};
  });
}
// Every slot row is drawn into one tall strip, zoomed so the digits are about 32px, and read once.
// Returns the words found in each row, left to right.
async function readRows(worker,src,rows){
  const unitPx=src.unit/src.scale,zoom=Math.max(1,Math.min(8,44/unitPx)),gap=Math.round(1.2*unitPx*zoom);
  const boxes=rows.map(r=>{
    const x0=Math.max(0,Math.round(r.x0/src.scale)),y0=Math.max(0,Math.round(r.y0/src.scale));
    return {x0,y0,w:Math.max(0,Math.min(src.bitmap.width,Math.round(r.x1/src.scale))-x0),h:Math.max(0,Math.min(src.bitmap.height,Math.round(r.y1/src.scale))-y0)};
  });
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(Math.max(1,...boxes.map(b=>b.w))*zoom)+2*gap;
  let y=gap;const at=boxes.map(b=>{const h=Math.round(b.h*zoom);const a={y,h};y+=h+gap;return a;});
  canvas.height=y;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';
  // Each row is stretched on its own: a hotbar slot sits on a grey panel, an inventory slot on black.
  boxes.forEach((b,i)=>{
    if(!b.w||!b.h)return;
    const w=Math.round(b.w*zoom);
    ctx.drawImage(src.bitmap,b.x0,b.y0,b.w,b.h,gap,at[i].y,w,at[i].h);
    enhance(ctx,gap,at[i].y,w,at[i].h,{invert:true,fromMedian:true});
  });
  // Read as one block of text lines. No character whitelist: the LSTM engine drops words instead of
  // honouring it, and sparse mode throws the short "x5" away as noise. Look-alikes are fixed in parseRow.
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:''});
  const {data}=await worker.recognize(await toBlob(canvas),{},{blocks:true});
  const words=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))).map(w=>({text:w.text,x:w.bbox.x0,y:(w.bbox.y0+w.bbox.y1)/2}));
  // The count is the left third of the row, the weight the right part.
  return at.map((a,i)=>{
    const mine=words.filter(w=>w.y>=a.y-gap/2&&w.y<a.y+a.h+gap/2).sort((p,q)=>p.x-q.x),split=gap+boxes[i].w*zoom*.42;
    return {left:mine.filter(w=>w.x<split).map(w=>w.text).join(' '),right:mine.filter(w=>w.x>=split).map(w=>w.text).join(' ')};
  });
}
// Left "x5" → count 5; right "500 g" → 500 grams ("1.00 kg" → 1000). Hotbar slots also print their
// key number on the left ("3x5", "3 x5"), so the count is whatever follows the x; a bare number is a fallback.
export function parseRow({left,right}){
  // Small digits come back as look-alike letters now and then: S00 g, x1O, l.00 kg.
  const fix=s=>s.toLowerCase().replace(/[s$]/g,'5').replace(/o/g,'0').replace(/[li|]/g,'1').replace(/,/g,'.');
  const l=fix(left),r=fix(right);
  const count=l.match(/x\s*(\d{1,5})/),lead=!count&&l.match(/(\d{1,5})/);
  const weight=r.match(/(\d+(?:\.\d+)?)/);
  let grams=null;
  if(weight){const v=Number(weight[1]),kilos=/k/.test(r)||weight[1].includes('.');grams=Math.round(kilos?v*1000:v);}
  return {n:count?Number(count[1]):null,grams,lead:lead?Number(lead[1]):null};
}
// Grams per item for a band, learned from any slot that showed both a count and a weight.
export function inferUnits(rows,known={}){
  const units={...known},votes={};
  // Stacks weigh a round number per item (100 g, 200 g). A misread count gives an odd ratio, which is skipped.
  for(const r of rows){if(r.n&&r.grams){const u=r.grams/r.n;if(u>0&&u%10===0)(votes[r.bandId]??={})[u]=(votes[r.bandId][u]||0)+1;}}
  for(const [bandId,v] of Object.entries(votes))units[bandId]=Number(Object.entries(v).sort((a,b)=>b[1]-a[1])[0][0]);
  return units;
}
export function resolveCount({n,grams,lead},unit){
  if(n!==null){
    if(grams&&unit&&Math.abs(n*unit-grams)>unit*.5)return {qty:Math.max(1,Math.round(grams/unit)),sure:false};
    return {qty:n,sure:true};
  }
  if(grams){
    if(unit){const q=grams/unit,whole=Math.abs(q-Math.round(q))<.05;return {qty:Math.max(1,Math.round(q)),sure:whole};}
    if(lead)return {qty:lead,sure:false};
    return {qty:1,sure:true};// nothing is drawn for a single item, so a weight alone means one
  }
  if(lead)return {qty:lead,sure:false};
  return {qty:1,sure:false};
}

// --- main entry ----------------------------------------------------------
export async function scanImage(file,bands,{onProgress}={}){
  const started=performance.now();
  let phase='names';
  report=m=>{
    if(!onProgress)return;
    const pct=Math.round((m.progress||0)*100);
    if(m.status==='loading tesseract core'||m.status==='loading language traineddata'||m.status==='initializing tesseract')onProgress({phase:'load',text:'Loading the reader (about 7 MB, one time only)…'});
    else if(m.status==='recognizing text')onProgress({phase:'read',text:(phase==='names'?'Finding bands… ':'Reading counts… ')+pct+'%'});
  };
  const worker=await reader();
  const src=await raster(file),aliases=readAliases();
  // The decoded bitmap and its full-size canvas are the largest things here, so a failed read has to release them too.
  try{
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''});
  const {data}=await worker.recognize(await toBlob(src.canvas),{},{blocks:true});
  const all=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines)).map(l=>({text:l.text.trim().replace(/\s+/g,' '),confidence:l.confidence,x0:l.bbox.x0,y0:l.bbox.y0,x1:l.bbox.x1,y1:l.bbox.y1}));
  const lines=all.filter(l=>l.confidence>=55&&/[a-z]{3}/i.test(l.text));
  // Weights the first pass happened to read ("500 g", "1.00 kg") pin down where each slot's count row is.
  const anchors=all.filter(l=>/\d/.test(l.text)&&/(\d\s*k?g\b|\d\.\d)/i.test(l.text));
  // Item names share one font: their typical height is the yardstick for everything around them.
  const heights=lines.map(l=>l.y1-l.y0).sort((a,b)=>a-b);
  src.unit=Math.max(8,heights.length?heights[heights.length>>1]:0);
  const names=[],others=[],seen=new Set();
  for(const line of lines){
    const band=matchBand(line.text,bands,aliases);
    if(band){names.push({...line,band});continue;}
    const key=normalizeName(line.text).join(' ');
    if(line.confidence>=75&&/[a-z]{4}/i.test(line.text)&&key&&!seen.has(key)){seen.add(key);others.push(line.text);}
  }
  let items=[];
  if(names.length){
    phase='counts';onProgress?.({phase:'read',text:'Reading counts…'});
    const rows=(await readRows(worker,src,slotRows(names,src.unit,anchors))).map((row,i)=>({...parseRow(row),text:(row.left+' · '+row.right).trim(),bandId:names[i].band.id}));
    const units=inferUnits(rows,readJson(UNIT_KEY));writeJson(UNIT_KEY,units);
    items=rows.map((row,i)=>{const {qty,sure}=resolveCount(row,units[row.bandId]||null),line=names[i];return {text:line.text,bandId:line.band.id,name:line.band.name,qty,sure,raw:row.text,x:Math.round(line.x0/src.scale),y:Math.round(line.y0/src.scale)};});
  }
  return {items,others,ms:Math.round(performance.now()-started)};
  }finally{src.canvas.width=src.canvas.height=0;src.bitmap?.close?.();}
}
