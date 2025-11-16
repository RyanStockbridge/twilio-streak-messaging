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
 * Finds an existing conversation for a phone number or creates a new one with backfill
 */
async function findOrCreateConversation(client: any, phoneNumber: string, twilioNumber: string, backfill = true) {
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
        return { conversation: conv, isNew: false };
      }
    }

    // No conversation found, create a new one
    console.log(`Creating new conversation for ${phoneNumber} with backfill=${backfill}`);
    const newConversation = await client.conversations.v1.conversations.create({
      friendlyName: phoneNumber
    });

    // Add the phone number as a participant with proper SMS binding
    await client.conversations.v1
      .conversations(newConversation.sid)
      .participants.create({
        'messagingBinding.address': phoneNumber,
        'messagingBinding.proxyAddress': twilioNumber
      });

    console.log(`Created conversation ${newConversation.sid} for ${phoneNumber}`);

    // Optionally backfill historical messages (default: last 20)
    if (backfill) {
      try {
        console.log('Backfilling historical messages...');

        // Fetch recent SMS messages
        const outgoingMessages = await client.messages.list({
          to: phoneNumber,
          from: twilioNumber,
          limit: 20
        });

        const incomingMessages = await client.messages.list({
          from: phoneNumber,
          to: twilioNumber,
          limit: 20
        });

        // Combine and sort by date (oldest first)
        const allMessages = [...outgoingMessages, ...incomingMessages].sort((a: any, b: any) =>
          new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
        );

        console.log(`Found ${allMessages.length} messages to backfill`);

        // Add each message to the conversation
        for (const msg of allMessages) {
          try {
            const author = msg.from === twilioNumber ? 'system' : msg.from;

            await client.conversations.v1
              .conversations(newConversation.sid)
              .messages.create({
                author: author,
                body: msg.body || '',
                dateCreated: msg.dateCreated,
                attributes: JSON.stringify({
                  originalMessageSid: msg.sid,
                  direction: msg.direction,
                  status: msg.status,
                  backfilled: true
                })
              });
          } catch (msgError: any) {
            console.error(`Failed to backfill message ${msg.sid}:`, msgError.message);
          }
        }

        console.log(`Backfilled ${allMessages.length} messages`);
      } catch (backfillError) {
        console.error('Error during backfill (non-fatal):', backfillError);
      }
    }

    return { conversation: newConversation, isNew: true };
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

    // Log media URLs for debugging
    if (numMedia && parseInt(numMedia) > 0) {
      for (let i = 0; i < parseInt(numMedia); i++) {
        console.log(`  MediaUrl${i}: ${body[`MediaUrl${i}`]}`);
        console.log(`  MediaContentType${i}: ${body[`MediaContentType${i}`]}`);
      }
    }

    // Forward to Zapier (don't await - run in parallel)
    forwardToZapier(body).catch(err =>
      console.error('Zapier forward error:', err)
    );

    // Get Twilio client
    const client = getTwilioClient();

    // Twilio's Autocreate doesn't always work reliably, so we'll force conversation creation
    try {
      // Find or create the conversation for this phone number (with backfill for new conversations)
      const { conversation, isNew } = await findOrCreateConversation(client, fromNumber, toNumber);

      console.log(`Using ${isNew ? 'newly created' : 'existing'} conversation ${conversation.sid}`);

      // Add the current incoming message to the conversation
      const messageData: any = {
        body: messageBody || '',
        author: fromNumber,
        attributes: JSON.stringify({
          MessageSid: messageSid,
          direction: 'inbound'
        })
      };

      // If there's media, add it to the attributes
      if (numMedia && parseInt(numMedia) > 0) {
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

        messageData.attributes = JSON.stringify(mediaAttrs);
      }

      // Create the message in the conversation (only if not already backfilled)
      // We check if this message was already added during backfill
      if (!isNew) {
        // For existing conversations, add the new message
        await client.conversations.v1
          .conversations(conversation.sid)
          .messages.create(messageData);

        console.log(`Added new message to existing conversation ${conversation.sid}`);
      } else {
        // For new conversations, the message might have been added during backfill
        // Check if we need to add it
        const recentMessages = await client.conversations.v1
          .conversations(conversation.sid)
          .messages.list({ limit: 5, order: 'desc' });

        const messageExists = recentMessages.some((m: any) =>
          m.body === messageBody && m.author === fromNumber
        );

        if (!messageExists) {
          await client.conversations.v1
            .conversations(conversation.sid)
            .messages.create(messageData);

          console.log(`Added current message to new conversation ${conversation.sid}`);
        } else {
          console.log(`Current message already exists in conversation (from backfill)`);
        }
      }
    } catch (error) {
      console.error('Error creating conversation/message:', error);
      // Don't fail the webhook - still return success to Twilio
    }

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

    // Find or create conversation for this phone number (no backfill for outgoing)
    const { conversation } = await findOrCreateConversation(client, to, from, false);

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
