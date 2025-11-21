#!/usr/bin/env bash

# pin-cids.sh - Sequential IPFS CID pinning script
# Usage: ./pin-cids.sh <cids-file.txt> [timeout-seconds]

set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if file argument is provided
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No CID file specified${NC}"
    echo "Usage: $0 <cids-file.txt> [timeout-seconds]"
    echo "  timeout-seconds: timeout per CID in seconds (default: 2)"
    exit 1
fi

CIDS_FILE="$1"
TIMEOUT_SECONDS="${2:-2}"  # Default to 2 seconds if not specified

# Check if file exists
if [ ! -f "$CIDS_FILE" ]; then
    echo -e "${RED}Error: File '$CIDS_FILE' not found${NC}"
    exit 1
fi

# Check if ipfs command exists
if ! command -v ipfs &> /dev/null; then
    echo -e "${RED}Error: ipfs command not found${NC}"
    echo "Please install IPFS CLI: https://docs.ipfs.tech/install/command-line/"
    exit 1
fi

# Check if timeout command exists
if ! command -v timeout &> /dev/null; then
    echo -e "${RED}Error: timeout command not found${NC}"
    echo "Please install coreutils package"
    exit 1
fi

# Check if IPFS daemon is running
if ! ipfs id &> /dev/null; then
    echo -e "${RED}Error: IPFS daemon not running${NC}"
    echo "Please start IPFS daemon: ipfs daemon"
    exit 1
fi

# Initialize counters
SUCCESS_COUNT=0
ALREADY_PINNED_COUNT=0
FAILED_COUNT=0
TIMEOUT_COUNT=0
TOTAL_COUNT=0

# Create failed CIDs log file
FAILED_LOG="${CIDS_FILE}-failed.txt"
> "$FAILED_LOG"  # Clear/create the file

# Count total valid lines in file
TOTAL_LINES=0
while IFS= read -r line || [ -n "$line" ]; do
    line=$(echo "$line" | xargs)
    if [ -n "$line" ]; then
        ((TOTAL_LINES++))
    fi
done < "$CIDS_FILE"

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}IPFS Sequential Pinning Script${NC}"
echo -e "${BLUE}======================================${NC}"
echo -e "File: ${YELLOW}$CIDS_FILE${NC}"
echo -e "Total CIDs to process: ${YELLOW}${TOTAL_LINES}${NC}"
echo -e "Timeout per CID: ${YELLOW}${TIMEOUT_SECONDS}s${NC}"
echo -e "Failed CIDs log: ${YELLOW}${FAILED_LOG}${NC}"
echo -e "Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "${BLUE}======================================${NC}\n"

# Read file line by line
while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines
    line=$(echo "$line" | xargs)
    if [ -z "$line" ]; then
        continue
    fi

    # Extract CID (first token, handles "CID name" format)
    CID=$(echo "$line" | awk '{print $1}')

    # Increment total count
    ((TOTAL_COUNT++))

    # Display command being executed
    echo -e "${BLUE}[${TOTAL_COUNT}/${TOTAL_LINES}] Command:${NC} timeout ${TIMEOUT_SECONDS}s ipfs pin add $CID"

    # Execute ipfs pin add with timeout and capture output
    OUTPUT=$(timeout "${TIMEOUT_SECONDS}s" ipfs pin add "$CID" 2>&1)
    EXIT_CODE=$?

    # Check result and display response
    if [ $EXIT_CODE -eq 0 ]; then
        # Check if already pinned
        if echo "$OUTPUT" | grep -q "already"; then
            echo -e "${YELLOW}Response:${NC} $OUTPUT"
            echo -e "${YELLOW}Status: Already pinned${NC}\n"
            ((ALREADY_PINNED_COUNT++))
        else
            echo -e "${GREEN}Response:${NC} $OUTPUT"
            echo -e "${GREEN}Status: Successfully pinned${NC}\n"
            ((SUCCESS_COUNT++))
        fi
    elif [ $EXIT_CODE -eq 124 ]; then
        # Timeout occurred (exit code 124)
        echo -e "${RED}Response:${NC} Command timed out after ${TIMEOUT_SECONDS}s"
        echo -e "${RED}Status: Timeout${NC}\n"
        ((TIMEOUT_COUNT++))
        ((FAILED_COUNT++))
        echo "$CID" >> "$FAILED_LOG"
    else
        # Other error
        echo -e "${RED}Response:${NC} $OUTPUT"
        echo -e "${RED}Status: Failed${NC}\n"
        ((FAILED_COUNT++))
        echo "$CID" >> "$FAILED_LOG"
    fi

done < "$CIDS_FILE"

# Print summary
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}======================================${NC}"
echo -e "Completed: $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "Total CIDs processed: ${TOTAL_COUNT}"
echo -e "${GREEN}Successfully pinned: ${SUCCESS_COUNT}${NC}"
echo -e "${YELLOW}Already pinned: ${ALREADY_PINNED_COUNT}${NC}"
echo -e "${RED}Timeouts: ${TIMEOUT_COUNT}${NC}"
echo -e "${RED}Failed (total): ${FAILED_COUNT}${NC}"
if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "${YELLOW}Failed CIDs logged to: ${FAILED_LOG}${NC}"
fi
echo -e "${BLUE}======================================${NC}"

# Exit with appropriate code
if [ $FAILED_COUNT -gt 0 ]; then
    exit 1
else
    exit 0
fi
