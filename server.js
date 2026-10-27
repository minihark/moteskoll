import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 80;

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'moteskoll.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    total_cost_sek REAL NOT NULL,
    duration_seconds INTEGER NOT NULL,
    attendee_count INTEGER NOT NULL,
    decisions_count INTEGER NOT NULL,
    actions_count INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const stmtListMeetings = db.prepare(
  'SELECT data_json FROM meetings ORDER BY created_at DESC LIMIT 50'
);
const stmtUpsertMeeting = db.prepare(`
  INSERT INTO meetings (
    id, title, total_cost_sek, duration_seconds, attendee_count,
    decisions_count, actions_count, data_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    total_cost_sek = excluded.total_cost_sek,
    duration_seconds = excluded.duration_seconds,
    attendee_count = excluded.attendee_count,
    decisions_count = excluded.decisions_count,
    actions_count = excluded.actions_count,
    data_json = excluded.data_json
`);
const stmtDeleteMeeting = db.prepare('DELETE FROM meetings WHERE id = ?');
const stmtStats = db.prepare(`
  SELECT
    COUNT(*) as total_meetings,
    COALESCE(SUM(total_cost_sek), 0) as cumulative_cost_sek,
    COALESCE(SUM(actions_count), 0) as total_actions
  FROM meetings
`);

const serve = sirv('dist', {
  single: true,
  dev: true,
  etag: true,
  dotfiles: false,
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' || url.pathname === '/api/health') {
    const stats = stmtStats.get();
    sendJson(res, 200, {
      status: 'ok',
      service: 'moteskoll',
      uptime: process.uptime(),
      db: 'sqlite',
      stats,
    });
    return;
  }

  if (url.pathname === '/api/meetings' && req.method === 'GET') {
    try {
      const rows = stmtListMeetings.all();
      const meetings = rows.map((r) => JSON.parse(r.data_json));
      const stats = stmtStats.get();
      sendJson(res, 200, { meetings, stats });
    } catch (e) {
      sendJson(res, 500, { error: 'Failed to load meetings' });
    }
    return;
  }

  if (url.pathname === '/api/meetings' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body || !body.id || !body.title) {
        sendJson(res, 400, { error: 'Missing meeting id or title' });
        return;
      }
      stmtUpsertMeeting.run(
        String(body.id),
        String(body.title),
        Number(body.totalCostSek || 0),
        Number(body.durationSeconds || 0),
        Number(body.attendeeCount || 0),
        Number(body.decisionsCount || 0),
        Number(body.actionsCount || 0),
        JSON.stringify(body),
        String(body.createdAt || new Date().toISOString())
      );
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { error: 'Failed to save meeting' });
    }
    return;
  }

  if (url.pathname === '/api/meetings' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (id) {
      stmtDeleteMeeting.run(id);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  serve(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MötesKoll server listening on http://0.0.0.0:${PORT}`);
});
