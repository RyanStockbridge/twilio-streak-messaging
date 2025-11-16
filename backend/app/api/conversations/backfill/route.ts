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

export async function POST(request: NextRequest) {
  try {
    // Optional: Verify API key from extension
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { conversationSid, phoneNumber, twilioNumber, limit = 100 } = body;

    if (!conversationSid || !phoneNumber || !twilioNumber) {
      return NextResponse.json(
        { error: 'conversationSid, phoneNumber, and twilioNumber are required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();

    console.log(`Fetching SMS messages between ${twilioNumber} and ${phoneNumber}...`);

    // Fetch SMS messages from Twilio Messaging API
    const messages = await client.messages.list({
      to: phoneNumber,
      from: twilioNumber,
      limit: limit
    });

    const reverseMessages = await client.messages.list({
      from: phoneNumber,
      to: twilioNumber,
      limit: limit
    });

    // Combine and sort by date
    const allMessages = [...messages, ...reverseMessages].sort((a, b) =>
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    );

    console.log(`Found ${allMessages.length} total messages`);

    // Add each message to the conversation
    let addedCount = 0;
    const errors = [];

    for (const msg of allMessages) {
      try {
        // Determine the author (the sender)
        const author = msg.from === twilioNumber ? 'system' : msg.from;

        // Create message in conversation
        await client.conversations.v1
          .conversations(conversationSid)
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

        addedCount++;
      } catch (error: any) {
        console.error(`Failed to add message ${msg.sid}:`, error.message);
        errors.push({
          messageSid: msg.sid,
          error: error.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      totalMessages: allMessages.length,
      addedCount: addedCount,
      errors: errors.length > 0 ? errors : undefined,
      conversationSid: conversationSid
    });
  } catch (error: any) {
    console.error('Error backfilling messages:', error);
    return NextResponse.json(
      { error: 'Failed to backfill messages', details: error.message },
      { status: 500 }
    );
  }
}
