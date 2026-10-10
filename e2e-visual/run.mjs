// usage: node run.mjs <scenario.mjs>   — scenario exports default async ({app,page,lib})
import * as lib from './lib.mjs';
const mod = await import('./' + process.argv[2]);
const opts = JSON.parse(process.argv[3] || '{}');
const { app, page } = await lib.launch(opts);
try { await mod.default({ app, page, lib, opts }); } catch (e) { console.error('SCENARIO ERROR', e); await lib.shot(page, 'error'); }
finally { await app.close(); }
