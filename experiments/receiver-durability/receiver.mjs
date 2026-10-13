// Synthetic-only HTTP receiver; no business API or externally routed listener.
// Independent receiver processes share a real PostgreSQL transaction + UNIQUE key.
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import pg from 'pg';
import { validRequest,contentHash,isolatedRunner,SPEC } from './contract.mjs';

if (!isolatedRunner()) throw Error('REFUSE_NON_DISPOSABLE_ENVIRONMENT');
if (!realpathSync(process.cwd()).startsWith(realpathSync(process.env.RUNNER_TEMP)+sep)) throw Error('REFUSE_NON_TEMP_WORKDIR');
const port=Number(process.env.V4_RECEIVER_PORT);
const owner=process.env.V4_RECEIVER_NAME;
if (![9191,9192].includes(port) || !['a','b'].includes(owner)) throw Error('REFUSE_INVALID_OWNED_RECEIVER');
const pool=new pg.Pool({connectionString:process.env.PGURL,max:12,connectionTimeoutMillis:3000});
async function transact(v){
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const sha=contentHash(v.stage);
    const insert=await client.query(
      'INSERT INTO v4_test_effects(operation_id,stage,payload_sha) VALUES ($1,$2,$3) ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id',
      [v.operationId,v.stage,sha]);
    let verdict;
    if (insert.rowCount === 1) verdict='committed';
    else {
      const seen=await client.query('SELECT stage,payload_sha FROM v4_test_effects WHERE operation_id=$1',[v.operationId]);
      if(seen.rowCount!==1) throw Error('CONFLICT_ROW_UNREADABLE');
      verdict=seen.rows[0].stage===v.stage && seen.rows[0].payload_sha===sha ? 'duplicate' : 'key_conflict';
    }
    await client.query('INSERT INTO v4_test_attempts(operation_id,stage,receiver_name,verdict) VALUES($1,$2,$3,$4)',
      [v.operationId,v.stage,owner,verdict]);
    await client.query('COMMIT');
    return verdict;
  } catch(err){try{await client.query('ROLLBACK');}catch{} throw err;}
  finally{client.release();}
}
async function ledger(){
  const [attempts,effects]=await Promise.all([
    pool.query('SELECT operation_id,stage,receiver_name,verdict FROM v4_test_attempts ORDER BY attempt_id'),
    pool.query('SELECT operation_id,stage,payload_sha FROM v4_test_effects ORDER BY operation_id'),
  ]);
  return {attempts:attempts.rows,effects:effects.rows};
}
const server=createServer((req,res)=>{
  if(req.method==='GET' && req.url==='/health'){res.writeHead(200);res.end('SYNTHETIC_OK');return;}
  if(req.method==='GET' && req.url==='/evidence'){
    ledger().then(data=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));})
      .catch(err=>{console.error('EVIDENCE_QUERY_ERROR',err.message);res.writeHead(500);res.end();});
    return;
  }
  if(req.method!=='POST'||req.url!=='/effect'){res.writeHead(404);res.end();return;}
  let bytes=0,raw='',overflow=false;
  req.on('data',p=>{bytes+=p.length;if(bytes>2048){overflow=true;req.destroy();return;}raw+=p;});
  req.on('end',async()=>{
    if(overflow)return;
    let value;
    try{value=JSON.parse(raw);}catch{res.writeHead(400);res.end('INVALID_JSON');return;}
    if(!validRequest(value)){res.writeHead(400);res.end('INVALID_SYNTHETIC_REQUEST');return;}
    try{
      const verdict=await transact(value); // effect + request-attempt evidence committed atomically.
      if(owner==='a' && process.env.V4_ENABLE_COMMIT_CRASH==='yes' &&
         value.operationId===SPEC.crash.operationId && value.trigger==='crash' && verdict==='committed') {
        console.log('OWNED_RECEIVER_CRASH_AFTER_POSTGRES_COMMIT_BEFORE_HTTP_ACK=73');
        process.exit(73); // ONLY this spawned test receiver; PG service stays alive.
      }
      res.writeHead(verdict==='key_conflict'?409:200,{'content-type':'application/json'});
      res.end(JSON.stringify({status:verdict==='key_conflict'?'IDEMPOTENCY_KEY_REUSE':'ACK_CONFIRMED',
        operationId:value.operationId,verdict,duplicate:verdict==='duplicate'}));
    }catch(err){console.error('TRANSACTION_FAILED',err?.stack??String(err));
      if(!res.headersSent){res.writeHead(500);res.end('TRANSACTION_FAILED');}}
  });
});
server.listen(port,'127.0.0.1',()=>console.log(`SYNTHETIC_RECEIVER_READY name=${owner} port=${port}`));
process.on('SIGTERM',()=>server.close(()=>pool.end().finally(()=>{process.exitCode=0;})));
