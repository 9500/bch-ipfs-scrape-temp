#!/usr/bin/env node
/**
 * BCMR Registry Tool
 * Console application to resolve, export, and fetch Bitcoin Cash Metadata Registries
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, statSync } from 'fs';
import { getBCMRRegistries, fetchAndValidateRegistry } from './lib/bcmr.js';
import { closeConnectionPool } from './lib/fulcrum-client.js';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { createHash } from 'crypto';
import { execSync, spawn } from 'child_process';

// Load environment variables
dotenv.config();

/**
 * Registry entry in authhead.json (active registries only)
 */
interface AuthheadRegistry {
  tokenId: string;
  authbase: string;
  authhead: string;
  blockHeight: number;
  hash: string;
  uris: string[];
  authchainLength: number;
  isActive: boolean;
  isBurned: boolean;
  isValid: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  authchainResolve: boolean;
  export: string | null;
  exportBcmrIpfsCids: boolean;
  exportCashtokenIpfsCids: boolean;
  fetchJson: boolean;
  ipfsPin: boolean;
  authheadFile: string;
  exportFile: string;
  cidsFile: string;
  cashtokenCidsFile: string;
  ipfsPinCidsFile: string | null;
  ipfsPinConcurrency: number;
  jsonFolder: string;
  maxFileSizeMB: number;
  ipfsPinTimeout: number;
  useCache: boolean;
  clearCache: boolean;
  verbose: boolean;
  concurrency: number;
  showHelp: boolean;
} {
  const args = process.argv.slice(2);
  let authchainResolve = false;
  let exportProtocols: string | null = null;
  let exportBcmrIpfsCids = false;
  let exportCashtokenIpfsCids = false;
  let fetchJson = false;
  let ipfsPin = false;
  let authheadFile = './authhead.json';
  let exportFile = 'exported-urls.txt';
  let cidsFile = 'bcmr-ipfs-cids.txt';
  let cashtokenCidsFile = 'cashtoken-ipfs-cids.txt';
  let ipfsPinCidsFile: string | null = null; // null = pin both files by default
  let ipfsPinConcurrency = 5; // Default: 5 concurrent pins
  let jsonFolder = './bcmr-registries';
  let maxFileSizeMB = 50; // Default: 50MB
  let ipfsPinTimeout = 5; // Default: 5 seconds
  let useCache = true;
  let clearCache = false;
  let verbose = false;
  let concurrency = 50;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--authchain-resolve') {
      authchainResolve = true;
    } else if (arg === '--export') {
      exportProtocols = args[i + 1];
      if (!exportProtocols) {
        console.error('Error: --export requires protocol list (IPFS, HTTPS, OTHER, ALL)');
        process.exit(1);
      }
      i++;
    } else if (arg === '--fetch-json') {
      fetchJson = true;
    } else if (arg === '--export-bcmr-ipfs-cids') {
      exportBcmrIpfsCids = true;
    } else if (arg === '--export-cashtoken-ipfs-cids') {
      exportCashtokenIpfsCids = true;
    } else if (arg === '--ipfs-pin') {
      ipfsPin = true;
    } else if (arg === '--authhead-file') {
      authheadFile = args[i + 1];
      if (!authheadFile) {
        console.error('Error: --authhead-file requires a path');
        process.exit(1);
      }
      i++;
    } else if (arg === '--export-file') {
      exportFile = args[i + 1];
      if (!exportFile) {
        console.error('Error: --export-file requires a filename');
        process.exit(1);
      }
      i++;
    } else if (arg === '--cids-file') {
      cidsFile = args[i + 1];
      if (!cidsFile) {
        console.error('Error: --cids-file requires a filename');
        process.exit(1);
      }
      i++;
    } else if (arg === '--cashtoken-cids-file') {
      cashtokenCidsFile = args[i + 1];
      if (!cashtokenCidsFile) {
        console.error('Error: --cashtoken-cids-file requires a filename');
        process.exit(1);
      }
      i++;
    } else if (arg === '--ipfs-pin-file') {
      ipfsPinCidsFile = args[i + 1];
      if (!ipfsPinCidsFile) {
        console.error('Error: --ipfs-pin-file requires a filename');
        process.exit(1);
      }
      i++;
    } else if (arg === '--ipfs-pin-timeout') {
      const timeoutValue = parseInt(args[i + 1]);
      if (isNaN(timeoutValue) || timeoutValue < 1 || timeoutValue > 600) {
        console.error('Error: --ipfs-pin-timeout must be a number between 1 and 600 seconds');
        process.exit(1);
      }
      ipfsPinTimeout = timeoutValue;
      i++;
    } else if (arg === '--ipfs-pin-concurrency') {
      const concurrencyValue = parseInt(args[i + 1]);
      if (isNaN(concurrencyValue) || concurrencyValue < 1 || concurrencyValue > 200) {
        console.error('Error: --ipfs-pin-concurrency must be a number between 1 and 200');
        process.exit(1);
      }
      ipfsPinConcurrency = concurrencyValue;
      i++;
    } else if (arg === '--json-folder') {
      jsonFolder = args[i + 1];
      if (!jsonFolder) {
        console.error('Error: --json-folder requires a path');
        process.exit(1);
      }
      i++;
    } else if (arg === '--no-cache') {
      useCache = false;
    } else if (arg === '--clear-cache') {
      clearCache = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--concurrency' || arg === '-c') {
      const concurrencyValue = parseInt(args[i + 1]);
      if (isNaN(concurrencyValue) || concurrencyValue < 1 || concurrencyValue > 200) {
        console.error('Error: --concurrency must be a number between 1 and 200');
        process.exit(1);
      }
      concurrency = concurrencyValue;
      i++;
    } else if (arg === '--max-file-size-mb') {
      const maxSizeValue = parseInt(args[i + 1]);
      if (isNaN(maxSizeValue) || maxSizeValue < 1 || maxSizeValue > 1000) {
        console.error('Error: --max-file-size-mb must be a number between 1 and 1000');
        process.exit(1);
      }
      maxFileSizeMB = maxSizeValue;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else {
      console.error(`Error: Unknown argument "${arg}"`);
      printUsage();
      process.exit(1);
    }
  }

  return {
    authchainResolve,
    export: exportProtocols,
    exportBcmrIpfsCids,
    exportCashtokenIpfsCids,
    fetchJson,
    ipfsPin,
    authheadFile,
    exportFile,
    cidsFile,
    cashtokenCidsFile,
    ipfsPinCidsFile,
    ipfsPinConcurrency,
    jsonFolder,
    maxFileSizeMB,
    ipfsPinTimeout,
    useCache,
    clearCache,
    verbose,
    concurrency,
    showHelp,
  };
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
BCMR Registry Tool

Usage: npm start [command] [options]

Commands:
  --authchain-resolve           Resolve authchains and save to authhead.json
  --export <protocols>          Export URLs from authhead.json (IPFS, HTTPS, OTHER, ALL)
  --export-bcmr-ipfs-cids       Export IPFS CIDs from authhead.json (deduplicated, sorted)
  --export-cashtoken-ipfs-cids  Extract IPFS CIDs from BCMR JSON files (deduplicated, sorted)
  --fetch-json                  Fetch BCMR JSON files from authhead.json
  --ipfs-pin                    Pin IPFS CIDs from both default files using local IPFS daemon
                                (uses cache to skip already-pinned CIDs)

Options:
  --authhead-file <path>        Path to authhead.json (default: ./authhead.json)
  --export-file <filename>      Export output filename (default: exported-urls.txt)
  --cids-file <filename>        BCMR CIDs output filename (default: bcmr-ipfs-cids.txt)
  --cashtoken-cids-file <file>  Cashtoken CIDs output filename (default: cashtoken-ipfs-cids.txt)
  --ipfs-pin-file <filename>    CIDs file to pin (default: both bcmr-ipfs-cids.txt and cashtoken-ipfs-cids.txt)
  --ipfs-pin-timeout <seconds>  Timeout per CID in seconds (1-600, default: 5)
  --ipfs-pin-concurrency <num>  Parallel pin concurrency (1-200, default: 5)
  --json-folder <path>          Folder for cache and BCMR JSON (default: ./bcmr-registries)
  --max-file-size-mb <num>      Max JSON file size in MB (1-1000, default: 50)
  --no-cache                    Disable authchain caching (force full resolution)
  --clear-cache                 Delete cache before running
  --concurrency, -c <num>       Parallel query concurrency (1-200, default: 50)
  --verbose, -v                 Enable verbose logging for detailed diagnostics
  --help, -h                    Show this help message

Workflow Examples:

  1. Resolve authchains (creates authhead.json):
     npm start -- --authchain-resolve

  2. Export IPFS URLs from authhead.json:
     npm start -- --export IPFS

  3. Export multiple protocol types:
     npm start -- --export IPFS,HTTPS --export-file all-urls.txt

  4. Export IPFS CIDs from authhead.json (deduplicated and sorted):
     npm start -- --export-bcmr-ipfs-cids

  5. Extract IPFS CIDs from BCMR JSON files:
     npm start -- --export-cashtoken-ipfs-cids

  6. Fetch BCMR JSON files:
     npm start -- --fetch-json

  7. Pin IPFS CIDs using local IPFS daemon (pins from both CID files by default):
     npm start -- --ipfs-pin
     npm start -- --ipfs-pin --ipfs-pin-file bcmr-ipfs-cids.txt  # pin only BCMR CIDs
     npm start -- --ipfs-pin --ipfs-pin-timeout 10

  8. Combined workflow (export and pin):
     npm start -- --export-bcmr-ipfs-cids --export-cashtoken-ipfs-cids --ipfs-pin

  9. Combined workflow (all in one):
     npm start -- --authchain-resolve --fetch-json --export-bcmr-ipfs-cids --export-cashtoken-ipfs-cids --ipfs-pin

  10. Custom authhead.json location:
      npm start -- --authchain-resolve --authhead-file ./data/authhead.json
      npm start -- --export IPFS --authhead-file ./data/authhead.json

Protocol Filters:
  IPFS   - IPFS URIs (ipfs://)
  HTTPS  - HTTP and HTTPS URIs (http://, https://)
  OTHER  - Other protocols (dweb://, etc.)
  ALL    - All URIs regardless of protocol

Environment Variables:
  CHAINGRAPH_URL    GraphQL endpoint for Chaingraph (required)
  FULCRUM_WS_URL    Fulcrum WebSocket endpoint for authchain resolution (required)

Notes:
  Adjust --concurrency (1-200) to balance server load.
  Use --verbose to see detailed cache hit/miss information per registry.
`);
}

/**
 * Load authhead.json file
 */
function loadAuthheadFile(authheadFile: string): AuthheadRegistry[] {
  if (!existsSync(authheadFile)) {
    console.error(`Error: ${authheadFile} not found. Run with --authchain-resolve first.`);
    process.exit(1);
  }

  try {
    const fileContent = readFileSync(authheadFile, 'utf-8');
    const data = sanitizeJSON(JSON.parse(fileContent));

    // Validate structure
    if (!Array.isArray(data)) {
      console.error(`Error: Invalid ${authheadFile} format (expected array). Please run --authchain-resolve again.`);
      process.exit(1);
    }

    // Basic validation of entries
    for (const entry of data) {
      if (!entry.tokenId || !entry.uris || !Array.isArray(entry.uris)) {
        console.error(`Error: Invalid ${authheadFile} format (missing required fields). Please run --authchain-resolve again.`);
        process.exit(1);
      }
    }

    return data as AuthheadRegistry[];
  } catch (error) {
    console.error(`Error: Failed to read ${authheadFile}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Classify URL protocol
 */
function classifyUrlProtocol(url: string): 'IPFS' | 'HTTPS' | 'OTHER' {
  if (url.startsWith('ipfs://')) {
    return 'IPFS';
  } else if (url.startsWith('https://') || url.startsWith('http://')) {
    return 'HTTPS';
  } else {
    return 'OTHER';
  }
}

/**
 * Parse protocols filter string
 */
function parseProtocolsFilter(protocolsStr: string): Set<'IPFS' | 'HTTPS' | 'OTHER' | 'ALL'> {
  const protocols = protocolsStr.split(',').map((p) => p.trim().toUpperCase());
  const validProtocols: Set<'IPFS' | 'HTTPS' | 'OTHER' | 'ALL'> = new Set();

  for (const protocol of protocols) {
    if (protocol === 'IPFS' || protocol === 'HTTPS' || protocol === 'OTHER' || protocol === 'ALL') {
      validProtocols.add(protocol as 'IPFS' | 'HTTPS' | 'OTHER' | 'ALL');
    } else {
      console.error(`Error: Unknown protocol '${protocol}'. Valid: IPFS, HTTPS, OTHER, ALL`);
      process.exit(1);
    }
  }

  if (validProtocols.size === 0) {
    console.error('Error: --export requires at least one protocol (IPFS, HTTPS, OTHER, ALL)');
    process.exit(1);
  }

  return validProtocols;
}

/**
 * Sanitize tokenId to prevent path traversal attacks
 * TokenIds should be 64-character hex strings (transaction hashes)
 * @throws Error if tokenId is invalid
 */
function sanitizeTokenId(tokenId: string): string {
  // Only allow 64-character hex strings (SHA-256 transaction hashes)
  if (!/^[a-fA-F0-9]{64}$/.test(tokenId)) {
    throw new Error(`Invalid tokenId format: ${tokenId.substring(0, 20)}...`);
  }
  return tokenId;
}

/**
 * Sanitize parsed JSON to prevent prototype pollution
 * Removes dangerous keys like __proto__, constructor, prototype
 * SECURITY: Prevents prototype pollution attacks from malicious JSON
 */
function sanitizeJSON(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeJSON);
  }

  // Remove dangerous keys
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
  for (const key of dangerousKeys) {
    delete obj[key];
  }

  // Recursively sanitize nested objects
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (dangerousKeys.includes(key)) {
        delete obj[key];
      } else {
        obj[key] = sanitizeJSON(obj[key]);
      }
    }
  }

  return obj;
}

/**
 * Validate if a string is a valid IPFS CID (v0 or v1)
 * CIDv0: Qm[base58]{44} (exactly 46 chars)
 * CIDv1: [multibase-prefix][encoded-content] (e.g., b=base32, z=base58)
 * SECURITY: Uses bounded quantifiers to prevent ReDoS attacks
 */
function isValidIPFSCID(cid: string): boolean {
  // Remove any whitespace
  cid = cid.trim();

  // Check for empty string
  if (!cid || cid.length === 0) {
    return false;
  }

  // CIDv0: Qm[base58]{44}
  if (cid.startsWith('Qm')) {
    return (
      cid.length === 46 &&
      /^Qm[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(cid)
    );
  }

  // Length check to prevent ReDoS attacks (CIDv1 typically 46-100 chars)
  if (cid.length > 200) {
    return false;
  }

  // CIDv1: [multibase-prefix][encoded-content]
  const cidv1Pattern = /^[bzBZmM][a-zA-Z0-9]{1,199}$/;
  if (cidv1Pattern.test(cid)) {
    const prefix = cid[0];
    const content = cid.slice(1);

    // Base32 variants (b, B)
    if (prefix === 'b' || prefix === 'B') {
      return /^[a-z0-9]{1,199}$/.test(content) || /^[A-Z0-9]{1,199}$/.test(content);
    }

    // Base58 variants (z, Z)
    if (prefix === 'z' || prefix === 'Z') {
      return /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,199}$/.test(content);
    }

    // Base64/Base64url (m, M)
    if (prefix === 'm' || prefix === 'M') {
      return /^[A-Za-z0-9+/=\-_]{1,199}$/.test(content);
    }

    return true; // Valid multibase prefix with valid characters
  }

  return false;
}

/**
 * Extract CID from ipfs:// URL (removes path components)
 * Example: ipfs://Qm.../path/file.json -> Qm...
 */
function extractCIDFromURL(url: string): string | null {
  try {
    // Handle ipfs:// scheme
    if (url.startsWith('ipfs://')) {
      const cidPart = url.substring(7).split('/')[0];
      return cidPart.length > 0 ? cidPart : null;
    }
  } catch {
    // URL parsing failed
  }

  return null;
}

/**
 * Command: Resolve authchains and save to authhead.json
 */
async function doAuthchainResolve(options: {
  authheadFile: string;
  jsonFolder: string;
  useCache: boolean;
  clearCache: boolean;
  verbose: boolean;
  concurrency: number;
}): Promise<void> {
  const { authheadFile, jsonFolder, useCache, clearCache, verbose, concurrency } = options;

  console.log('Fetching BCMR registries from Chaingraph...');
  const registries = await getBCMRRegistries({
    useCache,
    cachePath: join(jsonFolder, '.authchain-cache.json'),
    verbose,
    concurrency,
  });

  console.log(`\nFound ${registries.length} total registries`);

  // Filter to active registries only (non-burned, valid, authhead unspent)
  const activeRegistries = registries.filter(
    (r) => !r.isBurned && r.isValid && r.isAuthheadUnspent
  );

  console.log(`Active registries (non-burned, valid, authhead unspent): ${activeRegistries.length}`);

  // Convert to authhead.json format
  const authheadData: AuthheadRegistry[] = activeRegistries.map((r) => ({
    tokenId: r.tokenId,
    authbase: r.authbase,
    authhead: r.authhead,
    blockHeight: r.blockHeight,
    hash: r.hash,
    uris: r.uris,
    authchainLength: r.authchainLength,
    isActive: r.isAuthheadUnspent,
    isBurned: r.isBurned,
    isValid: r.isValid,
  }));

  // Save to authhead.json
  const jsonContent = JSON.stringify(authheadData, null, 2);
  writeFileSync(authheadFile, jsonContent, 'utf-8');

  console.log(`\n✓ Saved ${activeRegistries.length} active registries to ${authheadFile}`);
}

/**
 * Command: Export URLs from authhead.json
 */
async function doExport(options: {
  authheadFile: string;
  exportFile: string;
  protocols: string;
}): Promise<void> {
  const { authheadFile, exportFile, protocols } = options;

  // Load authhead.json
  console.log(`Reading ${authheadFile}...`);
  const registries = loadAuthheadFile(authheadFile);

  // Parse protocol filter
  const protocolsFilter = parseProtocolsFilter(protocols);

  // Extract and filter URLs
  const urls: string[] = [];
  for (const registry of registries) {
    for (const uri of registry.uris) {
      const protocol = classifyUrlProtocol(uri);

      // Check if protocol matches filter
      if (protocolsFilter.has('ALL') || protocolsFilter.has(protocol)) {
        urls.push(uri);
      }
    }
  }

  if (urls.length === 0) {
    console.log('No URLs found matching the specified protocols.');
    return;
  }

  // Count by protocol for statistics
  const ipfsCount = urls.filter((u) => classifyUrlProtocol(u) === 'IPFS').length;
  const httpsCount = urls.filter((u) => classifyUrlProtocol(u) === 'HTTPS').length;
  const otherCount = urls.filter((u) => classifyUrlProtocol(u) === 'OTHER').length;

  // Save to file (one URL per line)
  const txtOutput = urls.join('\n');
  writeFileSync(exportFile, txtOutput, 'utf-8');

  console.log(`\n✓ Exported ${urls.length} URLs to ${exportFile}`);
  console.log(`  IPFS: ${ipfsCount}, HTTPS: ${httpsCount}, OTHER: ${otherCount}`);
}

/**
 * Command: Export IPFS CIDs only from authhead.json
 */
async function doExportIPFSCIDs(options: {
  authheadFile: string;
  cidsFile: string;
}): Promise<void> {
  const { authheadFile, cidsFile } = options;

  // Load authhead.json
  console.log(`Reading ${authheadFile}...`);
  const registries = loadAuthheadFile(authheadFile);

  // Extract IPFS CIDs
  const cids: string[] = [];
  let invalidCount = 0;

  for (const registry of registries) {
    for (const uri of registry.uris) {
      // Only process IPFS URLs
      if (classifyUrlProtocol(uri) === 'IPFS') {
        // Extract CID from URL (removes path components)
        const cid = extractCIDFromURL(uri);

        if (cid) {
          // Validate CID
          if (isValidIPFSCID(cid)) {
            cids.push(cid);
          } else {
            console.warn(`Warning: Invalid CID format in URL: ${uri}`);
            invalidCount++;
          }
        } else {
          console.warn(`Warning: Failed to extract CID from URL: ${uri}`);
          invalidCount++;
        }
      }
    }
  }

  if (cids.length === 0) {
    console.log('No valid IPFS CIDs found.');
    return;
  }

  // Deduplicate CIDs
  const uniqueCids = Array.from(new Set(cids));

  // Sort alphabetically (case-sensitive)
  uniqueCids.sort();

  // Save to file (one CID per line)
  const txtOutput = uniqueCids.join('\n');
  writeFileSync(cidsFile, txtOutput, 'utf-8');

  console.log(`\n✓ Exported ${uniqueCids.length} unique IPFS CIDs to ${cidsFile}`);
  console.log(`  Total CIDs found: ${cids.length}`);
  console.log(`  Unique CIDs: ${uniqueCids.length}`);
  console.log(`  Duplicates removed: ${cids.length - uniqueCids.length}`);
  if (invalidCount > 0) {
    console.log(`  Invalid CIDs skipped: ${invalidCount}`);
  }
}

/**
 * Recursively extract IPFS CIDs from a JSON structure
 * Traverses all strings, arrays, and objects looking for ipfs:// URIs
 * SECURITY: Includes depth limiting and circular reference detection
 */
function extractIPFSCIDsFromJSON(
  json: any,
  cids: Set<string>,
  depth: number = 0,
  visited: WeakSet<object> = new WeakSet()
): void {
  // Depth limit to prevent stack overflow
  if (depth > 100) {
    console.warn('Maximum recursion depth (100) reached, skipping deeper structures');
    return;
  }

  if (typeof json === 'string') {
    // Limit string length to prevent memory issues
    if (json.length > 10000) {
      return;
    }

    // Check if string starts with ipfs://
    if (json.startsWith('ipfs://')) {
      const cid = extractCIDFromURL(json);
      if (cid && isValidIPFSCID(cid)) {
        cids.add(cid);
      }
    }
  } else if (Array.isArray(json)) {
    // Limit array size to prevent memory/CPU exhaustion
    if (json.length > 10000) {
      console.warn(`Array too large (${json.length} items), skipping`);
      return;
    }

    // Traverse array elements
    for (const item of json) {
      extractIPFSCIDsFromJSON(item, cids, depth + 1, visited);
    }
  } else if (typeof json === 'object' && json !== null) {
    // Prevent circular references
    if (visited.has(json)) {
      return;
    }
    visited.add(json);

    // Limit object size to prevent memory/CPU exhaustion
    const keys = Object.keys(json);
    if (keys.length > 10000) {
      console.warn(`Object too large (${keys.length} keys), skipping`);
      return;
    }

    // Traverse object properties
    for (const value of Object.values(json)) {
      extractIPFSCIDsFromJSON(value, cids, depth + 1, visited);
    }
  }
}

/**
 * Command: Extract IPFS CIDs from BCMR JSON files in a folder
 */
async function doExportCashtokenIPFSCIDs(options: {
  jsonFolder: string;
  cashtokenCidsFile: string;
  maxFileSizeMB: number;
}): Promise<void> {
  const { jsonFolder, cashtokenCidsFile, maxFileSizeMB } = options;

  // Check if folder exists
  if (!existsSync(jsonFolder)) {
    console.error(`Error: Folder not found: ${jsonFolder}`);
    console.error('Please run --fetch-json first to download BCMR JSON files.');
    process.exit(1);
  }

  console.log(`Reading BCMR JSON files from ${jsonFolder}...`);

  // Read all .json files from folder (excluding cache files)
  const { readdirSync } = await import('fs');
  const files = readdirSync(jsonFolder).filter(
    (f) => f.endsWith('.json') && !f.startsWith('.')
  );

  if (files.length === 0) {
    console.log('No JSON files found in folder.');
    console.log('Please run --fetch-json first to download BCMR JSON files.');
    return;
  }

  console.log(`Found ${files.length} JSON files to process`);

  const allCids = new Set<string>();
  let processedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const filePath = join(jsonFolder, file);

    try {
      // Check file size before reading (security: prevent memory exhaustion)
      const stats = statSync(filePath);
      const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;
      if (stats.size > maxFileSizeBytes) {
        console.warn(`Warning: File ${file} too large (${(stats.size / 1024 / 1024).toFixed(2)}MB > ${maxFileSizeMB}MB), skipping`);
        errorCount++;
        continue;
      }

      const fileContent = readFileSync(filePath, 'utf-8');
      const json = sanitizeJSON(JSON.parse(fileContent));

      // Recursively extract IPFS CIDs from the JSON
      extractIPFSCIDsFromJSON(json, allCids);
      processedCount++;

      // Show progress every 500 files
      if (processedCount % 500 === 0) {
        console.log(`  Processed ${processedCount}/${files.length} files...`);
      }
    } catch (error) {
      errorCount++;
      console.warn(`Warning: Failed to process ${file}:`, error instanceof Error ? error.message : error);
    }
  }

  if (allCids.size === 0) {
    console.log('\nNo IPFS CIDs found in BCMR JSON files.');
    return;
  }

  // Convert to array, sort alphabetically
  const uniqueCids = Array.from(allCids).sort();

  // Save to file (one CID per line)
  const txtOutput = uniqueCids.join('\n');
  writeFileSync(cashtokenCidsFile, txtOutput, 'utf-8');

  console.log(`\n✓ Extracted ${uniqueCids.length} unique IPFS CIDs from BCMR JSON files`);
  console.log(`  Files processed: ${processedCount}`);
  console.log(`  Files with errors: ${errorCount}`);
  console.log(`  Output file: ${cashtokenCidsFile}`);
}

/**
 * Command: Pin IPFS CIDs using local IPFS daemon
 */
async function doIPFSPin(options: {
  cidsFile: string | null;
  verbose: boolean;
  concurrency: number;
  timeout: number;
}): Promise<void> {
  const { cidsFile, verbose, concurrency, timeout } = options;

  // Check if ipfs command exists
  console.log('Checking IPFS CLI availability...');
  try {
    execSync('which ipfs', { stdio: 'ignore' });
  } catch (error) {
    console.error('Error: ipfs command not found');
    console.error('Please install IPFS CLI:');
    console.error('  - https://docs.ipfs.tech/install/command-line/');
    console.error('  - Or run: brew install ipfs (macOS) or apt install ipfs (Linux)');
    process.exit(1);
  }

  // Check if IPFS daemon is running
  try {
    execSync('ipfs id', { stdio: 'ignore', timeout: 5000 });
  } catch (error) {
    console.error('Error: IPFS daemon not running');
    console.error('Please start IPFS daemon in another terminal:');
    console.error('  ipfs daemon');
    process.exit(1);
  }

  // Determine which files to pin
  const defaultFiles = ['bcmr-ipfs-cids.txt', 'cashtoken-ipfs-cids.txt'];
  const filesToPin = cidsFile ? [cidsFile] : defaultFiles;

  if (cidsFile === null) {
    console.log('Pinning from both default CID files...');
  }

  // Load pin cache
  const pinCacheFile = './bcmr-registries/.ipfs-pin-cache.json';
  let pinnedCidsCache = new Set<string>();

  if (existsSync(pinCacheFile)) {
    try {
      const cacheContent = readFileSync(pinCacheFile, 'utf-8');
      const cacheData = JSON.parse(cacheContent);
      if (Array.isArray(cacheData.pinnedCids)) {
        pinnedCidsCache = new Set(cacheData.pinnedCids);
        console.log(`Loaded pin cache: ${pinnedCidsCache.size} previously pinned CIDs`);
      }
    } catch (error) {
      console.warn('Warning: Failed to load pin cache, will rebuild from scratch');
    }
  }

  // Track newly pinned CIDs across all files
  const newlyPinnedCids = new Set<string>();

  // Process each file
  for (const file of filesToPin) {
    // Check if CID file exists
    if (!existsSync(file)) {
      if (cidsFile) {
        // If user specified a file, it's an error
        console.error(`Error: ${file} not found.`);
        console.error('Please run one of these commands first:');
        console.error('  npm start -- --export-bcmr-ipfs-cids');
        console.error('  npm start -- --export-cashtoken-ipfs-cids');
        process.exit(1);
      } else {
        // If using defaults, just skip missing files
        console.log(`Skipping ${file} (not found)`);
        continue;
      }
    }

    // Read and parse CIDs from file
    console.log(`\nReading IPFS CIDs from ${file}...`);
    const fileContent = readFileSync(file, 'utf-8');
    const allCids = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (allCids.length === 0) {
      console.log(`No CIDs found in ${file}.`);
      continue;
    }

    // Filter out already cached CIDs
    const cids = allCids.filter(cid => !pinnedCidsCache.has(cid));
    const cachedCount = allCids.length - cids.length;

    console.log(`Found ${allCids.length} CIDs in ${file}`);
    if (cachedCount > 0) {
      console.log(`  ${cachedCount} already pinned (cached), ${cids.length} to pin`);
    }

    if (cids.length === 0) {
      console.log('All CIDs already pinned (from cache), skipping IPFS operations...');
      // Show summary for fully-cached file
      console.log(`\n✓ IPFS pinning complete for ${file} (all from cache)`);
      console.log(`  Newly pinned: 0`);
      console.log(`  Already pinned: ${cachedCount} (${cachedCount} from cache)`);
      console.log(`  Failed: 0`);
      console.log(`  Total: ${allCids.length}`);
      continue;
    }

    // Pin CIDs with parallel processing
    let pinnedCount = 0;
    let alreadyPinnedCount = 0;
    let failedCount = 0;
    const startTime = Date.now();

    // Process CIDs in batches with concurrency control
    const processBatch = async (batch: string[]): Promise<void> => {
      const results = await Promise.all(
        batch.map(async (cid) => {
          try {
            return await new Promise<{ cid: string; success: boolean; alreadyPinned: boolean }>((resolve, reject) => {
              const controller = new AbortController();
              const proc = spawn('ipfs', ['pin', 'add', cid], {
                timeout: timeout * 1000,  // Convert seconds to milliseconds
                signal: controller.signal
              });

              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (data) => { stdout += data; });
              proc.stderr.on('data', (data) => { stderr += data; });

              proc.on('close', (code) => {
                if (code === 0 || stdout.includes('recursive')) {
                  // Check if already pinned
                  const alreadyPinned = stdout.includes('already') || stderr.includes('already');
                  resolve({ cid, success: true, alreadyPinned });
                } else {
                  reject(new Error(stderr.trim() || 'Unknown error'));
                }
              });

              proc.on('error', (err) => {
                if (err.name === 'AbortError') {
                  reject(new Error(`Timeout after ${timeout}s`));
                } else {
                  reject(err);
                }
              });
            });
          } catch (error) {
            return {
              cid,
              success: false,
              alreadyPinned: false,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        })
      );

      // Update counters and log failures
      for (const result of results) {
        if (result.success) {
          // Add to cache for successfully pinned CIDs
          newlyPinnedCids.add(result.cid);

          if (result.alreadyPinned) {
            alreadyPinnedCount++;
            if (verbose) {
              console.log(`  ${result.cid.substring(0, 12)}... already pinned`);
            }
          } else {
            pinnedCount++;
            if (verbose) {
              console.log(`  ${result.cid.substring(0, 12)}... pinned`);
            }
          }
        } else {
          failedCount++;
          const errorMsg = 'error' in result ? result.error : 'Unknown error';
          console.warn(`Warning: Failed to pin ${result.cid.substring(0, 12)}...: ${errorMsg}`);
        }
      }
    };

    // Process CIDs in batches
    for (let i = 0; i < cids.length; i += concurrency) {
      const batch = cids.slice(i, Math.min(i + concurrency, cids.length));
      await processBatch(batch);

      // Progress reporting
      const processed = Math.min(i + concurrency, cids.length);
      if (processed % 50 === 0 || processed === cids.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((processed / (Date.now() - startTime)) * 1000).toFixed(1);
        console.log(`  Pinning CIDs... ${processed}/${cids.length} (${elapsed}s, ${rate} CIDs/s)`);
      }
    }

    // Summary report for this file
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalAlreadyPinned = cachedCount + alreadyPinnedCount;

    console.log(`\n✓ IPFS pinning complete for ${file} in ${elapsed}s`);
    console.log(`  Newly pinned: ${pinnedCount}`);
    if (cachedCount > 0) {
      console.log(`  Already pinned: ${totalAlreadyPinned} (${cachedCount} from cache)`);
    } else {
      console.log(`  Already pinned: ${alreadyPinnedCount}`);
    }
    console.log(`  Failed: ${failedCount}`);
    console.log(`  Total: ${allCids.length}`);
  }

  // Save updated pin cache
  if (newlyPinnedCids.size > 0) {
    try {
      // Merge new pins with existing cache
      const allPinnedCids = new Set([...pinnedCidsCache, ...newlyPinnedCids]);
      const cacheData = {
        pinnedCids: Array.from(allPinnedCids).sort(),
        lastUpdated: new Date().toISOString(),
        totalCount: allPinnedCids.size,
      };

      // Ensure folder exists
      const cacheDir = pinCacheFile.substring(0, pinCacheFile.lastIndexOf('/'));
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      writeFileSync(pinCacheFile, JSON.stringify(cacheData, null, 2), 'utf-8');
      console.log(`\n✓ Saved pin cache: ${allPinnedCids.size} total pinned CIDs (${newlyPinnedCids.size} newly added)`);
    } catch (error) {
      console.warn('Warning: Failed to save pin cache:', error);
    }
  }
}

/**
 * Command: Fetch BCMR JSON files from authhead.json
 */
async function doFetchJson(options: {
  authheadFile: string;
  jsonFolder: string;
}): Promise<void> {
  const { authheadFile, jsonFolder } = options;

  // Load authhead.json
  console.log(`Reading ${authheadFile}...`);
  const registries = loadAuthheadFile(authheadFile);

  // Create JSON folder if needed
  try {
    mkdirSync(jsonFolder, { recursive: true });
  } catch (error) {
    console.error(`Failed to create folder ${jsonFolder}:`, error);
    throw error;
  }

  console.log(`\nFetching BCMR JSON files (this may take a while)...`);

  let fetchedCount = 0;
  let validCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < registries.length; i++) {
    const registry = registries[i];

    // Show progress
    if ((i + 1) % 50 === 0) {
      console.log(`  Processing... ${i + 1}/${registries.length}`);
    }

    // SECURITY: Sanitize tokenId to prevent path traversal attacks
    let safeTokenId: string;
    try {
      safeTokenId = sanitizeTokenId(registry.tokenId);
    } catch (error) {
      console.warn(`Skipping registry with invalid tokenId format: ${error instanceof Error ? error.message : error}`);
      failedCount++;
      continue;
    }

    const jsonPath = join(jsonFolder, `${safeTokenId}.json`);
    let registryJson = null;

    // Check if file already exists locally
    if (existsSync(jsonPath)) {
      try {
        const fileContent = readFileSync(jsonPath, 'utf-8');
        const computedHash = createHash('sha256').update(fileContent).digest('hex');

        if (computedHash === registry.hash) {
          // Hash matches, use existing file (skip network fetch)
          registryJson = sanitizeJSON(JSON.parse(fileContent));
          skippedCount++;
        } else {
          // Hash mismatch, file is outdated or corrupted
          console.warn(`Hash mismatch for ${safeTokenId}, refetching...`);
        }
      } catch (error) {
        // File exists but can't read/parse, will fetch from network
        console.warn(`Error reading local file for ${safeTokenId}, refetching...`);
      }
    }

    // If not found locally or hash mismatch, fetch from network
    if (!registryJson) {
      try {
        const fetchResult = await fetchAndValidateRegistry(registry.uris, registry.hash);

        if (fetchResult) {
          // Save the raw JSON content (preserves exact formatting and hash)
          writeFileSync(jsonPath, fetchResult.rawContent, 'utf-8');
          registryJson = fetchResult.json;
          fetchedCount++;
          validCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        failedCount++;
      }
    } else {
      validCount++;
    }
  }

  console.log(`\n✓ BCMR JSON summary:`);
  console.log(`  Fetched from network: ${fetchedCount}`);
  console.log(`  Used local cache: ${skippedCount}`);
  console.log(`  Total valid: ${validCount}`);
  console.log(`  Failed: ${failedCount}`);
  console.log(`  Saved to: ${jsonFolder}/`);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    const args = parseArgs();

    // Show help if requested or no commands specified
    if (args.showHelp || (!args.authchainResolve && !args.export && !args.exportBcmrIpfsCids && !args.exportCashtokenIpfsCids && !args.fetchJson && !args.ipfsPin)) {
      printUsage();
      process.exit(0);
    }

    // Check for required environment variables (only for commands that need them)
    if (args.authchainResolve) {
      if (!process.env.CHAINGRAPH_URL) {
        console.error('Error: CHAINGRAPH_URL environment variable is not set');
        console.error('Please create a .env file with CHAINGRAPH_URL=<your-chaingraph-url>');
        process.exit(1);
      }

      if (!process.env.FULCRUM_WS_URL) {
        console.error('Error: FULCRUM_WS_URL environment variable is not set');
        console.error('Please add FULCRUM_WS_URL=<your-fulcrum-ws-url> to .env file');
        process.exit(1);
      }
    }

    // Handle cache clearing (only for authchain-resolve)
    if (args.clearCache && args.authchainResolve) {
      const cachePath = join(args.jsonFolder, '.authchain-cache.json');
      try {
        if (existsSync(cachePath)) {
          unlinkSync(cachePath);
          console.log('Authchain cache cleared');
        } else {
          console.log('No cache file to clear');
        }
      } catch (error) {
        console.warn(`Failed to clear cache: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Execute commands in order: resolve -> fetch -> export -> pin
    if (args.authchainResolve) {
      await doAuthchainResolve({
        authheadFile: args.authheadFile,
        jsonFolder: args.jsonFolder,
        useCache: args.useCache,
        clearCache: args.clearCache,
        verbose: args.verbose,
        concurrency: args.concurrency,
      });
    }

    if (args.fetchJson) {
      await doFetchJson({
        authheadFile: args.authheadFile,
        jsonFolder: args.jsonFolder,
      });
    }

    if (args.export) {
      await doExport({
        authheadFile: args.authheadFile,
        exportFile: args.exportFile,
        protocols: args.export,
      });
    }

    if (args.exportBcmrIpfsCids) {
      await doExportIPFSCIDs({
        authheadFile: args.authheadFile,
        cidsFile: args.cidsFile,
      });
    }

    if (args.exportCashtokenIpfsCids) {
      await doExportCashtokenIPFSCIDs({
        jsonFolder: args.jsonFolder,
        cashtokenCidsFile: args.cashtokenCidsFile,
        maxFileSizeMB: args.maxFileSizeMB,
      });
    }

    if (args.ipfsPin) {
      await doIPFSPin({
        cidsFile: args.ipfsPinCidsFile,
        verbose: args.verbose,
        concurrency: args.ipfsPinConcurrency,
        timeout: args.ipfsPinTimeout,
      });
    }

    // Clean up: close WebSocket connection pool
    await closeConnectionPool();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);

    // Clean up: close WebSocket connection pool
    await closeConnectionPool();

    process.exit(1);
  }
}

// Run the main function
main();
