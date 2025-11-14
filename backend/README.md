# Twilio Streak Messaging - Backend API

Next.js API backend for managing Twilio conversations and messages.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your Twilio credentials:
```bash
cp .env.example .env
```

Then edit `.env` with your actual credentials:
```
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
API_SECRET_KEY=your_secret_key_here
```

3. Run development server:
```bash
npm run dev
```

## API Endpoints

### GET /api/conversations
Fetch all Twilio conversations, optionally filtered by phone numbers.

**Query Parameters:**
- `phoneNumbers` (optional): Comma-separated list of phone numbers to filter by

**Headers:**
- `x-api-key`: Your API secret key (if configured)

**Response:**
```json
{
  "conversations": [
    {
      "sid": "CHxxxx",
      "friendlyName": "Conversation Name",
      "dateCreated": "2024-01-01T00:00:00Z",
      "dateUpdated": "2024-01-01T00:00:00Z",
      "state": "active",
      "participants": [
        {
          "sid": "MBxxxx",
          "address": "+15551234567",
          "type": "sms"
        }
      ]
    }
  ],
  "count": 1
}
```

### GET /api/messages
Fetch messages for a specific conversation.

**Query Parameters:**
- `conversationSid` (required): The Twilio conversation SID

**Headers:**
- `x-api-key`: Your API secret key (if configured)

**Response:**
```json
{
  "messages": [
    {
      "sid": "IMxxxx",
      "author": "+15551234567",
      "body": "Hello!",
      "dateCreated": "2024-01-01T00:00:00Z",
      "index": 0,
      "participantSid": "MBxxxx"
    }
  ],
  "count": 1
}
```

### POST /api/send-message
Send a message in a conversation.

**Headers:**
- `x-api-key`: Your API secret key (if configured)
- `Content-Type`: application/json

**Body:**
```json
{
  "conversationSid": "CHxxxx",
  "message": "Your message here",
  "author": "agent@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "sid": "IMxxxx",
    "author": "agent@example.com",
    "body": "Your message here",
    "dateCreated": "2024-01-01T00:00:00Z",
    "index": 5
  }
}
```

## Deployment to Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

3. Add environment variables in Vercel dashboard or via CLI:
```bash
vercel env add TWILIO_ACCOUNT_SID
vercel env add TWILIO_AUTH_TOKEN
vercel env add TWILIO_PHONE_NUMBER
vercel env add API_SECRET_KEY
```

4. Redeploy to apply environment variables:
```bash
vercel --prod
```
