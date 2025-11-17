const CHAINGRAPH_URL = 'http://192.168.88.105:8088/graphql';

interface GraphQLResponse {
	data?: any;
	errors?: Array<{
		message: string;
	}>;
}

async function graphqlQuery(query: string): Promise<any> {
	const response = await fetch(CHAINGRAPH_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ query }),
		cache: 'no-store' // No caching
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data: GraphQLResponse = await response.json();

	if (data.errors && data.errors.length > 0) {
		throw new Error(data.errors[0].message);
	}

	return data.data;
}

export async function getChaingraphData() {
	// Query for latest block info, transaction count, and chain tip
	const query = `
		query {
			block(limit: 1, order_by: {height: desc}) {
				height
				hash
				timestamp
				transaction_count
			}
			transaction_aggregate {
				aggregate {
					count
				}
			}
		}
	`;

	const data = await graphqlQuery(query);

	const latestBlock = data.block && data.block.length > 0 ? data.block[0] : null;

	return {
		blockHeight: latestBlock?.height || 0,
		blockHash: latestBlock?.hash ? latestBlock.hash.substring(0, 16) + '...' : 'N/A',
		timestamp: latestBlock?.timestamp || 'N/A',
		transactionsInBlock: latestBlock?.transaction_count || 0,
		totalTransactions: data.transaction_aggregate?.aggregate?.count || 0
	};
}
