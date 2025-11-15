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

    // Get the base URL from the request for constructing media proxy URLs
    const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    // Prepare API key query param for media URLs
    const apiKeyParam = apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : '';

    const ensureAbsoluteUrl = (url: string) => {
      if (!url) return '';
      try {
        return new URL(url, baseUrl).toString();
      } catch (error) {
        return url;
      }
    };

    const extractServiceSidFromLink = (link?: string | null) => {
      if (!link) return null;
      const match = link.match(/Services\/([^\/]+)\/Media/);
      return match ? match[1] : null;
    };

    if (!conversationSid) {
      return NextResponse.json(
        { error: 'conversationSid is required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();
    const conversationDetails = await client.conversations.v1
      .conversations(conversationSid)
      .fetch();
    const serviceSid = (conversationDetails as any)?.chatServiceSid || (conversationDetails as any)?.chat_service_sid || null;

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
                // Convert Twilio media URL to our proxied URL
                // Extract MessageSid and MediaSid from the Twilio URL
                const twilioUrlMatch = mediaUrl.match(/Messages\/([^\/]+)\/Media\/([^\/\?]+)/);
                const proxiedUrl = twilioUrlMatch
                  ? `${baseUrl}/api/media/${twilioUrlMatch[1]}/${twilioUrlMatch[2]}${apiKeyParam}`
                  : mediaUrl;

                media.push({
                  sid: `media_${i}`,
                  contentType: mediaContentType || 'image/jpeg',
                  filename: `image_${i}`,
                  size: 0,
                  url: proxiedUrl
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error parsing attributes for message ${msg.sid}:`, error);
        }
      }

      // If media info isn't set yet, check the Conversations media array
      if (!media && Array.isArray((msgAny as any).media) && (msgAny as any).media.length > 0) {
        media = (msgAny as any).media.map((m: any, idx: number) => {
          const linkOptions = [
            m.links?.content_direct,
            m.links?.content,
            m.url
          ].filter(Boolean);

          const serviceFromLink = linkOptions
            .map(link => extractServiceSidFromLink(link))
            .find(Boolean);

          const effectiveServiceSid = serviceSid || serviceFromLink;

          let proxiedUrl = '';

          if (effectiveServiceSid && m.sid) {
            proxiedUrl = `${baseUrl}/api/conversation-media/${effectiveServiceSid}/${m.sid}${apiKeyParam}`;
          } else if (linkOptions.length > 0) {
            proxiedUrl = ensureAbsoluteUrl(linkOptions[0]);
          }

          return {
            sid: m.sid || `media_${idx}`,
            contentType: m.content_type || m.contentType || 'image/jpeg',
            filename: m.filename || m.fileName || `image_${idx}`,
            size: m.size || 0,
            url: proxiedUrl
          };
        });
      }

      // If we don't have media yet, try to get it from the SMS Messages API
      // This handles both old messages and cases where the webhook didn't capture media
      if (!media) {
        try {
          // Try to find the SMS message SID from attributes or derive it
          let smsMessageSid = twilioMessageSid;

          // If no MessageSid in attributes, check if this message has SMS binding
          if (!smsMessageSid && msgAny.delivery) {
            // For SMS messages, we can try to fetch from the Messages API
            // The message might have been created via SMS
            const delivery = msgAny.delivery as any;
            if (delivery && delivery.status) {
              // This is an SMS message, try to find its MessageSid
              // We'll need to search for it based on the message content and timestamp
            }
          }

          // If we have a MessageSid, fetch media
          if (smsMessageSid && smsMessageSid.startsWith('MM') || smsMessageSid?.startsWith('SM')) {
            const mediaList = await client.messages(smsMessageSid).media.list();

            if (mediaList.length > 0) {
              media = mediaList.map((m: any) => {
                // Convert Twilio media URL to our proxied URL
                const twilioUrl = `https://api.twilio.com${m.uri.replace('.json', '')}`;
                const twilioUrlMatch = twilioUrl.match(/Messages\/([^\/]+)\/Media\/([^\/\?]+)/);
                const proxiedUrl = twilioUrlMatch
                  ? `${baseUrl}/api/media/${twilioUrlMatch[1]}/${twilioUrlMatch[2]}${apiKeyParam}`
                  : twilioUrl;

                return {
                  sid: m.sid,
                  contentType: m.contentType,
                  filename: 'image',
                  size: 0,
                  url: proxiedUrl
                };
              });
            }
          }
        } catch (error) {
          // Silently fail - message just doesn't have media
          console.log(`No media found for message ${msg.sid}`);
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
