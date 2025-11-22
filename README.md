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
- **CID Export** - Extract and deduplicate IPFS CIDs from both registry metadata and JSON content
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

### Export CashToken IPFS CIDs

Extract IPFS CIDs from BCMR JSON files:

```bash
npm start -- --export-cashtoken-ipfs-cids
```

### Fetch JSON Files

Download and validate registry JSON files:

```bash
npm start -- --fetch-json
```

### Pin IPFS CIDs

Pin CIDs using local IPFS daemon:

```bash
# Pin CIDs from default file (bcmr-ipfs-cids.txt)
npm start -- --ipfs-pin

# Pin CIDs from custom file
npm start -- --ipfs-pin --ipfs-pin-file cashtoken-ipfs-cids.txt

# Custom timeout (default: 2 seconds)
npm start -- --ipfs-pin --ipfs-pin-timeout 10
```

Bash script alternative for sequential pinning:

```bash
./pin-cids.sh bcmr-ipfs-cids.txt          # 2s timeout
./pin-cids.sh bcmr-ipfs-cids.txt 10       # 10s timeout
```

## Common Workflows

### Complete Workflow

Resolve, export, and fetch in one command:

```bash
npm start -- --authchain-resolve --export IPFS --export-bcmr-ipfs-cids --fetch-json
```

### Update Existing Data

Use caching to quickly update:

```bash
npm start -- --authchain-resolve --export IPFS
```

### Export and Pin CIDs

```bash
npm start -- --export-bcmr-ipfs-cids --ipfs-pin
```

### Custom Output Files

```bash
npm start -- --authchain-resolve \
  --export IPFS,HTTPS --export-file all-urls.txt \
  --export-bcmr-ipfs-cids --cids-file my-cids.txt
```

## Output Files

- `authhead.json` - Resolved active registries (created by `--authchain-resolve`)
- `exported-urls.txt` - Exported URLs (created by `--export`)
- `bcmr-ipfs-cids.txt` - Exported IPFS CIDs from authhead.json (created by `--export-bcmr-ipfs-cids`)
- `cashtoken-ipfs-cids.txt` - Exported IPFS CIDs from JSON files (created by `--export-cashtoken-ipfs-cids`)
- `bcmr-registries/*.json` - Downloaded registry JSON files (created by `--fetch-json`)
- `bcmr-registries/.authchain-cache.json` - Authchain cache (auto-generated)

## Requirements

- Node.js 18+
- Access to a Chaingraph server (GraphQL endpoint)
- Access to a Fulcrum server (Electrum WebSocket endpoint)
- IPFS daemon (optional, for `--ipfs-pin` command)

## Advanced Usage

For detailed information about caching, output formats, and advanced configuration, see [ADVANCED.md](ADVANCED.md).

## License

[MIT](LICENSE)
