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

/**
 * Proxy endpoint for fetching Twilio media files
 * This allows the Chrome extension to display images without exposing Twilio credentials
 *
 * URL format: /api/media/{messageSid}/{mediaSid}
 * Example: /api/media/MMxxx/MExxx
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { mediaSid: string } }
) {
  try {
    // Optional: Verify API key from extension
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mediaSid = params.mediaSid;

    // Extract messageSid and mediaSid from the path
    // Path should be: /api/media/{messageSid}/{mediaSid}
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const messageSid = pathParts[pathParts.length - 2];
    const actualMediaSid = pathParts[pathParts.length - 1];

    if (!messageSid || !actualMediaSid) {
      return NextResponse.json(
        { error: 'Invalid media URL format. Expected: /api/media/{messageSid}/{mediaSid}' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;

    // Fetch the media from Twilio
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${actualMediaSid}`;

    const response = await fetch(mediaUrl, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch media from Twilio: ${response.status}`);
      return NextResponse.json(
        { error: 'Failed to fetch media from Twilio' },
        { status: response.status }
      );
    }

    // Get the content type from Twilio's response
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Stream the image data
    const imageBuffer = await response.arrayBuffer();

    // Return the image with proper headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
      }
    });
  } catch (error: any) {
    console.error('Error proxying media:', error);
    return NextResponse.json(
      { error: 'Failed to proxy media', details: error.message },
      { status: 500 }
    );
  }
}
