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
    const { phoneNumber, twilioNumber, friendlyName, backfill = false, backfillLimit = 100 } = body;

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

    let backfillResult = null;

    // Optionally backfill historical messages
    if (backfill) {
      console.log(`Backfilling messages with limit ${backfillLimit}...`);

      try {
        // Fetch SMS messages from Twilio Messaging API
        const outgoingMessages = await client.messages.list({
          to: phoneNumber,
          from: twilioNumber,
          limit: backfillLimit
        });

        const incomingMessages = await client.messages.list({
          from: phoneNumber,
          to: twilioNumber,
          limit: backfillLimit
        });

        // Combine and sort by date (oldest first)
        const allMessages = [...outgoingMessages, ...incomingMessages].sort((a, b) =>
          new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
        );

        console.log(`Found ${allMessages.length} total messages to backfill`);

        // Add each message to the conversation
        let addedCount = 0;
        const errors = [];

        for (const msg of allMessages) {
          try {
            // Determine the author (the sender)
            const author = msg.from === twilioNumber ? 'system' : msg.from;

            // Create message in conversation
            await client.conversations.v1
              .conversations(conversation.sid)
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

        backfillResult = {
          totalMessages: allMessages.length,
          addedCount: addedCount,
          errors: errors.length > 0 ? errors : undefined
        };

        console.log(`Backfilled ${addedCount}/${allMessages.length} messages`);
      } catch (backfillError: any) {
        console.error('Error during backfill:', backfillError);
        backfillResult = {
          error: backfillError.message
        };
      }
    }

    return NextResponse.json({
      success: true,
      conversation: {
        sid: conversation.sid,
        friendlyName: conversation.friendlyName,
        dateCreated: conversation.dateCreated,
        phoneNumber: phoneNumber,
        twilioNumber: twilioNumber
      },
      backfill: backfillResult
    });
  } catch (error: any) {
    console.error('Error creating conversation:', error);
    return NextResponse.json(
      { error: 'Failed to create conversation', details: error.message },
      { status: 500 }
    );
  }
}
