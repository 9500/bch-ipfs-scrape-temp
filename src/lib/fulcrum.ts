import WebSocket from 'ws';

const FULCRUM_URL = 'ws://192.168.88.17:80';

interface ElectrumResponse {
	jsonrpc: string;
	id: number | string;
	result?: any;
	error?: {
		code: number;
		message: string;
	};
}

async function electrumCall(method: string, params: any[] = []): Promise<any> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(FULCRUM_URL);
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error('Connection timeout'));
		}, 10000);

		ws.on('open', () => {
			const request = {
				jsonrpc: '2.0',
				id: 1,
				method,
				params
			};
			ws.send(JSON.stringify(request));
		});

		ws.on('message', (data: WebSocket.Data) => {
			clearTimeout(timeout);
			try {
				const response: ElectrumResponse = JSON.parse(data.toString());

				if (response.error) {
					ws.close();
					reject(new Error(response.error.message));
					return;
				}

				ws.close();
				resolve(response.result);
			} catch (e) {
				ws.close();
				reject(e);
			}
		});

		ws.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
	});
}

export async function getFulcrumData() {
	try {
		// Get server version
		const serverVersion = await electrumCall('server.version', ['Astro Client', '1.4']);

		// Get block headers (contains current height)
		const headerSubscription = await electrumCall('blockchain.headers.subscribe');

		// Get server banner
		const banner = await electrumCall('server.banner');

		return {
			serverVersion: Array.isArray(serverVersion) ? serverVersion[0] : serverVersion,
			protocolVersion: Array.isArray(serverVersion) ? serverVersion[1] : 'unknown',
			blockHeight: headerSubscription?.height || 0,
			blockHash: headerSubscription?.hex ? headerSubscription.hex.substring(0, 16) + '...' : 'N/A',
			banner: banner || 'No banner available'
		};
	} catch (error) {
		throw error;
	}
}
