import {buildClient} from './build-client.mjs';
await buildClient('dist/pages',{standalone:true});
console.log('GitHub Pages files ready in dist/pages.');
