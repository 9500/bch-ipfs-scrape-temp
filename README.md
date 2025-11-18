# BCMR IPFS Link Extractor

A Node.js console application that extracts IPFS links from Bitcoin Cash Metadata Registry (BCMR) announcements on the blockchain.

## What is BCMR?

BCMR (Bitcoin Cash Metadata Registry) is a specification for publishing on-chain metadata about Bitcoin Cash tokens and identities. This tool queries the blockchain via Chaingraph to find all BCMR announcements and extracts the IPFS links they contain.

## Features

- Fetches BCMR registry data from Chaingraph GraphQL API
- Parses Bitcoin Script OP_RETURN outputs to extract metadata
- Filters out burned and invalid registries
- Extracts only IPFS URIs (excludes HTTPS URLs)
- Supports multiple output formats (plain text or JSON)
- Configurable output filename

## Project Structure

```text
/
├── src/
│   ├── index.ts          # Main console app entry point
│   └── lib/
│       └── bcmr.ts       # BCMR parsing and fetching library
├── .env                  # Environment configuration
├── package.json          # Project dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

Copy `.env.example` to `.env` and update the `CHAINGRAPH_URL` with your Chaingraph server endpoint:

```bash
cp .env.example .env
```

Edit `.env`:
```
CHAINGRAPH_URL=http://your-chaingraph-server:8088/v1/graphql
```

## Usage

### Build the project

```bash
npm run build
```

### Run the application

Basic usage (saves to `bcmr-ipfs-links.txt` in plain text format):

```bash
npm start
```

### Command-line Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--format` | `-f` | Output format: `txt` or `json` | `txt` |
| `--output` | `-o` | Output filename | `bcmr-ipfs-links.txt` |
| `--help` | `-h` | Show help message | - |

### Examples

Save as plain text (one IPFS link per line):
```bash
npm start
```

Save as JSON with metadata:
```bash
npm start -- --format json
```

Custom output filename:
```bash
npm start -- --output my-ipfs-links.txt
```

JSON format with custom filename:
```bash
npm start -- -f json -o output.json
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
Array of objects with metadata:
```json
[
  {
    "tokenId": "transaction_hash_1",
    "blockHeight": 850000,
    "hash": "sha256_hash",
    "ipfsUri": "ipfs://QmHash1..."
  },
  {
    "tokenId": "transaction_hash_2",
    "blockHeight": 850001,
    "hash": "sha256_hash",
    "ipfsUri": "ipfs://QmHash2..."
  }
]
```

## Filtering Rules

The application applies the following filters:

- ✅ Includes: Valid registries with at least one URI
- ✅ Includes: Only IPFS URIs (`ipfs://` protocol)
- ❌ Excludes: Burned registries (output index 0)
- ❌ Excludes: Invalid registries (no URIs)
- ❌ Excludes: HTTPS and other non-IPFS URLs

## Development

Build and run in development mode:
```bash
npm run dev
```

## Requirements

- Node.js 18+ (for native `fetch` support)
- TypeScript 5+
- Access to a Chaingraph server

## License

MIT
