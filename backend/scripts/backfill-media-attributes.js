/**
 * Script to backfill media attributes for existing conversation messages
 * This will fetch all SMS messages with media and update the corresponding conversation messages
 *
 * Usage:
 * export TWILIO_ACCOUNT_SID=your_sid
 * export TWILIO_AUTH_TOKEN=your_token
 * node scripts/backfill-media-attributes.js
 */

const twilio = require('twilio');

async function backfillMediaAttributes() {
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

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const conv of conversations) {
      try {
        console.log(`\nProcessing conversation: ${conv.friendlyName || conv.sid}`);

        // Get all messages in this conversation
        const messages = await client.conversations.v1
          .conversations(conv.sid)
          .messages.list({ limit: 100 });

        for (const msg of messages) {
          try {
            // Skip if already has media attributes
            if (msg.attributes) {
              const attrs = JSON.parse(msg.attributes);
              if (attrs.NumMedia || attrs.MediaUrl0) {
                console.log(`  Message ${msg.sid} already has media attributes, skipping`);
                skipped++;
                continue;
              }
            }

            // Check if this is an SMS message by looking at the author (phone number)
            if (msg.author && msg.author.startsWith('+')) {
              // Try to find the corresponding SMS message by searching recent messages
              // from this phone number around the same time
              const phoneNumber = msg.author;
              const messageTime = new Date(msg.dateCreated);

              // Search for SMS messages from this number around this time (within 1 minute)
              const dateSentAfter = new Date(messageTime.getTime() - 60000);
              const dateSentBefore = new Date(messageTime.getTime() + 60000);

              const smsMessages = await client.messages.list({
                from: phoneNumber,
                dateSentAfter: dateSentAfter,
                dateSentBefore: dateSentBefore,
                limit: 10
              });

              // Find matching message by body content
              const matchingSms = smsMessages.find(sms => sms.body === msg.body);

              if (matchingSms && matchingSms.numMedia && parseInt(matchingSms.numMedia) > 0) {
                console.log(`  Found matching SMS ${matchingSms.sid} with ${matchingSms.numMedia} media`);

                // Fetch media for this message
                const mediaList = await client.messages(matchingSms.sid).media.list();

                if (mediaList.length > 0) {
                  // Build media attributes
                  const mediaAttrs = {
                    MessageSid: matchingSms.sid,
                    NumMedia: matchingSms.numMedia
                  };

                  // Add media URLs
                  mediaList.forEach((media, index) => {
                    mediaAttrs[`MediaUrl${index}`] = `https://api.twilio.com${media.uri.replace('.json', '')}`;
                    mediaAttrs[`MediaContentType${index}`] = media.contentType;
                  });

                  // Update conversation message with media attributes
                  await client.conversations.v1
                    .conversations(conv.sid)
                    .messages(msg.sid)
                    .update({
                      attributes: JSON.stringify(mediaAttrs)
                    });

                  console.log(`  ✓ Updated message ${msg.sid} with ${mediaList.length} media attachments`);
                  updated++;
                } else {
                  console.log(`  Message ${matchingSms.sid} has NumMedia but no actual media found`);
                  skipped++;
                }
              } else {
                // No matching SMS or no media
                skipped++;
              }
            } else {
              // Not an SMS message (probably sent from the extension)
              skipped++;
            }
          } catch (msgError) {
            console.error(`  ✗ Error processing message ${msg.sid}:`, msgError.message);
            failed++;
          }
        }
      } catch (convError) {
        console.error(`✗ Error processing conversation ${conv.sid}:`, convError.message);
        failed++;
      }
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   Updated: ${updated} messages with media`);
    console.log(`   Skipped: ${skipped} messages (no media or already updated)`);
    console.log(`   Failed: ${failed} messages`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

backfillMediaAttributes();
