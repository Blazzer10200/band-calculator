import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {clientFiles} from './client-files.mjs';
// Every import gets the same content-derived release fingerprint, including cycles.
export async function buildClient(directory,{standalone=false}={}){
  await mkdir(directory,{recursive:true});
  const contents=new Map(await Promise.all(clientFiles.map(async f=>{const bytes=await readFile(f);return [f,/\.(js|css|html)$/.test(f)?Buffer.from(bytes.toString().replace(/\r\n/g,'\n')):bytes];})));
  const hash=createHash('sha256');for(const [f,bytes]of contents)hash.update(f).update(bytes);
  const version=hash.digest('hex').slice(0,12),mapping=Object.fromEntries(clientFiles.map(f=>[f,/\.(js|css)$/.test(f)?f.replace(/\.([^.]+)$/,'.'+version+'.$1'):f]));
  for(const [file,bytes]of contents){let content=bytes;
    if(/\.(js|css|html)$/.test(file)){content=bytes.toString();for(const [source,target]of Object.entries(mapping))if(source!==target)content=content.replaceAll('./'+source,'./'+target);
      if(file==='index.html')content=content.replace('<head>','<head>\n  <meta name="pto-release" content="'+version+'">'+(standalone?'\n  <meta name="band-standalone" content="1">':''));
    }await writeFile(directory+'/'+mapping[file],content);
  }
  await writeFile(directory+'/release.json',JSON.stringify({version,assets:Object.values(mapping),builtAt:new Date().toISOString()}));
  await writeFile(directory+'/.nojekyll','');
  return {version,assets:[...Object.values(mapping),'release.json','.nojekyll']};
}
