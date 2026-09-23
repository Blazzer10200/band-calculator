// Copies accounts and counts out of a local database (read-only) for the Worker's one-time BAND_SEED secret.
// Usage: node scripts/export-accounts.mjs [.local/pto-dev.sqlite] > .local/cloudflare-seed.json
// The output holds password hashes: keep it in .local/, never commit or print it.
import {DatabaseSync} from 'node:sqlite';
import {exportAccounts} from '../api.mjs';

const db=new DatabaseSync(process.argv[2]||'.local/pto-dev.sqlite',{readOnly:true});
const document=exportAccounts(db);db.close();
process.stdout.write(JSON.stringify(document));
console.error('Exported '+Object.entries(document.tables).map(([name,rows])=>rows.length+' '+name).join(', ')+'.');
