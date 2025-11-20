#!/usr/bin/env node
/**
 * BCMR Registry Tool
 * Console application to resolve, export, and fetch Bitcoin Cash Metadata Registries
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { getBCMRRegistries, fetchAndValidateRegistry } from './lib/bcmr.js';
import { closeConnectionPool } from './lib/fulcrum-client.js';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { createHash } from 'crypto';

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
  fetchJson: boolean;
  authheadFile: string;
  exportFile: string;
  jsonFolder: string;
  useCache: boolean;
  clearCache: boolean;
  verbose: boolean;
  concurrency: number;
  showHelp: boolean;
} {
  const args = process.argv.slice(2);
  let authchainResolve = false;
  let exportProtocols: string | null = null;
  let fetchJson = false;
  let authheadFile = './authhead.json';
  let exportFile = 'exported-urls.txt';
  let jsonFolder = './bcmr-registries';
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
    fetchJson,
    authheadFile,
    exportFile,
    jsonFolder,
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
  --authchain-resolve       Resolve authchains and save to authhead.json
  --export <protocols>      Export URLs from authhead.json (IPFS, HTTPS, OTHER, ALL)
  --fetch-json              Fetch BCMR JSON files from authhead.json

Options:
  --authhead-file <path>    Path to authhead.json (default: ./authhead.json)
  --export-file <filename>  Export output filename (default: exported-urls.txt)
  --json-folder <path>      Folder for cache and BCMR JSON (default: ./bcmr-registries)
  --no-cache                Disable authchain caching (force full resolution)
  --clear-cache             Delete cache before running
  --concurrency, -c <num>   Parallel query concurrency (1-200, default: 50)
  --verbose, -v             Enable verbose logging for detailed diagnostics
  --help, -h                Show this help message

Workflow Examples:

  1. Resolve authchains (creates authhead.json):
     npm start -- --authchain-resolve

  2. Export IPFS URLs from authhead.json:
     npm start -- --export IPFS

  3. Export multiple protocol types:
     npm start -- --export IPFS,HTTPS --export-file all-urls.txt

  4. Fetch BCMR JSON files:
     npm start -- --fetch-json

  5. Combined workflow (all in one):
     npm start -- --authchain-resolve --export IPFS --fetch-json

  6. Custom authhead.json location:
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

Performance:
  Parallel processing with connection pooling provides ~10-20x speedup.
  First run: ~30-60 seconds (builds cache, concurrency 50)
  Subsequent runs: ~20-40 seconds (uses cache for inactive chains)

  Adjust --concurrency (1-200) to balance performance vs server load.
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
    const data = JSON.parse(fileContent);

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

    const jsonPath = join(jsonFolder, `${registry.tokenId}.json`);
    let registryJson = null;

    // Check if file already exists locally
    if (existsSync(jsonPath)) {
      try {
        const fileContent = readFileSync(jsonPath, 'utf-8');
        const computedHash = createHash('sha256').update(fileContent).digest('hex');

        if (computedHash === registry.hash) {
          // Hash matches, use existing file (skip network fetch)
          registryJson = JSON.parse(fileContent);
          skippedCount++;
        } else {
          // Hash mismatch, file is outdated or corrupted
          console.warn(`Hash mismatch for ${registry.tokenId}, refetching...`);
        }
      } catch (error) {
        // File exists but can't read/parse, will fetch from network
        console.warn(`Error reading local file for ${registry.tokenId}, refetching...`);
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
    if (args.showHelp || (!args.authchainResolve && !args.export && !args.fetchJson)) {
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

    // Execute commands in order: resolve -> export -> fetch
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

    if (args.export) {
      await doExport({
        authheadFile: args.authheadFile,
        exportFile: args.exportFile,
        protocols: args.export,
      });
    }

    if (args.fetchJson) {
      await doFetchJson({
        authheadFile: args.authheadFile,
        jsonFolder: args.jsonFolder,
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
