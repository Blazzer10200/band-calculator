// Lets the calculator panels be dragged and resized in "arrange" mode, remembering where they were put.
// Horizontal position and width are fractions of the workspace width so a layout survives a different window size;
// vertical position and height are pixels. Narrow screens ignore a saved layout and keep the stacked CSS grid.
import {readUiPreference,saveUiPreference} from './ui-utils.js';

const PANELS=[
  {id:'count',selector:'.calc-count',name:'Count bands'},
  {id:'scan',selector:'.calc-scan',name:'Scan a screenshot'},
  {id:'math',selector:'.calc-math',name:'Quick math'},
  {id:'recent',selector:'.calc-recent',name:'Recent counts'}
];
const WIDE='(min-width:820px)',MIN_W=250,MIN_H=110,STEP=8,COLS=48;
const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
const snapY=n=>Math.round(n/STEP)*STEP;
const snapX=f=>Math.round(f*COLS)/COLS;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validBox=b=>!!b&&finite(b.x)&&finite(b.y)&&finite(b.w)&&finite(b.h)&&b.w>0&&b.h>0;

// One live layout at a time, so the breakpoint listener below never piles up across page mounts.
let current=null;
try{matchMedia(WIDE).addEventListener('change',()=>current?.refresh());}catch{}

export function createPanelLayout({key,onChange}){
  let state=null,arranging=false,root=null;
  const wide=()=>matchMedia(WIDE).matches;
  const workspaceOf=container=>container?.querySelector('.calc-workspace')||null;

  function load(){
    try{
      const raw=readUiPreference(key);if(!raw)return null;
      const parsed=JSON.parse(raw),out={};
      for(const p of PANELS){
        const b=parsed?.[p.id];if(!validBox(b))return null;
        out[p.id]={x:clamp(b.x,0,.95),y:Math.max(0,b.y),w:clamp(b.w,.08,1),h:Math.max(MIN_H,b.h)};
      }
      return out;
    }catch{return null;}
  }
  function save(){saveUiPreference(key,state?JSON.stringify(state):'');}

  // Start arranging from wherever the CSS grid already put the panels, so nothing jumps on the first click.
  function measure(workspace){
    if(!workspace)return null;
    const base=workspace.getBoundingClientRect(),width=base.width;
    if(!width)return null;
    const out={};
    for(const p of PANELS){
      const el=workspace.querySelector(p.selector);if(!el)return null;
      const r=el.getBoundingClientRect();
      out[p.id]={x:(r.left-base.left)/width,y:snapY(r.top-base.top),w:r.width/width,h:Math.max(MIN_H,snapY(r.height))};
    }
    return out;
  }

  function place(workspace){
    const on=!!state&&wide();
    let bottom=0;
    for(const p of PANELS){
      const el=workspace.querySelector(p.selector);if(!el)continue;
      if(!on){el.style.left=el.style.top=el.style.width=el.style.height='';continue;}
      const b=state[p.id];
      el.style.left=(b.x*100)+'%';el.style.top=b.y+'px';el.style.width=(b.w*100)+'%';el.style.height=b.h+'px';
      bottom=Math.max(bottom,b.y+b.h);
    }
    workspace.classList.toggle('is-custom',on);
    workspace.classList.toggle('is-arranging',on&&arranging);
    workspace.style.height=on?bottom+'px':'';
    return on;
  }

  function drawHandles(workspace,show){
    let layer=workspace.querySelector('[data-arrange-layer]');
    if(!show){layer?.remove();return;}
    if(!layer){layer=document.createElement('div');layer.className='calc-arrange-layer';layer.dataset.arrangeLayer='';workspace.append(layer);}
    layer.innerHTML=PANELS.map(p=>{
      const b=state[p.id];
      return '<div class="calc-arrange-box" data-panel="'+p.id+'" style="left:'+(b.x*100)+'%;top:'+b.y+'px;width:'+(b.w*100)+'%;height:'+b.h+'px">'
        +'<button type="button" class="calc-grip" data-grip="'+p.id+'" aria-label="Move '+p.name+'. Arrow keys move it, Shift and arrow keys resize it."><span aria-hidden="true">⠿</span>'+p.name+'</button>'
        +'<span class="calc-edge" data-edge="e" data-panel="'+p.id+'"></span>'
        +'<span class="calc-edge" data-edge="s" data-panel="'+p.id+'"></span>'
        +'<span class="calc-edge" data-edge="se" data-panel="'+p.id+'"></span></div>';
    }).join('');
  }

  function apply(container){
    if(container)root=container;
    const workspace=workspaceOf(root);if(!workspace)return;
    const on=place(workspace);
    drawHandles(workspace,on&&arranging);
  }

  function begin(e,workspace,id,dir){
    if(e.button!==0)return;
    e.preventDefault();
    const width=workspace.getBoundingClientRect().width||1;
    const box={...state[id]},fromX=e.clientX,fromY=e.clientY;
    const move=ev=>{
      const dx=(ev.clientX-fromX)/width,dy=ev.clientY-fromY,next={...box};
      if(dir==='move'){
        next.x=clamp(snapX(box.x+dx),0,Math.max(0,1-box.w));
        next.y=Math.max(0,snapY(box.y+dy));
      }else{
        if(dir.includes('e'))next.w=clamp(snapX(box.w+dx),MIN_W/width,Math.max(MIN_W/width,1-box.x));
        if(dir.includes('s'))next.h=Math.max(MIN_H,snapY(box.h+dy));
      }
      state[id]=next;apply();
    };
    const end=()=>{
      document.removeEventListener('pointermove',move);
      document.removeEventListener('pointerup',end);
      document.removeEventListener('pointercancel',end);
      save();
    };
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',end);
    document.addEventListener('pointercancel',end);
  }

  function byKey(e,workspace,id){
    const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const d=dirs[e.key];if(!d)return;
    e.preventDefault();
    const width=workspace.getBoundingClientRect().width||1,box={...state[id]};
    if(e.shiftKey){
      if(d[0])box.w=clamp(box.w+d[0]*(STEP/width),MIN_W/width,Math.max(MIN_W/width,1-box.x));
      if(d[1])box.h=Math.max(MIN_H,box.h+d[1]*STEP);
    }else{
      if(d[0])box.x=clamp(box.x+d[0]*(STEP/width),0,Math.max(0,1-box.w));
      if(d[1])box.y=Math.max(0,box.y+d[1]*STEP);
    }
    state[id]=box;apply();save();
    workspace.querySelector('[data-grip="'+id+'"]')?.focus();
  }

  function bind(container){
    root=container;
    const workspace=workspaceOf(container);if(!workspace)return;
    workspace.addEventListener('pointerdown',e=>{
      if(!arranging||!state)return;
      const grip=e.target.closest('[data-grip]'),edge=e.target.closest('[data-edge]');
      if(grip)begin(e,workspace,grip.dataset.grip,'move');
      else if(edge)begin(e,workspace,edge.dataset.panel,edge.dataset.edge);
    });
    workspace.addEventListener('keydown',e=>{
      if(!arranging||!state)return;
      const grip=e.target.closest('[data-grip]');
      if(grip)byKey(e,workspace,grip.dataset.grip);
    });
  }

  state=load();
  const instance={
    apply,bind,
    // The arrange controls are hidden on a narrow window, so leaving the mode on would freeze refreshes with no way out.
    refresh(){if(arranging&&!wide()){arranging=false;save();}apply();onChange?.();},
    arranging:()=>arranging,
    customised:()=>!!state,
    setArranging(next){
      const workspace=workspaceOf(root);
      if(next&&!state)state=measure(workspace);
      arranging=next&&!!state;
      if(!arranging)save();
      apply();
      onChange?.();
    },
    reset(){
      state=null;arranging=false;save();
      const workspace=workspaceOf(root);
      if(workspace){workspace.querySelector('[data-arrange-layer]')?.remove();place(workspace);}
      onChange?.();
    }
  };
  current=instance;
  return instance;
}
