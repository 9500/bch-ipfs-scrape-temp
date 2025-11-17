const CHAINGRAPH_URL = 'http://192.168.88.105:8088/v1/graphql';

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
	const query = `
		query MonitorMempools {
			node {
				name
				user_agent
				unconfirmed_transaction_count
				unconfirmed_transactions(
					limit: 5,
					order_by: { validated_at: desc }
				) {
					validated_at
					transaction {
						hash
						input_count
						output_count
						output_value_satoshis
						size_bytes
					}
				}
			}
		}
	`;

	const data = await graphqlQuery(query);

	const nodeData = data.node && data.node.length > 0 ? data.node[0] : null;

	if (!nodeData) {
		throw new Error('No node data returned from Chaingraph');
	}

	return {
		nodeName: nodeData.name,
		userAgent: nodeData.user_agent,
		unconfirmedCount: parseInt(nodeData.unconfirmed_transaction_count) || 0,
		recentTransactions: nodeData.unconfirmed_transactions || []
	};
}
