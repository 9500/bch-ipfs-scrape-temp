# BCH IPFS BCMR Registry Scraping Tool

A Node.js tool for resolving, exporting, and fetching Bitcoin Cash Metadata Registry (BCMR) and NFT data from the blockchain.

## What is BCMR?

BCMR (Bitcoin Cash Metadata Registry) is a specification for publishing on-chain metadata about Bitcoin Cash tokens and identities. This tool queries the blockchain to find BCMR announcements, resolves authchains to find current registry states, and provides commands to export URLs and fetch registry JSON files.

## Quick Start

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/9500/bch-ipfs-scrape.git
   cd bch-ipfs-scrape
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` with your endpoints:**
   ```
   CHAINGRAPH_URL=http://your-chaingraph-server:8088/v1/graphql
   FULCRUM_WS_URL=ws://your-fulcrum-server:50003
   ```

### First Run

```bash
# Build the project
npm run build

# Resolve authchains and create authhead.json
npm start -- --authchain-resolve

# Export IPFS URLs
npm start -- --export IPFS

# Fetch registry JSON files
npm start -- --fetch-json
```

## Features

- **Authchain Resolution** - Follows spending chains from authbase to authhead
- **URL Export** - Extract URLs from registries with protocol filtering (IPFS, HTTPS, OTHER, ALL)
- **JSON Fetching** - Download and validate registry JSON files with hash verification
- **CID Export** - Extract and deduplicate IPFS CIDs from both registry metadata and JSON content (supports ipfs:// URLs and HTTPS gateway URLs)
- **IPFS Pinning** - Pin CIDs from both sources using local IPFS daemon
- **Caching** - Automatically caches authchain resolution to speed up subsequent runs
- **Parallel Processing** - Configurable concurrency for blockchain queries

## Basic Commands

### Resolve Authchains

Fetch BCMR data and resolve authchains:

```bash
npm start -- --authchain-resolve
```

Options:
- `--verbose` - Show detailed logging
- `--concurrency <num>` - Set parallel query limit (default: 50)
- `--no-cache` - Disable caching
- `--clear-cache` - Delete cache before running

### Export URLs

Export URLs with protocol filtering:

```bash
# Export IPFS URLs only
npm start -- --export IPFS

# Export IPFS and HTTPS URLs
npm start -- --export IPFS,HTTPS

# Export all URLs
npm start -- --export ALL
```

### Export IPFS CIDs

Extract only IPFS CIDs (deduplicated and sorted):

```bash
npm start -- --export-bcmr-ipfs-cids
```

This extracts CIDs from:
- `ipfs://` URLs (e.g., `ipfs://QmHash/path`)
- HTTPS gateway URLs in path style (e.g., `https://ipfs.tapswap.cash/ipfs/QmHash/file.json`)
- HTTPS gateway URLs in subdomain style (e.g., `https://QmHash.ipfs.dweb.link/file.json`)
- IPNS URLs are automatically skipped

### Export CashToken IPFS CIDs

Extract IPFS CIDs from BCMR JSON files:

```bash
npm start -- --export-cashtoken-ipfs-cids
```

This recursively scans all BCMR JSON files and extracts CIDs from both `ipfs://` URLs and HTTPS gateway URLs.

### Fetch JSON Files

Download and validate registry JSON files:

```bash
npm start -- --fetch-json
```

### Pin IPFS CIDs

Pin CIDs using local IPFS daemon (uses cache to skip already-pinned CIDs):

```bash
# Pin from both default files (bcmr-ipfs-cids.txt and cashtoken-ipfs-cids.txt)
npm start -- --ipfs-pin

# Pin CIDs from a single file
npm start -- --ipfs-pin --ipfs-pin-file bcmr-ipfs-cids.txt

# Custom timeout and concurrency (defaults: 5s timeout, 5 concurrent pins)
npm start -- --ipfs-pin --ipfs-pin-timeout 10 --ipfs-pin-concurrency 10
```

Bash script alternative for sequential pinning:

```bash
./pin-cids.sh bcmr-ipfs-cids.txt          # 2s timeout
./pin-cids.sh bcmr-ipfs-cids.txt 10       # 10s timeout
```

## Common Workflows

### Complete Workflow (Recommended)

Resolve authchains, fetch JSON, export CIDs, and pin everything to IPFS:

```bash
npm start -- --authchain-resolve --fetch-json --export-bcmr-ipfs-cids --export-cashtoken-ipfs-cids --ipfs-pin
```

This command:
1. Resolves authchains from blockchain data
2. Fetches and validates BCMR JSON files
3. Exports IPFS CIDs from registry metadata
4. Exports IPFS CIDs from JSON file contents
5. Pins all CIDs to local IPFS daemon (automatically skips already-pinned CIDs using cache)

### Update Existing Data

Use caching to quickly update (subsequent runs are much faster):

```bash
npm start -- --authchain-resolve --fetch-json --export-bcmr-ipfs-cids --export-cashtoken-ipfs-cids --ipfs-pin
```

Cached components:
- Authchains (only queries new/changed chains)
- IPFS pins (skips already-pinned CIDs)

### Export and Pin CIDs

Export and pin from both sources (pins both files by default):

```bash
npm start -- --export-bcmr-ipfs-cids --export-cashtoken-ipfs-cids --ipfs-pin
```

Pin from a single file:

```bash
npm start -- --ipfs-pin --ipfs-pin-file bcmr-ipfs-cids.txt
```

### Custom Output Files

```bash
npm start -- --authchain-resolve \
  --export IPFS,HTTPS --export-file all-urls.txt \
  --export-bcmr-ipfs-cids --cids-file my-cids.txt
```

## Output Files

- `authhead.json` - Current registries: active + burned, excludes superseded (created by `--authchain-resolve`)
- `exported-urls.txt` - Exported URLs (created by `--export`)
- `bcmr-ipfs-cids.txt` - Exported IPFS CIDs from authhead.json (created by `--export-bcmr-ipfs-cids`)
- `cashtoken-ipfs-cids.txt` - Exported IPFS CIDs from JSON files (created by `--export-cashtoken-ipfs-cids`)
- `bcmr-registries/*.json` - Downloaded registry JSON files (created by `--fetch-json`)
- `bcmr-registries/.authchain-cache.json` - Authchain cache (auto-generated)
- `bcmr-registries/.ipfs-pin-cache.json` - IPFS pin cache (auto-generated)

## Requirements

- Node.js 18+
- Access to a Chaingraph server (GraphQL endpoint)
- Access to a Fulcrum server (Electrum WebSocket endpoint)
- IPFS daemon (optional, for `--ipfs-pin` command)

## Advanced Usage

For detailed information about caching, output formats, and advanced configuration, see [ADVANCED.md](ADVANCED.md).

## License

[MIT](LICENSE)
