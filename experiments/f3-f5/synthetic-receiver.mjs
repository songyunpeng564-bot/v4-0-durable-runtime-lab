// PUBLIC / SYNTHETIC / LOCALHOST-ONLY. The receiver owns an append+fsync evidence log.
import { createServer } from 'node:http';
import { openSync, closeSync, writeSync, fsyncSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 9186;
const LEDGER = join(process.cwd(), 'synthetic-receiver-ledger.jsonl');
const allowedStages = new Set(['codex', 'promotion', 'telegram']);
const allowedFrameworks = new Set(['dbos', 'restate']);
const idPattern = /^[a-z0-9][a-z0-9_-]{7,63}$/;
const records = [];
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/evidence') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ records }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/effect') {
    res.writeHead(404); res.end(); return;
  }
  let bytes = 0, chunks = '';
  req.on('data', part => {
    bytes += part.length;
    if (bytes > 4096) { req.destroy(); return; }
    chunks += part;
  });
  req.on('end', () => {
    let input;
    try { input = JSON.parse(chunks); } catch { res.writeHead(400); res.end(); return; }
    if (Object.keys(input).sort().join(',') !== 'framework,mode,operationId,stage' ||
        !allowedFrameworks.has(input.framework) || !allowedStages.has(input.stage) ||
        !idPattern.test(input.operationId) || !['drop_ack', 'ack'].includes(input.mode)) {
      res.writeHead(400); res.end(); return;
    }
    const record = Object.freeze({
      sequence: records.length + 1,
      framework: input.framework, stage: input.stage,
      operationId: input.operationId, effect: 'SYNTHETIC_EFFECT_ACCEPTED',
    });
    // Evidence is written and fsynced BEFORE intentional response-loss injection.
    const fd = openSync(LEDGER, 'a', 0o600);
    try { writeSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    records.push(record);
    if (input.mode === 'drop_ack') {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ACK_CONFIRMED', operationId: input.operationId }));
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('OWNED_SYNTHETIC_RECEIVER_READY=PASS'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
// Defensive receipt/ledger correspondence is checked by the independent orchestrator.
