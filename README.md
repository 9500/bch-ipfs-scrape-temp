# BCMR IPFS Link Extractor & Validator

A Node.js console application that extracts and validates IPFS links from Bitcoin Cash Metadata Registry (BCMR) announcements on the blockchain, with full authchain resolution according to the BCMR specification.

## What is BCMR?

BCMR (Bitcoin Cash Metadata Registry) is a specification for publishing on-chain metadata about Bitcoin Cash tokens and identities. This tool queries the blockchain via Chaingraph to find all BCMR announcements, resolves authchains to find the current registry state, and optionally fetches and validates the registry JSON files.

## Features

### Core Functionality
- **Fetches BCMR registry data** from Chaingraph GraphQL API
- **Parses Bitcoin Script OP_RETURN** outputs to extract metadata
- **Full authchain resolution** via Fulcrum Electrum protocol
  - Follows spending chain from authbase to authhead
  - Identifies active vs superseded registries
  - Tracks chain length and validation status
  - **Intelligent caching** reduces subsequent runs from minutes to seconds
- **Filters registries**:
  - Burned registries (OP_RETURN at output index 0)
  - Invalid registries (no URIs)
  - Inactive registries (authhead output spent)
- **Extracts IPFS URIs** (excludes HTTPS URLs)
- **Supports multiple output formats** (plain text or JSON with metadata)

### Authchain Caching
- **Automatic caching** of authchain resolution results
- **Inactive chains cached permanently** (~50% of registries never need revalidation)
- **Active chains revalidated efficiently** (single query to check if still unspent)
- **Atomic cache updates** prevent corruption from interruptions
- **Cache stored** in `bcmr-registries/.authchain-cache.json`
- **Performance improvement:** 75% reduction in queries on subsequent runs

### Optional JSON Validation (--fetch-json)
- **Fetches registry JSON** from IPFS gateways and HTTPS URIs
- **SHA-256 hash validation** against on-chain data
- **Structure validation** (must have `identities` object)
- **Saves valid JSON files** to specified folder
- **Retry logic** with exponential backoff (2 attempts per URI)
- **2-second timeout** per request
- **Progress reporting** with fetch statistics

## Project Structure

```text
/
├── src/
│   ├── index.ts                  # Main console app entry point
│   └── lib/
│       ├── bcmr.ts               # BCMR parsing, authchain resolution, JSON validation
│       ├── fulcrum-client.ts     # Fulcrum Electrum protocol client
│       └── authchain-cache.ts    # Authchain caching logic
├── bcmr-registries/
│   ├── .authchain-cache.json     # Authchain resolution cache (auto-generated)
│   └── *.json                    # Registry JSON files (with --fetch-json)
├── .env                          # Environment configuration
├── package.json                  # Project dependencies and scripts
└── tsconfig.json                 # TypeScript configuration
```

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

Copy `.env.example` to `.env` and configure both Chaingraph and Fulcrum endpoints:

```bash
cp .env.example .env
```

Edit `.env`:
```
# Chaingraph GraphQL endpoint
CHAINGRAPH_URL=http://your-chaingraph-server:8088/v1/graphql

# Fulcrum WebSocket endpoint for authchain resolution
FULCRUM_WS_URL=ws://your-fulcrum-server:50003
```

**Note**: Both CHAINGRAPH_URL and FULCRUM_WS_URL are required.

## Usage

### Build the project

```bash
npm run build
```

### Run the application

Basic usage (IPFS links only, saves to `bcmr-ipfs-links.txt`):

```bash
npm start
```

### Command-line Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--format` | `-f` | Output format: `txt` or `json` | `txt` |
| `--output` | `-o` | Output filename | `bcmr-ipfs-links.txt` |
| `--fetch-json` | - | Fetch and validate registry JSON files | `false` (disabled) |
| `--json-folder` | - | Folder to save registry JSON files | `./bcmr-registries` |
| `--no-cache` | - | Disable authchain caching (force full resolution) | `false` (cache enabled) |
| `--clear-cache` | - | Delete cache before running | `false` |
| `--verbose` | `-v` | Enable verbose logging for detailed diagnostics | `false` |
| `--help` | `-h` | Show help message | - |

### Examples

**Basic usage** (IPFS links only, no JSON fetching):
```bash
npm start
```

**Save as JSON** with authchain metadata:
```bash
npm start -- --format json
```

**Fetch and validate registry JSON** (saves to `./bcmr-registries/`):
```bash
npm start -- --fetch-json
```

**Custom JSON storage folder**:
```bash
npm start -- --fetch-json --json-folder ./my-registries
```

**Full featured** (JSON format with registry validation):
```bash
npm start -- --format json --fetch-json --output validated-registries.json
```

**Custom output filename**:
```bash
npm start -- --output my-links.txt
```

**Force full authchain resolution** (disable cache):
```bash
npm start -- --no-cache
```

**Clear cache and rebuild**:
```bash
npm start -- --clear-cache
```

**Verbose mode** (detailed cache diagnostics):
```bash
npm start -- --verbose
```

## Output Formats

### Plain Text (`txt`)
One IPFS link per line:
```
ipfs://QmHash1...
ipfs://QmHash2...
ipfs://QmHash3...
```

### JSON Format (`json`)
Array of objects with metadata (includes authchain and optional validation info):
```json
[
  {
    "tokenId": "transaction_hash_1",
    "blockHeight": 850000,
    "hash": "sha256_hash",
    "ipfsUri": "ipfs://QmHash1...",
    "authchainLength": 1,
    "isActive": true,
    "registryValid": true,
    "registryFetched": true,
    "jsonPath": "./bcmr-registries/transaction_hash_1.json"
  },
  {
    "tokenId": "transaction_hash_2",
    "blockHeight": 850001,
    "hash": "sha256_hash",
    "ipfsUri": "ipfs://QmHash2...",
    "authchainLength": 3,
    "isActive": true
  }
]
```

**Fields**:
- `tokenId`: Transaction hash (authbase)
- `blockHeight`: Block height of the authbase transaction
- `hash`: SHA-256 hash from the BCMR OP_RETURN
- `ipfsUri`: IPFS link in `ipfs://` format
- `authchainLength`: Number of transactions in the authchain
- `isActive`: Whether the registry is active (authhead unspent)
- `registryValid`: (if `--fetch-json`) Hash validation result
- `registryFetched`: (if `--fetch-json`) Whether JSON was downloaded
- `jsonPath`: (if `--fetch-json`) Path to saved JSON file

## Filtering Rules

The application applies the following filters:

- ✅ Includes: Valid registries with at least one URI
- ✅ Includes: Only IPFS URIs (`ipfs://` protocol)
- ✅ Includes: Active registries (authhead output 0 unspent)
- ❌ Excludes: Burned registries (OP_RETURN at output index 0)
- ❌ Excludes: Invalid registries (no URIs)
- ❌ Excludes: Inactive registries (authhead output spent/superseded)
- ❌ Excludes: HTTPS and other non-IPFS URLs

## Development

Build and run in development mode:
```bash
npm run dev
```

## Requirements

- **Node.js 18+** (for native `fetch` and `AbortController` support)
- **TypeScript 5+**
- **Access to a Chaingraph server** (GraphQL endpoint)
- **Access to a Fulcrum server** (Electrum WebSocket endpoint)

## Performance Notes

### Authchain Resolution Performance

**With Caching (Default):**
- **First run (cold cache):** ~6-10 minutes for 3000+ registries
  - Performs full authchain resolution for all registries
  - Builds cache for future runs
- **Subsequent runs (warm cache):** ~2-4 minutes
  - **Perfect hits:** Inactive chains (0 Fulcrum queries)
  - **Good hits:** Active chains still unspent (1 query to verify)
  - **Partial hits:** Active chains with spent authhead (continues from cache)
  - **~75% reduction in Fulcrum queries**

**Cache Behavior:**
- **Interruption-safe:** Cache only saved if run completes successfully
- **Automatic:** No manual intervention needed
- **Detailed statistics:** Shows cache hit types, query counts, and performance metrics
- **Cache age tracking:** Displays oldest and newest cache entry timestamps

**Without Caching (`--no-cache`):**
- Every run takes ~6-10 minutes
- Useful for testing or when cache corruption suspected

### Verifying Cache Performance

Use the `--verbose` flag to see per-registry cache diagnostics:

```bash
npm start -- --verbose
```

**Normal output shows:**
- Cache hit/miss breakdown (perfect/good/partial/miss)
- Total Fulcrum queries made
- Average queries per registry
- Estimated query savings
- Performance timing (duration, rate)
- Cache age information

**Verbose output additionally shows:**
- Per-registry cache hit type
- Queries used for each registry
- Real-time processing rate

**Example output (second run with warm cache):**
```
Loaded authchain cache from ./bcmr-registries/.authchain-cache.json
  3124 entries (1543 active, 1581 inactive)
  Cache age: oldest 2.3h, newest 0.1h
Resolving authchains for 3124 registries...
  Resolving authchains... 100/3124 (2.1s, 47.6 reg/s)
  ...
Authchain resolution complete in 65.42s (avg 21ms per registry)

Cache Performance:
  Perfect hits: 1581 (0 queries each)
  Good hits: 1512 (1 query each)
  Partial hits: 28 (continued from cache)
  Misses: 3 (full authchain walk)
  Total: 3121/3124 cached (99.9%)

Fulcrum Query Statistics:
  Total queries: 1587
  Average per registry: 0.51
  Estimated queries saved: 4661 (~74.6% reduction)

Cache saved to ./bcmr-registries/.authchain-cache.json
```

### JSON Fetching Performance

- **JSON fetching** (`--fetch-json`): Can be slow fetching from IPFS gateways
- Each registry requires HTTP requests with 2-second timeouts and up to 2 retry attempts
- Locally cached JSON files are verified by hash and reused
- Expect significant time for large datasets when fetching from network

## License

MIT
