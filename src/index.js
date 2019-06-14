const Emitter = require('eventemitter3');
const Hoek = require('hoek');
const Joi = require('joi');
const WebSocket = require('ws');

const urlSchema = Joi.alternatives().try(Joi.string(), Joi.func());

const defaultSettings = {
	connectionTimeout: 5 * 1000,
	heartbeatInterval: 15 * 1000,
	heartbeatTimeout: 5 * 1000,
	maxReconnectDelay: 5 * 60 * 1000,
	messageBuffering: true,
	minReconnectDelay: 1000,
	reconnectDelayMultiplier: 2,
};

const positiveIntSchema = Joi.number()
	.integer()
	.min(1);

const settingsSchema = Joi.object({
	connectionTimeout: positiveIntSchema.required(),
	heartbeatInterval: positiveIntSchema.required(),
	heartbeatTimeout: positiveIntSchema.required(),
	maxReconnectDelay: positiveIntSchema.required(),
	messageBuffering: Joi.boolean().required(),
	minReconnectDelay: positiveIntSchema.required(),
	reconnectDelayMultiplier: positiveIntSchema.required(),
});

module.exports = (url, options = {}) => {
	const settings = Hoek.applyToDefaults(defaultSettings, options);

	Joi.assert(url, urlSchema.required(), 'Invalid url');
	Joi.assert(
		settings,
		settingsSchema.required(),
		'Invalid ReconnectingSocket options',
	);

	let connectionTimeout;
	let heartbeatInterval;
	let heartbeatTimeout;
	let reconnectDelay = settings.minReconnectDelay;
	let reconnectTimeout;
	let ws;
	let isClosed = false;
	let shouldIgnorePongs = false;
	let msgBuffer = [];
	const emitter = new Emitter();

	function isOpen() {
		return !!ws && ws.readyState === WebSocket.OPEN;
	}

	// Drop messages if the socket is not open
	function send(body) {
		if (isOpen()) {
			ws.send(body);
		} else if (settings.messageBuffering) {
			msgBuffer.push(body);
		}
	}

	function ping() {
		if (isOpen()) {
			ws.ping();
		}
	}

	function onOpen() {
		clearTimeout(connectionTimeout);

		heartbeatInterval = setInterval(() => {
			heartbeatTimeout = setTimeout(() => {
				reconnect(); // eslint-disable-line no-use-before-define
				emitter.emit(
					'error',
					new Error('Disconnecting due to a heartbeat timeout'),
				);
			}, settings.heartbeatTimeout);

			ping();
		}, settings.heartbeatInterval);

		// Reset the reconnect delay on successful connection
		reconnectDelay = settings.minReconnectDelay;

		const msgBufferClone = [...msgBuffer];
		msgBuffer = [];
		msgBufferClone.forEach(send);

		emitter.emit('open');
	}

	function onMessage(msg) {
		emitter.emit('message', msg);
	}

	function onPong() {
		if (shouldIgnorePongs) {
			// This is a flag for testing purposes
			return;
		}
		clearTimeout(heartbeatTimeout);
	}

	function onError(err) {
		emitter.emit('error', err);
	}

	// Automatically reconnect when the socket is closed without us closing it
	function onClose(code) {
		reconnect(); // eslint-disable-line no-use-before-define
		emitter.emit('close', { code, willReconnect: true });
	}

	function connect() {
		// 'url' may be a string, function, or function that returns a promise
		let prom = typeof url === 'function' ? url() : url;
		if (!(prom instanceof Promise)) {
			prom = Promise.resolve(prom);
		}

		prom
			.then(actualUrl => {
				if (isClosed) {
					return;
				}
				Joi.assert(actualUrl, Joi.string().required(), 'Invalid url');

				ws = new WebSocket(actualUrl);
				ws.on('open', onOpen);
				ws.on('message', onMessage);
				ws.on('pong', onPong);
				ws.on('error', onError);
				ws.on('close', onClose);

				connectionTimeout = setTimeout(() => {
					reconnect(); // eslint-disable-line no-use-before-define
					emitter.emit('error', new Error('Timed out waiting to connect'));
				}, settings.connectionTimeout);
			})
			.catch(() => {
				if (isClosed) {
					return;
				}
				reconnect(); // eslint-disable-line no-use-before-define
				emitter.emit('error', new Error('Failed to resolve the socket url'));
			});
	}

	function cleanup(code) {
		clearTimeout(connectionTimeout);
		clearTimeout(heartbeatTimeout);
		clearInterval(heartbeatInterval);
		clearTimeout(reconnectTimeout);
		if (ws) {
			ws.removeAllListeners();

			// ws.close() will throw if socket hasn't been opened yet. We will have removed the error
			// listener before calling ws.close() so this error become an unhandled promise rejection
			// if we don't catch it here.
			try {
				ws.close(code);
			} catch (err) {
				// noop
			}
		}
	}

	function reconnect(code = 1000) {
		cleanup(code);
		reconnectTimeout = setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(
			reconnectDelay * settings.reconnectDelayMultiplier,
			settings.maxReconnectDelay,
		);
	}

	function close(code = 1000) {
		if (isClosed) {
			return;
		}
		cleanup(code);
		emitter.removeAllListeners();
		isClosed = true;
	}

	// For testing only
	function ignorePongs() {
		shouldIgnorePongs = true;
	}

	connect();

	return {
		close,
		ignorePongs, // For testing only
		reconnect,
		send,
		on: emitter.on.bind(emitter),
		once: emitter.once.bind(emitter),
		removeListener: emitter.on.bind(emitter),
	};
};
