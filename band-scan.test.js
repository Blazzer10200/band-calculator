import test from 'node:test';
import assert from 'node:assert/strict';
// The vendored OCR engine looks for a worker global the moment it loads; nothing below ever runs it.
globalThis.self??=globalThis;
const {parseRow,resolveCount,inferUnits,commonUnit,matchBand,normalizeName,lattice,gridCells,cellAt}=await import('./band-scan.js');

const BANDS=[
  {id:'band-1',name:'White band',price:10000,active:true},
  {id:'band-3',name:'Purple band',price:250000,active:true},
  {id:'band-6',name:'Violet band',price:2000000,active:true}
];

test('a count is only ever what follows the x, so a stray number is not a quantity',()=>{
  assert.deepEqual(parseRow({left:'x5',right:'500 g'}),{n:5,grams:500,bare:false});
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

test('an unusual layout is left alone rather than forced onto a grid',()=>{
  assert.equal(lattice([{x0:0,y0:0},{x0:10,y0:0},{x0:0,y0:10}],20),null);// too few names
  assert.equal(lattice([{x0:0,y0:0},{x0:5,y0:0},{x0:0,y0:5},{x0:5,y0:5}],20),null);// slots too close together
});
