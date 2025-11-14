import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Missing Twilio credentials in environment variables');
  }

  return twilio(accountSid, authToken);
}

/**
 * Finds an existing conversation for a phone number or creates a new one
 */
async function findOrCreateConversation(client: any, phoneNumber: string, twilioNumber: string) {
  try {
    // Search for existing conversations with this phone number
    const conversations = await client.conversations.v1.conversations.list({ limit: 100 });

    for (const conv of conversations) {
      const participants = await client.conversations.v1
        .conversations(conv.sid)
        .participants.list();

      // Check if this conversation has the phone number as a participant
      const hasPhoneNumber = participants.some(
        (p: any) => p.messagingBinding?.address === phoneNumber
      );

      if (hasPhoneNumber) {
        return conv;
      }
    }

    // No conversation found, create a new one
    console.log(`Creating new conversation for ${phoneNumber}`);
    const newConversation = await client.conversations.v1.conversations.create({
      friendlyName: `SMS with ${phoneNumber}`
    });

    // Add the phone number as a participant with proper SMS binding
    await client.conversations.v1
      .conversations(newConversation.sid)
      .participants.create({
        'messagingBinding.address': phoneNumber,
        'messagingBinding.proxyAddress': twilioNumber
      });

    console.log(`Created conversation ${newConversation.sid} for ${phoneNumber}`);
    return newConversation;
  } catch (error) {
    console.error('Error finding/creating conversation:', error);
    throw error;
  }
}

/**
 * Forwards webhook data to Zapier or other external service
 */
async function forwardToZapier(webhookData: any) {
  const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;

  if (!zapierWebhookUrl) {
    console.log('No Zapier webhook URL configured, skipping forward');
    return;
  }

  try {
    console.log(`Forwarding to Zapier: ${zapierWebhookUrl}`);
    const response = await fetch(zapierWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookData)
    });

    if (!response.ok) {
      console.error(`Zapier webhook failed: ${response.status}`);
    } else {
      console.log('Successfully forwarded to Zapier');
    }
  } catch (error) {
    console.error('Error forwarding to Zapier:', error);
    // Don't throw - we don't want to fail the main webhook if Zapier is down
  }
}

/**
 * Handles incoming SMS webhooks from Twilio
 * This endpoint can be set as the webhook URL in your Twilio phone number configuration
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: Verify webhook signature for security
    const twilioSignature = request.headers.get('x-twilio-signature');

    // Parse the webhook payload (Twilio sends form data)
    const formData = await request.formData();
    const body = Object.fromEntries(formData.entries());

    const {
      From: fromNumber,
      To: toNumber,
      Body: messageBody,
      MessageSid: messageSid,
      NumMedia: numMedia
    } = body as any;

    if (!fromNumber || !toNumber) {
      return NextResponse.json(
        { error: 'Missing required fields: From, To' },
        { status: 400 }
      );
    }

    console.log(`Received SMS from ${fromNumber} to ${toNumber}: ${messageBody}`);
    console.log(`NumMedia: ${numMedia}`);

    // Forward to Zapier (don't await - run in parallel)
    forwardToZapier(body).catch(err =>
      console.error('Zapier forward error:', err)
    );

    // Get Twilio client
    const client = getTwilioClient();

    // Find or create conversation for this phone number
    const conversation = await findOrCreateConversation(client, fromNumber, toNumber);

    // Twilio automatically adds the SMS to the conversation, but it doesn't include media attributes
    // We need to wait a moment for the message to be added, then update its attributes with media info
    if (numMedia && parseInt(numMedia) > 0) {
      // Wait 2 seconds for Twilio to add the message to the conversation
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        // Get the most recent message in the conversation
        const recentMessages = await client.conversations.v1
          .conversations(conversation.sid)
          .messages.list({ limit: 5, order: 'desc' });

        // Find the message that matches this MessageSid or was just added
        const targetMessage = recentMessages.find((m: any) => {
          // Check if it's from the same phone number and around the same time
          return m.author === fromNumber && m.body === messageBody;
        });

        if (targetMessage) {
          // Build media attributes object
          const mediaAttrs: any = {
            MessageSid: messageSid,
            NumMedia: numMedia
          };

          // Add all MediaUrl and MediaContentType fields
          for (let i = 0; i < parseInt(numMedia); i++) {
            const mediaUrlKey = `MediaUrl${i}`;
            const mediaContentTypeKey = `MediaContentType${i}`;

            if (body[mediaUrlKey]) {
              mediaAttrs[mediaUrlKey] = body[mediaUrlKey];
            }
            if (body[mediaContentTypeKey]) {
              mediaAttrs[mediaContentTypeKey] = body[mediaContentTypeKey];
            }
          }

          // Update the message attributes
          await client.conversations.v1
            .conversations(conversation.sid)
            .messages(targetMessage.sid)
            .update({
              attributes: JSON.stringify(mediaAttrs)
            });

          console.log(`Updated message ${targetMessage.sid} with media attributes`);
        } else {
          console.log('Could not find matching message to update with media');
        }
      } catch (error) {
        console.error('Error updating message with media attributes:', error);
      }
    }

    console.log(`Message added to conversation ${conversation.sid}`);

    // Return TwiML response (required for Twilio webhooks)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: {
          'Content-Type': 'text/xml'
        }
      }
    );
  } catch (error: any) {
    console.error('Error processing SMS webhook:', error);
    return NextResponse.json(
      { error: 'Failed to process SMS', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Handles outgoing SMS via ActiveCampaign or other automation tools
 * POST body should be JSON: { "to": "+1234567890", "from": "+1987654321", "message": "Hello!" }
 */
export async function PUT(request: NextRequest) {
  try {
    // Optional: Verify API key from automation tool
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { to, from, message, author } = body;

    if (!to || !from || !message) {
      return NextResponse.json(
        { error: 'to, from, and message are required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();

    // Find or create conversation for this phone number
    const conversation = await findOrCreateConversation(client, to, from);

    // Add the message to the conversation
    const sentMessage = await client.conversations.v1
      .conversations(conversation.sid)
      .messages.create({
        body: message,
        author: author || from
      });

    // Also send the actual SMS via Twilio
    await client.messages.create({
      body: message,
      from: from,
      to: to
    });

    return NextResponse.json({
      success: true,
      conversationSid: conversation.sid,
      message: {
        sid: sentMessage.sid,
        author: sentMessage.author,
        body: sentMessage.body,
        dateCreated: sentMessage.dateCreated
      }
    });
  } catch (error: any) {
    console.error('Error sending outbound SMS:', error);
    return NextResponse.json(
      { error: 'Failed to send SMS', details: error.message },
      { status: 500 }
    );
  }
}
