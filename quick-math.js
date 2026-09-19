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

export function formatNumber(n){
  if(!Number.isFinite(n))return 'Cannot divide by zero';
  const abs=Math.abs(n);
  if(abs>=1e16||(abs>0&&abs<1e-9))return n.toExponential(6).replace(/\.?0+e/,'e');
  return Number(n.toPrecision(15)).toLocaleString('en-US',{maximumFractionDigits:10});
}

const HINT='Type to calculate. Enter is equals, Esc clears.';

export function createQuickMath(){
  let entry='0',acc=null,op=null,fresh=true,trail='',error=false,lastOp=null,lastOperand=null;
  const value=()=>Number(entry.replace(/,/g,''));
  const reset=()=>{entry='0';acc=null;op=null;fresh=true;trail='';error=false;lastOp=null;lastOperand=null;};
  const setResult=n=>{if(!Number.isFinite(n)){error=true;entry='Cannot divide by zero';acc=null;op=null;fresh=true;return;}entry=formatNumber(n);fresh=true;};
  function press(key){
    if(error&&key!=='clear'){reset();}
    if(/^\d$/.test(key)){if(fresh){entry=key;fresh=false;}else if(entry.replace(/[-.,]/g,'').length<16)entry=entry==='0'?key:entry+key;if(op===null)trail='';return;}
    switch(key){
      case '.':if(fresh){entry='0.';fresh=false;}else if(!entry.includes('.'))entry+='.';return;
      case 'clear':reset();return;
      case 'back':if(fresh)return;entry=entry.length>1?entry.slice(0,-1):'0';if(entry==='-'||entry==='-0')entry='0';return;
      case 'negate':if(entry==='0')return;entry=entry.startsWith('-')?entry.slice(1):'-'+entry;return;
      case 'percent':{const base=acc??0;const n=op==='+'||op==='-'?base*value()/100:value()/100;setResult(n);fresh=true;return;}
      case '+':case '-':case '*':case '/':{
        if(op!==null&&!fresh){setResult(OPS[op](acc,value()));if(error)return;}
        acc=value();op=key;fresh=true;trail=formatNumber(acc)+' '+SYMBOL[key];lastOp=null;return;
      }
      case 'equals':{
        if(op!==null){const b=value();trail=formatNumber(acc)+' '+SYMBOL[op]+' '+formatNumber(b)+' =';lastOp=op;lastOperand=b;setResult(OPS[op](acc,b));acc=null;op=null;return;}
        if(lastOp!==null){const a=value();trail=formatNumber(a)+' '+SYMBOL[lastOp]+' '+formatNumber(lastOperand)+' =';setResult(OPS[lastOp](a,lastOperand));}
        return;
      }
    }
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
  function html(){
    return '<div class="qm" data-quick-math tabindex="0" role="group" aria-label="Quick math calculator"><div class="qm-screen" aria-live="polite"><span class="qm-trail" data-qm-trail>'+esc(trail)+'</span><output class="qm-entry'+(error?' is-error':'')+'" data-qm-entry>'+esc(entry)+'</output></div><div class="qm-keys">'+KEYS.map(([label,key,name])=>'<button type="button" data-qm-key="'+key+'" class="'+(/^\d$|^\.$/.test(key)?'qm-digit':key==='equals'?'qm-equals':'qm-fn')+'" aria-label="'+esc(name||label)+'">'+label+'</button>').join('')+'</div><div class="qm-foot"><button type="button" class="text-button" data-qm-copy>Copy result</button><small data-qm-note>'+HINT+'</small></div></div>';
  }
  function bind(container){
    const el=container.querySelector('[data-quick-math]');if(!el)return;
    const entryEl=el.querySelector('[data-qm-entry]'),trailEl=el.querySelector('[data-qm-trail]');
    const paint=()=>{entryEl.textContent=entry;entryEl.classList.toggle('is-error',error);entryEl.classList.toggle('is-long',entry.length>12);trailEl.textContent=trail;entryEl.classList.remove('is-tick');void entryEl.offsetWidth;entryEl.classList.add('is-tick');};
    el.querySelectorAll('[data-qm-key]').forEach(b=>b.addEventListener('click',()=>{press(b.dataset.qmKey);paint();el.focus({preventScroll:true});}));
    el.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;const key=keyFor(e);if(key===null)return;e.preventDefault();press(key);paint();const button=el.querySelector('[data-qm-key="'+CSS.escape(key)+'"]');if(button){button.classList.remove('is-pressed');void button.offsetWidth;button.classList.add('is-pressed');}});
    const note=el.querySelector('[data-qm-note]');let noteTimer;
    const say=text=>{note.textContent=text;clearTimeout(noteTimer);noteTimer=setTimeout(()=>{note.textContent=HINT;},2500);};
    el.querySelector('[data-qm-copy]').addEventListener('click',async()=>{if(error)return;try{await navigator.clipboard.writeText(entry.replace(/,/g,''));say('Copied '+entry+'.');}catch{say('Could not copy. Select the number and copy it by hand.');}});
    paint();
  }
  return {html,bind,press,get entry(){return entry;},get trail(){return trail;},reset};
}
