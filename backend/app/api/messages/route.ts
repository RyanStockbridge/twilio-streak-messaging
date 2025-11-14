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

    const formattedMessages = await Promise.all(messages.map(async (msg) => {
      // Fetch media if present
      let media = null;
      if (msg.media) {
        try {
          const mediaList = await client.conversations.v1
            .conversations(conversationSid)
            .messages(msg.sid)
            .media.list();

          if (mediaList.length > 0) {
            media = mediaList.map(m => ({
              sid: m.sid,
              contentType: m.contentType,
              filename: m.filename,
              size: m.size,
              url: m.url
            }));
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
