import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const ROUNDS_PER_RECITE = 3;

interface WordRow {
  id: number;
  word: string;
  correct_round: number;
  recite_count: number;
  total_typed: number;
}

/**
 * POST /api/practice/type 照抄校验
 * - 正确：本轮进度 +1；累计 3 遍记为已背诵 1 遍（recite_count 累加，correct_round 归零）
 * - 错误：本轮 3 遍进度清零，需重新拼写 3 遍
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { wordId?: number; input?: string };
    if (!body.wordId || typeof body.input !== 'string') {
      return NextResponse.json({ error: '缺少 wordId 或 input' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: rows, error } = await client
      .from('words')
      .select('id, word, correct_round, recite_count, total_typed')
      .eq('id', body.wordId)
      .limit(1);
    if (error) throw new Error(`查询单词失败: ${error.message}`);
    const word = rows?.[0] as WordRow | undefined;
    if (!word) return NextResponse.json({ error: '单词不存在' }, { status: 404 });

    const typed = body.input.trim().toLowerCase();
    const correct = typed === word.word.toLowerCase();

    if (!correct) {
      // 拼写错误：重置本轮进度，重新拼写 3 遍
      const { error: resetError } = await client
        .from('words')
        .update({ correct_round: 0, status: 'practicing' })
        .eq('id', word.id);
      if (resetError) throw new Error(`重置进度失败: ${resetError.message}`);
      return NextResponse.json({
        correct: false,
        correct_round: 0,
        recite_count: word.recite_count,
        total_typed: word.total_typed,
        completed_round: false,
      });
    }

    const newRound = word.correct_round + 1;
    const completedRound = newRound >= ROUNDS_PER_RECITE;

    const updatePayload = completedRound
      ? {
          correct_round: 0,
          recite_count: word.recite_count + 1,
          total_typed: word.total_typed + 1,
          status: 'done',
          recited_at: new Date().toISOString(),
        }
      : { correct_round: newRound, total_typed: word.total_typed + 1, status: 'practicing' };

    // 单词进度更新与背诵流水写入并行执行（减少一次串行往返，加速回车响应）
    const [updateResult, recordResult] = await Promise.all([
      client.from('words').update(updatePayload).eq('id', word.id),
      client.from('practice_records').insert({
        word_id: word.id,
        word: word.word,
        round_index: newRound,
        session_no: word.recite_count + 1,
      }),
    ]);
    if (updateResult.error) throw new Error(`更新拼写进度失败: ${updateResult.error.message}`);
    if (recordResult.error) throw new Error(`写入背诵记录失败: ${recordResult.error.message}`);

    return NextResponse.json({
      correct: true,
      correct_round: completedRound ? 0 : newRound,
      recite_count: completedRound ? word.recite_count + 1 : word.recite_count,
      total_typed: word.total_typed + 1,
      completed_round: completedRound,
    });
  } catch (error) {
    console.error('[practice/type] 校验失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '校验失败' }, { status: 500 });
  }
}
