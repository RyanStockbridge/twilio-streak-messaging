/**
 * Script to configure Twilio Messaging Service with Conversations integration
 * This will check and optionally update your Messaging Service to work with Conversations
 *
 * Usage:
 * export TWILIO_ACCOUNT_SID=your_sid
 * export TWILIO_AUTH_TOKEN=your_token
 * node scripts/configure-messaging-service.js
 */

const twilio = require('twilio');

const MESSAGING_SERVICE_SID = 'MGef6b2461fad0132c7cdc367afcc3d29f';

async function configureMessagingService() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('Error: Missing Twilio credentials in environment variables');
    console.error('Make sure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    console.log('Fetching Messaging Service configuration...\n');

    // Get the messaging service
    const service = await client.messaging.v1.services(MESSAGING_SERVICE_SID).fetch();

    console.log('📋 Messaging Service Details:');
    console.log(`   SID: ${service.sid}`);
    console.log(`   Friendly Name: ${service.friendlyName}`);
    console.log(`   Inbound Request URL: ${service.inboundRequestUrl || 'Not set'}`);
    console.log(`   Inbound Method: ${service.inboundMethod || 'Not set'}`);
    console.log(`   Status Callback URL: ${service.statusCallback || 'Not set'}`);
    console.log(`   Use Inbound Webhook on Number: ${service.useInboundWebhookOnNumber}`);
    console.log('');

    // Check if it has Conversations integration
    console.log('🔍 Checking phone numbers associated with this service...\n');
    const phoneNumbers = await client.messaging.v1
      .services(MESSAGING_SERVICE_SID)
      .phoneNumbers.list();

    if (phoneNumbers.length === 0) {
      console.log('⚠️  No phone numbers are associated with this Messaging Service');
      console.log('   You should add your phone number to this service in the Twilio Console');
    } else {
      console.log(`📱 Phone numbers in this service (${phoneNumbers.length}):`);
      phoneNumbers.forEach(pn => {
        console.log(`   - ${pn.phoneNumber} (${pn.sid})`);
      });
    }
    console.log('');

    // Check for Conversations integration
    console.log('💬 Checking Conversations integration...\n');
    try {
      // Try to fetch conversation configuration for this service
      // Note: This might not be directly accessible via API
      console.log('ℹ️  To enable Conversations integration:');
      console.log('   1. Go to: https://console.twilio.com/us1/develop/sms/services/' + MESSAGING_SERVICE_SID);
      console.log('   2. Navigate to "Integration" section');
      console.log('   3. Enable "Autocreate Conversations"');
      console.log('   4. This will automatically create conversations for incoming/outgoing SMS');
      console.log('');
    } catch (error) {
      console.error('Error checking conversations:', error.message);
    }

    console.log('📌 Current Setup Recommendations:\n');

    if (service.useInboundWebhookOnNumber) {
      console.log('✅ Service is configured to use webhook on phone number level');
      console.log('   Your webhook should be set on the phone number itself');
      console.log('   Go to: Phone Numbers → Active Numbers → Select your number → Messaging Configuration');
    } else {
      console.log('✅ Service uses the Messaging Service webhook');
      console.log('   Current webhook URL: ' + (service.inboundRequestUrl || 'Not set'));

      if (!service.inboundRequestUrl || !service.inboundRequestUrl.includes('/api/webhook/sms')) {
        console.log('');
        console.log('⚠️  Consider updating the webhook URL to your backend:');
        console.log('   Recommended URL: https://your-backend.vercel.app/api/webhook/sms');
      }
    }

    console.log('');
    console.log('🔧 Alternative: Enable Autocreate Conversations\n');
    console.log('   If you enable "Autocreate Conversations" in the Messaging Service:');
    console.log('   - Twilio will automatically create conversations for all SMS');
    console.log('   - You won\'t need the webhook to create conversations');
    console.log('   - BUT you still need the webhook to capture media URLs');
    console.log('   - The webhook will just add media attributes to existing messages');
    console.log('');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

configureMessagingService();
