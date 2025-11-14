/**
 * Script to diagnose what messages exist in Conversations vs SMS Messages API
 * This helps understand why backfill isn't finding messages
 *
 * Usage:
 * export TWILIO_ACCOUNT_SID=your_sid
 * export TWILIO_AUTH_TOKEN=your_token
 * node scripts/diagnose-conversations.js
 */

const twilio = require('twilio');

async function diagnoseConversations() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('Error: Missing Twilio credentials in environment variables');
    console.error('Make sure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    console.log('=== DIAGNOSING CONVERSATIONS ===\n');

    // Get all conversations
    const conversations = await client.conversations.v1.conversations.list({ limit: 100 });
    console.log(`Found ${conversations.length} conversations\n`);

    for (const conv of conversations) {
      console.log(`\n📱 Conversation: ${conv.friendlyName || conv.sid}`);
      console.log(`   SID: ${conv.sid}`);
      console.log(`   Created: ${conv.dateCreated}`);

      // Get participants
      const participants = await client.conversations.v1
        .conversations(conv.sid)
        .participants.list();

      console.log(`   Participants (${participants.length}):`);
      participants.forEach(p => {
        console.log(`     - ${p.messagingBinding?.address || p.identity || 'Unknown'} (${p.sid})`);
      });

      // Get messages in this conversation
      const messages = await client.conversations.v1
        .conversations(conv.sid)
        .messages.list({ limit: 100 });

      console.log(`   Messages (${messages.length}):`);

      if (messages.length === 0) {
        console.log('     ⚠️  No messages in this conversation!');
      }

      messages.forEach((msg, idx) => {
        const attrs = msg.attributes ? JSON.parse(msg.attributes) : {};
        const hasMedia = attrs.NumMedia && parseInt(attrs.NumMedia) > 0;

        console.log(`     ${idx + 1}. [${msg.sid}] from ${msg.author}`);
        console.log(`        Body: ${msg.body ? msg.body.substring(0, 50) : '(no body)'}${msg.body && msg.body.length > 50 ? '...' : ''}`);
        console.log(`        Date: ${msg.dateCreated}`);
        console.log(`        Attributes: ${msg.attributes || 'none'}`);
        console.log(`        Has Media: ${hasMedia ? 'YES ✓' : 'NO'}`);
      });
    }

    console.log('\n\n=== CHECKING SMS MESSAGES API ===\n');

    // Get recent SMS messages with media
    console.log('Fetching SMS messages with media from the last 30 days...\n');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const smsMessages = await client.messages.list({
      dateSentAfter: thirtyDaysAgo,
      limit: 100
    });

    const messagesWithMedia = smsMessages.filter(m => m.numMedia && parseInt(m.numMedia) > 0);

    console.log(`Found ${smsMessages.length} total SMS messages`);
    console.log(`Found ${messagesWithMedia.length} SMS messages with media\n`);

    if (messagesWithMedia.length > 0) {
      console.log('SMS Messages with Media:');
      for (const msg of messagesWithMedia) {
        console.log(`\n  📎 ${msg.sid}`);
        console.log(`     From: ${msg.from}`);
        console.log(`     To: ${msg.to}`);
        console.log(`     Body: ${msg.body ? msg.body.substring(0, 50) : '(no body)'}${msg.body && msg.body.length > 50 ? '...' : ''}`);
        console.log(`     Date: ${msg.dateSent}`);
        console.log(`     NumMedia: ${msg.numMedia}`);
        console.log(`     Direction: ${msg.direction}`);

        // Fetch media details
        try {
          const mediaList = await client.messages(msg.sid).media.list();
          console.log(`     Media Items (${mediaList.length}):`);
          mediaList.forEach((m, i) => {
            console.log(`       ${i + 1}. ${m.contentType} - ${m.sid}`);
          });
        } catch (err) {
          console.log(`     Error fetching media: ${err.message}`);
        }
      }
    }

    console.log('\n\n=== SUMMARY ===\n');
    console.log(`Conversations: ${conversations.length}`);
    console.log(`Total messages in conversations: ${conversations.reduce((sum, c) => sum + c.messagesCount, 0)}`);
    console.log(`SMS messages (last 30 days): ${smsMessages.length}`);
    console.log(`SMS messages with media: ${messagesWithMedia.length}`);

    if (messagesWithMedia.length > 0) {
      console.log('\n⚠️  You have SMS messages with media that may not be in conversations!');
      console.log('   This likely means Autocreate Conversations was not enabled before.');
      console.log('   These older messages won\'t appear in the extension until you:');
      console.log('   1. Send a new message to trigger conversation creation');
      console.log('   2. Or manually create conversations for these phone numbers');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

diagnoseConversations();
