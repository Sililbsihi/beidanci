import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { probeWordsNewColumns, probeWordsPhonetic } from '@/lib/word-app';

export const runtime = 'nodejs';

interface WordItem {
  word: string;
  pos?: string;
  translation?: string;
  phonetic?: string;
  translation_source?: string;
  source_file?: string;
  batchId?: string;
}

interface WordsListRow {
  id: number;
  word: string;
  pos: string | null;
  translation: string | null;
  translation_source: string;
  source_file: string | null;
  batch_id: string | null;
  correct_round: number;
  recite_count: number;
  total_typed: number;
  status: string;
  recited_at: string | null;
  created_at: string;
}

interface ExistingRow {
  id: number;
  word: string;
  recite_count: number;
  import_count: number;
}

/** GET /api/words 全部单词列表（识别校对页使用） */
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('words')
      .select('id, word, pos, translation, translation_source, source_file, batch_id, correct_round, recite_count, total_typed, status, recited_at, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`查询单词失败: ${error.message}`);
    return NextResponse.json({ words: (data ?? []) as unknown as WordsListRow[] });
  } catch (error) {
    console.error('[words:GET] 查询失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '查询失败' }, { status: 500 });
  }
}

/**
 * POST /api/words 校对完成，批量加入背诵
 * - 新词：插入队列（导入次数记 1）
 * - 重复导入：不再跳过——重置本轮进度（correct_round 清零、status 回 pending），
 *   目标遍数 target_recite 提升到「已背遍数 + 1」，该词重新进入待背队列再背一遍；
 *   历史累计遍数 recite_count 保留不被抹掉，导入次数 import_count +1
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { batchId?: string; items?: WordItem[] };
    const items = body.items ?? [];
    if (items.length === 0) {
      return NextResponse.json({ error: '没有可加入的单词' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const hasNewColumns = await probeWordsNewColumns(client);

    // 规范化 + 去重
    const normalized = new Map<string, WordItem>();
    for (const item of items) {
      // 保留空格与连字符，支持多词短语（如 ocean energy）
      const word = typeof item.word === 'string' ? item.word.trim().toLowerCase().replace(/[^a-z0-9\s'-]/g, '').replace(/\s+/g, ' ').trim() : '';
      if (word.length < 1 || word.length > 40 || normalized.has(word)) continue;
      normalized.set(word, { ...item, word });
    }
    if (normalized.size === 0) {
      return NextResponse.json({ error: '没有有效的英文单词' }, { status: 400 });
    }

    // 查重：词库中已存在的单词走"重复导入重新背诵"，其余为新词插入
    const wordList = [...normalized.keys()];
    const hasPhonetic = await probeWordsPhonetic(client);
    const existCols = [
      'word',
      ...(hasNewColumns ? ['id', 'recite_count', 'import_count'] : []),
      ...(hasPhonetic ? ['phonetic'] : []),
    ].join(', ');
    const { data: existing, error: existError } = await client
      .from('words')
      .select(existCols)
      .in('word', wordList);
    if (existError) throw new Error(`查重失败: ${existError.message}`);
    const existingRows = (existing ?? []) as unknown as Array<
      ExistingRow & { id?: number; recite_count?: number; import_count?: number; phonetic?: string | null }
    >;
    const existingMap = new Map(existingRows.map((row) => [row.word, row]));

    const toInsert = [...normalized.values()]
      .filter((item) => !existingMap.has(item.word))
      .map((item) => ({
        word: item.word,
        pos: item.pos?.slice(0, 20) ?? null,
        translation: item.translation?.slice(0, 200) || null,
        translation_source: ['search', 'manual'].includes(item.translation_source ?? '') ? (item.translation_source as string) : 'upload',
        source_file: item.source_file?.slice(0, 250) ?? null,
        batch_id: (item.batchId ?? body.batchId)?.slice(0, 36) ?? null,
        status: 'pending',
        ...(hasNewColumns ? { target_recite: 1, import_count: 1 } : {}),
        ...(hasPhonetic ? { phonetic: item.phonetic?.slice(0, 60) || null } : {}),
      }));

    if (toInsert.length > 0) {
      const { error: insertError } = await client.from('words').insert(toInsert);
      if (insertError) throw new Error(`加入背诵失败: ${insertError.message}`);
    }

    // 重复导入：重置进度重新背诵（仅在新列就绪时启用，旧结构退回旧行为）
    let reimported = 0;
    if (hasNewColumns) {
      const batchId = body.batchId?.slice(0, 36) ?? null;
      for (const item of normalized.values()) {
        const row = existingMap.get(item.word);
        if (!row?.id) continue;
        const patch: Record<string, unknown> = {
          target_recite: (row.recite_count ?? 0) + 1,
          import_count: (row.import_count ?? 1) + 1,
          correct_round: 0,
          status: 'pending',
        };
        if (batchId) patch.batch_id = batchId;
        if (item.source_file) patch.source_file = item.source_file.slice(0, 250);
        if (item.translation) patch.translation = item.translation.slice(0, 200);
        if (item.pos) patch.pos = item.pos.slice(0, 20);
        if (hasPhonetic && item.phonetic && !row.phonetic) patch.phonetic = item.phonetic.slice(0, 60);
        const { error: updateError } = await client.from('words').update(patch).eq('id', row.id);
        if (updateError) throw new Error(`重复导入处理失败: ${updateError.message}`);
        reimported += 1;
      }
    }

    return NextResponse.json({ added: toInsert.length, reimported, skipped: 0 });
  } catch (error) {
    console.error('[words:POST] 加入失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '加入失败' }, { status: 500 });
  }
}
