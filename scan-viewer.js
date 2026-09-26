// The scan viewer: a modal that opens as soon as a screenshot is added. It shows the screenshot with a box
// drawn round every slot the reader found, the counts it read (editable), and adds them to the count.
// Everything it shows comes from band-scan.js; nothing here reads pixels.
import {money} from './calc-model.js';
import {escapeHtml as esc} from './ui-utils.js';

const ZOOM=2.3,SWEEP_MS=1500;
const pct=n=>Math.round(n*100)+'%';
const short=name=>name.replace(/ band$/i,'');

// One row per band: the slots it was read from, what they add up to, and how sure the reader was.
// qty is null only when no slot of that band could be read.
export function scanRows(scan,bands){
  const by=new Map();
  for(const it of scan?.items||[]){
    const r=by.get(it.bandId)||{bandId:it.bandId,items:[],qty:null,unknown:0,unsure:false,confidence:1};
    r.items.push(it);
    if(it.qty===null)r.unknown++;else{r.qty=(r.qty||0)+it.qty;r.confidence=Math.min(r.confidence,it.confidence??1);}
    if(!it.sure)r.unsure=true;
    by.set(it.bandId,r);
  }
  return bands.filter(b=>by.has(b.id)).map(b=>({...by.get(b.id),band:b}));
}
// What a screenshot adds to the count: the reader's numbers, with the user's edits on top.
export const shotCounts=(shot,bands)=>scanRows(shot.scan,bands).map(r=>({bandId:r.bandId,qty:shot.edits&&r.bandId in shot.edits?shot.edits[r.bandId]:r.qty}));

export function openScanViewer({shot,bands,from,reduceMotion,onFill,onAgain,onAlias,onClose}){
  const url=URL.createObjectURL(shot.file);
  shot.edits??={};
  let focus=null,phase='',closed=false,picked=null;
  const el=document.createElement('div');
  el.className='sv';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','sv-title');
  el.innerHTML='<div class="sv-backdrop" data-sv-close></div><div class="sv-card" data-sv-card>'
    +'<div class="sv-left"><div class="sv-meta"><span class="sv-file"><i></i>'+esc(shot.name)+'</span><span>Read on this device · nothing uploaded</span></div>'
    +'<div class="sv-stage" data-sv-stage><div class="sv-fly" data-sv-fly><div class="sv-layer" data-sv-layer><img alt="Your screenshot" data-sv-img><div class="sv-boxes" data-sv-boxes></div></div></div>'
    +'<div class="sv-grid" aria-hidden="true"></div><div class="sv-sweep" aria-hidden="true"></div>'
    +'<div class="sv-readout" data-sv-readout hidden></div><button type="button" class="sv-fit" data-sv-fit hidden>Fit</button></div>'
    +'<p class="sv-hint">Hover a result to zoom in. Click any slot to inspect it. Esc closes.</p></div>'
    +'<div class="sv-right"><div class="sv-head"><h2 id="sv-title">Scan results</h2><button type="button" class="sv-close" data-sv-close aria-label="Close">×</button></div>'
    +'<p class="sv-status" data-sv-status></p><p class="eyebrow">Adds to this count</p><strong class="sv-total" data-sv-total>···</strong>'
    +'<div class="sv-rows" data-sv-rows></div><div class="sv-others" data-sv-others hidden></div>'
    +'<div class="sv-foot"><button type="button" class="button primary" data-sv-fill disabled>Fill in counts</button><button type="button" class="button secondary" data-sv-again>Scan again</button></div></div></div>';
  document.body.append(el);
  const $=s=>el.querySelector(s),card=$('[data-sv-card]'),stage=$('[data-sv-stage]'),layer=$('[data-sv-layer]'),img=$('[data-sv-img]'),boxesEl=$('[data-sv-boxes]');
  const rowsEl=$('[data-sv-rows]'),othersEl=$('[data-sv-others]'),readout=$('[data-sv-readout]'),fit=$('[data-sv-fit]');
  const opener=document.activeElement;
  document.documentElement.classList.add('sv-open');

  // The card is drawn at 1180×640 and zoomed to fit; narrow screens get the stacked layout instead.
  const size=()=>{
    const wide=innerWidth>=1000;
    card.style.zoom=wide?String(Math.min(1,(innerWidth-48)/1180,(innerHeight-48)/640)):'';
    place();
  };
  // The screenshot is fitted inside the stage (object-fit: contain, by hand) so the boxes can share its coordinates.
  let fitted=null;
  const place=()=>{
    const W=img.naturalWidth,H=img.naturalHeight;if(!W||!H)return;
    const sw=stage.clientWidth,sh=stage.clientHeight,k=Math.min(sw/W,sh/H);
    fitted={w:W*k,h:H*k,x:(sw-W*k)/2,y:(sh-H*k)/2,k,sw,sh};
    Object.assign(layer.style,{width:fitted.w+'px',height:fitted.h+'px',left:fitted.x+'px',top:fitted.y+'px'});
    zoomTo(focus,true);
  };
  addEventListener('resize',size);
  // The stage can gain its size after the image loads (hidden tab, stacked layout settling); refit whenever it does.
  const watch=new ResizeObserver(place);watch.observe(stage);

  const scan=()=>shot.scan&&!shot.scan.busy?shot.scan:null;
  const rows=()=>scanRows(scan(),bands);
  const countOf=r=>r.bandId in shot.edits?shot.edits[r.bandId]:r.qty;
  const tone=it=>it.qty===null?'danger':it.sure?'good':'amber';
  const boxStyle=b=>{const W=img.naturalWidth||scan()?.width||1,H=img.naturalHeight||scan()?.height||1;return 'left:calc('+(b.x/W*100)+'% - 5px);top:calc('+(b.y/H*100)+'% - 5px);width:calc('+(b.w/W*100)+'% + 10px);height:calc('+(b.h/H*100)+'% + 10px)';};
  // Every box pops in as the sweep's leading edge crosses its middle.
  const popDelay=b=>Math.round(((b.y+b.h/2)/(img.naturalHeight||scan()?.height||1))*SWEEP_MS);
  function drawBoxes(){
    const s=scan();if(!s||s.error){boxesEl.innerHTML='';return;}
    const items=s.items.filter(i=>i.box).map((it,i)=>({kind:'item',i,it,box:it.box}));
    const others=(s.othersAt||[]).map((o,i)=>({kind:'other',i,o,box:o.box}));
    boxesEl.innerHTML=items.map(({i,it,box})=>'<button type="button" class="sv-box is-'+tone(it)+'" data-sv-box="item:'+i+'" data-band="'+esc(it.bandId)+'" style="'+boxStyle(box)+';--pop:'+popDelay(box)+'ms"><span class="sv-tag">'+esc(short(it.name))+' ×'+(it.qty??'?')+(it.qty===null?'':' · '+pct(it.confidence??0))+'</span></button>').join('')
      +others.map(({i,o,box})=>'<button type="button" class="sv-box is-soft" data-sv-box="other:'+i+'" style="'+boxStyle(box)+';--pop:'+popDelay(box)+'ms"><span class="sv-tag">'+esc(o.text||'Not a band')+'</span></button>').join('');
    boxesEl.querySelectorAll('[data-sv-box]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const [kind,i]=b.dataset.svBox.split(':');setFocus(kind==='item'?{slot:Number(i)}:{other:Number(i)});}));
  }

  // Zoom onto whatever is in focus: one slot, all of one band's slots, or an item that is not a band.
  function focusBoxes(f){
    const s=scan();if(!f||!s)return [];
    if(f.band)return s.items.filter(i=>i.bandId===f.band&&i.box).map(i=>i.box);
    if(f.slot!==undefined)return s.items[f.slot]?.box?[s.items[f.slot].box]:[];
    if(f.other!==undefined)return s.othersAt?.[f.other]?.box?[s.othersAt[f.other].box]:[];
    return [];
  }
  function zoomTo(f,instant=false){
    if(!fitted)return;
    const boxes=focusBoxes(f),{k,w,h,x:ox,y:oy,sw,sh}=fitted;
    if(instant)layer.classList.add('is-instant');
    if(!boxes.length){layer.style.transform='';fit.hidden=true;}
    else{
      const x0=Math.min(...boxes.map(b=>b.x))*k,y0=Math.min(...boxes.map(b=>b.y))*k,x1=Math.max(...boxes.map(b=>b.x+b.w))*k,y1=Math.max(...boxes.map(b=>b.y+b.h))*k;
      const s=Math.max(1,Math.min(ZOOM,sw*.8/(x1-x0),sh*.8/(y1-y0)));
      // Centre the target, then pull back so no empty edge shows past the screenshot.
      const clamp=(t,o,len,room)=>len*s>=room?Math.min(-o,Math.max(room-o-len*s,t)):(room-len*s)/2-o;
      const tx=clamp(sw/2-ox-s*(x0+x1)/2,ox,w,sw),ty=clamp(sh/2-oy-s*(y0+y1)/2,oy,h,sh);
      layer.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';
      fit.hidden=false;
    }
    if(instant){void layer.offsetWidth;layer.classList.remove('is-instant');}
  }
  function setFocus(f){
    focus=f;zoomTo(f);
    const s=scan();
    boxesEl.classList.toggle('has-focus',!!f);
    const band=f?.band??(f?.slot!==undefined?s?.items[f.slot]?.bandId:null);
    boxesEl.querySelectorAll('[data-sv-box]').forEach(b=>b.classList.toggle('is-focus',!!f&&(f.slot!==undefined?b.dataset.svBox==='item:'+f.slot:f.other!==undefined?b.dataset.svBox==='other:'+f.other:b.dataset.band===f.band)));
    rowsEl.querySelectorAll('[data-sv-row]').forEach(r=>r.classList.toggle('is-focus',!!band&&r.dataset.svRow===band));
    // The readout names what is in focus and what was read from it.
    if(!f||!s){readout.hidden=true;return;}
    let name,line,t;
    if(f.other!==undefined){const o=s.othersAt[f.other];name=o.text||'Not a band';line='Not a band · left out';t='soft';}
    else{
      const its=f.slot!==undefined?[s.items[f.slot]]:s.items.filter(i=>i.bandId===f.band),known=its.filter(i=>i.qty!==null);
      name=bands.find(b=>b.id===its[0]?.bandId)?.name||its[0]?.name||'';
      t=known.length<its.length?'danger':its.every(i=>i.sure)?'good':'amber';
      line=!known.length?'Digits too blurry to read':'Read ×'+known.reduce((n,i)=>n+i.qty,0)+' · '+pct(Math.min(...known.map(i=>i.confidence??0)))+' match'+(its.length>1?' · '+its.length+' slots':'');
    }
    readout.hidden=false;readout.className='sv-readout is-'+t;
    readout.innerHTML='<i></i><div><strong>'+esc(name)+'</strong><span>'+esc(line)+'</span></div>';
  }

  function totalCents(){return rows().reduce((n,r)=>n+(countOf(r)||0)*(r.band.price||0),0);}
  function noteFor(r){
    const c=countOf(r);
    if(r.bandId in shot.edits&&c!==r.qty)return {text:'Edited · read '+(r.qty===null?'?':'×'+r.qty),cls:''};
    if(r.qty===null)return {text:'Not readable. Enter it.',cls:'is-danger'};
    if(r.unknown)return {text:r.unknown+(r.unknown===1?' slot':' slots')+' not readable',cls:'is-danger'};
    if(r.unsure)return {text:'Double-check this one',cls:'is-amber'};
    if(!r.band.price)return {text:'No price set',cls:'is-amber'};
    return {text:pct(r.confidence)+' match',cls:''};
  }
  function rowHtml(r,i){
    const c=countOf(r),n=noteFor(r),edited=r.bandId in shot.edits;
    const qtyCls=c===null?'is-danger':!edited&&(r.unsure||r.unknown)?'is-amber':'';
    return '<div class="sv-row" data-sv-row="'+esc(r.bandId)+'" style="--band:'+esc(r.band.color||'#8e8d88')+';--i:'+i+'"><i></i><div class="sv-row-name"><span>'+esc(r.band.name)+'</span><small class="'+n.cls+'">'+esc(n.text)+'</small></div>'
      +'<div class="sv-step"><button type="button" data-sv-step="-1" aria-label="One fewer '+esc(r.band.name)+'"'+(c===null||c<=0?' disabled':'')+'>−</button><output class="'+qtyCls+'" data-sv-qty>'+(c===null?'?':'×'+c.toLocaleString())+'</output><button type="button" data-sv-step="1" aria-label="One more '+esc(r.band.name)+'">+</button></div>'
      +'<span class="sv-value">'+(c&&r.band.price?money(c*r.band.price):'–')+'</span></div>';
  }
  // A screenshot is added to the count once; reopening it shows that instead of a button that does nothing.
  function syncFill(){
    const fill=$('[data-sv-fill]');
    fill.textContent=shot.added?'Added to this count':'Fill in counts';
    fill.disabled=!!shot.added||!rows().some(x=>countOf(x)>0&&x.band.price);
  }
  function renderResults(animate){
    const s=scan(),status=$('[data-sv-status]'),fill=$('[data-sv-fill]');
    if(!s){
      status.className='sv-status is-busy';status.textContent=phase||'Reading the screenshot…';
      $('[data-sv-total]').textContent='···';$('[data-sv-total]').classList.add('is-reading');
      rowsEl.innerHTML=[0,1,2,3].map(i=>'<div class="sv-skel" style="--i:'+i+'"><i class="skel"></i><span class="skel"></span><span class="skel"></span></div>').join('');
      othersEl.hidden=true;fill.disabled=true;el.classList.add('is-reading');return;
    }
    el.classList.remove('is-reading');
    const list=rows(),others=s.othersAt||[];
    if(s.error){status.className='sv-status is-warn';status.textContent=s.error;}
    else{status.className='sv-status';status.textContent=list.length?'Found '+list.length+(list.length===1?' band':' bands')+(others.length?' and '+others.length+(others.length===1?' other item':' other items'):''):'No bands found in this screenshot';}
    const total=$('[data-sv-total]');total.textContent=money(totalCents());total.classList.remove('is-reading');total.classList.toggle('is-in',!!animate);
    rowsEl.innerHTML=list.length?list.map(rowHtml).join(''):'<p class="sv-empty">'+(s.error?'Try another screenshot.':'Nothing here looks like a band. Try a closer screenshot of your inventory, or tell the scanner what one of the items below is.')+'</p>';
    rowsEl.classList.toggle('is-in',!!animate);
    syncFill();
    const named=others.map((o,i)=>({o,i})).filter(({o})=>o.text);
    othersEl.hidden=!others.length;
    othersEl.innerHTML='<p class="sv-others-title">Not bands ('+others.length+')</p><p class="sv-others-hint">Left out of the count.'+(named.length?' Tap one if it is a band under another name.':'')+'</p>'
      +(named.length?'<div class="sv-chips">'+named.map(({o,i})=>'<button type="button" data-sv-other="'+i+'"'+(picked===i?' class="is-picked"':'')+'>'+esc(o.text)+'</button>').join('')+'</div><div class="sv-teach" data-sv-teach hidden></div>':'');
    bindResults();bindOthers();
  }
  function bindResults(){
    rowsEl.querySelectorAll('[data-sv-row]').forEach(bindRow);
  }
  function bindRow(row){
    const id=row.dataset.svRow;
    row.addEventListener('mouseenter',()=>setFocus({band:id}));
    row.addEventListener('focusin',()=>setFocus({band:id}));
    row.querySelectorAll('[data-sv-step]').forEach(b=>b.addEventListener('click',()=>{
      const r=rows().find(x=>x.bandId===id),c=countOf(r),up=b.dataset.svStep==='1';
      shot.edits[id]=c===null?(up?1:null):Math.max(0,c+(up?1:-1));
      const old=row.querySelector('[data-sv-qty]');
      // The entry stagger is over by the time anyone clicks; without this the new row would replay it.
      rowsEl.classList.remove('is-in');
      row.outerHTML=rowHtml(r,0);
      const fresh=rowsEl.querySelector('[data-sv-row="'+CSS.escape(id)+'"]'),qty=fresh.querySelector('[data-sv-qty]');
      if(!reduceMotion&&old){qty.classList.add(up?'is-up':'is-down');}
      fresh.classList.add('is-focus');
      $('[data-sv-total]').textContent=money(totalCents());
      syncFill();
      bindRow(fresh);fresh.querySelector('[data-sv-step="'+(up?1:-1)+'"]')?.focus({preventScroll:true});
    }));
  }
  function bindOthers(){
    const teach=othersEl.querySelector('[data-sv-teach]');
    othersEl.querySelectorAll('[data-sv-other]').forEach(b=>{
      const i=Number(b.dataset.svOther),text=scan().othersAt[i].text;
      b.addEventListener('mouseenter',()=>setFocus({other:i}));
      b.addEventListener('click',()=>{
        picked=i;othersEl.querySelectorAll('[data-sv-other]').forEach(x=>x.classList.toggle('is-picked',x===b));
        teach.hidden=false;teach.innerHTML='<label><span>“'+esc(text)+'” is</span><select><option value="">Pick a band…</option>'+bands.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label>';
        const select=teach.querySelector('select');select.focus();
        select.addEventListener('change',()=>{if(!select.value)return;picked=null;onAlias(text,select.value);});
      });
    });
  }
  // Leaving the results zooms back out.
  $('.sv-right').addEventListener('mouseleave',()=>setFocus(null));
  fit.addEventListener('click',()=>setFocus(null));
  stage.addEventListener('click',()=>setFocus(null));

  function close(after){
    if(closed)return;closed=true;
    removeEventListener('resize',size);watch.disconnect();document.removeEventListener('keydown',onKey,true);
    const done=()=>{el.remove();URL.revokeObjectURL(url);document.documentElement.classList.remove('sv-open');onClose?.();after?.();if(opener?.isConnected)opener.focus({preventScroll:true});};
    if(reduceMotion)return done();
    el.classList.add('is-closing');setTimeout(done,220);
  }
  const onKey=e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
    // Keep Tab inside the dialog.
    if(e.key==='Tab'){const f=[...el.querySelectorAll('button:not([disabled]),select,[href]')].filter(x=>x.offsetParent);if(!f.length)return;const first=f[0],last=f.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  };
  document.addEventListener('keydown',onKey,true);
  el.querySelectorAll('[data-sv-close]').forEach(b=>b.addEventListener('click',()=>close()));
  $('[data-sv-fill]').addEventListener('click',()=>{const lines=shotCounts(shot,bands);close(()=>onFill(lines));});
  $('[data-sv-again]').addEventListener('click',()=>close(onAgain));

  // The screenshot flies in from wherever it was dropped or pasted.
  img.addEventListener('load',()=>{
    size();
    if(reduceMotion||!from)return;
    // Screen rects are in zoomed pixels; the transform works inside the zoomed card, so shifts are divided back out.
    const z=Number(card.style.zoom)||1,r=layer.getBoundingClientRect();
    if(!r.width||!r.height)return;
    const s=Math.min(from.width/r.width,from.height/r.height)||.2;
    $('[data-sv-fly]').animate([{transform:'translate('+((from.left+from.width/2-(r.left+r.width/2))/z)+'px,'+((from.top+from.height/2-(r.top+r.height/2))/z)+'px) scale('+s+')',opacity:.6},{transform:'none',opacity:1}],{duration:640,easing:'cubic-bezier(.2,.9,.2,1)'});
  },{once:true});
  img.src=url;
  $('[data-sv-close].sv-close').focus({preventScroll:true});
  el.classList.add('is-reading');
  renderResults(false);drawBoxes();

  return {
    shot,
    // Reading moved on: show progress, or the results once they are in.
    update(progress){
      if(closed)return;
      if(progress!==undefined){phase=progress;if(!scan()){const st=$('[data-sv-status]');st.textContent=phase||'Reading the screenshot…';}return;}
      const ready=!!scan();
      if(ready&&!reduceMotion){el.classList.remove('is-final');void el.offsetWidth;el.classList.add('is-final');}
      if(!ready){picked=null;boxesEl.innerHTML='';setFocus(null);}
      drawBoxes();renderResults(ready&&!reduceMotion);
    },
    close
  };
}
