# Twilio Streak Messaging Chrome Extension

A Chrome extension that integrates Twilio conversations with Streak CRM, allowing your team to manage text message threads directly from their browser with proper access controls based on Streak assignments.

## Features

- Chrome side panel for easy access to message threads
- Streak CRM integration with permission verification
- Contact name lookup from Streak
- View incoming and outgoing Twilio messages
- Send replies directly from the extension
- Local caching for better performance
- Direct links to Streak boxes for each contact

## Project Structure

```
twilio-streak-messaging/
├── backend/           # Next.js API backend (deployed to Vercel)
│   ├── app/
│   │   └── api/
│   │       ├── conversations/
│   │       ├── messages/
│   │       └── send-message/
│   ├── package.json
│   └── next.config.js
│
└── extension/         # Chrome extension
    ├── manifest.json
    ├── sidepanel.html
    ├── app.js
    ├── styles.css
    ├── background.js
    └── icons/
```

## Setup Instructions

### Part 1: Deploy the Backend to Vercel

1. **Navigate to the backend folder:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create a Vercel account** if you don't have one:
   - Go to https://vercel.com
   - Sign up with your GitHub account

4. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

5. **Deploy to Vercel:**
   ```bash
   vercel
   ```

   Follow the prompts:
   - Set up and deploy? **Y**
   - Which scope? Select your account
   - Link to existing project? **N**
   - Project name? (press enter for default)
   - In which directory is your code located? **.**
   - Want to override settings? **N**

6. **Add environment variables to Vercel:**

   Either via the CLI:
   ```bash
   vercel env add TWILIO_ACCOUNT_SID
   vercel env add TWILIO_AUTH_TOKEN
   vercel env add TWILIO_PHONE_NUMBER
   vercel env add API_SECRET_KEY
   vercel env add ZAPIER_WEBHOOK_URL  # Optional: for forwarding to Zapier
   ```

   Or via the Vercel dashboard:
   - Go to your project settings
   - Navigate to "Environment Variables"
   - Add each variable for Production, Preview, and Development

   **Optional Zapier Integration:**
   - If you have an existing Zapier webhook that should continue to receive SMS data, add:
   - `ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/YOUR_HOOK_ID`
   - The webhook will forward all incoming SMS to Zapier while also creating conversations

7. **Redeploy to apply environment variables:**
   ```bash
   vercel --prod
   ```

8. **Note your deployment URL** (e.g., `https://your-app.vercel.app`)
   - You'll need this for the Chrome extension setup

### Part 2: Install the Chrome Extension

1. **Navigate to the extension folder:**
   ```bash
   cd ../extension
   ```

2. **Add icons (optional but recommended):**
   - Create or download icons in PNG format:
     - `icons/icon16.png` (16x16 pixels)
     - `icons/icon48.png` (48x48 pixels)
     - `icons/icon128.png` (128x128 pixels)
   - See `extension/icons/README.md` for more details

3. **Load the extension in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `extension` folder
   - The extension icon should appear in your Chrome toolbar

### Part 3: Configure the Extension

1. **Click the extension icon** in your Chrome toolbar

2. **Enter your credentials:**
   - **Streak Email**: Your email address registered with Streak
   - **Streak API Key**: Get this from https://www.streak.com/api/
   - **Backend API URL**: Your Vercel deployment URL (e.g., `https://your-app.vercel.app`)
   - **API Key**: The API_SECRET_KEY you set in Vercel (optional but recommended)

3. **Click Login**
   - The extension will verify your Streak access
   - If successful, you'll see the conversation list

## How It Works

### Authentication Flow

1. User enters their Streak email and API key
2. Extension calls Streak API to verify team membership
3. Only users with Owner or Member roles can access the extension
4. Credentials are stored locally in Chrome's storage

### Conversation Loading

1. Extension fetches all Twilio conversations from your backend
2. For each conversation, it extracts the phone number
3. Extension searches Streak for contacts matching that phone number
4. Contact names and box links are displayed in the UI
5. Results are cached locally for performance

### Message Flow

1. User selects a conversation from the list
2. Extension fetches messages for that conversation
3. Messages are displayed with timestamps
4. User can type and send replies
5. Sent messages are attributed to their Streak email

## API Endpoints

### GET /api/conversations
Fetches all Twilio conversations with optional phone number filtering.

**Query Parameters:**
- `phoneNumbers` (optional): Comma-separated phone numbers
- `limit` (optional): Number of conversations to fetch (default: 50, max: 100)

**Response:**
```json
{
  "conversations": [...],
  "count": 10
}
```

### GET /api/messages
Fetches messages for a specific conversation.

**Query Parameters:**
- `conversationSid` (required): Twilio conversation SID

**Response:**
```json
{
  "messages": [...],
  "count": 15
}
```

### POST /api/send-message
Sends a message in a conversation.

**Body:**
```json
{
  "conversationSid": "CHxxxx",
  "message": "Your message",
  "author": "user@example.com"
}
```

### POST /api/webhook/sms
**NEW:** Webhook endpoint for incoming SMS that automatically creates conversations.

This endpoint handles incoming SMS from Twilio and ensures messages are added to conversations automatically.

**Incoming SMS (Twilio Webhook):**
- Set this as your Twilio phone number's webhook URL
- Twilio will POST form data when SMS arrives
- Automatically finds or creates a conversation for the sender
- Adds the message to the conversation

**Setup in Twilio:**
1. Go to your Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click on your phone number
3. Scroll to "Messaging Configuration"
4. Set "A MESSAGE COMES IN" webhook to: `https://your-backend.vercel.app/api/webhook/sms`
5. Method: POST
6. Save

### PUT /api/webhook/sms
Send outbound SMS via automation (e.g., ActiveCampaign).

**Body:**
```json
{
  "to": "+1234567890",
  "from": "+1987654321",
  "message": "Your message text",
  "author": "automation@example.com"
}
```

**Headers:**
- `x-api-key`: Your API_SECRET_KEY (for security)

**Response:**
```json
{
  "success": true,
  "conversationSid": "CHxxxx",
  "message": { ... }
}
```

**ActiveCampaign Setup:**
1. In your automation, add a "Webhook" action
2. URL: `https://your-backend.vercel.app/api/webhook/sms`
3. Method: PUT
4. Headers: Add `x-api-key` with your API_SECRET_KEY
5. Body (JSON):
```json
{
  "to": "%PHONE%",
  "from": "YOUR_TWILIO_NUMBER",
  "message": "Your automated message",
  "author": "ActiveCampaign"
}
```

## Twilio Setup Requirements

Your Twilio account needs to be configured with:

1. **Conversations API** enabled
2. **A phone number** configured for messaging
3. **(Optional) Messaging Service** - recommended for better conversation management

### Auto-Creating Conversations

With the new webhook endpoint, conversations are **automatically created** when:
- Someone sends an SMS to your Twilio number (incoming)
- Your ActiveCampaign automation sends an SMS (outgoing)

**Setup Steps:**
1. Deploy the backend with the webhook endpoint
2. Configure your Twilio phone number to use the webhook (see [POST /api/webhook/sms](#post-apiwebhooksms))
3. Messages will now automatically be organized into conversations by phone number

**How it works:**
- First message to/from a phone number creates a new conversation
- Subsequent messages are added to the existing conversation
- Each conversation has participants for both your Twilio number and the customer's number
- Conversation friendly name: "SMS with +1234567890"

## Security Considerations

- **API Key**: Always use the API_SECRET_KEY in production to prevent unauthorized access
- **Streak API Key**: Stored locally in Chrome storage (encrypted by Chrome)
- **Twilio Credentials**: Never exposed to the client, only stored on Vercel
- **CORS**: Configure `next.config.js` to restrict API access to your extension only

## Troubleshooting

### Extension won't load conversations
- Check that your backend URL is correct (no trailing slash)
- Verify your Vercel deployment is running: visit the URL in your browser
- Check the browser console (F12) for error messages
- Verify your Twilio credentials in Vercel environment variables

### "Unable to verify Streak access"
- Confirm your Streak API key is correct
- Verify your email matches your Streak account
- Ensure you have Owner or Member role in at least one team

### Messages not sending
- Check Vercel logs for errors: `vercel logs`
- Verify your Twilio credentials are correct
- Ensure the conversation exists in Twilio
- Check that your Twilio number has SMS capability

### Contact names not showing
- Verify the phone numbers exist in Streak
- Check that contacts are properly linked to boxes
- Try the search API directly: `https://api.streak.com/api/v1/search?query={phone}`

## Future Enhancements

Potential features to add:

- [ ] Real-time message updates (webhooks + WebSocket)
- [ ] Filter conversations by Streak box assignment
- [ ] Rich media support (images, attachments)
- [ ] Message templates
- [ ] Conversation archiving
- [ ] Multi-agent support with conversation assignment
- [ ] Message notifications
- [ ] Search functionality
- [ ] Bulk messaging
- [ ] Analytics dashboard

## Development

### Local Development

**Backend:**
```bash
cd backend
npm install
npm run dev
# Server runs on http://localhost:3000
```

**Extension:**
1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Reload the extension to see changes

### Testing

Test the backend API with curl:

```bash
# Test conversations endpoint
curl https://your-backend.vercel.app/api/conversations \
  -H "x-api-key: your_secret_key"

# Test messages endpoint
curl "https://your-backend.vercel.app/api/messages?conversationSid=CHxxxx" \
  -H "x-api-key: your_secret_key"

# Test send message
curl -X POST https://your-backend.vercel.app/api/send-message \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_secret_key" \
  -d '{"conversationSid":"CHxxxx","message":"Test","author":"test@example.com"}'
```

## Support

For issues or questions:
1. Check the console logs (F12 in Chrome)
2. Review Vercel deployment logs
3. Verify all credentials are correct
4. Check Twilio and Streak API documentation

## License

MIT License - feel free to modify and use for your agency's needs.
