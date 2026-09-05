import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { detectFileType, storage } from '@/lib/word-app';

export const runtime = 'nodejs';

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/** POST /api/upload 上传临时文件到对象存储，仅用于本次单词识别 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少上传文件' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '文件不能超过 20MB' }, { status: 400 });
    }

    const fileType = detectFileType(file.name, file.type);
    if (!fileType) {
      return NextResponse.json(
        { error: '不支持的文件格式，请上传图片（jpg/png/jpeg）、Word、PDF、PPT 或 Excel 文件' },
        { status: 400 },
      );
    }

    const batchId = crypto.randomUUID();
    // 规范文件名：仅保留字母数字点下划线短横，避免对象存储非法 key
    const safeName = file.name.replace(/[^\w.-]/g, '_').slice(-120) || 'file';
    const buffer = Buffer.from(await file.arrayBuffer());

    // 注意：必须使用 uploadFile 返回的实际 key
    const fileKey = await storage.uploadFile({
      fileContent: buffer,
      fileName: `tmp-words/${batchId}/${safeName}`,
      contentType: file.type || 'application/octet-stream',
    });

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('upload_files')
      .insert({
        filename: file.name.slice(0, 250),
        file_key: fileKey,
        file_type: fileType,
        batch_id: batchId,
      })
      .select('id, filename, file_key, file_type, batch_id, created_at')
      .single();
    if (error) throw new Error(`记录上传文件失败: ${error.message}`);

    return NextResponse.json({ file: data });
  } catch (error) {
    console.error('[upload] 上传失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '上传失败' }, { status: 500 });
  }
}
