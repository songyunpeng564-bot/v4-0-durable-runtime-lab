// Test-only one-process fsynced receiver. Attempts and effects are distinct ledgers.
import { createServer } from 'node:http';
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const PORT = 9187;
const ATTEMPTS = join(process.cwd(), 'synthetic-attempts.jsonl');
const EFFECTS = join(process.cwd(), 'synthetic-effects.jsonl');
const allowed = new Set(['dbos','restate']);
const modes = new Set(['dedup','unknown']);
const id = /^v4_(dbos|restate)_(dedup|unknown)_crash_01$/;
function read(path) { return existsSync(path) ? readFileSync(path,'utf8').split('\n').filter(Boolean).map(JSON.parse) : []; }
const attempts = read(ATTEMPTS), effects = read(EFFECTS);
function append(path, value) {
  const fd=openSync(path,'a',0o600);
  try { writeSync(fd,JSON.stringify(value)+'\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
}
const server = createServer((req,res)=>{
  if(req.method==='GET' && req.url==='/evidence') {
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({attempts,effects})); return;
  }
  if(req.method!=='POST' || req.url!=='/effect') { res.writeHead(404);res.end();return; }
  let size=0, raw='';
  req.on('data',chunk=>{size+=chunk.length;if(size>2048){req.destroy();return;}raw+=chunk;});
  req.on('end',()=>{
    let v;
    try { v=JSON.parse(raw); }catch{res.writeHead(400);res.end();return;}
    if(Object.keys(v).sort().join(',')!=='framework,mode,operationId' ||
       !allowed.has(v.framework) || !modes.has(v.mode) || !id.test(v.operationId) ||
       v.operationId!==`v4_${v.framework}_${v.mode}_crash_01`) {
      res.writeHead(400);res.end();return;
    }
    const attempt={sequence:attempts.length+1,...v};
    append(ATTEMPTS,attempt);attempts.push(attempt);
    const duplicate=v.mode==='dedup' && effects.some(e=>e.operationId===v.operationId);
    if(!duplicate){
      const effect={sequence:effects.length+1,...v,effect:'SYNTHETIC_COMMITTED'};
      append(EFFECTS,effect);effects.push(effect);
    }
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({status:'ACK_CONFIRMED',operationId:v.operationId,duplicate}));
  });
});
server.listen(PORT,'127.0.0.1',()=>console.log('MITIGATION_RECEIVER_READY=PASS'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
