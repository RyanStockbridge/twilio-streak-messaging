#!/bin/bash

# Script to create a Twilio conversation with optional message backfill
# Usage: ./create-conversation.sh YOUR_API_KEY [--backfill] [--limit 200]

API_KEY=$1
PHONE_NUMBER="+15415300865"
TWILIO_NUMBER="+13235434797"
BACKFILL="false"
BACKFILL_LIMIT="100"

# Shift past the API key
shift

# Parse optional arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --backfill)
      BACKFILL="true"
      shift
      ;;
    --limit)
      BACKFILL_LIMIT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -z "$API_KEY" ]; then
  echo "Usage: ./create-conversation.sh YOUR_API_KEY [--backfill] [--limit 200]"
  echo ""
  echo "Options:"
  echo "  --backfill        Backfill historical SMS messages into the conversation"
  echo "  --limit NUM       Number of messages to backfill (default: 100)"
  echo ""
  echo "To get your API key from Chrome extension:"
  echo "1. Open Chrome DevTools on the extension side panel"
  echo "2. Run in Console: chrome.storage.local.get(['apiKey'], (r) => console.log(r.apiKey))"
  echo "3. Copy the API key and run this script again"
  echo ""
  echo "Examples:"
  echo "  ./create-conversation.sh YOUR_KEY"
  echo "  ./create-conversation.sh YOUR_KEY --backfill"
  echo "  ./create-conversation.sh YOUR_KEY --backfill --limit 200"
  exit 1
fi

echo "Creating conversation between $PHONE_NUMBER and $TWILIO_NUMBER..."
if [ "$BACKFILL" = "true" ]; then
  echo "Will backfill up to $BACKFILL_LIMIT messages..."
fi

curl -X POST https://twilio-streak-messaging.vercel.app/api/conversations/create \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{
    \"phoneNumber\": \"$PHONE_NUMBER\",
    \"twilioNumber\": \"$TWILIO_NUMBER\",
    \"friendlyName\": \"$PHONE_NUMBER\",
    \"backfill\": $BACKFILL,
    \"backfillLimit\": $BACKFILL_LIMIT
  }"

echo ""
