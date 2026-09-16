import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** PATCH /api/words/[id] 编辑单词（拼写 / 词性 / 释义） */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const wordId = Number(id);
    if (!Number.isInteger(wordId)) {
      return NextResponse.json({ error: '无效的单词 ID' }, { status: 400 });
    }

    const body = (await request.json()) as { word?: string; pos?: string; translation?: string; starred?: boolean };
    const updates: Record<string, string | boolean> = {};
    if (typeof body.word === 'string') {
      const cleaned = body.word.trim().toLowerCase().replace(/[^a-z'-]/g, '');
      if (cleaned.length < 1 || cleaned.length > 30) {
        return NextResponse.json({ error: '单词格式不正确' }, { status: 400 });
      }
      updates.word = cleaned;
    }
    if (typeof body.pos === 'string') updates.pos = body.pos.trim().slice(0, 20);
    if (typeof body.translation === 'string') updates.translation = body.translation.trim().slice(0, 200);
    if (typeof body.starred === 'boolean') updates.starred = body.starred;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('words')
      .update(updates)
      .eq('id', wordId)
      .select('id, word, pos, translation, translation_source, source_file, correct_round, recite_count, total_typed, status, starred')
      .maybeSingle();
    if (error) throw new Error(`更新单词失败: ${error.message}`);
    if (!data) return NextResponse.json({ error: '单词不存在' }, { status: 404 });

    return NextResponse.json({ word: data });
  } catch (error) {
    console.error('[words:PATCH] 更新失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '更新失败' }, { status: 500 });
  }
}

/** DELETE /api/words/[id] 删除单词（背诵流水级联删除） */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const wordId = Number(id);
    if (!Number.isInteger(wordId)) {
      return NextResponse.json({ error: '无效的单词 ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { error } = await client.from('words').delete().eq('id', wordId);
    if (error) throw new Error(`删除单词失败: ${error.message}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[words:DELETE] 删除失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '删除失败' }, { status: 500 });
  }
}
