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
   ```

   Or via the Vercel dashboard:
   - Go to your project settings
   - Navigate to "Environment Variables"
   - Add each variable for Production, Preview, and Development

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

## Twilio Setup Requirements

Your Twilio account needs to be configured with:

1. **Conversations API** enabled
2. **A phone number** configured for messaging
3. **Conversations** created for each contact you want to message

To create conversations programmatically, you can use the Twilio Console or API. Each conversation should have:
- A participant for your Twilio number
- A participant for the customer's phone number

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
