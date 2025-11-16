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
    const { phoneNumber, twilioNumber, friendlyName } = body;

    if (!phoneNumber || !twilioNumber) {
      return NextResponse.json(
        { error: 'phoneNumber and twilioNumber are required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();

    // Create a new conversation
    const conversation = await client.conversations.v1.conversations.create({
      friendlyName: friendlyName || phoneNumber
    });

    console.log(`Created conversation: ${conversation.sid}`);

    // Add the phone number as a participant
    await client.conversations.v1
      .conversations(conversation.sid)
      .participants.create({
        'messagingBinding.address': phoneNumber,
        'messagingBinding.proxyAddress': twilioNumber
      });

    console.log(`Added participant ${phoneNumber} to conversation ${conversation.sid}`);

    return NextResponse.json({
      success: true,
      conversation: {
        sid: conversation.sid,
        friendlyName: conversation.friendlyName,
        dateCreated: conversation.dateCreated,
        phoneNumber: phoneNumber,
        twilioNumber: twilioNumber
      }
    });
  } catch (error: any) {
    console.error('Error creating conversation:', error);
    return NextResponse.json(
      { error: 'Failed to create conversation', details: error.message },
      { status: 500 }
    );
  }
}
