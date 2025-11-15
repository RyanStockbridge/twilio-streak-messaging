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

const EXTENSION_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime'
};

function resolveContentType(file: File) {
  if (file.type && file.type.trim()) {
    return file.type;
  }

  const fileName = file.name || '';
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (extension && EXTENSION_MIME_MAP[extension]) {
    return EXTENSION_MIME_MAP[extension];
  }

  return 'application/octet-stream';
}

async function uploadMediaFile(
  serviceSid: string,
  file: File,
  accountSid: string,
  authToken: string
) {
  const region = process.env.TWILIO_REGION || 'us1';
  const uploadUrl = `https://mcs.${region}.twilio.com/v1/Services/${serviceSid}/Media`;
  const filename = file.name || `attachment-${Date.now()}`;
  const contentType = resolveContentType(file);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': contentType,
      'Content-Length': buffer.byteLength.toString(),
      'Content-Disposition': `inline; filename="${filename}"`
    },
    body: buffer
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to upload media to Twilio (${response.status}): ${responseText}`);
  }

  try {
    const data = JSON.parse(responseText);
    return data.sid as string;
  } catch (error) {
    console.error('Unexpected Twilio response while uploading media:', responseText);
    throw new Error('Twilio returned an unexpected response while uploading media');
  }
}

async function uploadMediaFiles(
  serviceSid: string,
  files: File[],
  accountSid: string,
  authToken: string
) {
  const uploadedSids: string[] = [];
  for (const file of files) {
    const sid = await uploadMediaFile(serviceSid, file, accountSid, authToken);
    uploadedSids.push(sid);
  }
  return uploadedSids;
}

export async function POST(request: NextRequest) {
  try {
    // Optional: Verify API key from extension
    const apiKey = request.headers.get('x-api-key');
    if (process.env.API_SECRET_KEY && apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    let conversationSid: string | null = null;
    let rawMessage: string | null = null;
    let author = 'system';
    let mediaFiles: File[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const conversationField = formData.get('conversationSid');
      conversationSid = typeof conversationField === 'string' ? conversationField : null;

      const messageField = formData.get('message');
      rawMessage = typeof messageField === 'string' ? messageField : null;

      const authorField = formData.get('author');
      if (typeof authorField === 'string' && authorField.trim()) {
        author = authorField;
      }

      mediaFiles = formData
        .getAll('media')
        .filter((item): item is File => item instanceof File);
    } else {
      const body = await request.json();
      conversationSid = body.conversationSid;
      rawMessage = body.message;
      if (body.author) {
        author = body.author;
      }
    }

    const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';

    if (!conversationSid) {
      return NextResponse.json(
        { error: 'conversationSid is required' },
        { status: 400 }
      );
    }

    if (!message && mediaFiles.length === 0) {
      return NextResponse.json(
        { error: 'Message text or media attachment is required' },
        { status: 400 }
      );
    }

    // Get Twilio client
    const client = getTwilioClient();
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;

    let mediaSids: string[] = [];

    if (mediaFiles.length > 0) {
      const conversation = await client.conversations.v1
        .conversations(conversationSid)
        .fetch();

      const serviceSid = conversation.chatServiceSid;

      if (!serviceSid) {
        throw new Error('Conversation is missing chat service SID required for media uploads');
      }

      mediaSids = await uploadMediaFiles(serviceSid, mediaFiles, accountSid, authToken);
    }

    const payload: any = {
      author: author || 'system'
    };

    if (message) {
      payload.body = message;
    }

    if (mediaSids.length > 0) {
      payload.mediaSid = mediaSids;
    }

    // Send message in the conversation
    const sentMessage = await client.conversations.v1
      .conversations(conversationSid)
      .messages.create(payload);

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
