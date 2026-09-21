import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as {
      message?: unknown;
      stack?: unknown;
      source?: unknown;
      url?: unknown;
      userAgent?: unknown;
    };
    const line = [
      '[client-error]',
      typeof data.source === 'string' ? `source=${data.source}` : 'source=unknown',
      `url=${typeof data.url === 'string' ? data.url : 'unknown'}`,
      `message=${typeof data.message === 'string' ? data.message.slice(0, 500) : 'unknown'}`,
      `stack=${typeof data.stack === 'string' ? data.stack.replace(/\s+/g, ' ').slice(0, 900) : 'none'}`,
      `ua=${typeof data.userAgent === 'string' ? data.userAgent.slice(0, 150) : 'unknown'}`,
    ].join(' | ');
    console.error(line);
  } catch {
    console.error('[client-error] failed to parse payload');
  }
  return new NextResponse(null, { status: 204 });
}
