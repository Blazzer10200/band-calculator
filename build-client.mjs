import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {clientFiles} from './client-files.mjs';
// Every import gets the same content-derived release fingerprint, including cycles.
// apiOrigin: accounts server on another origin; allowed in the CSP and announced to api-config.js. standalone: no server at all.
export async function buildClient(directory,{standalone=false,apiOrigin=''}={}){
  if(apiOrigin&&!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(apiOrigin))throw Error('apiOrigin must be a bare origin like https://example.workers.dev');
  // Start empty so the output is exactly one release, the same as a fresh CI checkout.
  await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
  const contents=new Map(await Promise.all(clientFiles.map(async f=>{const bytes=await readFile(f);return [f,/\.(js|css|html)$/.test(f)?Buffer.from(bytes.toString().replace(/\r\n/g,'\n')):bytes];})));
  const hash=createHash('sha256');for(const [f,bytes]of contents)hash.update(f).update(bytes);
  const version=hash.digest('hex').slice(0,12),mapping=Object.fromEntries(clientFiles.map(f=>[f,/\.(js|css)$/.test(f)?f.replace(/\.([^.]+)$/,'.'+version+'.$1'):f]));
  for(const [file,bytes]of contents){let content=bytes;
    if(/\.(js|css|html)$/.test(file)){content=bytes.toString();for(const [source,target]of Object.entries(mapping))if(source!==target)content=content.replaceAll('./'+source,'./'+target);
      if(file==='index.html'){
        content=content.replace('<head>','<head>\n  <meta name="pto-release" content="'+version+'">'+(standalone?'\n  <meta name="band-standalone" content="1">':'')+(apiOrigin?'\n  <meta name="band-api" content="'+apiOrigin+'">':''));
        if(apiOrigin){const csp=content.replace("connect-src 'self'","connect-src 'self' "+apiOrigin);if(csp===content)throw Error('index.html CSP has no connect-src to extend.');content=csp;}
      }
    }await writeFile(directory+'/'+mapping[file],content);
  }
  await writeFile(directory+'/release.json',JSON.stringify({version,assets:Object.values(mapping),builtAt:new Date().toISOString()}));
  await writeFile(directory+'/.nojekyll','');
  return {version,assets:[...Object.values(mapping),'release.json','.nojekyll']};
}
