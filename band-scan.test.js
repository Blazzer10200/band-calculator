import test from 'node:test';
import assert from 'node:assert/strict';
// The vendored OCR engine looks for a worker global the moment it loads; nothing below ever runs it.
globalThis.self??=globalThis;
const {parseRow,resolveCount,inferUnits,commonUnit,usualUnit,matchBand,normalizeName,lattice,gridCells,cellAt,findBars,slotBoxes,stripeColor,stripeBand,findBadge,badgeNumber}=await import('./band-scan.js');

const BANDS=[
  {id:'band-1',name:'White band',price:10000,active:true},
  {id:'band-3',name:'Purple band',price:250000,active:true},
  {id:'band-6',name:'Violet band',price:2000000,active:true}
];

test('a count is only ever what follows the x, so a stray number is not a quantity',()=>{
  assert.deepEqual(parseRow({left:'x5',right:'500 g'}),{n:5,grams:500,bare:false,guess:null});
  // Hotbar slots print their key number to the left of the count.
  assert.equal(parseRow({left:'3 x5',right:'500 g'}).n,5);
  // A bare number is the hotbar key or the wreckage of a crop that slipped. Reading one as a quantity
  // once turned a stack of ten into a hundred.
  assert.equal(parseRow({left:'an 100',right:''}).n,null);
});

test('look-alike letters are read back as the digits they are',()=>{
  assert.equal(parseRow({left:'xS',right:'S00 g'}).n,5);
  assert.equal(parseRow({left:'x1O',right:'1,00 kg'}).grams,1000);
  assert.equal(parseRow({left:'xB',right:'800 g'}).n,8);
});

test('a kilogram weight with its decimal point lost is thrown away, not believed',()=>{
  // The panel always prints kg with two decimals and grams whole, so "100k" is a mangled "1.00 kg".
  assert.equal(parseRow({left:'',right:'100k'}).grams,null);
  assert.equal(parseRow({left:'',right:'1.00 kg'}).grams,1000);
  assert.equal(parseRow({left:'',right:'13.50 kg'}).grams,13500);
});

test('an empty count corner beside a weight is itself the answer',()=>{
  const row=parseRow({left:'   ',right:'200 g'});
  assert.equal(row.bare,true);
  assert.deepEqual(resolveCount(row,200),{qty:1,sure:true});
});

test('count and weight check each other, and the weight wins a disagreement',()=>{
  assert.deepEqual(resolveCount({n:5,grams:500,bare:false},100),{qty:5,sure:true});
  // The weight is the bigger, cleaner text; a misread count is flagged rather than trusted.
  assert.deepEqual(resolveCount({n:1,grams:500,bare:false},100),{qty:5,sure:false});
  assert.deepEqual(resolveCount({n:7,grams:null,bare:false},100),{qty:7,sure:true});
});

test('a slot nobody can stand behind comes back blank instead of guessed',()=>{
  assert.equal(resolveCount({n:null,grams:null,bare:false},100).qty,null);
  assert.equal(resolveCount({n:99999,grams:null,bare:false},100).qty,null);
  assert.equal(resolveCount({n:null,grams:250,bare:false},null).qty,1);
});

test('the grams per band are learned from whatever the screenshot showed',()=>{
  const rows=[
    {bandId:'band-3',n:5,grams:500,bare:false},
    {bandId:'band-3',n:3,grams:300,bare:false},
    {bandId:'band-6',n:null,grams:200,bare:true}
  ];
  assert.deepEqual(inferUnits(rows),{'band-3':100,'band-6':200});
  // A counted stack outranks a lone item of the same band.
  assert.equal(inferUnits([{bandId:'band-1',n:null,grams:500,bare:true},{bandId:'band-1',n:10,grams:1000,bare:false}])['band-1'],100);
  // A misread count gives an odd ratio, which is no evidence at all.
  assert.deepEqual(inferUnits([{bandId:'band-1',n:3,grams:500,bare:false}]),{});
  assert.equal(inferUnits([],{'band-1':100})['band-1'],100);
});

test('a band that never showed a count falls back to what the rest of the screenshot weighs',()=>{
  assert.equal(commonUnit([{n:10,grams:1000,bare:false},{n:5,grams:500,bare:false}]),100);
  assert.equal(commonUnit([{n:null,grams:null,bare:false}]),null);
  // Borrowed from other bands, the weight suggests a number but does not vouch for it.
  assert.deepEqual(resolveCount({n:null,grams:300,bare:false},100,true),{qty:3,sure:false});
});

test('loose change weighs half a band and a violet stack double, whatever the rest of the shot weighs',()=>{
  assert.equal(usualUnit('Loose change'),50);
  assert.equal(usualUnit('Violet band'),200);
  assert.equal(usualUnit('White band'),null);
  // "x2  100 g" of loose change with the x lost: 100 g is two coins' worth, not one band's.
  assert.deepEqual(resolveCount(parseRow({left:'2',right:'100g'}),usualUnit('Loose change')),{qty:2,sure:true});
  assert.deepEqual(resolveCount(parseRow({left:'x24',right:'1.20 kg'}),usualUnit('Loose change')),{qty:24,sure:true});
});

test('a big stack keeps its thousands separator out of the count',()=>{
  assert.equal(parseRow({left:'x1,250',right:''}).n,1250);
  assert.equal(parseRow({left:'x1.250',right:''}).n,1250);
  assert.equal(parseRow({left:'x24',right:''}).n,24);
});

test('band names match the game wording, not the settings wording',()=>{
  assert.equal(matchBand('Purple Stack',BANDS).id,'band-3');
  assert.equal(matchBand('Purpie Stack',BANDS).id,'band-3');// one wrong letter
  assert.equal(matchBand('Lockpick',BANDS),null);
  assert.equal(matchBand('Backpack',BANDS,{backpack:'band-1'}).id,'band-1');
  assert.deepEqual(normalizeName('  Violet   Stack! '),['violet','stack']);
});

test('the slots that were read pin down the grid, including a row nothing was read from',()=>{
  const unit=20,names=[];
  for(const y of [100,200,300])for(const x of [50,250,450])if(!(y===200&&x===250))names.push({x0:x,y0:y});
  const grid=lattice(names,unit);
  assert.equal(grid.cols.length,3);assert.equal(grid.rows.length,3);
  assert.equal(grid.colPitch,200);assert.equal(grid.rowPitch,100);
  const cells=gridCells(grid,names);
  assert.equal(cells.length,9);
  // The cell the sweep lost still gets a place, and the ones it saw keep the position it measured.
  assert.ok(cells.some(c=>c.x0===250&&c.y0===200));
  assert.equal(cellAt(grid,names,{x0:250,y0:200}),undefined);
  assert.deepEqual(cellAt(grid,names,{x0:50,y0:100}),{x0:50,y0:100});
});

test('a row whose names drift in perspective stays one row, not two',()=>{
  // Real geometry off a cropped grab: within a row the names sit a few pixels apart because the panel
  // is drawn in perspective. Read as two rows, every slot on them was counted twice - 44 bands came
  // back as 84. Rows here are ~250 apart, so 355 and 384 cannot be two of them.
  const unit=31,names=[
    {x0:100,y0:355},{x0:400,y0:384},
    {x0:100,y0:620},{x0:400,y0:650},
    {x0:400,y0:880}
  ];
  const grid=lattice(names,unit);
  assert.equal(grid.rows.length,3);
  assert.equal(grid.cols.length,2);
  assert.equal(gridCells(grid,names).length,6);
});

test('two grid lines that land on the same names give one cell, not two',()=>{
  // Even if a line too many survives, a position only ever gets one cell: a slot read twice is added
  // up twice, and a doubled total is worse than a missing one because nothing on screen looks wrong.
  const grid={rows:[100,108],cols:[50,250],rowPitch:100,colPitch:200};
  const names=[{x0:50,y0:100},{x0:250,y0:100}];
  const cells=gridCells(grid,names);
  assert.equal(cells.length,2);
  assert.equal(new Set(cells.map(c=>c.x0+','+c.y0)).size,2);
});

test('an unusual layout is left alone rather than forced onto a grid',()=>{
  assert.equal(lattice([{x0:0,y0:0},{x0:10,y0:0},{x0:0,y0:10}],20),null);// too few names
  assert.equal(lattice([{x0:0,y0:0},{x0:5,y0:0},{x0:0,y0:5},{x0:5,y0:5}],20),null);// slots too close together
});

test('a count whose x went missing is offered as a guess, and a weight of 0 g is no weight',()=>{
  const row=parseRow({left:'2',right:'eoog'});
  assert.equal(row.grams,null);assert.equal(row.guess,2);
  assert.deepEqual(resolveCount(row,100),{qty:2,sure:false});
  // The weight still settles it when it can be read, and a lone "1" is never a stack.
  assert.deepEqual(resolveCount(parseRow({left:'2',right:'200 g'}),100),{qty:2,sure:true});
  assert.equal(resolveCount(parseRow({left:'1',right:''}),100).qty,null);
});

// A tiny inventory in raw pixels: two slots on a dark panel, each closed off by a coloured bar, with
// grey-green bills in the middle wrapped in a paper band, and the storage weight meter above them.
function inventory(){
  const W=260,H=130,data=new Uint8ClampedArray(W*H*4);
  const fill=(x0,y0,x1,y1,[r,g,b])=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*W+x)*4;data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=255;}};
  fill(0,0,W,H,[20,20,20]);
  fill(10,8,85,10,[178,241,101]);// the weight meter: a bar, but a quarter shorter than a slot's
  for(const [x,paper] of [[10,[122,97,71]],[130,[145,67,114]]]){// brown, violet
    fill(x,110,x+100,113,[124,216,255]);
    fill(x+20,35,x+80,95,[170,182,160]);// the bills
    fill(x+45,35,x+58,95,paper);// the paper band round them
  }
  // A boxed "5" in the violet slot's corner, as a few bright pixels.
  fill(215,16,220,17,[235,235,235]);fill(215,17,216,20,[235,235,235]);fill(215,20,220,21,[235,235,235]);fill(219,21,220,23,[235,235,235]);fill(215,23,220,24,[235,235,235]);
  return {width:W,height:H,data};
}

test('filled slots are found by the bar under them, and the weight meter is not one',()=>{
  const bars=findBars(inventory());
  assert.equal(bars.length,2);
  const boxes=slotBoxes(bars);
  assert.deepEqual(boxes.map(b=>[b.x,b.w]),[[8,104],[128,104]]);
  assert.ok(boxes.every(b=>b.y>=0&&b.y<20&&b.y+b.h>=112),'each box runs from the top of the slot down past its bar');
});

test('a slot is told apart by its paper band, and counted by the box in its corner',()=>{
  const image=inventory(),boxes=slotBoxes(findBars(image));
  const bands=[{id:'w',name:'White band'},{id:'br',name:'Brown band'},{id:'p',name:'Purple band'},{id:'v',name:'Violet band'},{id:'lc',name:'Loose change'}];
  const colours=boxes.map(b=>stripeColor(image,b));
  assert.ok(colours.every(c=>c.paper>.3),'bills everywhere');
  assert.deepEqual(colours.map(c=>stripeBand(c,bands)?.id),['br','v']);
  // White paper has no hue; loose change has no band at all. Something with no bills is not money.
  assert.equal(stripeBand({hue:null,share:0,white:.03,paper:.15},bands).id,'w');
  assert.equal(stripeBand({hue:null,share:0,white:0,paper:.15},bands).id,'lc');
  assert.equal(stripeBand({hue:30,sat:.42,share:.05,white:0,paper:0},bands),null);
  assert.equal(stripeBand({hue:120,sat:.8,share:.2,white:0,paper:.15},bands),null);// a green band nobody has
  assert.equal(findBadge(image,boxes[0]),null);// no box: one item
  assert.deepEqual(findBadge(image,boxes[1]),{x0:215,y0:16,x1:220,y1:24});
});

test('a badge holds only digits, and a lone 1 is a digit lost, not a count',()=>{
  assert.equal(badgeNumber('10'),10);
  assert.equal(badgeNumber('§'),5);
  assert.equal(badgeNumber('1O'),10);
  assert.equal(badgeNumber('1'),null);
  assert.equal(badgeNumber(''),null);
});
