import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Missing Twilio credentials in environment variables');
  }

  return twilio(accountSid, authToken);
}

export async function POST(request: NextRequest) {
  try {
    // Optional: Verify API key from extension
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { conversationSid, message, author } = body;

    if (!conversationSid || !message) {
      return NextResponse.json(
        { error: 'conversationSid and message are required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();

    // Send message in the conversation
    const sentMessage = await client.conversations.v1
      .conversations(conversationSid)
      .messages.create({
        body: message,
        author: author || 'system'
      });

    return NextResponse.json({
      success: true,
      message: {
        sid: sentMessage.sid,
        author: sentMessage.author,
        body: sentMessage.body,
        dateCreated: sentMessage.dateCreated,
        index: sentMessage.index
      }
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    return NextResponse.json(
      { error: 'Failed to send message', details: error.message },
      { status: 500 }
    );
  }
}
