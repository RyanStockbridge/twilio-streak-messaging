import { NextRequest, NextResponse } from 'next/server';
import { getNotificationsSince } from '@/lib/notification-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const apiKeyHeader = request.headers.get('x-api-key');
    const apiKeyQuery = request.nextUrl.searchParams.get('apiKey');
    const providedApiKey = apiKeyHeader || apiKeyQuery;

    if (process.env.API_SECRET_KEY && providedApiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const since = request.nextUrl.searchParams.get('since');
    const events = getNotificationsSince(since);

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
