// Shared by the browser and api.mjs. Money is always integer cents.
export const money=value=>'$'+(value/100).toLocaleString('en-US',{maximumFractionDigits:2});
export const cents=value=>Math.round(Number(value)*100);
export const TIME_ZONE='America/Chicago';
export const dayOf=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
// Weeks run Thursday to Wednesday, the in-game payday.
export const weekStart=day=>addDays(day,-((new Date(day+'T12:00:00Z').getUTCDay()+3)%7));
export const countTotal=count=>count.lines.reduce((n,l)=>n+l.quantity*l.price,0);
export const MAX_QTY=1000000,MAX_PRICE=100000000000,MAX_TOTAL=100000000000000;
export const DEFAULT_BANDS=[['Loose change','#c2c9b5',2500],['White band','#e4e5e0',10000],['Blue band','#82aef5',150000],['Purple band','#ba98e4',250000],['Brown band','#b28b6f',600000],['Yellow band','#f2e23a',1250000]].map(([name,color,price],i)=>({id:'band-'+i,name,color,price,active:true}));
export function cleanBands(list){
  if(!Array.isArray(list)||!list.length||list.length>40)throw Error('Keep between 1 and 40 bands.');
  const ids=new Set(),names=new Set();
  return list.map(b=>{
    if(!b||typeof b.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.id)||ids.has(b.id))throw Error('Invalid band.');ids.add(b.id);
    const name=typeof b.name==='string'?b.name.trim():'';
    if(!name||name.length>40)throw Error('Every band needs a name of up to 40 characters.');
    if(names.has(name.toLowerCase()))throw Error('Two bands are both called “'+name+'”.');names.add(name.toLowerCase());
    if(typeof b.color!=='string'||!/^#[0-9a-f]{6}$/i.test(b.color))throw Error('Pick a color for '+name+'.');
    if(!Number.isSafeInteger(b.price)||b.price<0||b.price>MAX_PRICE)throw Error('Check the price for '+name+'.');
    if(typeof b.active!=='boolean')throw Error('Invalid band.');
    return {id:b.id,name,color:b.color.toLowerCase(),price:b.price,active:b.active};
  });
}
