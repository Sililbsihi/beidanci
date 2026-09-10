import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  extractTextFromFetchResponse,
  extractWordsFromImage,
  extractWordsFromText,
  getFetchClient,
  getStorage,
} from '@/lib/word-app';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface UploadFileRow {
  id: number;
  filename: string;
  file_key: string;
  file_type: string;
}

/** POST /api/recognize 识别文件中的英文单词（图片走多模态 OCR，文档走解析 + LLM 选词） */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { fileId?: number };
    if (!body.fileId) {
      return NextResponse.json({ error: '缺少 fileId' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: fileRows, error: fileError } = await client
      .from('upload_files')
      .select('id, filename, file_key, file_type')
      .eq('id', body.fileId)
      .limit(1);
    if (fileError) throw new Error(`查询文件失败: ${fileError.message}`);
    const file = fileRows?.[0] as UploadFileRow | undefined;
    if (!file) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    let words: Array<{ word: string; pos?: string }> = [];

    if (file.file_type === 'image') {
      // 图片：读取内容转 base64，交给多模态模型精准识别
      const buffer = await getStorage().readFile({ fileKey: file.file_key });
      const mime = buffer.subarray(0, 4).toString('hex') === '89504e47' ? 'image/png' : 'image/jpeg';
      words = await extractWordsFromImage(buffer.toString('base64'), mime);
    } else {
      // PDF / Word / PPT / Excel / 文本：签名 URL 抓取解析出文本后再选词
      const signedUrl = await getStorage().generatePresignedUrl({ key: file.file_key, expireTime: 3600 });
      let text = '';
      if (file.file_type === 'text') {
        // 纯文本文件直接拉取原始内容，不走文档解析服务
        const resp = await fetch(signedUrl);
        text = (await resp.text()).slice(0, 12000);
        console.info(`[recognize] text 文件直取长度=${text.length}`);
      } else {
        const response = await getFetchClient().fetch(signedUrl);
        text = extractTextFromFetchResponse(response.content ?? []);
        console.info(`[recognize] 文档解析长度=${text.length}`);
      }
      if (!text.trim()) {
        return NextResponse.json(
          { error: '未能从文件中解析出文本内容，请确认文件内包含英文内容' },
          { status: 422 },
        );
      }
      words = await extractWordsFromText(text);
    }

    // 文件即用即焚：单词已提取完毕，立即删除对象存储文件并标记记录为 deleted（失败不阻塞返回）
    try {
      await getStorage().deleteFile({ fileKey: file.file_key });
      await client
        .from('upload_files')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', file.id);
      console.info(`[recognize] 临时文件已清理 fileKey=${file.file_key}`);
    } catch (cleanupError) {
      console.warn(`[recognize] 临时文件清理失败 fileKey=${file.file_key}`, cleanupError);
    }

    return NextResponse.json({ words, file: { id: file.id, filename: file.filename } });
  } catch (error) {
    console.error('[recognize] 识别失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '识别失败' }, { status: 500 });
  }
}
