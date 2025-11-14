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

    const formattedMessages = messages.map(msg => {
      // Extract media if present in the message object
      let media = null;
      const msgAny = msg as any;

      // Check if media exists on the message object
      if (msgAny.media && Array.isArray(msgAny.media) && msgAny.media.length > 0) {
        media = msgAny.media.map((m: any) => ({
          sid: m.sid,
          contentType: m.content_type || m.contentType,
          filename: m.filename,
          size: m.size,
          url: m.url
        }));
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
    });

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
