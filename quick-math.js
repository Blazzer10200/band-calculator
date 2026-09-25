// Quick math: a small standard calculator (Windows-style immediate execution, no operator precedence).
// State lives in the instance so the page can re-render around it without losing the current sum.
import {escapeHtml as esc} from './ui-utils.js';

const OPS={'+':(a,b)=>a+b,'-':(a,b)=>a-b,'*':(a,b)=>a*b,'/':(a,b)=>a/b};
const SYMBOL={'+':'+','-':'−','*':'×','/':'÷'};
const KEYS=[
  ['C','clear','Clear'],['⌫','back','Backspace'],['%','percent','Percent'],['÷','/','Divide'],
  ['7','7'],['8','8'],['9','9'],['×','*','Multiply'],
  ['4','4'],['5','5'],['6','6'],['−','-','Subtract'],
  ['1','1'],['2','2'],['3','3'],['+','+','Add'],
  ['±','negate','Change sign'],['0','0'],['.','.','Decimal point'],['=','equals','Equals']
];
const keyClass=key=>/^\d$|^\.$/.test(key)?'qm-digit':OPS[key]?'qm-op':key==='equals'?'qm-equals':key==='clear'?'qm-clear':'qm-fn';

export function formatNumber(n){
  if(!Number.isFinite(n))return 'Cannot divide by zero';
  const abs=Math.abs(n);
  if(abs>=1e16||(abs>0&&abs<1e-9))return n.toExponential(6).replace(/\.?0+e/,'e');
  return Number(n.toPrecision(15)).toLocaleString('en-US',{maximumFractionDigits:10});
}

const HINT='Type to calculate. Enter is equals, Esc clears.';

export function createQuickMath(){
  // loaded: the entry came from a chip or the tape. It counts as typed, but the next digit starts a new number.
  let entry='0',acc=null,op=null,fresh=true,loaded=false,trail='',error=false,lastOp=null,lastOperand=null,tape=[],tapeFresh=false;
  const value=()=>Number(entry.replace(/,/g,''));
  const reset=()=>{entry='0';acc=null;op=null;fresh=true;loaded=false;trail='';error=false;lastOp=null;lastOperand=null;};
  const setResult=n=>{loaded=false;if(!Number.isFinite(n)){error=true;entry='Cannot divide by zero';acc=null;op=null;fresh=true;return;}entry=formatNumber(n);fresh=true;};
  const record=expr=>{if(error)return;tape=[{expr,result:entry},...tape].slice(0,3);tapeFresh=true;};
  function press(key){
    if(error&&key!=='clear'){reset();}
    if(/^\d$/.test(key)){if(fresh||loaded){entry=key;fresh=loaded=false;}else if(entry.replace(/[-.,]/g,'').length<16)entry=entry==='0'?key:entry+key;if(op===null)trail='';return;}
    switch(key){
      case '.':if(fresh||loaded){entry='0.';fresh=loaded=false;}else if(!entry.includes('.'))entry+='.';return;
      case 'clear':reset();return;
      case 'back':if(fresh)return;loaded=false;entry=entry.length>1?entry.slice(0,-1):'0';if(entry==='-'||entry==='-0')entry='0';return;
      case 'negate':if(entry==='0')return;entry=entry.startsWith('-')?entry.slice(1):'-'+entry;return;
      case 'percent':{const base=acc??0;const n=op==='+'||op==='-'?base*value()/100:value()/100;setResult(n);fresh=true;return;}
      case '+':case '-':case '*':case '/':{
        if(op!==null&&!fresh){setResult(OPS[op](acc,value()));if(error)return;}
        acc=value();op=key;fresh=true;loaded=false;trail=formatNumber(acc)+' '+SYMBOL[key];lastOp=null;return;
      }
      case 'equals':{
        if(op!==null){const b=value(),expr=formatNumber(acc)+' '+SYMBOL[op]+' '+formatNumber(b);trail=expr+' =';lastOp=op;lastOperand=b;setResult(OPS[op](acc,b));acc=null;op=null;record(expr);return;}
        if(lastOp!==null){const a=value(),expr=formatNumber(a)+' '+SYMBOL[lastOp]+' '+formatNumber(lastOperand);trail=expr+' =';setResult(OPS[lastOp](a,lastOperand));record(expr);}
        return;
      }
    }
  }
  // A chip or a tape row drops its number in as the current entry.
  function use(n){
    if(error)reset();
    if(!Number.isFinite(n))return;
    entry=formatNumber(n);fresh=false;loaded=true;if(op===null)trail='';
  }
  const keyFor=e=>{
    if(/^\d$/.test(e.key))return e.key;
    if(e.key==='.'||e.key===',')return '.';
    if(['+','-','*','/'].includes(e.key))return e.key;
    if(e.key==='Enter'||e.key==='=')return 'equals';
    if(e.key==='Backspace')return 'back';
    if(e.key==='Escape'||e.key==='Delete')return 'clear';
    if(e.key==='%')return 'percent';
    if(e.key==='F9')return 'negate';
    return null;
  };
  const tapeHtml=()=>tape.length?tape.map((t,i)=>'<button type="button" class="qm-tape-row'+(i===0&&tapeFresh?' is-new':'')+'" data-qm-tape="'+i+'" aria-label="Use '+esc(t.result)+'"><span>'+esc(t.expr)+'</span><span>'+esc(t.result)+'</span></button>').join(''):'<span class="qm-tape-empty">Results land here. Tap one to reuse it.</span>';
  const chipsHtml=chips=>chips.map(c=>'<button type="button" class="qm-chip" data-qm-chip="'+esc(c.value)+'" style="--band:'+esc(c.color)+'"><i></i>'+esc(c.label)+'</button>').join('');
  function html(chips=[]){
    return '<div class="qm" data-quick-math tabindex="0" role="group" aria-label="Quick math calculator"><div class="qm-screen"><div class="qm-tape" data-qm-tapes>'+tapeHtml()+'</div><div class="qm-readout"><span class="qm-pending" data-qm-pending aria-hidden="true"></span><div class="qm-display" aria-live="polite"><span class="qm-trail" data-qm-trail>'+esc(trail)+'</span><output class="qm-entry'+(error?' is-error':'')+'" data-qm-entry>'+esc(entry)+'</output></div></div></div><div class="qm-chips" data-qm-chips>'+chipsHtml(chips)+'</div><div class="qm-keys">'+KEYS.map(([label,key,name])=>'<button type="button" data-qm-key="'+key+'" class="'+keyClass(key)+'" aria-label="'+esc(name||label)+'">'+label+'</button>').join('')+'</div><div class="qm-foot"><button type="button" class="text-button" data-qm-copy>Copy result</button><small data-qm-note>'+HINT+'</small></div></div>';
  }
  // Chips follow the count being made, so the page redraws them without touching the rest of the calculator.
  function setChips(container,chips){const row=container?.querySelector('[data-qm-chips]');if(row)row.innerHTML=chipsHtml(chips);}
  function bind(container){
    const el=container.querySelector('[data-quick-math]');if(!el)return;
    const entryEl=el.querySelector('[data-qm-entry]'),trailEl=el.querySelector('[data-qm-trail]'),tapeEl=el.querySelector('[data-qm-tapes]'),pendingEl=el.querySelector('[data-qm-pending]');
    const flash=button=>{if(!button)return;button.classList.remove('is-pressed');void button.offsetWidth;button.classList.add('is-pressed');};
    const paint=()=>{
      entryEl.textContent=entry;entryEl.classList.toggle('is-error',error);
      entryEl.classList.toggle('is-long',!error&&entry.length>10&&entry.length<=14);entryEl.classList.toggle('is-xlong',!error&&entry.length>14);
      trailEl.textContent=trail;
      pendingEl.textContent=op?SYMBOL[op]:'';pendingEl.classList.toggle('is-on',!!op);
      el.querySelectorAll('.qm-op').forEach(b=>b.classList.toggle('is-pending',b.dataset.qmKey===op));
      tapeEl.innerHTML=tapeHtml();tapeFresh=false;
      entryEl.classList.remove('is-tick');void entryEl.offsetWidth;entryEl.classList.add('is-tick');
    };
    el.querySelectorAll('[data-qm-key]').forEach(b=>b.addEventListener('click',()=>{press(b.dataset.qmKey);paint();flash(b);el.focus({preventScroll:true});}));
    el.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;const key=keyFor(e);if(key===null)return;e.preventDefault();press(key);paint();flash(el.querySelector('[data-qm-key="'+CSS.escape(key)+'"]'));});
    el.querySelector('[data-qm-chips]').addEventListener('click',e=>{const chip=e.target.closest('[data-qm-chip]');if(!chip)return;use(Number(chip.dataset.qmChip));paint();el.focus({preventScroll:true});});
    tapeEl.addEventListener('click',e=>{const row=e.target.closest('[data-qm-tape]');const t=row&&tape[Number(row.dataset.qmTape)];if(!t)return;use(Number(t.result.replace(/,/g,'')));paint();el.focus({preventScroll:true});});
    const note=el.querySelector('[data-qm-note]');let noteTimer;
    const say=text=>{note.textContent=text;clearTimeout(noteTimer);noteTimer=setTimeout(()=>{note.textContent=HINT;},2500);};
    el.querySelector('[data-qm-copy]').addEventListener('click',async()=>{if(error)return;try{await navigator.clipboard.writeText(entry.replace(/,/g,''));say('Copied '+entry+'.');}catch{say('Could not copy. Select the number and copy it by hand.');}});
    paint();
  }
  return {html,bind,setChips,press,use,get entry(){return entry;},get trail(){return trail;},get tape(){return tape;},reset};
}
