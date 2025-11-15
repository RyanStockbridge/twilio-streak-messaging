import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getTwilioAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Missing Twilio credentials in environment variables');
  }

  return {
    accountSid,
    authToken
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { serviceSid: string; mediaSid: string } }
) {
  try {
    const apiKeyHeader = request.headers.get('x-api-key');
    const apiKeyQuery = request.nextUrl.searchParams.get('apiKey');
    const providedApiKey = apiKeyHeader || apiKeyQuery;

    if (process.env.API_SECRET_KEY && providedApiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { serviceSid, mediaSid } = params;

    if (!serviceSid || !mediaSid) {
      return NextResponse.json(
        { error: 'Invalid media URL format.' },
        { status: 400 }
      );
    }

    const { accountSid, authToken } = getTwilioAuth();
    const region = process.env.TWILIO_REGION || 'us1';
    const mediaUrl = `https://mcs.${region}.twilio.com/v1/Services/${serviceSid}/Media/${mediaSid}/Content`;

    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch conversation media from Twilio: ${response.status}`);
      return NextResponse.json(
        { error: 'Failed to fetch media from Twilio' },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error: any) {
    console.error('Error proxying conversation media:', error);
    return NextResponse.json(
      { error: 'Failed to proxy media', details: error.message },
      { status: 500 }
    );
  }
}
