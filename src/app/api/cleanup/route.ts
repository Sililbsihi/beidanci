import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { storage } from '@/lib/word-app';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface UploadFileRow {
  id: number;
  filename: string;
  file_key: string;
}

/**
 * POST /api/cleanup 背诵完成后清理临时文件
 * 删除对象存储中的文件并将记录标记为 deleted（仅保留单词与背诵记录）
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { batchId?: string };
    const batchId = body.batchId?.trim();
    if (!batchId) {
      return NextResponse.json({ error: '缺少 batchId' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('upload_files')
      .select('id, filename, file_key')
      .eq('batch_id', batchId)
      .eq('status', 'active');
    if (error) throw new Error(`查询临时文件失败: ${error.message}`);

    const files = (data ?? []) as UploadFileRow[];
    const filenames: string[] = [];

    for (const file of files) {
      try {
        await storage.deleteFile({ fileKey: file.file_key });
      } catch (deleteError) {
        console.error(`[cleanup] 删除对象存储文件失败 fileKey=${file.file_key}`, deleteError);
      }
      filenames.push(file.filename);
    }

    if (files.length > 0) {
      const { error: updateError } = await client
        .from('upload_files')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .in(
          'id',
          files.map((f) => f.id),
        );
      if (updateError) throw new Error(`更新清理状态失败: ${updateError.message}`);
    }

    return NextResponse.json({ deleted: files.length, filenames });
  } catch (error) {
    console.error('[cleanup] 清理失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '清理失败' }, { status: 500 });
  }
}
