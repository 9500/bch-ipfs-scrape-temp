/**
 * Fulcrum Electrum Protocol Client
 * Connects to Fulcrum server for blockchain queries
 */

import WebSocket from 'ws';
import { createHash } from 'crypto';

interface ElectrumResponse {
  jsonrpc: string;
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface TransactionVerbose {
  txid: string;
  hash: string;
  version: number;
  size: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    scriptSig: { asm: string; hex: string };
    sequence: number;
  }>;
  vout: Array<{
    value: number;
    n: number;
    scriptPubKey: {
      asm: string;
      hex: string;
      type: string;
      addresses?: string[];
    };
  }>;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

interface HistoryItem {
  tx_hash: string;
  height: number;
  fee?: number;
}

/**
 * Make a call to Fulcrum using Electrum protocol over WebSocket
 */
async function electrumCall(method: string, params: any[] = []): Promise<any> {
  const FULCRUM_WS_URL = process.env.FULCRUM_WS_URL;

  if (!FULCRUM_WS_URL) {
    throw new Error('FULCRUM_WS_URL environment variable is not set');
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(FULCRUM_WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Fulcrum connection timeout'));
    }, 10000);

    ws.on('open', () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      };
      ws.send(JSON.stringify(request));
    });

    ws.on('message', (data: WebSocket.Data) => {
      clearTimeout(timeout);
      try {
        const response: ElectrumResponse = JSON.parse(data.toString());

        if (response.error) {
          ws.close();
          reject(new Error(`Fulcrum error: ${response.error.message}`));
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

/**
 * Calculate Electrum scripthash from scriptPubKey hex
 * Scripthash = sha256(scriptPubKey) reversed as hex
 */
export function calculateScripthash(scriptPubKeyHex: string): string {
  const scriptBuffer = Buffer.from(scriptPubKeyHex, 'hex');
  const hash = createHash('sha256').update(scriptBuffer).digest();
  // Reverse the hash bytes
  return hash.reverse().toString('hex');
}

/**
 * Get transaction in verbose format (with decoded inputs/outputs)
 */
export async function getTransaction(txid: string): Promise<TransactionVerbose> {
  const result = await electrumCall('blockchain.transaction.get', [txid, true]);
  return result as TransactionVerbose;
}

/**
 * Get transaction as raw hex
 */
export async function getTransactionHex(txid: string): Promise<string> {
  const result = await electrumCall('blockchain.transaction.get', [txid, false]);
  return result as string;
}

/**
 * Get history for a scripthash (all transactions involving this script)
 * Used to find if an output has been spent
 */
export async function getScripthashHistory(scripthash: string): Promise<HistoryItem[]> {
  const result = await electrumCall('blockchain.scripthash.get_history', [scripthash]);
  return result as HistoryItem[];
}

/**
 * Check if a specific output (txid:vout) is spent
 * Returns the spending transaction hash if spent, null if unspent
 */
export async function getOutputSpendingTx(
  txid: string,
  vout: number
): Promise<string | null> {
  try {
    // Get the transaction to find output's scriptPubKey
    const tx = await getTransaction(txid);

    if (!tx.vout[vout]) {
      throw new Error(`Output ${vout} does not exist in transaction ${txid}`);
    }

    const scriptPubKeyHex = tx.vout[vout].scriptPubKey.hex;
    const scripthash = calculateScripthash(scriptPubKeyHex);

    // Get all transactions involving this scripthash
    const history = await getScripthashHistory(scripthash);

    // Find our transaction in the history
    const ourTxIndex = history.findIndex((h) => h.tx_hash === txid);

    if (ourTxIndex === -1) {
      // Transaction not in history - might be unconfirmed or not indexed yet
      // Assume unspent for now (conservative approach)
      return null;
    }

    // Check if there's a transaction after ours (spending transaction)
    // In Electrum history, transactions are in chronological order
    // We need to check all subsequent transactions to see if any spend our output
    for (let i = ourTxIndex + 1; i < history.length; i++) {
      const candidateTx = await getTransaction(history[i].tx_hash);

      // Check if any input spends our output
      for (const input of candidateTx.vin) {
        if (input.txid === txid && input.vout === vout) {
          return history[i].tx_hash;
        }
      }
    }

    // Output is unspent
    return null;
  } catch (error) {
    // On error, log and return null (assume unspent)
    console.error(`Warning: Could not check spending status for ${txid}:${vout}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Get server information
 */
export async function getServerInfo(): Promise<{
  version: string;
  protocolVersion: string;
  blockHeight: number;
}> {
  const serverVersion = await electrumCall('server.version', ['BCMR Client', '1.4']);
  const headerSubscription = await electrumCall('blockchain.headers.subscribe');

  return {
    version: Array.isArray(serverVersion) ? serverVersion[0] : serverVersion,
    protocolVersion: Array.isArray(serverVersion) ? serverVersion[1] : 'unknown',
    blockHeight: headerSubscription?.height || 0,
  };
}
