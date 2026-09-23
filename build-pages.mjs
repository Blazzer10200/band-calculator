import {buildClient} from './build-client.mjs';
// Accounts server for the live site (cloudflare-worker.mjs). BAND_API overrides it for a local preview build.
// BAND_API= (empty) builds the calculator-only version.
const API_ORIGIN=process.env.BAND_API??'https://band-calculator.blazzer.workers.dev';
await buildClient('dist/pages',API_ORIGIN?{apiOrigin:API_ORIGIN}:{standalone:true});
console.log('GitHub Pages files ready in dist/pages'+(API_ORIGIN?' (accounts: '+API_ORIGIN+').':' (calculator only).'));
