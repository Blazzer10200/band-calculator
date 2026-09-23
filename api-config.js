// The GitHub Pages build has no server: the Pages build marks index.html and the app runs as a plain calculator.
export const standalone = !!globalThis.document?.querySelector('meta[name="band-standalone"]');
// Everywhere else the API is same-origin (local dev server, or a Worker serving its own frontend).
export const apiFetch = (path,options={}) => fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:new Headers(options.headers)});
