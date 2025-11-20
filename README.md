# BCMR Registry Tool

A Node.js console application for resolving, exporting, and fetching Bitcoin Cash Metadata Registry (BCMR) data from the blockchain with full authchain resolution.

## What is BCMR?

BCMR (Bitcoin Cash Metadata Registry) is a specification for publishing on-chain metadata about Bitcoin Cash tokens and identities. This tool queries the blockchain via Chaingraph to find all BCMR announcements, resolves authchains to find the current registry state, and provides commands to export URLs and fetch registry JSON files.

## Features

### Core Functionality
- **Resolves authchains** via Chaingraph GraphQL and Fulcrum Electrum protocol
  - Follows spending chain from authbase to authhead
  - Identifies active vs superseded registries
  - Tracks chain length and validation status
  - **Intelligent caching** reduces subsequent runs from minutes to seconds
- **Exports URLs** from resolved registries with protocol filtering
  - IPFS, HTTPS (includes HTTP), OTHER protocols
  - Supports multiple protocol combinations
- **Fetches and validates registry JSON** from IPFS and HTTPS
  - SHA-256 hash validation against on-chain data
  - Structure validation (must have `identities` object)
  - Retry logic with exponential backoff
  - Local caching to avoid redundant network fetches

### Authchain Caching
- **Automatic caching** of authchain resolution results
- **Inactive chains cached permanently** (~50% of registries never need revalidation)
- **Active chains revalidated efficiently** (single query to check if still unspent)
- **Atomic cache updates** prevent corruption from interruptions
- **Cache stored** in `bcmr-registries/.authchain-cache.json`
- **Performance improvement:** 75% reduction in queries on subsequent runs

### Performance Optimizations
- **WebSocket connection pooling** maintains 10 persistent connections to Fulcrum
- **Parallel query processing** with configurable concurrency (default: 50)
- **Request queuing** automatically manages connection reuse
- **~10-20x performance improvement** over sequential processing

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
├── authhead.json                 # Resolved active registries (with --authchain-resolve)
├── exported-urls.txt             # Exported URLs (with --export)
├── bcmr-ipfs-cids.txt            # Exported IPFS CIDs (with --export-bcmr-ipfs-cids)
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

**Note**: Both CHAINGRAPH_URL and FULCRUM_WS_URL are required for authchain resolution.

## Usage

### Build the project

```bash
npm run build
```

### Run the application

Show help:

```bash
npm start
```

## Commands

### 1. Resolve Authchains

Fetch BCMR data from Chaingraph, resolve authchains, and save active registries to `authhead.json`:

```bash
npm start -- --authchain-resolve
```

**Options:**
- `--authhead-file <path>` - Custom output file (default: `./authhead.json`)
- `--json-folder <path>` - Folder for cache (default: `./bcmr-registries`)
- `--no-cache` - Disable authchain caching (force full resolution)
- `--clear-cache` - Delete cache before running
- `--concurrency <num>` - Parallel query concurrency (1-200, default: 50)
- `--verbose` - Enable verbose logging

**Example:**
```bash
npm start -- --authchain-resolve --verbose --concurrency 100
```

**Output:** `authhead.json` containing all active registries (non-burned, valid URIs, authhead unspent)

### 2. Export URLs

Export URLs from `authhead.json` with protocol filtering:

```bash
npm start -- --export <protocols>
```

**Protocol Filters:**
- `IPFS` - IPFS URIs (`ipfs://`)
- `HTTPS` - HTTP and HTTPS URIs (`http://`, `https://`)
- `OTHER` - Other protocols (`dweb://`, etc.)
- `ALL` - All URIs regardless of protocol

**Options:**
- `--authhead-file <path>` - Path to authhead.json (default: `./authhead.json`)
- `--export-file <filename>` - Output filename (default: `exported-urls.txt`)

**Examples:**
```bash
# Export IPFS URLs only
npm start -- --export IPFS

# Export IPFS and HTTPS URLs
npm start -- --export IPFS,HTTPS --export-file all-urls.txt

# Export all URLs
npm start -- --export ALL

# Custom authhead.json location
npm start -- --export IPFS --authhead-file ./data/authhead.json
```

**Output:** Text file with one URL per line

### 3. Export IPFS CIDs Only

Extract and export only IPFS CIDs from `authhead.json` (deduplicated and sorted):

```bash
npm start -- --export-bcmr-ipfs-cids
```

**Features:**
- Extracts CIDs from `ipfs://` URLs (removes path components)
- Validates CID format (CIDv0 and CIDv1)
- Deduplicates CIDs automatically
- Sorts alphabetically
- Logs warnings for invalid CIDs

**Options:**
- `--authhead-file <path>` - Path to authhead.json (default: `./authhead.json`)
- `--cids-file <filename>` - Output filename (default: `bcmr-ipfs-cids.txt`)

**Examples:**
```bash
# Export IPFS CIDs with default filename
npm start -- --export-bcmr-ipfs-cids

# Export to custom file
npm start -- --export-bcmr-ipfs-cids --cids-file my-cids.txt

# Custom authhead.json location
npm start -- --export-bcmr-ipfs-cids --authhead-file ./data/authhead.json
```

**Output:** Text file with one CID per line (deduplicated, sorted)

**Example output:**
```
QmVwdDCY4SPGVFnNCiZnX5CtzwWDn6kAM98JXzKxE3kCmn
bafyreihwqw6lsve7gkorqemerjrl3t5fjxpjdljbndto467zixmstw43aq
zb2rhY3zDDA4RYEHbkwLjVB8v84u7x4Ztda8oVpyVGnQV
```

### 4. Fetch Registry JSON Files

Fetch and validate BCMR JSON files from `authhead.json`:

```bash
npm start -- --fetch-json
```

**Options:**
- `--authhead-file <path>` - Path to authhead.json (default: `./authhead.json`)
- `--json-folder <path>` - Folder to save JSON files (default: `./bcmr-registries`)

**Example:**
```bash
npm start -- --fetch-json --json-folder ./my-registries
```

**Output:** Registry JSON files in specified folder, validated against on-chain hash

### Combined Workflow

Commands can be combined in a single execution:

```bash
# Resolve, export URLs, and fetch in one command
npm start -- --authchain-resolve --export IPFS --fetch-json

# Resolve, export CIDs, and fetch
npm start -- --authchain-resolve --export-bcmr-ipfs-cids --fetch-json

# Export both URLs and CIDs
npm start -- --export IPFS --export-bcmr-ipfs-cids

# Complete workflow: resolve, export URLs, export CIDs, fetch JSONs
npm start -- --authchain-resolve --export IPFS --export-bcmr-ipfs-cids --fetch-json

# With custom options
npm start -- --authchain-resolve --verbose --export IPFS,HTTPS --export-file urls.txt --export-bcmr-ipfs-cids --cids-file cids.txt --fetch-json
```

## Command Reference

| Flag | Description | Default | Used By |
|------|-------------|---------|---------|
| `--authchain-resolve` | Resolve authchains and save to authhead.json | - | Command |
| `--export <protocols>` | Export URLs from authhead.json | - | Command |
| `--export-bcmr-ipfs-cids` | Export IPFS CIDs only (deduplicated, sorted) | - | Command |
| `--fetch-json` | Fetch BCMR JSON files | - | Command |
| `--authhead-file <path>` | Path to authhead.json | `./authhead.json` | All commands |
| `--export-file <filename>` | Export output filename | `exported-urls.txt` | `--export` |
| `--cids-file <filename>` | CIDs output filename | `bcmr-ipfs-cids.txt` | `--export-bcmr-ipfs-cids` |
| `--json-folder <path>` | Folder for cache and BCMR JSON | `./bcmr-registries` | `--authchain-resolve`, `--fetch-json` |
| `--no-cache` | Disable authchain caching | false (cache enabled) | `--authchain-resolve` |
| `--clear-cache` | Delete cache before running | false | `--authchain-resolve` |
| `--concurrency, -c <num>` | Parallel query concurrency (1-200) | 50 | `--authchain-resolve` |
| `--verbose, -v` | Enable verbose logging | false | `--authchain-resolve` |
| `--help, -h` | Show help message | - | All |

## Output Formats

### authhead.json

Array of active registry objects (non-burned, valid, authhead unspent):

```json
[
  {
    "tokenId": "abc123...",
    "authbase": "abc123...",
    "authhead": "def456...",
    "blockHeight": 850000,
    "hash": "sha256hash...",
    "uris": [
      "ipfs://Qm...",
      "https://example.com/bcmr.json"
    ],
    "authchainLength": 2,
    "isActive": true,
    "isBurned": false,
    "isValid": true
  }
]
```

### exported-urls.txt

Plain text with one URL per line:

```
ipfs://QmHash1...
ipfs://QmHash2...
https://example.com/registry.json
```

### bcmr-ipfs-cids.txt

Plain text with one CID per line (deduplicated and sorted alphabetically):

```
QmVwdDCY4SPGVFnNCiZnX5CtzwWDn6kAM98JXzKxE3kCmn
bafyreihwqw6lsve7gkorqemerjrl3t5fjxpjdljbndto467zixmstw43aq
zb2rhY3zDDA4RYEHbkwLjVB8v84u7x4Ztda8oVpyVGnQV
```

**Features:**
- Only IPFS CIDs (extracted from `ipfs://` URLs)
- Paths removed (e.g., `ipfs://Qm.../path/file` → `Qm...`)
- Automatically deduplicated
- Sorted alphabetically (case-sensitive)
- Invalid CIDs skipped with warning

### BCMR JSON Files

Registry JSON files saved in `--json-folder`, named by token ID:
- `{tokenId}.json` - Validated registry JSON with hash verification

## Filtering Rules

`authhead.json` contains **only active registries** that pass:
- ✅ Not burned (`isBurned === false`)
- ✅ Valid (`isValid === true`, has URIs)
- ✅ Active (`isActive === true`, authhead unspent)

## Performance Notes

### Authchain Resolution Performance

**With Caching and Parallel Processing (Default):**
- **First run (cold cache):** ~30-60 seconds for 3000+ registries (with concurrency 50)
  - Performs full authchain resolution for all registries using parallel processing
  - Uses WebSocket connection pool (10 connections) for efficient query execution
  - Builds cache for future runs
- **Subsequent runs (warm cache):** ~20-40 seconds
  - **Perfect hits:** Inactive chains (0 Fulcrum queries)
  - **Good hits:** Active chains still unspent (1 query to verify)
  - **Partial hits:** Active chains with spent authhead (continues from cache)
  - **~75% reduction in Fulcrum queries**
  - **Parallel execution:** 50 concurrent queries by default (configurable 1-200)

**Cache Behavior:**
- **Interruption-safe:** Cache only saved if run completes successfully
- **Automatic:** No manual intervention needed
- **Detailed statistics:** Shows cache hit types, query counts, and performance metrics
- **Cache age tracking:** Displays oldest and newest cache entry timestamps

**Without Caching (`--no-cache`):**
- Every run takes ~30-60 seconds (with parallel processing)
- Useful for testing or when cache corruption suspected

**Adjusting Concurrency:**
- **Lower concurrency (1-20):** Reduces load on Fulcrum server, slower processing
- **Default concurrency (50):** Balanced performance for most use cases
- **Higher concurrency (100-200):** Maximum performance, higher server load
- Connection pool automatically manages 10 persistent WebSocket connections

### Verifying Cache Performance

Use the `--verbose` flag to see per-registry cache diagnostics:

```bash
npm start -- --authchain-resolve --verbose
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

**Example output (second run with warm cache, concurrency 50):**
```
Loaded authchain cache from ./bcmr-registries/.authchain-cache.json
  3124 entries (1543 active, 1581 inactive)
  Cache age: oldest 2.3h, newest 0.1h
Resolving authchains for 3124 registries (concurrency: 50)...
  Resolving authchains... 100/3124 (1.2s, 83.3 reg/s)
  Resolving authchains... 200/3124 (2.4s, 83.3 reg/s)
  ...
  Resolving authchains... 3124/3124 (37.5s, 83.3 reg/s)
Authchain resolution complete in 37.52s (avg 12ms per registry)

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

- **JSON fetching** (`--fetch-json`): Can be slow when fetching from IPFS gateways
- Each registry requires HTTP requests with 2-second timeouts and up to 2 retry attempts
- Locally cached JSON files are verified by hash and reused
- Expect significant time for large datasets when fetching from network
- Progress shown every 50 registries

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

## Workflow Tips

1. **First-time setup:**
   ```bash
   npm start -- --authchain-resolve --verbose
   ```

2. **Regular usage** (resolve and export):
   ```bash
   npm start -- --authchain-resolve --export IPFS
   ```

3. **Fetch JSON for analysis:**
   ```bash
   npm start -- --fetch-json
   ```

4. **Update registries** (uses cache):
   ```bash
   npm start -- --authchain-resolve
   npm start -- --export ALL --export-file all-updated-urls.txt
   ```

5. **Force full rebuild** (ignores cache):
   ```bash
   npm start -- --authchain-resolve --clear-cache --no-cache
   ```

## License

MIT
