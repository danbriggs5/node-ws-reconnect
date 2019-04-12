const { test } = require('tape');
const WebSocket = require('ws');
const ReconnectingWebSocket = require('./index');

const WebSocketServer = WebSocket.Server;

let curPort = 3130;
function getUniquePort() {
	curPort += 1;
	return curPort;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

test('ws', t1 => {
	t1.test('server', t2 => {
		t2.test('receives the client socket', t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			let ws;

			wss.on('connection', socket => {
				t.ok(socket);
				ws.close();
				wss.close();
				t.end();
			});

			ws = ReconnectingWebSocket(`ws://localhost:${port}`);
		});
	});

	t1.test('client', t2 => {
		t2.test('emits open event on connection', t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`);

			ws.on('open', () => {
				t.pass('opened');
				t.end();
				ws.close();
				wss.close();
			});
		});

		t2.test('does not open if server is not running', async t => {
			const port = getUniquePort();
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`);
			let opened = false;

			ws.on('open', () => {
				opened = true;
			});

			await delay(100);

			t.notOk(opened);
			t.end();
			ws.close();
		});

		t2.test('throws a connection timeout error', async t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				connectionTimeout: 1,
			});

			ws.on('error', err => {
				t.equal(err.message, 'Timed out waiting to connect');
				t.end();
				ws.close();
				wss.close();
			});
		});

		t2.test('keeps trying to connect', async t => {
			const port = getUniquePort();
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				connectionTimeout: 1,
				minReconnectDelay: 1,
			});
			let errorCount = 0;

			ws.on('error', err => {
				errorCount += 1;
				if (err.message === 'Timed out waiting to connect') {
					errorCount += 1;
				}
			});

			await delay(500);

			t.ok(errorCount >= 2);
			t.end();
			ws.close();
		});

		t2.test('reconnect delay increases exponentially', async t => {
			const port = getUniquePort();
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				connectionTimeout: 1,
				minReconnectDelay: 10,
				maxReconnectDelay: 1000,
			});
			const delays = [];
			let lastErrorAt;

			ws.on('error', () => {
				if (lastErrorAt) {
					delays.push(Date.now() - lastErrorAt);
				}
				lastErrorAt = Date.now();
			});

			await delay(500);

			t.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]));
			t.end();
			ws.close();
		});

		t2.test('emits close event', async t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				minReconnectDelay: 1000,
			});

			wss.on('connection', socket => {
				socket.close(1000);
			});
			ws.on('close', ({ code, willReconnect }) => {
				t.ok(willReconnect);
				t.equal(code, 1000);
				t.end();
				ws.close();
				wss.close();
			});
		});

		t2.test('reconnects when closed', async t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				minReconnectDelay: 1,
			});
			let connectionCount = 0;
			let openCount = 0;

			wss.on('connection', socket => {
				connectionCount += 1;
				socket.close();
			});
			ws.on('open', () => {
				openCount += 1;
			});

			await delay(500);

			t.ok(connectionCount >= 2);
			t.ok(openCount >= 2);
			t.end();
			ws.close();
			wss.close();
		});

		t2.test('stays open when server is heartbeating', async t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				heartbeatInterval: 20,
				heartbeatTimeout: 10,
				minReconnectDelay: 1,
			});
			let gotError = false;

			ws.on('error', () => {
				gotError = true;
			});

			await delay(500);

			t.notOk(gotError);
			t.end();
			ws.close();
			wss.close();
		});

		t2.test('emits error when server stops heartbeating', async t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				heartbeatInterval: 20,
				heartbeatTimeout: 10,
			});
			ws.on('error', err => {
				t.equal(err.message, 'Disconnecting due to a heartbeat timeout');
				t.end();
				ws.close();
				wss.close();
			});

			await delay(500);
			ws.ignorePongs();
		});

		t2.test('reconnects when server stops heartbeating', async t => {
			const port = getUniquePort();
			const wss = new WebSocketServer({ port });
			const ws = ReconnectingWebSocket(`ws://localhost:${port}`, {
				heartbeatInterval: 20,
				heartbeatTimeout: 10,
				minReconnectDelay: 1,
			});
			let connectionCount = 0;
			let openCount = 0;

			wss.on('connection', socket => {
				connectionCount += 1;
				socket.close();
			});
			ws.on('open', () => {
				openCount += 1;
			});

			await delay(50);
			ws.ignorePongs();
			await delay(500);

			t.ok(connectionCount >= 2);
			t.ok(openCount >= 2);
			t.end();
			ws.close();
			wss.close();
		});
	});
});
