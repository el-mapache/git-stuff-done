import { NextResponse } from 'next/server';
import { fetchNotifications } from '@/lib/github';

export async function GET() {
  try {
    const notifications = await fetchNotifications();
    return NextResponse.json(notifications);
  } catch (error) {
    console.error('[notifications] Failed to fetch:', error);
    return NextResponse.json([]);
  }
}
