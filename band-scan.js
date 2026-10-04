// Reads band names and "xN" counts out of inventory screenshots, entirely in the browser.
// The OCR engine (Tesseract.js, Apache-2.0) is vendored as ocr-engine.js / ocr-worker.js / ocr-core.js
// plus eng.traineddata.gz, so nothing leaves the device and no CDN is contacted.
//
// Every inventory slot draws its name bottom-left, the "xN" count top-left (only when N > 1) and the
// stack weight top-right, on one row roughly two thirds of a slot above the name. Three reads:
//
//   1. a sweep of the whole scaled-up grayscale copy, to find WHERE the slots are. It is good at that
//      and unreliable at reading them - it drops or merges some names every single time.
//   2. the names that did come through pin down the grid (see "the slot grid" below), and every cell
//      of that grid is cut out and read close up, on its own, which is steadier and far cheaper than
//      a second sweep. This is what stops a whole slot going missing from the total.
//   3. the count row of every matched slot is cut out, blown up and read in one go. Slots that come
//      back with nothing get one more go at a tighter crop.
//
// The count and the weight are drawn independently, so they check each other: a Purple Stack weighs
// 100 g each, so "500 g" means five. When they cannot be reconciled the slot returns qty null and the
// screen asks for the number rather than adding up a guess.
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
// A slot's border comes through as one long dark bar across the top of its crop, and the reader tries
// to make a word out of it - it was turning a perfectly legible "x5  500 g" into "= ses". Text always
// has gaps, so a pixel row carrying one unbroken run across more than a third of the crop is a rule,
// not writing, and gets painted out.
function stripRules(ctx,x,y,w,h){
  const image=ctx.getImageData(x,y,w,h),d=image.data,limit=Math.max(8,w*.5);
  let wiped=false;
  for(let row=0;row<h;row++){
    let run=0,longest=0;
    for(let col=0;col<w;col++){run=d[(row*w+col)*4]<128?run+1:0;if(run>longest)longest=run;}
    if(longest>limit){wiped=true;for(let col=0;col<w;col++){const i=(row*w+col)*4;d[i]=d[i+1]=d[i+2]=255;}}
  }
  if(wiped)ctx.putImageData(image,x,y);
}
// The name pass works on a copy scaled so a full 1080p shot lands near 2400px wide and a cropped
// inventory near 2.4x: item names come out 15-28px tall, which is enough to place them. Anything the
// pass misses is re-read close up from the grid, so paying for a 3x first pass buys nothing.
// The original bitmap is kept for the count crops.
async function raster(file){
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(2.4,Math.max(1.4,2400/Math.max(bitmap.width,bitmap.height*.75))),canvas=document.createElement('canvas');
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
// A name the scanner was taught can be wrong, so it has to be forgettable. Stack sizes used to be learned
// and kept too, until one bad read taught it 10 g Brown and every later stack of five came out as fifty;
// scanImage clears what is left of them.
export const hasLearned=()=>Object.keys(readJson(ALIAS_KEY)).length>0;
export function forgetLearned(){for(const key of [ALIAS_KEY,UNIT_KEY])try{localStorage.removeItem(key);}catch{}}
export function saveAlias(text,bandId){
  const aliases=readAliases(),key=normalizeName(text).join(' ');
  if(!key)return aliases;
  if(bandId)aliases[key]=bandId;else delete aliases[key];
  writeJson(ALIAS_KEY,aliases);
  return aliases;
}

// --- the slot grid -------------------------------------------------------
// Inventory slots sit on a regular grid and every name is drawn at the same spot inside its slot, so
// the names that did come through pin down where all the others should be. A cell with no name on it
// is a slot the first pass lost - usually two neighbours that merged into one line, or a name the
// reader was not confident enough about. Those cells get read again, close up, in one extra pass.
const cluster=(values,tol)=>{
  const sorted=[...values].sort((a,b)=>a-b),groups=[[sorted[0]]];
  for(const v of sorted.slice(1)){const g=groups.at(-1);if(v-g.at(-1)<=tol)g.push(v);else groups.push([v]);}
  return groups.map(g=>g.reduce((a,b)=>a+b,0)/g.length);
};
const medianGap=v=>{const g=v.slice(1).map((x,i)=>x-v[i]).sort((a,b)=>a-b);return g.length?g[g.length>>1]:0;};
// The panel is drawn in perspective, so names drift a few pixels down a row and a row of slots can come
// back as two centres sitting almost on top of each other. Two lines of the grid far closer together
// than the grid's own spacing are one line, and leaving them apart counted every slot on them twice.
// The floor comes from the text height, not from the spacing of the centres: the duplicates are what
// throws that spacing off in the first place. Real rows are at least 3 name-heights apart and real
// columns at least 4, both checked below, so anything within 2 of its neighbour is the same line twice.
const merge=(centres,minGap)=>{
  const out=[centres[0]];
  for(const c of centres.slice(1)){if(c-out.at(-1)<minGap)out[out.length-1]=(out.at(-1)+c)/2;else out.push(c);}
  return out;
};
// Respace an axis evenly so a column or row that nothing was read from still gets a place - but only
// when the centres really do line up, so an unusual layout keeps the positions that were measured.
const evenly=(centres,pitch)=>{
  const steps=pitch?Math.round((centres.at(-1)-centres[0])/pitch):0;
  if(steps<1||steps>40)return centres;
  const model=Array.from({length:steps+1},(_,k)=>centres[0]+k*pitch);
  return centres.every(c=>model.some(m=>Math.abs(m-c)<=pitch*.25))?model:centres;
};
export function lattice(names,unit){
  if(names.length<4)return null;
  const lines=(values,tol)=>merge(cluster(values,tol),unit*2);
  const cols=lines(names.map(n=>n.x0),unit*1.5),rows=lines(names.map(n=>n.y0),unit*.8);
  const colPitch=medianGap(cols),rowPitch=medianGap(rows);
  if(cols.length<2||rows.length<2||colPitch<4*unit||rowPitch<3*unit)return null;
  return {cols:evenly(cols,colPitch),rows:evenly(rows,rowPitch),colPitch,rowPitch};
}
// Where a row or a column does have names the sweep measured, those names are the truth for that line
// of the grid; the evenly spaced model is only there to cover a line nothing was read from. Averaging
// the whole grid instead put the crop a text-height too high and cut the number off.
export function gridCells(grid,names=[]){
  const middle=(vals,fallback)=>{const m=vals.sort((a,b)=>a-b);return m.length?m[m.length>>1]:fallback;};
  // Two grid lines can still land on the same names and come back as the same measured position, and
  // one slot read twice is added up twice, so a position only ever gets one cell.
  const ys=[...new Set(grid.rows.map(y=>middle(names.filter(n=>Math.abs(n.y0-y)<grid.rowPitch*.5).map(n=>n.y0),y)))];
  const xs=[...new Set(grid.cols.map(x=>middle(names.filter(n=>Math.abs(n.x0-x)<grid.colPitch*.5).map(n=>n.x0),x)))];
  return ys.flatMap(y=>xs.map(x=>({x0:x,y0:y})));
}
export const cellAt=(grid,list,cell)=>list.find(n=>Math.abs(n.x0-cell.x0)<grid.colPitch*.5&&Math.abs(n.y0-cell.y0)<grid.rowPitch*.5);
const nameRect=(cell,grid,unit)=>({x0:cell.x0-.35*unit,x1:cell.x0+.94*grid.colPitch,y0:cell.y0-.55*unit,y1:cell.y0+1.7*unit});

// --- slots by picture ----------------------------------------------------
// The game has a second inventory style with no names and no weights: just the picture and a boxed
// count in the top-right corner (no box at all for one item). What both styles do draw is a thin
// coloured bar along the bottom of every filled slot, and that bar is the steadiest thing on screen:
// one straight line, the width of the slot, with dark on both sides. The panel is drawn in slight
// perspective, so each bar comes out as a staircase of short runs that get joined back up here.
// Works on raw pixels ({width,height,data} as from getImageData) so it can be tested without a canvas.
const lit=(d,i)=>Math.max(d[i],d[i+1],d[i+2])>150;
export function findBars({width:W,height:H,data:d}){
  const runs=[];
  for(let y=1;y<H-1;y++){
    let s=-1;
    for(let x=0;x<=W;x++){
      const on=x<W&&lit(d,(y*W+x)*4);
      if(on&&s<0)s=x;
      else if(!on&&s>=0){
        const L=x-s;
        // A bar is thin: every column of it is only a few pixels tall. Text is broken up by gaps
        // before it gets this long, and the stacks of bills in the pictures are far taller.
        if(L>=12){
          let thin=0,n=0;
          for(let k=s;k<x;k+=2){n++;let t=1;for(const dy of [-1,1])for(let yy=y+dy;yy>=0&&yy<H&&t<12&&lit(d,(yy*W+k)*4);yy+=dy)t++;if(t<=Math.max(6,L*.08))thin++;}
          if(thin>=n*.8)runs.push({y,x0:s,x1:x});
        }
        s=-1;
      }
    }
  }
  // Join runs that touch from one row to the next into one bar.
  const bars=[];
  for(const r of runs){
    const b=bars.find(b=>r.y-b.yLast<=2&&r.x0<=b.x1+3&&b.x0<=r.x1+3);
    if(b){if(r.x0<b.x0){b.x0=r.x0;b.yl=r.y;}if(r.x1>b.x1){b.x1=r.x1;b.yr=r.y;}b.yLast=r.y;b.y0=Math.min(b.y0,r.y);b.y1=Math.max(b.y1,r.y);}
    else bars.push({x0:r.x0,x1:r.x1,y0:r.y,y1:r.y,yl:r.y,yr:r.y,yLast:r.y});
  }
  const long=bars.filter(b=>b.x1-b.x0>=30);
  if(!long.length)return [];
  // Slot bars are all one length; the storage weight meter and other rules are not.
  const lengths=long.map(b=>b.x1-b.x0).sort((a,b)=>a-b),usual=lengths[lengths.length>>1];
  // Perspective shortens the far columns by a few percent; the weight meter is a quarter shorter.
  return long.filter(b=>Math.abs(b.x1-b.x0-usual)<=usual*.15).map(({yLast,...b})=>b);
}
// Each bar closes off one slot; the slot is about as tall as the bars are long, or one row pitch
// less the gap when there is more than one row to measure it from.
export function slotBoxes(bars){
  if(!bars.length)return [];
  const L=bars.map(b=>b.x1-b.x0).sort((a,b)=>a-b)[bars.length>>1];
  const rows=cluster(bars.map(b=>(b.y0+b.y1)/2),L*.3),pitch=medianGap(rows);
  const h=Math.round(pitch>L*.6?Math.min(pitch*.93,L*1.1):L);
  return bars.map(b=>({x:b.x0-2,y:b.y0-h,w:b.x1-b.x0+4,h:h+(b.y1-b.y0)+2,bar:b})).sort((p,q)=>p.y-q.y||p.x-q.x);
}
const hsv=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),c=mx-mn;let h=0;if(c){h=mx===r?((g-b)/c)%6:mx===g?(b-r)/c+2:(r-g)/c+4;h*=60;if(h<0)h+=360;}return [h,mx?c/mx:0,mx/255];};
// The colour of the paper band around the bills, from the middle of the picture: the bills
// themselves are a washed-out grey-green, so the band is whatever saturated colour dominates.
// `paper` is how much of the picture is that grey-green: every stack of money has plenty, nothing
// else in the inventory has any.
export function stripeColor({width:W,height:H,data:d},box){
  const x0=Math.round(box.x+box.w*.18),x1=Math.round(box.x+box.w*.82),y0=Math.round(box.y+box.h*.28),y1=Math.round(box.y+box.h*.74);
  const bins=new Float64Array(36),hues=Array.from({length:36},()=>[0,0,0]);let total=0,bright=0,paper=0;
  for(let y=Math.max(0,y0);y<Math.min(H??Infinity,y1);y++)for(let x=Math.max(0,x0);x<Math.min(W,x1);x++){
    const i=(y*W+x)*4,[h,s,v]=hsv(d[i],d[i+1],d[i+2]);total++;
    if(v>.82&&s<.12)bright++;
    if(s>=.04&&s<.3&&v>.45&&h>=50&&h<=170)paper++;
    if(s>=.3&&v>=.3){const k=Math.floor(h/10)%36;bins[k]++;hues[k][0]+=h;hues[k][1]+=s;hues[k][2]+=v;}
  }
  const win=j=>[(j+35)%36,j,(j+1)%36];
  let k=0;for(let j=1;j<36;j++){const a=win(j).reduce((n,i)=>n+bins[i],0),b=win(k).reduce((n,i)=>n+bins[i],0);if(a>b||(a===b&&bins[j]>bins[k]))k=j;}
  // Averaged over the whole window; a hue near 0/360 is unwrapped first so red does not average to cyan.
  let n=0,hs=0,ss=0,vs=0;
  for(const i of win(k)){n+=bins[i];hs+=hues[i][0]+(k<=1&&i>=35?-360*bins[i]:k>=35&&i<=0?360*bins[i]:0);ss+=hues[i][1];vs+=hues[i][2];}
  const share=v=>total?+(v/total).toFixed(3):0;
  return {hue:n?Math.round((hs/n+360)%360):null,sat:n?+(ss/n).toFixed(2):0,val:n?+(vs/n).toFixed(2):0,share:share(n),white:share(bright),paper:share(paper)};
}
// The in-game paper colours, measured off real screenshots. They are not the swatches the calculator
// draws (those are pastel so they read on a dark page), so the band is found by the colour word in its
// name. Purple and Violet sit only ten degrees apart; Violet is the far stronger colour.
const STRIPES=[['brown',30,.42],['yellow',53,.6],['blue',228,.57],['purple',314,.35],['violet',324,.54]];
export function stripeBand(c,bands){
  if(!c||c.paper<.06)return null;// not a stack of money
  const named=re=>bands.find(b=>re.test(b.name))||null;
  // White paper has no hue at all, and loose change has no paper band.
  if(c.hue===null||c.share<.01)return named(c.white>=.015?/white/i:/loose|change|coin/i);
  let best=null,cost=3;
  for(const b of bands){
    const k=STRIPES.find(([word])=>b.name.toLowerCase().includes(word));
    if(!k)continue;
    const dh=Math.abs(c.hue-k[1]),d=Math.min(dh,360-dh)/10+Math.abs(c.sat-k[2])*20;
    if(d<cost){cost=d;best=b;}
  }
  return best;
}
// The boxed count in a slot's top-right corner: a small cluster of bright, colourless digits. None at all
// means one item. Returns the digits' bounds in image pixels, or null.
export function findBadge({width:W,height:H,data:d},box){
  // Top fifth, right third: the bills are drawn lower down, and their highlights are never this white.
  const x0=Math.max(0,Math.round(box.x+box.w*.65)),x1=Math.min(W,Math.round(box.x+box.w)),y0=Math.max(0,Math.round(box.y)),y1=Math.min(H,Math.round(box.y+box.h*.2));
  let n=0,bx0=Infinity,bx1=-1,by0=Infinity,by1=-1;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=(y*W+x)*4,[,s,v]=hsv(d[i],d[i+1],d[i+2]);
    if(v>.72&&s<.12){n++;bx0=Math.min(bx0,x);bx1=Math.max(bx1,x);by0=Math.min(by0,y);by1=Math.max(by1,y);}
  }
  // Digits are small: a bright patch as tall as a fifth of the slot is part of the picture, not a count.
  if(n<6||by1-by0>box.h*.2||bx1-bx0>box.w*.35)return null;
  return {x0:bx0,y0:by0,x1:bx1+1,y1:by1+1};
}

// --- counts --------------------------------------------------------------
// One crop per matched name: from just left of the name to 90% of the column pitch, covering the
// count on the left and the weight on the right. The inventory panel is drawn in perspective, so the
// row's height above the name drifts; when the first pass already read the weight (it usually does)
// the crop is centred on it, otherwise on the usual two-thirds of a slot above the name.
function slotRows(names,unit,anchors,grid,half=1.2){
  let pitch,above;
  if(grid){pitch=grid.colPitch;above=grid.rowPitch*.655;}
  else{
    const columns=[...new Set(names.map(n=>Math.round(n.x0/unit)))].sort((a,b)=>a-b);
    const gaps=columns.slice(1).map((x,i)=>(x-columns[i])*unit).filter(g=>g>4*unit);
    pitch=gaps.length?Math.min(...gaps):11.5*unit;above=6.2*unit;
  }
  return names.map(n=>{
    const near=anchors.map(a=>({a,cy:(a.y0+a.y1)/2})).filter(({a,cy})=>a.x0>n.x0+.3*pitch&&a.x0<n.x0+pitch&&cy<n.y0-above*.65&&cy>n.y0-above*1.53)
      .sort((p,q)=>Math.abs(p.cy-(n.y0-above))-Math.abs(q.cy-(n.y0-above)))[0];
    const cy=near?near.cy:n.y0-above;
    const h=half*unit;return {x0:n.x0-.6*unit,x1:n.x0+.9*pitch,y0:cy-h,y1:cy+h};
  });
}
// Every crop is drawn into one tall strip, zoomed so the glyphs are about 44px, and read in one go.
// Returns the words found in each crop, left to right, with the strip geometry to place them by.
// With `split`, the part of each crop right of that fraction of its width goes on a line of its own
// under the rest. The panel is drawn tilted, so on a small screenshot the count sits half a letter
// lower than the weight beside it, and read as one line "x10  1.00 kg" came back as "ao 100%". Apart,
// each is one short word the reader has no trouble with. With `bin`, each crop is cut to black and white
// at that level once it has been stretched.
async function readTiles(worker,src,rows,split=0,bin=0){
  const unitPx=src.unit/src.scale,zoom=Math.max(1,Math.min(8,44/unitPx)),gap=Math.round(1.2*unitPx*zoom);
  const boxes=rows.map(r=>{
    const x0=Math.max(0,Math.round(r.x0/src.scale)),y0=Math.max(0,Math.round(r.y0/src.scale));
    return {x0,y0,w:Math.max(0,Math.min(src.bitmap.width,Math.round(r.x1/src.scale))-x0),h:Math.max(0,Math.min(src.bitmap.height,Math.round(r.y1/src.scale))-y0)};
  });
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(Math.max(1,...boxes.map(b=>b.w))*zoom)+2*gap;
  let y=gap;const at=boxes.map(b=>{const h=Math.round(b.h*zoom),a={y,h,y2:split?y+h+gap:y};y=a.y2+h+gap;return a;});
  canvas.height=y;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';
  // Each row is stretched on its own: a hotbar slot sits on a grey panel, an inventory slot on black.
  // It is stretched whole before any split, so an empty count corner is not blown up out of its own noise.
  boxes.forEach((b,i)=>{
    if(!b.w||!b.h)return;
    const w=Math.round(b.w*zoom),{y,h,y2}=at[i];
    ctx.drawImage(src.bitmap,b.x0,b.y0,b.w,b.h,gap,y,w,h);
    enhance(ctx,gap,y,w,h,{invert:true,fromMedian:true});
    stripRules(ctx,gap,y,w,h);
    if(bin){const image=ctx.getImageData(gap,y,w,h),d=image.data;for(let i=0;i<d.length;i+=4)d[i]=d[i+1]=d[i+2]=d[i]<bin?0:255;ctx.putImageData(image,gap,y);}
    if(split){const cut=Math.round(w*split);ctx.putImageData(ctx.getImageData(gap+cut,y,w-cut,h),gap+cut,y2);ctx.fillRect(gap+cut,y,w-cut,h);}
  });
  // Read as one block of text lines. No character whitelist: the LSTM engine drops words instead of
  // honouring it, and sparse mode throws the short "x5" away as noise. Look-alikes are fixed in parseRow.
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:''});
  const {data}=await worker.recognize(await toBlob(canvas),{},{blocks:true});
  const words=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))).map(w=>({text:w.text,x:w.bbox.x0,y:(w.bbox.y0+w.bbox.y1)/2,conf:w.confidence}));
  const line=(y,h)=>words.filter(w=>w.y>=y-gap/2&&w.y<y+h+gap/2).sort((p,q)=>p.x-q.x);
  const tiles=at.map(({y,h,y2})=>split?{left:line(y,h),right:line(y2,h)}:{words:line(y,h)});
  globalThis.__scanDebug?.push(canvas.toDataURL());// off unless a dev sets it; .local/scan/crops.html renders the strips
  globalThis.__scanGeometry?.push({at,gap,split});
  canvas.width=canvas.height=0;// the strip can run to tens of megabytes; let it go before the next pass
  return tiles;
}
// The count is the left part of the row, the weight the right part.
// On the second look, anything darker than this after the stretch is ink and the rest is paper. Over the
// bench, 48 left 12 slots unsure, 64 left 9, 80 left 8, 96 left 11 and 128 left 12. The first read stays
// grey: cutting it too made it worse.
const RETRY_INK=80;
const meanConf=words=>words.length?words.reduce((n,w)=>n+w.conf,0)/words.length/100:0;
const readRows=async(worker,src,rows,bin=0)=>(await readTiles(worker,src,rows,.42,bin)).map(({left,right})=>
  ({left:left.map(w=>w.text).join(' '),right:right.map(w=>w.text).join(' '),conf:meanConf([...left,...right])}));
// Second look at the slots whose name the first pass missed: the whole crop is one name.
const readNames=async(worker,src,rows)=>(await readTiles(worker,src,rows)).map(({words})=>words.map(w=>w.text).join(' ').trim());
// Left "x5" → count 5; right "500 g" → 500 grams ("1.00 kg" → 1000). Hotbar slots also print their
// key number on the left ("3x5", "3 x5"), so the count is only ever whatever follows the x. A bare
// number on the left is NOT a count: it is the hotbar key, or the wreckage of a crop that slipped, and
// reading one as a quantity once turned a stack of ten into a hundred.
export function parseRow({left,right}){
  // Small digits come back as look-alike letters now and then: S00 g, x1O, l.00 kg.
  const fix=s=>s.toLowerCase().replace(/×/g,'x').replace(/[s$]/g,'5').replace(/[od]/g,'0').replace(/[li|]/g,'1').replace(/b/g,'8').replace(/,/g,'.');
  const l=fix(left),r=fix(right);
  // A big stack can carry a thousands separator ("x1,250"), which fix() has just made a point.
  const count=l.match(/x\s*(\d{1,3}(?:\.\d{3})+|\d{1,4})/);
  // The weight is the number with its g or kg after it ("8 S00 g" is a stray mark and 500 g); failing
  // that, the first number there is.
  const weight=r.match(/(\d+(?:\.\d+)?)(?=\s*k?\s*[g¢])/)??r.match(/(\d+(?:\.\d+)?)/);
  let grams=null,labelled=false;
  if(weight){
    const digits=weight[1],v=Number(digits),dot=digits.includes('.'),after=r.slice(weight.index+digits.length);
    const kilos=dot||/^\s*k/.test(after);
    // The number should be followed by its g or kg. One that came back as "100%", or bare, is a weight
    // the reader struggled with: "1.00 kg" lost its point and its kg exactly that way.
    labelled=/^\s*(k|[g¢])/.test(after);
    if(!kilos){
      // From 1000 g up the game prints kg, so four digits of grams is a misread - nearly always the g
      // itself read as an 8 or a 9 ("200 g" as "2008").
      if(v>=1000){grams=/^\d{3}[89]$/.test(digits)?Math.floor(v/10):null;labelled=grams!==null;}
      else grams=Math.round(v)||null;// nothing weighs 0 g: that is "200g" with the 2 lost
    }
    else if(dot)grams=Math.round(v*1000)||null;
    // Kilograms are always printed with two decimals ("1.00 kg", "13.50 kg"), so a kg weight with no
    // point in it lost just the point: "Look" is "100k", 1.00 kg. Read as 100 kg it would have made a
    // stack of ten a thousand. Fewer than three digits is no kg weight the game prints.
    else grams=/^\d{3,5}$/.test(digits)?v*10:null;
  }
  // The "x" is the thinnest glyph on the row and sometimes goes missing on its own, leaving "2". That is
  // kept aside, to be believed only when the weight says the same.
  const bareNumber=count?null:l.match(/^\s*(\d{1,3})\s*$/);
  // The game draws no count at all for a single item, so a count corner with nothing in it is itself
  // the answer - and it is what tells a lone 200 g band apart from a garbled stack of them.
  return {n:count?Number(count[1].replace(/\./g,'')):null,grams,bare:!left.trim(),guess:bareNumber?Number(bareNumber[1]):null,labelled};
}
// Grams per item for something the game facts below do not cover, from the slots of this screenshot
// that showed both a count and a weight. Stacks weigh a round number per item (100 g, 200 g), so a
// misread count gives an odd ratio, which is skipped. A lone item is no evidence: its empty count corner
// may be a count the reader lost, and "x2  200 g" read that way once taught the scanner a 200 g band.
// Neither is "x1", which the game never draws (it is "x10" with a digit lost). Nothing learned is kept
// between screenshots - one bad read once taught it 10 g Brown and every later stack of five came out
// as fifty.
const tally=(into,key,value)=>{(into[key]??={})[value]=(into[key][value]||0)+1;};
const top=votes=>Number(Object.entries(votes).sort((a,b)=>b[1]-a[1])[0][0]);
const perItem=r=>r.n>1&&r.grams&&r.grams%r.n===0&&(r.grams/r.n)%10===0?r.grams/r.n:null;
export function inferUnits(rows){
  const units={},counted={};
  for(const r of rows){const u=perItem(r);if(u)tally(counted,r.bandId,u);}
  for(const [bandId,v] of Object.entries(counted))units[bandId]=top(v);
  return units;
}
// What an item weighs is a fact of the game, not something to learn: every band is 100 g, a Violet
// Stack 200 g, Loose Change 50 g a piece (x24 = 1.20 kg). Borrowing the 100 g of the bands around it
// read "x2  100 g" of loose change as one, and called it sure.
export const usualUnit=name=>/loose|change|coin/i.test(name)?50:/violet/i.test(name)?200:/\b(band|stack)s?\b/i.test(name)?100:null;
// Bands in one screenshot nearly all weigh the same per item, so for an item the facts above do not
// cover, what the rest of the screenshot weighs is a better guess than giving up on it.
export function commonUnit(rows){
  const votes={};
  for(const r of rows){const u=perItem(r);if(u)tally(votes,'u',u);}
  return votes.u?top(votes.u):null;
}
// A count nobody can stand behind is worth less than an honest blank: qty null makes the screen say
// "not readable" and the number gets typed in, instead of a wrong one being added up in silence.
const sane=q=>Number.isFinite(q)&&q>=1&&q<=9999;
// Sure takes two things on the slot that agree: the count and the weight, or an empty count corner and
// the weight of one item. They are drawn apart and misread apart, so being sure and wrong would take both
// going wrong the same way. Given two reads of a slot, everything either of them made out has to agree.
// Anything short of that is offered, flagged: "x10  1.00 kg" once came back as "ao  100%", was taken
// at its weight alone, and was added up as one, for sure.
// `borrowed` means the unit is the rest of the screenshot's, not this band's own: good enough to
// suggest a number, not to vouch for it.
export function resolveCount(reads,unit,borrowed=false){
  const counts=[],guesses=[],weights=[],rough=[];
  let empty=true,weighedAny=false;
  for(const {n,grams,bare,guess=null,labelled=true} of [reads].flat()){
    if(grams)weighedAny=true;
    // A weight that comes to a whole number of items says how many there are; one that does not was
    // misread. One that lost its g or kg ("100%") is a read the reader struggled with.
    const weighed=grams&&unit?grams/unit:null,near=weighed===null?null:Math.round(weighed);
    if(near!==null&&Math.abs(weighed-near)<=.05&&sane(near))(labelled&&!borrowed?weights:rough).push(near);
    // The game never draws "x1", so a one there is a count that lost a digit ("x10" as "x1"). A number with
    // no x may be a count that lost its x ("2" for "x2"), or a hotbar key, or "x5" read as "3": it can make
    // a slot sure by agreeing with the weight, but it never names the number on its own.
    if(n!==null){if(n!==1&&sane(n))counts.push(n);}
    else if(guess!==null&&guess>=2&&sane(guess))guesses.push(guess);
    if(!bare)empty=false;
  }
  // An empty count corner means one item - unless another read found the count the first one dropped.
  const made=[...counts,...guesses],said=made.length?made:empty?[1]:[],all=[...said,...weights];
  if(said.length&&weights.length&&all.every(v=>v===all[0]))return {qty:all[0],sure:true};
  // Short of that, the number most of the reads point at. The weight is the bigger, cleaner text, so it
  // breaks a tie; a rough weight only speaks when nothing else did. And since nothing is drawn for one
  // item, a weight with no unit to divide it by still means one.
  const votes=new Map();
  for(const v of counts)votes.set(v,(votes.get(v)||0)+1);
  for(const v of weights)votes.set(v,(votes.get(v)||0)+1.1);
  const best=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0]??rough[0]??(weighedAny&&!unit?1:null);
  return {qty:best,sure:false};
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
  try{localStorage.removeItem(UNIT_KEY);}catch{}
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
  const rawPx=heights.length?heights[heights.length>>1]/src.scale:null;
  // Slot outlines, from the coloured bar under every filled slot. The viewer draws them, and in the
  // inventory style with no names they are the only way in.
  const pixels=imagePixels(src.bitmap),boxes=slotBoxes(findBars(pixels));
  const boxAt=(x,y)=>boxes.find(b=>x>=b.x-6&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h+6)||null;
  const names=[],others=[],othersAt=[],seen=new Set();
  // Anything read that is not a band is offered back to the user, who can tell the scanner it is one.
  const addOther=(text,r)=>{
    const key=normalizeName(text).join(' ');if(!key||seen.has(key))return;
    seen.add(key);others.push(text);
    const x=r.x0/src.scale,y=r.y0/src.scale;
    othersAt.push({text,box:boxAt(x,y)||{x:Math.round(x),y:Math.round(y),w:Math.round((r.x1-r.x0)/src.scale),h:Math.round((r.y1-r.y0)/src.scale)}});
  };
  for(const line of lines){
    const band=matchBand(line.text,bands,aliases);
    if(band){names.push({...line,band});continue;}
    if(line.confidence>=75&&/[a-z]{4}/i.test(line.text))addOther(line.text,line);
  }
  // The sweep over the whole screenshot is good at finding WHERE the slots are and unreliable at
  // reading them: it has to take every name at whatever size the screenshot happens to be, next to
  // its neighbours, and it drops or merges some every time. Once the grid is known, each slot's name
  // can be cut out and read on its own, blown up and stretched against its own background, which is
  // both steadier and far cheaper than another sweep. So the grid decides, and the sweep only fills
  // in for a cell the close-up could not read.
  const grid=lattice(names,src.unit),cells=grid?gridCells(grid,names):[];
  let slots=names;
  if(cells.length&&cells.length<=60){
    onProgress?.({phase:'read',text:'Reading each slot…'});
    const texts=await readNames(worker,src,cells.map(cell=>nameRect(cell,grid,src.unit)));
    slots=[];
    // One name the sweep measured belongs to one slot. If two cells both reach for it the grid has a
    // line too many, and counting that slot on both is how a stack of ten became twenty.
    const taken=new Set();
    cells.forEach((cell,i)=>{
      const text=texts[i],band=text&&matchBand(text,bands,aliases),prior=cellAt(grid,names,cell);
      if(prior&&taken.has(prior))return;
      if(prior)taken.add(prior);
      // Where the sweep did see the name, keep the box it measured: the count crop is cut relative to
      // it, and a real measurement beats a position averaged out of the grid by a few pixels.
      if(band)slots.push(prior?{...prior,band}:{text,x0:cell.x0,y0:cell.y0,x1:cell.x0+grid.colPitch,y1:cell.y0+src.unit,band});
      else if(prior)slots.push(prior);
      else if(text&&/[a-z]{4}/i.test(text))addOther(text,nameRect(cell,grid,src.unit));
    });
  }
  let items=[];
  if(!slots.length&&boxes.length){
    phase='counts';onProgress?.({phase:'read',text:'Reading counts…'});
    items=await readPictures(worker,src,pixels,boxes,bands,othersAt);
  }
  // A slot the bars missed still gets an outline, cut from the grid around its name.
  const gridBox=line=>grid?{x:Math.round((line.x0-.4*src.unit)/src.scale),y:Math.round((line.y1+.5*src.unit-.93*grid.rowPitch)/src.scale),w:Math.round(.93*grid.colPitch/src.scale),h:Math.round(.93*grid.rowPitch/src.scale)}:null;
  if(slots.length){
    phase='counts';onProgress?.({phase:'read',text:'Reading counts…'});
    const parse=(row,i)=>({...parseRow(row),text:(row.left+' · '+row.right).trim(),bandId:slots[i].band.id,conf:row.conf});
    const rows=(await readRows(worker,src,slotRows(slots,src.unit,anchors,grid))).map(parse);
    // What an item weighs: the game's own facts, else what this screenshot's counted stacks say. Nothing
    // is carried over from one screenshot to the next.
    const fixed=Object.fromEntries(bands.map(b=>[b.id,usualUnit(b.name)]));
    const units=inferUnits(rows.filter(r=>!fixed[r.bandId])),shared=commonUnit(rows);
    const settle=(reads,bandId)=>{const own=fixed[bandId]||units[bandId];return resolveCount(reads,own||shared,!own);};
    const found=rows.map(r=>({reads:[r],...settle(r,r.bandId)}));
    // A crop that lands a pixel or two off clips the digits enough to lose them, and the height that
    // reads one slot cleanly is not the one that reads its neighbour - sweeping the height moved single
    // slots in and out of legibility with no best setting. So every slot whose count and weight did not
    // agree gets a second look at a tighter crop, and the two reads are weighed together. It costs one
    // small read. That look is cut to black and white first (RETRY_INK): on a strip with this little ink
    // the reader's own threshold lands too high, the glow round each letter runs together, and slots came
    // back blank on both reads.
    const again=found.flatMap((f,i)=>f.sure?[]:[i]);
    if(again.length){
      const tight=slotRows(slots,src.unit,anchors,grid,1);
      (await readRows(worker,src,again.map(i=>tight[i]),RETRY_INK)).forEach((row,k)=>{
        const i=again[k],reads=[rows[i],parse(row,i)];
        found[i]={reads,...settle(reads,rows[i].bandId)};
      });
    }
    items=found.map(({reads,qty,sure},i)=>{
      const line=slots[i],x=Math.round(line.x0/src.scale),y=Math.round(line.y0/src.scale);
      return {text:line.text,bandId:line.band.id,name:line.band.name,qty,sure,raw:reads.map(r=>r.text).join(' / '),x,y,box:boxAt(x,y)||gridBox(line),
        confidence:confidence(qty,sure,Math.max(...reads.map(r=>r.conf)))};
    });
  }
  // How big the slots are in the original pixels. Bench: ~110px on every shot that reads perfectly,
  // errors start near 95px (85% of that size) and the reads fall apart by 80px, so under 100px is flagged.
  const slotPx=boxes.length?Math.round(boxes.map(b=>b.w).sort((a,b)=>a-b)[boxes.length>>1]):null;
  return {items,others,othersAt,width:src.bitmap.width,height:src.bitmap.height,textPx:rawPx==null?null:Math.round(rawPx),slotPx,lowRes:(slotPx!=null&&slotPx<100)||(rawPx!=null&&rawPx<8.5),ms:Math.round(performance.now()-started)};
  }finally{src.canvas.width=src.canvas.height=0;src.bitmap?.close?.();}
}
function imagePixels(bitmap){
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=0;
  return pixels;
}
// What the viewer shows as "98% match": the reader's own confidence, held down when the count and the
// weight did not agree, and nothing at all for a slot that could not be read.
const confidence=(qty,sure,conf)=>qty===null?0:+Math.min(sure?.99:.6,Math.max(.3,conf||0)).toFixed(2);
// The inventory style with no names and no weights. Each slot is told apart by the colour of its paper
// band, and counted by the boxed number in its corner: no box means one item.
async function readPictures(worker,src,pixels,boxes,bands,othersAt){
  const slots=[];
  for(const box of boxes){
    const band=stripeBand(stripeColor(pixels,box),bands);
    if(band)slots.push({box,band,badge:findBadge(pixels,box)});
    else othersAt.push({text:'',box});
  }
  const counted=slots.filter(s=>s.badge);
  if(counted.length){
    // Read at two sizes: a count both agree on is vouched for, one they split on gets double-checked.
    const badges=counted.map(s=>s.badge),[a,b]=[await readBadges(worker,src.bitmap,badges,42),await readBadges(worker,src.bitmap,badges,52)];
    counted.forEach((s,i)=>{
      const first=a[i].map(w=>w.text).join(' '),second=b[i].map(w=>w.text).join(' '),n1=badgeNumber(first),n2=badgeNumber(second);
      s.raw=first===second?first:first+' / '+second;s.conf=Math.min(meanConf(a[i]),meanConf(b[i])||meanConf(a[i]));
      s.n=n1??n2;s.agreed=n1!==null&&n1===n2;
    });
  }
  return slots.map(s=>{
    const qty=s.badge?s.n:1,sure=s.badge?s.agreed:true;
    return {text:'',bandId:s.band.id,name:s.band.name,qty,sure,raw:s.badge?s.raw:'',x:s.box.x,y:s.box.y,box:s.box,confidence:confidence(qty,sure,s.badge?s.conf:.95)};
  });
}
// Badge digits are a few pixels tall and often a single character, which the reader throws away as
// noise when it meets one alone on a line. Laid side by side on one line, blown up, they read as words.
// The font is so small that a 9 and an 8 are one pixel apart, and a contrast stretch fills that pixel
// in, so each badge is cut hard at halfway between its background and its digits instead.
async function readBadges(worker,bitmap,badges,size){
  const tall=badges.map(b=>b.y1-b.y0).sort((a,b)=>a-b)[badges.length>>1],zoom=Math.max(1,Math.min(12,size/tall)),pad=2;
  const gap=Math.round(tall*zoom*1.5);
  const canvas=document.createElement('canvas');
  let x=gap;const at=badges.map(b=>{const a={x,w:Math.round((b.x1-b.x0+2*pad)*zoom),h:Math.round((b.y1-b.y0+2*pad)*zoom)};x+=a.w+gap;return a;});
  canvas.width=x;canvas.height=Math.max(...at.map(a=>a.h))+2*gap;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';
  badges.forEach((b,i)=>{
    const {x,w,h}=at[i];
    ctx.drawImage(bitmap,b.x0-pad,b.y0-pad,b.x1-b.x0+2*pad,b.y1-b.y0+2*pad,x,gap,w,h);
    const image=ctx.getImageData(x,gap,w,h),d=image.data,grey=new Uint8Array(d.length/4);
    for(let i=0;i<d.length;i+=4)grey[i>>2]=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
    const sorted=[...grey].sort((p,q)=>p-q),cut=(sorted[sorted.length>>1]+sorted[Math.floor(sorted.length*.98)])/2;
    for(let i=0;i<d.length;i+=4)d[i]=d[i+1]=d[i+2]=grey[i>>2]>cut?0:255;
    ctx.putImageData(image,x,gap);
  });
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,tessedit_char_whitelist:''});
  const {data}=await worker.recognize(await toBlob(canvas),{},{blocks:true});
  globalThis.__scanDebug?.push(canvas.toDataURL());
  canvas.width=canvas.height=0;
  const words=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))).map(w=>({text:w.text,x:(w.bbox.x0+w.bbox.x1)/2,conf:w.confidence}));
  return at.map(a=>words.filter(w=>w.x>=a.x-gap/2&&w.x<a.x+a.w+gap/2));
}
// A badge holds nothing but digits. A count of one is never boxed, so "1" means the reader lost a digit.
export function badgeNumber(text){
  const t=String(text).toLowerCase().replace(/[s$§]/g,'5').replace(/[od]/g,'0').replace(/[li|]/g,'1').replace(/b/g,'8').replace(/[\s,.]/g,'');
  const m=t.match(/^[^\d]?(\d{1,4})[^\d]?$/);
  const n=m?Number(m[1]):null;
  return n!==null&&n>=2&&n<=9999?n:null;
}
