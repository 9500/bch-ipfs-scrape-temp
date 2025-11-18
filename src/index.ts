#!/usr/bin/env node
/**
 * BCMR IPFS Link Extractor
 * Console application to fetch and save IPFS links from Bitcoin Cash Metadata Registries
 */

import { writeFileSync } from 'fs';
import { getBCMRRegistries } from './lib/bcmr.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface IPFSLinkOutput {
  tokenId: string;
  blockHeight: number;
  hash: string;
  ipfsUri: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { format: 'txt' | 'json'; output: string } {
  const args = process.argv.slice(2);
  let format: 'txt' | 'json' = 'txt';
  let output = 'bcmr-ipfs-links.txt';

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
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Error: Unknown argument "${arg}"`);
      printUsage();
      process.exit(1);
    }
  }

  return { format, output };
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
  --help, -h                Show this help message

Examples:
  npm start                                  # Save to bcmr-ipfs-links.txt
  npm start --format json                    # Save as JSON
  npm start --output my-links.txt            # Custom filename
  npm start -f json -o output.json           # JSON with custom filename

Environment Variables:
  CHAINGRAPH_URL    GraphQL endpoint for Chaingraph (required)
`);
}

/**
 * Extract IPFS URIs from registries
 */
function extractIPFSLinks(registries: Awaited<ReturnType<typeof getBCMRRegistries>>): IPFSLinkOutput[] {
  const results: IPFSLinkOutput[] = [];

  for (const registry of registries) {
    // Filter out burned and invalid registries
    if (registry.isBurned || !registry.isValid) {
      continue;
    }

    // Extract only IPFS URIs (exclude HTTPS and other protocols)
    for (const uri of registry.uris) {
      if (uri.startsWith('ipfs://')) {
        results.push({
          tokenId: registry.tokenId,
          blockHeight: registry.blockHeight,
          hash: registry.hash,
          ipfsUri: uri,
        });
      }
    }
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

    const { format, output } = parseArgs();

    console.log('Fetching BCMR registries from Chaingraph...');
    const registries = await getBCMRRegistries();
    console.log(`Found ${registries.length} total registries`);

    console.log('Extracting IPFS links...');
    const ipfsLinks = extractIPFSLinks(registries);
    console.log(`Extracted ${ipfsLinks.length} IPFS links`);

    if (ipfsLinks.length === 0) {
      console.log('No IPFS links found. Nothing to save.');
      return;
    }

    console.log(`Saving to ${output} (format: ${format})...`);

    if (format === 'json') {
      // Save as JSON
      const jsonOutput = JSON.stringify(ipfsLinks, null, 2);
      writeFileSync(output, jsonOutput, 'utf-8');
    } else {
      // Save as plain text (one link per line)
      const txtOutput = ipfsLinks.map(link => link.ipfsUri).join('\n');
      writeFileSync(output, txtOutput, 'utf-8');
    }

    console.log(`✓ Successfully saved ${ipfsLinks.length} IPFS links to ${output}`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the main function
main();
