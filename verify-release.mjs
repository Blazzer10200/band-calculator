import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.argv[2]||'dist/pages',base=process.argv[3],manifest=JSON.parse(await readFile(directory+'/release.json','utf8')),assets=new Set(manifest.assets);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.match(manifest.version,/^[0-9a-f]{12}$/);
for(const file of await readdir(directory))assert.ok(assets.has(file)||file==='release.json'||file==='.nojekyll',file+' is in the build folder but not in this release');
for(const file of assets){assert.ok(!file.includes('/')&&!file.includes('..'),'Only browser assets may be published');const bytes=await readFile(directory+'/'+file);if(/\.(js|css|html)$/.test(file)){const text=bytes.toString();for(const match of text.matchAll(/["']\.\/([^"']+\.(?:js|css))["']/g))assert.ok(assets.has(match[1]),file+' references an unpublished dependency');if(file==='index.html')assert.ok(text.includes('content="'+manifest.version+'"'),'HTML release marker matches');}
 if(base){const r=await fetch(new URL(file+'?release='+manifest.version,base),{cache:'no-store'});assert.equal(r.status,200,file+' HTTP status');assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(bytes),file+' differs from the validated build');}}
if(base){const r=await fetch(new URL('release.json?release='+manifest.version,base),{cache:'no-store'});assert.equal(r.status,200);assert.equal((await r.json()).version,manifest.version);}
console.log((base?'Published':'Built')+' browser release '+manifest.version+': '+assets.size+' assets and all module dependencies verified.');
