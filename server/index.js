import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closeAll } from './db.js';
import { listTables, getTableInfo, syncWithParents } from './sync.js';

const PORT = Number(process.env.PORT) || 3101;
const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/connect', async (req, res) => {
  const pool = await getPool(req.body.conn);
  const { recordset } = await pool
    .request()
    .query(`SELECT DB_NAME() AS [database], CAST(SERVERPROPERTY('ProductVersion') AS varchar(50)) AS version`);
  res.json({ ok: true, ...recordset[0] });
});

app.post('/api/tables', async (req, res) => {
  const pool = await getPool(req.body.conn);
  res.json({ tables: await listTables(pool) });
});

app.post('/api/table-info', async (req, res) => {
  const { conn, target, schema, table } = req.body;
  res.json(await getTableInfo(conn, schema, table, target));
});

// Streams newline-delimited JSON events: log / progress / done / error.
app.post('/api/sync', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (event) => res.write(JSON.stringify(event) + '\n');
  try {
    const result = await syncWithParents(req.body, send);
    send({ type: 'done', result });
  } catch (err) {
    send({ type: 'error', error: err.message });
  }
  res.end();
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || String(err) });
});

// Serve the built React app when present (npm run build && npm start).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(PORT, '127.0.0.1', () => console.log(`DB Syncer API on http://127.0.0.1:${PORT}`));
process.on('SIGINT', async () => {
  await closeAll();
  server.close(() => process.exit(0));
});
