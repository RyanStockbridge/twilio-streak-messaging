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

    // Fetch media for each message that has attachments
    const formattedMessages = await Promise.all(messages.map(async (msg) => {
      let media = null;
      const msgAny = msg as any;

      // Check if message has media (NumMedia field or media property)
      const hasMedia = msgAny.delivery?.total > 0 || msgAny.media ||
                      (msgAny.attributes && JSON.parse(msgAny.attributes || '{}').NumMedia);

      if (hasMedia) {
        try {
          // Fetch media using the REST API directly
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

          const mediaResponse = await fetch(
            `https://conversations.twilio.com/v1/Conversations/${conversationSid}/Messages/${msg.sid}`,
            {
              headers: {
                'Authorization': `Basic ${authHeader}`
              }
            }
          );

          if (mediaResponse.ok) {
            const messageData = await mediaResponse.json();

            // Check if media links exist
            if (messageData.links && messageData.links.delivery_receipts) {
              // Try to fetch media from the message's media endpoint
              const mediaListResponse = await fetch(
                `https://conversations.twilio.com/v1/Conversations/${conversationSid}/Messages/${msg.sid}/Receipts`,
                {
                  headers: {
                    'Authorization': `Basic ${authHeader}`
                  }
                }
              );
            }

            // Parse attributes for MMS media URLs
            if (messageData.attributes) {
              const attrs = JSON.parse(messageData.attributes);
              if (attrs.media && Array.isArray(attrs.media)) {
                media = attrs.media.map((m: any) => ({
                  sid: m.sid || '',
                  contentType: m.content_type || m.contentType || 'image/jpeg',
                  filename: m.filename || 'image',
                  size: m.size || 0,
                  url: m.url || ''
                }));
              } else if (attrs.MediaUrl0) {
                // Legacy MMS format
                media = [{
                  sid: msg.sid,
                  contentType: attrs.MediaContentType0 || 'image/jpeg',
                  filename: 'image',
                  size: 0,
                  url: attrs.MediaUrl0
                }];
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching media for message ${msg.sid}:`, error);
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
