import { test } from 'node:test';
import assert from 'node:assert/strict';

let importId = 0;
const inventoryId = '11111111-1111-4111-8111-111111111111';
const invitation = 'a'.repeat(64);
const device = { inventory_id: inventoryId, device_id: 'test-device', device_token: 'b'.repeat(64) };
const creation = { name: 'Test', description: '', deviceName: 'Browser', invitationToken: invitation };

async function endpoint(t, name, respond) {
  let handler;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true,
    value: {
      env: { get: (name) => ({
        SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      })[name] },
      serve: (value) => { handler = value; },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'Deno', descriptor);
    else delete globalThis.Deno;
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const call = { name: new URL(url).pathname.split('/').at(-1), body: JSON.parse(options.body) };
    calls.push(call);
    return respond(call);
  });
  const url = new URL(`../supabase/functions/${name}/index.ts`, import.meta.url);
  url.searchParams.set('test', String(importId++));
  await import(url);
  return {
    calls,
    request: (body, method = 'POST') => handler(new Request(`https://example.test/${name}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.1' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    })),
  };
}

test('Inventaranlage ohne Betreiber-Einladung scheitert vor dem Datenbankzugriff', async (t) => {
  const api = await endpoint(t, 'createInventory', () => { throw new Error('Unexpected database access'); });
  const { invitationToken, ...body } = creation;
  const response = await api.request(body);
  assert.equal(response.status, 400);
  assert.equal(api.calls.length, 0);
  assert.equal((await api.request(creation, 'GET')).status, 405);
});

test('Inventaranlage prüft zuerst das Clientlimit und übergibt die Einladung nur an die geschützte RPC', async (t) => {
  const api = await endpoint(t, 'createInventory', (call) =>
    Response.json(call.name === 'consume_public_attempt' ? true : [device]));
  const response = await api.request(creation);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    inventoryId, deviceId: device.device_id, deviceToken: device.device_token,
  });
  assert.equal(api.calls[0].name, 'consume_public_attempt');
  assert.equal(api.calls[0].body.p_action, 'create');
  assert.match(api.calls[0].body.p_client_key, /^[0-9a-f]{64}$/);
  assert.deepEqual(api.calls[1], {
    name: 'setup_inventory',
    body: { p_invitation_token: invitation, p_name: 'Test', p_description: '', p_device_name: 'Browser' },
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('Erschöpftes Clientlimit und ungültige Einladungen führen nicht zu einer erfolgreichen Anlage', async (t) => {
  const limited = await endpoint(t, 'createInventory', () => Response.json(false));
  assert.equal((await limited.request(creation)).status, 429);
  assert.equal(limited.calls.length, 1);
  const invalid = await endpoint(t, 'createInventory', (call) =>
    call.name === 'consume_public_attempt' ? Response.json(true) :
      Response.json({ code: '28000', message: 'Invalid inventory invitation' }, { status: 403 }));
  const response = await invalid.request(creation);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Invalid or expired credentials' });
});

test('Gerätekopplung verwendet ein separates Clientbudget und kein fremd ausschöpfbares Inventarbudget', async (t) => {
  const api = await endpoint(t, 'registerDevice', (call) =>
    Response.json(call.name === 'consume_public_attempt' ? true : [device]));
  for (const id of [inventoryId, '22222222-2222-4222-8222-222222222222']) {
    assert.equal((await api.request({
      inventoryId: id, joinToken: 'ABCD-EFGH-JKLM', deviceName: 'Browser',
    })).status, 200);
  }
  assert.equal(api.calls[0].body.p_action, 'register');
  assert.deepEqual(api.calls[0], api.calls[2]);
  assert.deepEqual(Object.keys(api.calls[0].body).sort(), ['p_action', 'p_client_key']);
  assert.equal(api.calls[1].body.p_inventory_id, inventoryId);
});
