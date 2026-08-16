import { NextResponse } from 'next/server';
import { SURAHS_LIST } from '@/lib/quranData';

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      surahs: SURAHS_LIST
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
