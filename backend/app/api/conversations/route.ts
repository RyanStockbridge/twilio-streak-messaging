import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error('Missing Twilio credentials');
}

const client = twilio(accountSid, authToken);

export async function GET(request: NextRequest) {
  try {
    // Optional: Verify API key from extension
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get phone numbers from query params (comma-separated)
    const phoneNumbers = request.nextUrl.searchParams.get('phoneNumbers');

    // Get pagination params
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
    const pageSize = Math.min(limit, 100); // Cap at 100 per request

    // Fetch conversations with pagination
    const conversations = await client.conversations.v1.conversations.list({
      limit: pageSize
    });

    // If phone numbers are provided, filter conversations
    let filteredConversations = conversations;
    if (phoneNumbers) {
      const phoneNumberSet = new Set(phoneNumbers.split(',').map(p => p.trim()));

      // For each conversation, get participants to check phone numbers
      const conversationsWithParticipants = await Promise.all(
        conversations.map(async (conv) => {
          const participants = await client.conversations.v1
            .conversations(conv.sid)
            .participants.list();

          // Check if any participant's phone number matches our filter
          const hasMatchingNumber = participants.some(p => {
            const address = p.messagingBinding?.address;
            return address && phoneNumberSet.has(address);
          });

          if (hasMatchingNumber) {
            return {
              sid: conv.sid,
              friendlyName: conv.friendlyName,
              dateCreated: conv.dateCreated,
              dateUpdated: conv.dateUpdated,
              state: conv.state,
              participants: participants.map(p => ({
                sid: p.sid,
                address: p.messagingBinding?.address,
                type: p.messagingBinding?.type
              }))
            };
          }
          return null;
        })
      );

      filteredConversations = conversationsWithParticipants.filter(c => c !== null) as any[];
    } else {
      // If no filter, return all conversations with participants
      filteredConversations = await Promise.all(
        conversations.map(async (conv) => {
          const participants = await client.conversations.v1
            .conversations(conv.sid)
            .participants.list();

          return {
            sid: conv.sid,
            friendlyName: conv.friendlyName,
            dateCreated: conv.dateCreated,
            dateUpdated: conv.dateUpdated,
            state: conv.state,
            participants: participants.map(p => ({
              sid: p.sid,
              address: p.messagingBinding?.address,
              type: p.messagingBinding?.type
            }))
          };
        })
      );
    }

    return NextResponse.json({
      conversations: filteredConversations,
      count: filteredConversations.length
    });
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversations', details: error.message },
      { status: 500 }
    );
  }
}
