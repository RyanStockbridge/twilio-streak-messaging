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

export async function GET(request: NextRequest) {
  try {
    // Optional: Verify API key from extension
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const conversationSid = request.nextUrl.searchParams.get('conversationSid');

    if (!conversationSid) {
      return NextResponse.json(
        { error: 'conversationSid is required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();

    // Fetch messages for the conversation
    const messages = await client.conversations.v1
      .conversations(conversationSid)
      .messages.list({ limit: 100, order: 'desc' });

    // Get conversation participants to find the SMS message SIDs
    const participants = await client.conversations.v1
      .conversations(conversationSid)
      .participants.list();

    // Fetch media for each message that might have attachments
    const formattedMessages = await Promise.all(messages.map(async (msg) => {
      let media = null;
      const msgAny = msg as any;

      // Parse attributes to check for NumMedia or twilioMessageSid
      let twilioMessageSid = null;
      if (msgAny.attributes) {
        try {
          const attrs = JSON.parse(msgAny.attributes);

          // Check if this message has media
          if (attrs.NumMedia && parseInt(attrs.NumMedia) > 0) {
            twilioMessageSid = attrs.MessageSid || attrs.twilioMessageSid;

            // Extract media URLs from attributes (these come from the webhook)
            const numMedia = parseInt(attrs.NumMedia);
            media = [];

            for (let i = 0; i < numMedia; i++) {
              const mediaUrl = attrs[`MediaUrl${i}`];
              const mediaContentType = attrs[`MediaContentType${i}`];

              if (mediaUrl) {
                media.push({
                  sid: `media_${i}`,
                  contentType: mediaContentType || 'image/jpeg',
                  filename: `image_${i}`,
                  size: 0,
                  url: mediaUrl
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error parsing attributes for message ${msg.sid}:`, error);
        }
      }

      // If we have a Twilio Message SID, try to fetch media from the Messages API
      if (!media && twilioMessageSid) {
        try {
          const mediaList = await client.messages(twilioMessageSid).media.list();

          if (mediaList.length > 0) {
            media = mediaList.map((m: any) => ({
              sid: m.sid,
              contentType: m.contentType,
              filename: 'image',
              size: 0,
              url: `https://api.twilio.com${m.uri.replace('.json', '')}`
            }));
          }
        } catch (error) {
          console.error(`Error fetching media from Messages API for ${twilioMessageSid}:`, error);
        }
      }

      return {
        sid: msg.sid,
        author: msg.author,
        body: msg.body,
        dateCreated: msg.dateCreated,
        index: msg.index,
        participantSid: msg.participantSid,
        attributes: msg.attributes,
        media: media
      };
    }));

    return NextResponse.json({
      messages: formattedMessages.reverse(), // Return in chronological order
      count: formattedMessages.length
    });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages', details: error.message },
      { status: 500 }
    );
  }
}
