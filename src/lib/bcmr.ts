/**
 * BCMR (Bitcoin Cash Metadata Registries) Library
 * Fetches and parses BCMR registry announcements from the BCH blockchain
 */

import { getOutputSpendingTx } from './fulcrum-client.js';

// GraphQL query to fetch all BCMR outputs using prefix search
const BCMR_QUERY = `
  query SearchOutputsByLockingBytecodePrefix {
    search_output_prefix(
      args: { locking_bytecode_prefix_hex: "6a0442434d5220" }
    ) {
      locking_bytecode
      output_index
      transaction_hash
      value_satoshis
      transaction {
        block_inclusions {
          block {
            hash
            height
          }
        }
      }
      spent_by {
        input_index
        transaction {
          hash
          block_inclusions {
            block {
              hash
              height
            }
          }
        }
      }
    }
  }
`;

interface BCMROutput {
  locking_bytecode: string;
  output_index: string | number; // Chaingraph returns as string
  transaction_hash: string;
  value_satoshis: string | number; // Chaingraph returns as string
  transaction: {
    block_inclusions: Array<{
      block: {
        hash: string;
        height: string | number; // Chaingraph returns as string
      };
    }>;
  };
  spent_by: Array<{
    input_index: string | number; // Chaingraph returns as string
    transaction: {
      hash: string;
      block_inclusions: Array<{
        block: {
          hash: string;
          height: string | number; // Chaingraph returns as string
        };
      }>;
    };
  }>;
}

interface ParsedBCMR {
  hash: string;
  uris: string[];
}

interface BCMRRegistry {
  authbase: string; // Transaction hash where authchain starts
  authhead: string; // Latest transaction in authchain
  tokenId: string;  // Same as authbase for display
  blockHeight: number;
  hash: string;
  uris: string[];
  isBurned: boolean;
  isValid: boolean;
  authchainLength: number; // Number of transactions in the authchain
  isAuthheadUnspent: boolean; // True if authhead output 0 is unspent (active registry)
}

/**
 * Strip PostgreSQL hex prefix (\x) from hex strings
 */
function stripHexPrefix(hex: string): string {
  // Handle both \x and \\x prefixes from PostgreSQL
  if (hex.startsWith('\\x')) {
    return hex.slice(2);
  }
  if (hex.startsWith('0x')) {
    return hex.slice(2);
  }
  return hex;
}

/**
 * Parse BCMR locking bytecode to extract hash and URIs
 */
function parseBCMRBytecode(hex: string): ParsedBCMR | null {
  try {
    // Strip PostgreSQL hex prefix if present
    const cleanHex = stripHexPrefix(hex);
    const bytes = Buffer.from(cleanHex, 'hex');
    let pos = 0;

    // Verify OP_RETURN (0x6a)
    if (bytes[pos] !== 0x6a) return null;
    pos++;

    // Verify OP_PUSHBYTES_4 (0x04) and "BCMR"
    if (bytes[pos] !== 0x04) return null;
    pos++;

    const bcmrText = bytes.slice(pos, pos + 4).toString('ascii');
    if (bcmrText !== 'BCMR') return null;
    pos += 4;

    // Verify OP_PUSHBYTES_32 (0x20) for hash
    if (bytes[pos] !== 0x20) return null;
    pos++;

    // Extract 32-byte SHA-256 hash
    const hash = bytes.slice(pos, pos + 32).toString('hex');
    pos += 32;

    // Extract URIs (remaining push operations)
    const uris: string[] = [];

    while (pos < bytes.length) {
      const opcode = bytes[pos];
      pos++;

      let pushLength = 0;

      if (opcode >= 0x01 && opcode <= 0x4b) {
        // Direct push (1-75 bytes)
        pushLength = opcode;
      } else if (opcode === 0x4c) {
        // OP_PUSHDATA1
        pushLength = bytes[pos];
        pos++;
      } else if (opcode === 0x4d) {
        // OP_PUSHDATA2
        pushLength = bytes.readUInt16LE(pos);
        pos += 2;
      } else if (opcode === 0x4e) {
        // OP_PUSHDATA4
        pushLength = bytes.readUInt32LE(pos);
        pos += 4;
      } else {
        // Unknown opcode, skip
        break;
      }

      if (pos + pushLength > bytes.length) break;

      const uriBytes = bytes.slice(pos, pos + pushLength);
      try {
        const uri = uriBytes.toString('utf8').trim();
        // Per BCMR spec: accept all non-empty URIs (protocol-less URIs assume HTTPS)
        if (uri.length > 0) {
          uris.push(uri);
        }
      } catch (e) {
        // Invalid UTF-8, skip this URI
      }

      pos += pushLength;
    }

    return { hash, uris };
  } catch (error) {
    console.error('Error parsing BCMR bytecode:', error);
    return null;
  }
}

/**
 * Filter to keep only the first BCMR output per transaction
 */
function filterFirstOutputOnly(outputs: BCMROutput[]): BCMROutput[] {
  const txMap = new Map<string, BCMROutput>();

  for (const output of outputs) {
    const txHash = stripHexPrefix(output.transaction_hash);
    const existing = txMap.get(txHash);
    const currentIndex = parseInt(String(output.output_index));
    const existingIndex = existing ? parseInt(String(existing.output_index)) : Infinity;

    if (!existing || currentIndex < existingIndex) {
      txMap.set(txHash, output);
    }
  }

  return Array.from(txMap.values());
}

/**
 * Check if an output is burned (is OP_RETURN at output index 0)
 */
function isOutputBurned(output: BCMROutput): boolean {
  // An identity is burned if the authhead transaction's output 0 is OP_RETURN
  // For simplicity, we check if this output is at index 0 and is OP_RETURN
  const outputIndex = parseInt(String(output.output_index));
  return outputIndex === 0;
}

/**
 * Resolve authchain to find the current authhead
 * Follows the chain of transactions spending output 0 until an unspent output is found
 *
 * @param authbaseTxid - Starting transaction hash (authbase)
 * @returns Object containing authhead txid, chain length, and whether it's active
 */
async function resolveAuthchain(authbaseTxid: string): Promise<{
  authhead: string;
  chainLength: number;
  isActive: boolean;
}> {
  let currentTxid = authbaseTxid;
  let chainLength = 1;
  const maxChainLength = 1000; // Safety limit to prevent infinite loops

  try {
    while (chainLength < maxChainLength) {
      // Check if output 0 of current transaction is spent
      const spendingTxid = await getOutputSpendingTx(currentTxid, 0);

      if (spendingTxid === null) {
        // Output 0 is unspent - this is the authhead
        return {
          authhead: currentTxid,
          chainLength,
          isActive: true,
        };
      }

      // Output 0 is spent, follow the chain
      currentTxid = spendingTxid;
      chainLength++;
    }

    // Hit max chain length
    console.warn(`Warning: Authchain exceeded maximum length of ${maxChainLength} for ${authbaseTxid}`);
    return {
      authhead: currentTxid,
      chainLength,
      isActive: false,
    };
  } catch (error) {
    // Return the current position with isActive=false to indicate error
    return {
      authhead: currentTxid,
      chainLength,
      isActive: false,
    };
  }
}

/**
 * Fetch all BCMR registries from Chaingraph
 */
export async function getBCMRRegistries(): Promise<BCMRRegistry[]> {
  try {
    const CHAINGRAPH_URL = process.env.CHAINGRAPH_URL || '';

    if (!CHAINGRAPH_URL) {
      throw new Error('CHAINGRAPH_URL environment variable is not set');
    }

    const response = await fetch(CHAINGRAPH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: BCMR_QUERY,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chaingraph request failed: ${response.status}`);
    }

    const data = await response.json() as {
      data?: { search_output_prefix?: BCMROutput[] };
      errors?: Array<{ message: string }>;
    };

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const outputs: BCMROutput[] = data.data?.search_output_prefix || [];

    // Filter to keep only first BCMR output per transaction
    const validOutputs = filterFirstOutputOnly(outputs);

    // Parse and build registry list
    const registries: BCMRRegistry[] = [];

    console.log(`Resolving authchains for ${validOutputs.length} registries...`);

    for (let i = 0; i < validOutputs.length; i++) {
      const output = validOutputs[i];

      // Progress indicator every 100 registries
      if ((i + 1) % 100 === 0) {
        console.log(`  Resolving authchains... ${i + 1}/${validOutputs.length}`);
      }

      const parsed = parseBCMRBytecode(output.locking_bytecode);

      if (!parsed) {
        // Failed to parse, skip
        continue;
      }

      // Strip hex prefix from transaction hash
      const txHash = stripHexPrefix(output.transaction_hash);

      // Resolve authchain to find the true authhead
      const authchainResult = await resolveAuthchain(txHash);

      // Get block height (if confirmed) - convert string to number
      const blockHeight = output.transaction.block_inclusions[0]?.block.height
        ? parseInt(String(output.transaction.block_inclusions[0].block.height))
        : 0;

      // Check if output is burned (OP_RETURN at index 0)
      const isBurned = isOutputBurned(output);

      registries.push({
        authbase: txHash,
        authhead: authchainResult.authhead,
        tokenId: txHash,
        blockHeight,
        hash: parsed.hash,
        uris: parsed.uris,
        isBurned,
        isValid: parsed.uris.length > 0, // Valid if has at least one URI
        authchainLength: authchainResult.chainLength,
        isAuthheadUnspent: authchainResult.isActive,
      });
    }

    console.log(`Authchain resolution complete.`);

    // Sort by block height (newest first)
    registries.sort((a, b) => b.blockHeight - a.blockHeight);

    return registries;
  } catch (error) {
    console.error('Error fetching BCMR registries:', error);
    throw error;
  }
}

/**
 * Normalize URI to a clickable HTTP(S) URL
 * - ipfs:// URIs are converted to IPFS gateway URLs
 * - URIs without protocol are assumed to be HTTPS per BCMR spec
 * - http:// and https:// URIs are kept as-is
 */
export function normalizeUri(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    const hash = uri.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${hash}`;
  }

  // If URI already has a protocol, keep it as-is
  if (uri.startsWith('https://') || uri.startsWith('http://')) {
    return uri;
  }

  // Per BCMR spec: URIs without protocol prefix assume HTTPS
  return `https://${uri}`;
}

/**
 * Legacy alias for backward compatibility
 */
export function ipfsToGateway(uri: string): string {
  return normalizeUri(uri);
}
