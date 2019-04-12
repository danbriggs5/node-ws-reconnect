const Emitter = require('eventemitter3');
const Hoek = require('hoek');
const Joi = require('joi');
const WebSocket = require('ws');

const defaultSettings = {
	connectionTimeout: 5 * 1000,
	heartbeatInterval: 15 * 1000,
	heartbeatTimeout: 5 * 1000,
	maxReconnectDelay: 5 * 60 * 1000,
	minReconnectDelay: 1000,
};

const positiveIntSchema = Joi.number()
	.integer()
	.min(1);

const settingsSchema = Joi.object({
	connectionTimeout: positiveIntSchema.required(),
	heartbeatInterval: positiveIntSchema.required(),
	heartbeatTimeout: positiveIntSchema.required(),
	maxReconnectDelay: positiveIntSchema.required(),
	minReconnectDelay: positiveIntSchema.required(),
}).required();

module.exports = (url, options = {}) => {
	const settings = Hoek.applyToDefaults(defaultSettings, options);

	Joi.assert(settings, settingsSchema, 'Invalid ReconnectingSocket options');

	let connectionTimeout;
	let heartbeatInterval;
	let heartbeatTimeout;
	let reconnectDelay = settings.minReconnectDelay;
	let reconnectTimeout;
	let ws;
	let isClosed = false;
	let shouldIgnorePongs = false;
	const emitter = new Emitter();

	function parseJsonDict(json) {
		try {
			const dict = JSON.parse(json);
			return dict instanceof Object ? dict : {};
		} catch (err) {
			return {};
		}
	}

	function isOpen() {
		return ws.readyState === WebSocket.OPEN;
	}

	// Drop messages if the socket is not open
	function send(body) {
		if (isOpen()) {
			ws.send(JSON.stringify(body));
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
		emitter.emit('open');
	}

	function onMessage(json) {
		emitter.emit('message', parseJsonDict(json));
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
		ws = new WebSocket(url);
		ws.on('open', onOpen);
		ws.on('message', onMessage);
		ws.on('pong', onPong);
		ws.on('error', onError);
		ws.on('close', onClose);

		connectionTimeout = setTimeout(() => {
			reconnect(); // eslint-disable-line no-use-before-define
			emitter.emit('error', new Error('Timed out waiting to connect'));
		}, settings.connectionTimeout);
	}

	function cleanup(code) {
		clearTimeout(connectionTimeout);
		clearTimeout(heartbeatTimeout);
		clearInterval(heartbeatInterval);
		clearTimeout(reconnectTimeout);
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

	function reconnect(code = 1000) {
		cleanup(code);
		reconnectTimeout = setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, settings.maxReconnectDelay);
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
