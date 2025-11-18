/**
 * Fulcrum Electrum Protocol Client
 * Connects to Fulcrum server for blockchain queries with connection pooling
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

interface PendingRequest {
  method: string;
  params: any[];
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  id: number;
}

/**
 * Connection Pool for Fulcrum WebSocket connections
 */
class FulcrumConnectionPool {
  private connections: WebSocket[] = [];
  private availableConnections: WebSocket[] = [];
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private requestQueue: PendingRequest[] = [];
  private nextRequestId = 1;
  private poolSize: number;
  private wsUrl: string;
  private connectionPromises: Map<WebSocket, Promise<void>> = new Map();
  private isClosing = false;

  constructor(poolSize = 10) {
    const FULCRUM_WS_URL = process.env.FULCRUM_WS_URL;
    if (!FULCRUM_WS_URL) {
      throw new Error('FULCRUM_WS_URL environment variable is not set');
    }
    this.wsUrl = FULCRUM_WS_URL;
    this.poolSize = poolSize;
  }

  /**
   * Initialize the connection pool
   */
  async initialize(): Promise<void> {
    const promises = [];
    for (let i = 0; i < this.poolSize; i++) {
      promises.push(this.createConnection());
    }
    await Promise.all(promises);
  }

  /**
   * Create a new WebSocket connection
   */
  private async createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Fulcrum connection timeout during pool initialization'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.connections.push(ws);
        this.availableConnections.push(ws);
        this.setupMessageHandler(ws);
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('close', () => {
        // Remove from available connections
        const availableIndex = this.availableConnections.indexOf(ws);
        if (availableIndex !== -1) {
          this.availableConnections.splice(availableIndex, 1);
        }

        // Remove from all connections
        const index = this.connections.indexOf(ws);
        if (index !== -1) {
          this.connections.splice(index, 1);
        }

        // Recreate connection if pool is still active and not closing
        if (!this.isClosing && this.connections.length < this.poolSize) {
          this.createConnection().catch((err) => {
            console.error('Failed to recreate connection:', err);
          });
        }
      });
    });
  }

  /**
   * Setup message handler for a connection
   */
  private setupMessageHandler(ws: WebSocket): void {
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response: ElectrumResponse = JSON.parse(data.toString());
        const pending = this.pendingRequests.get(Number(response.id));

        if (pending) {
          this.pendingRequests.delete(Number(response.id));

          if (response.error) {
            pending.reject(new Error(`Fulcrum error: ${response.error.message}`));
          } else {
            pending.resolve(response.result);
          }

          // Mark connection as available and process queue
          if (!this.availableConnections.includes(ws)) {
            this.availableConnections.push(ws);
          }
          this.processQueue();
        }
      } catch (e) {
        console.error('Error parsing Fulcrum response:', e);
      }
    });
  }

  /**
   * Make a call using a pooled connection
   */
  async call(method: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++;
      const request: PendingRequest = {
        method,
        params,
        resolve,
        reject,
        id,
      };

      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    while (this.requestQueue.length > 0 && this.availableConnections.length > 0) {
      const request = this.requestQueue.shift()!;
      const ws = this.availableConnections.shift()!;

      // Add to pending requests
      this.pendingRequests.set(request.id, request);

      // Send request
      const message = {
        jsonrpc: '2.0',
        id: request.id,
        method: request.method,
        params: request.params,
      };

      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        // If send fails, reject and return connection to pool
        this.pendingRequests.delete(request.id);
        request.reject(error instanceof Error ? error : new Error('Failed to send request'));
        this.availableConnections.push(ws);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; pending: number; queued: number } {
    return {
      total: this.connections.length,
      available: this.availableConnections.length,
      pending: this.pendingRequests.size,
      queued: this.requestQueue.length,
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    this.isClosing = true;

    for (const ws of this.connections) {
      ws.close();
    }
    this.connections = [];
    this.availableConnections = [];
    this.pendingRequests.clear();
    this.requestQueue = [];
  }
}

// Global connection pool instance
let globalPool: FulcrumConnectionPool | null = null;

/**
 * Get or create the global connection pool
 */
export async function getConnectionPool(poolSize = 10): Promise<FulcrumConnectionPool> {
  if (!globalPool) {
    globalPool = new FulcrumConnectionPool(poolSize);
    await globalPool.initialize();
  }
  return globalPool;
}

/**
 * Close the global connection pool
 */
export async function closeConnectionPool(): Promise<void> {
  if (globalPool) {
    await globalPool.close();
    globalPool = null;
  }
}

/**
 * Make a call to Fulcrum using the connection pool
 */
async function electrumCall(method: string, params: any[] = []): Promise<any> {
  const pool = await getConnectionPool();
  return pool.call(method, params);
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
