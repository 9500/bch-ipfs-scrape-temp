#!/usr/bin/env node
/**
 * BCMR IPFS Link Extractor
 * Console application to fetch and save IPFS links from Bitcoin Cash Metadata Registries
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { getBCMRRegistries, fetchAndValidateRegistry } from './lib/bcmr.js';
import { closeConnectionPool } from './lib/fulcrum-client.js';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { createHash } from 'crypto';

// Load environment variables
dotenv.config();

interface IPFSLinkOutput {
  tokenId: string;
  blockHeight: number;
  hash: string;
  ipfsUri: string;
  authchainLength?: number;
  isActive?: boolean;
  registryValid?: boolean;
  registryFetched?: boolean;
  jsonPath?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  format: 'txt' | 'json';
  output: string;
  fetchJson: boolean;
  jsonFolder: string;
  useCache: boolean;
  clearCache: boolean;
  verbose: boolean;
  concurrency: number;
} {
  const args = process.argv.slice(2);
  let format: 'txt' | 'json' = 'txt';
  let output = 'bcmr-ipfs-links.txt';
  let fetchJson = false;
  let jsonFolder = './bcmr-registries';
  let useCache = true;
  let clearCache = false;
  let verbose = false;
  let concurrency = 50;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--format' || arg === '-f') {
      const formatValue = args[i + 1]?.toLowerCase();
      if (formatValue === 'json' || formatValue === 'txt') {
        format = formatValue;
        i++;
      } else {
        console.error('Error: --format must be either "txt" or "json"');
        process.exit(1);
      }
    } else if (arg === '--output' || arg === '-o') {
      output = args[i + 1];
      if (!output) {
        console.error('Error: --output requires a filename');
        process.exit(1);
      }
      i++;
    } else if (arg === '--fetch-json') {
      fetchJson = true;
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
      printUsage();
      process.exit(0);
    } else {
      console.error(`Error: Unknown argument "${arg}"`);
      printUsage();
      process.exit(1);
    }
  }

  return { format, output, fetchJson, jsonFolder, useCache, clearCache, verbose, concurrency };
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
BCMR IPFS Link Extractor

Usage: npm start [options]

Options:
  --format, -f <txt|json>   Output format (default: txt)
  --output, -o <filename>   Output filename (default: bcmr-ipfs-links.txt)
  --fetch-json              Fetch and validate registry JSON from URIs
  --json-folder <path>      Folder to save registry JSON files (default: ./bcmr-registries)
  --no-cache                Disable authchain caching (force full resolution)
  --clear-cache             Delete cache before running
  --concurrency, -c <num>   Parallel query concurrency (1-200, default: 50)
  --verbose, -v             Enable verbose logging for detailed diagnostics
  --help, -h                Show this help message

Examples:
  npm start                                   # Save IPFS links only
  npm start --format json                     # Save as JSON with metadata
  npm start --fetch-json                      # Fetch and validate registry JSON
  npm start --fetch-json --json-folder ./data # Custom JSON storage folder
  npm start --output my-links.txt             # Custom output filename
  npm start --no-cache                        # Force full authchain resolution
  npm start --clear-cache                     # Clear cache and rebuild
  npm start --verbose                         # Show per-registry cache diagnostics

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
 * Extract IPFS URIs from registries
 */
async function extractIPFSLinks(
  registries: Awaited<ReturnType<typeof getBCMRRegistries>>,
  fetchJson: boolean,
  jsonFolder: string
): Promise<IPFSLinkOutput[]> {
  const results: IPFSLinkOutput[] = [];

  // Create JSON folder if needed
  if (fetchJson) {
    try {
      mkdirSync(jsonFolder, { recursive: true });
    } catch (error) {
      console.error(`Failed to create folder ${jsonFolder}:`, error);
      throw error;
    }
  }

  let fetchedCount = 0;
  let validCount = 0;
  let failedCount = 0;

  for (let i = 0; i < registries.length; i++) {
    const registry = registries[i];

    // Show progress for JSON fetching
    if (fetchJson && (i + 1) % 50 === 0) {
      console.log(`  Fetching and validating... ${i + 1}/${registries.length}`);
    }

    // Filter out burned, invalid, or inactive registries
    if (registry.isBurned || !registry.isValid || !registry.isAuthheadUnspent) {
      continue;
    }

    // Extract only IPFS URIs (exclude HTTPS and other protocols)
    for (const uri of registry.uris) {
      if (uri.startsWith('ipfs://')) {
        const linkOutput: IPFSLinkOutput = {
          tokenId: registry.tokenId,
          blockHeight: registry.blockHeight,
          hash: registry.hash,
          ipfsUri: uri,
          authchainLength: registry.authchainLength,
          isActive: registry.isAuthheadUnspent,
        };

        // Optionally fetch and validate registry JSON
        if (fetchJson) {
          try {
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
              const fetchResult = await fetchAndValidateRegistry(registry.uris, registry.hash);

              if (fetchResult) {
                // Save the raw JSON content (preserves exact formatting and hash)
                writeFileSync(jsonPath, fetchResult.rawContent, 'utf-8');
                registryJson = fetchResult.json;
              }
            }

            // Update linkOutput based on whether we got valid JSON
            if (registryJson) {
              linkOutput.registryValid = true;
              linkOutput.registryFetched = true;
              linkOutput.jsonPath = jsonPath;
              fetchedCount++;
              validCount++;
            } else {
              linkOutput.registryValid = false;
              linkOutput.registryFetched = false;
              failedCount++;
            }
          } catch (error) {
            linkOutput.registryValid = false;
            linkOutput.registryFetched = false;
            failedCount++;
          }
        }

        results.push(linkOutput);
      }
    }
  }

  if (fetchJson) {
    console.log(
      `\nRegistry JSON summary: Fetched: ${fetchedCount}, Valid: ${validCount}, Failed: ${failedCount}`
    );
  }

  return results;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Check for required environment variables
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

    const { format, output, fetchJson, jsonFolder, useCache, clearCache, verbose, concurrency } = parseArgs();

    // Handle cache clearing
    if (clearCache) {
      const cachePath = join(jsonFolder, '.authchain-cache.json');
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

    console.log('Fetching BCMR registries from Chaingraph...');
    const registries = await getBCMRRegistries({
      useCache,
      cachePath: join(jsonFolder, '.authchain-cache.json'),
      verbose,
      concurrency,
    });
    console.log(`\nFound ${registries.length} total registries`);

    // Show authchain summary
    const activeRegistries = registries.filter((r) => r.isAuthheadUnspent);
    console.log(`Active registries (authhead unspent): ${activeRegistries.length}`);

    console.log('\nExtracting IPFS links...');
    if (fetchJson) {
      console.log(`Fetching and validating registry JSON (this may take a while)...`);
    }

    const ipfsLinks = await extractIPFSLinks(registries, fetchJson, jsonFolder);
    console.log(`Extracted ${ipfsLinks.length} IPFS links from active registries`);

    if (ipfsLinks.length === 0) {
      console.log('No IPFS links found. Nothing to save.');
      return;
    }

    console.log(`\nSaving to ${output} (format: ${format})...`);

    if (format === 'json') {
      // Save as JSON
      const jsonOutput = JSON.stringify(ipfsLinks, null, 2);
      writeFileSync(output, jsonOutput, 'utf-8');
    } else {
      // Save as plain text (one link per line)
      const txtOutput = ipfsLinks.map((link) => link.ipfsUri).join('\n');
      writeFileSync(output, txtOutput, 'utf-8');
    }

    console.log(`✓ Successfully saved ${ipfsLinks.length} IPFS links to ${output}`);

    if (fetchJson) {
      console.log(`✓ Registry JSON files saved to ${jsonFolder}/`);
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
