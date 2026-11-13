// Checks database.rules.json against the Firebase Realtime Database emulator.
//   npx firebase-tools emulators:exec --only database --project demo-aquaguard "node firebase/rules.test.mjs"
// (run from the repository root; needs Java for the emulator)
import assert from 'node:assert/strict';

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const ns = 'demo-aquaguard-default-rtdb';
const DEV = 'ag-1a2b3c';

// The emulator accepts unsigned tokens, which lets us act as any user.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, iat: 0, exp: 4102444800, aud: 'demo-aquaguard', iss: 'https://securetoken.google.com/demo-aquaguard', firebase: { sign_in_provider: 'password', identities: {} } })}.`;

async function call(method, path, body, uid) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid === 'admin') headers.Authorization = 'Bearer owner';
  else if (uid) headers.Authorization = `Bearer ${token(uid)}`;
  const res = await fetch(`http://${host}/${path}.json?ns=${ns}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.status;
}
const allowed = async (label, ...args) => assert.equal(await call(...args), 200, `should be allowed: ${label}`);
const denied = async (label, ...args) => {
  const status = await call(...args);
  assert.ok(status === 401 || status === 403, `should be denied: ${label} (got ${status})`);
};
const ts = { '.sv': 'timestamp' };
const d = (child) => `devices/${DEV}/${child}`;

// Seed membership the way the setup guide does it in the console.
await allowed('seed', 'PUT', d('members'), { ownerUid: 'owner', deviceUid: 'device' }, 'admin');

await denied('anonymous read', 'GET', d('status'));
await denied('stranger read', 'GET', d('status'), undefined, 'stranger');
await allowed('owner read', 'GET', d('status'), undefined, 'ownerUid');
await allowed('device read commands', 'GET', d('commands'), undefined, 'deviceUid');
await denied('read another unit', 'GET', 'devices/ag-ffffff/status', undefined, 'ownerUid');
await denied('read root', 'GET', 'devices', undefined, 'ownerUid');

await allowed('device writes status', 'PUT', d('status'), { fw: '0.1.0', updatedAt: ts }, 'deviceUid');
await denied('owner writes status', 'PUT', d('status'), { fw: 'x' }, 'ownerUid');
await denied('stranger writes status', 'PUT', d('status'), { fw: 'x' }, 'stranger');
await allowed('device writes history', 'PUT', d('history/20261113/0905'), { p: 50, v: 0 }, 'deviceUid');
await allowed('device posts event', 'POST', d('events'), { event: 'BOOT', at: ts }, 'deviceUid');
await denied('owner posts event', 'POST', d('events'), { event: 'BOOT' }, 'ownerUid');
await allowed('device writes config', 'PUT', d('config'), { tankName: 'Tank' }, 'deviceUid');

await denied('owner adds a member', 'PUT', d('members/stranger'), 'owner', 'ownerUid');
await denied('device adds a member', 'PUT', d('members/stranger'), 'owner', 'deviceUid');
await denied('stranger adds self', 'PUT', d('members/stranger'), 'owner', 'stranger');

await allowed('owner sends command', 'PUT', d('commands/c1'), { type: 'close', ts, uid: 'ownerUid' }, 'ownerUid');
await denied('stranger sends command', 'PUT', d('commands/c2'), { type: 'open', ts, uid: 'stranger' }, 'stranger');
await denied('owner backdates a command', 'PUT', d('commands/c3'), { type: 'open', ts: 1, uid: 'ownerUid' }, 'ownerUid');
await denied('owner forges uid', 'PUT', d('commands/c4'), { type: 'open', ts, uid: 'someoneElse' }, 'ownerUid');
await denied('owner rewrites a queued command', 'PUT', d('commands/c1'), { type: 'open', ts, uid: 'ownerUid' }, 'ownerUid');
await denied('command without type', 'PUT', d('commands/c5'), { ts, uid: 'ownerUid' }, 'ownerUid');
await denied('device invents a command', 'PUT', d('commands/c6'), { type: 'open', ts, uid: 'deviceUid' }, 'deviceUid');
await allowed('device removes a command', 'DELETE', d('commands/c1'), undefined, 'deviceUid');
await allowed('device answers', 'PUT', d('results/c1'), { ok: true, at: ts }, 'deviceUid');
await denied('owner fakes an answer', 'PUT', d('results/c9'), { ok: true }, 'ownerUid');
await allowed('owner clears an answer', 'DELETE', d('results/c1'), undefined, 'ownerUid');
await allowed('owner withdraws own command', 'PUT', d('commands/c7'), { type: 'ack', ts, uid: 'ownerUid' }, 'ownerUid');
await allowed('owner withdraws own command (delete)', 'DELETE', d('commands/c7'), undefined, 'ownerUid');
await allowed('device clears the queue', 'DELETE', d('commands'), undefined, 'deviceUid');

await allowed('owner logbook entry', 'POST', d('logbook'), { kind: 'Monthly check', checks: ['a'], note: 'ok', by: 'me', at: ts }, 'ownerUid');
await denied('device logbook entry', 'POST', d('logbook'), { kind: 'Note' }, 'deviceUid');
await denied('oversized note', 'POST', d('logbook'), { kind: 'Note', note: 'x'.repeat(1001) }, 'ownerUid');
await allowed('owner saves record', 'PUT', d('record'), { board: 'N16R8 rev 1.1' }, 'ownerUid');
await denied('record field too long', 'PUT', d('record'), { board: 'x'.repeat(201) }, 'ownerUid');
await denied('write outside devices', 'PUT', 'anything', { a: 1 }, 'ownerUid');

console.log('database rules: all checks passed');
