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

function parseSince(since?: string | null) {
  if (!since) return null;
  const parsed = new Date(since);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed;
}

function isIncomingMessage(message: any) {
  if (!message || !message.author) {
    return false;
  }

  const author = String(message.author);
  return !author.includes('@');
}

export async function GET(request: NextRequest) {
  try {
    const apiKeyHeader = request.headers.get('x-api-key');
    const apiKeyQuery = request.nextUrl.searchParams.get('apiKey');
    const providedApiKey = apiKeyHeader || apiKeyQuery;

    if (process.env.API_SECRET_KEY && providedApiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sinceParam = request.nextUrl.searchParams.get('since');
    const sinceDate = parseSince(sinceParam);

    const client = getTwilioClient();

    const conversations = await client.conversations.v1.conversations.list();

    const events: any[] = [];

    for (const conversation of conversations) {
      const messages = await client.conversations.v1
        .conversations(conversation.sid)
        .messages.list({ limit: 20, order: 'desc' });

      for (const message of messages) {
        const created = message.dateCreated ? new Date(message.dateCreated) : null;

        if (sinceDate && created && created <= sinceDate) {
          continue;
        }

        if (!isIncomingMessage(message)) {
          continue;
        }

        events.push({
          type: 'incoming_message',
          timestamp: created ? created.toISOString() : new Date().toISOString(),
          payload: {
            from: message.author,
            to: conversation.friendlyName || '',
            body: message.body,
            conversationSid: conversation.sid,
            hasMedia: Array.isArray((message as any).media) && (message as any).media.length > 0
          }
        });
      }
    }

    events.sort((a, b) => new Date(a.timestamp).valueOf() - new Date(b.timestamp).valueOf());

    return NextResponse.json({ events }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'x-api-key, content-type'
      }
    });
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications', details: error.message },
      { status: 500 }
    );
  }
}
