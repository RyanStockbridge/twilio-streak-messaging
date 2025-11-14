/**
 * Script to delete all Twilio conversations
 * Usage: TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=yyy node scripts/delete-all-conversations.js
 *
 * Or set environment variables first:
 * export TWILIO_ACCOUNT_SID=your_sid
 * export TWILIO_AUTH_TOKEN=your_token
 * node scripts/delete-all-conversations.js
 */

const twilio = require('twilio');

async function deleteAllConversations() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('Error: Missing Twilio credentials in environment variables');
    console.error('Make sure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    console.log('Fetching all conversations...');
    const conversations = await client.conversations.v1.conversations.list({ limit: 1000 });

    console.log(`Found ${conversations.length} conversations`);

    if (conversations.length === 0) {
      console.log('No conversations to delete');
      return;
    }

    // Ask for confirmation
    console.log('\nAre you sure you want to delete ALL conversations? This cannot be undone!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Deleting conversations...\n');

    let deleted = 0;
    let failed = 0;

    for (const conv of conversations) {
      try {
        await client.conversations.v1.conversations(conv.sid).remove();
        deleted++;
        console.log(`✓ Deleted: ${conv.friendlyName || conv.sid} (${deleted}/${conversations.length})`);
      } catch (error) {
        failed++;
        console.error(`✗ Failed to delete ${conv.sid}:`, error.message);
      }
    }

    console.log(`\n✅ Deletion complete!`);
    console.log(`   Deleted: ${deleted}`);
    console.log(`   Failed: ${failed}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

deleteAllConversations();
