import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAccount } from '@/lib/auth';

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
 * - 并发安全：正确分支使用乐观锁（以读到的 correct_round 为条件做原子更新），
 *   0 行受影响说明并发冲突，重读最新进度后重试，杜绝连背时两遍请求互相覆盖导致少计遍数
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccount();
    if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const body = (await request.json()) as { wordId?: number; input?: string };
    if (!body.wordId || typeof body.input !== 'string') {
      return NextResponse.json({ error: '缺少 wordId 或 input' }, { status: 400 });
    }

    const client = ctx.supabase;
    const { data: rows, error } = await client
      .from('words')
      .select('id, word, correct_round, recite_count, total_typed')
      .eq('id', body.wordId)
      .eq('user_id', ctx.account.id)
      .limit(1);
    if (error) throw new Error(`查询单词失败: ${error.message}`);
    const word = rows?.[0] as WordRow | undefined;
    if (!word) return NextResponse.json({ error: '单词不存在' }, { status: 404 });

    const typed = body.input.trim().toLowerCase();
    const correct = typed === word.word.toLowerCase();

    if (!correct) {
      // 拼写错误：重置本轮进度（写入 0 为幂等操作，无并发危害）
      const { error: resetError } = await client
        .from('words')
        .update({ correct_round: 0, status: 'practicing' })
        .eq('id', word.id);
      if (resetError) throw new Error(`重置进度失败: ${resetError.message}`);
      // 写入错误流水（round_index=0 代表一次拼错，与 round_index=3 的完成记录区分），供"犯错最多"排行榜聚合
      const { error: mistakeError } = await client.from('practice_records').insert({
        word_id: word.id,
        word: word.word,
        round_index: 0,
        session_no: word.recite_count,
        user_id: ctx.account.id,
      });
      if (mistakeError) console.error('[practice/type] 写入错误流水失败', mistakeError);
      return NextResponse.json({
        correct: false,
        correct_round: 0,
        recite_count: word.recite_count,
        total_typed: word.total_typed,
        completed_round: false,
      });
    }

    // 乐观锁重试：读 → 条件更新（correct_round 必须等于读到的值）→ 冲突则重读
    let lastRound = word.correct_round;
    let reciteCount = word.recite_count;
    let totalTyped = word.total_typed;

    for (let attempt = 0; attempt < 3; attempt++) {
      const newRound = lastRound + 1;
      const completedRound = newRound >= ROUNDS_PER_RECITE;

      const updatePayload = completedRound
        ? {
            correct_round: 0,
            recite_count: reciteCount + 1,
            total_typed: totalTyped + 1,
            status: 'done',
            recited_at: new Date().toISOString(),
          }
        : { correct_round: newRound, total_typed: totalTyped + 1, status: 'practicing' };

      const { data: updatedRows, error: updateError } = await client
        .from('words')
        .update(updatePayload)
        .eq('id', word.id)
        .eq('correct_round', lastRound)
        .select('correct_round, recite_count, total_typed');
      if (updateError) throw new Error(`更新拼写进度失败: ${updateError.message}`);

      const updated = (updatedRows as WordRow[] | null)?.[0];
      if (updated) {
        // 进度原子推进成功，写入背诵流水（保证记录与进度一致）
        const { error: recordError } = await client.from('practice_records').insert({
          word_id: word.id,
          word: word.word,
          round_index: newRound,
          session_no: reciteCount + 1,
          user_id: ctx.account.id,
        });
        if (recordError) throw new Error(`写入背诵记录失败: ${recordError.message}`);
        return NextResponse.json({
          correct: true,
          correct_round: updated.correct_round,
          recite_count: updated.recite_count,
          total_typed: updated.total_typed,
          completed_round: completedRound,
        });
      }

      // 0 行受影响：并发冲突，重读最新进度后重试
      const { data: rereadRows, error: rereadError } = await client
        .from('words')
        .select('correct_round, recite_count, total_typed')
        .eq('id', word.id)
        .limit(1);
      if (rereadError) throw new Error(`重读进度失败: ${rereadError.message}`);
      const reread = (rereadRows as WordRow[] | null)?.[0];
      if (!reread) return NextResponse.json({ error: '单词不存在' }, { status: 404 });
      lastRound = reread.correct_round;
      reciteCount = reread.recite_count;
      totalTyped = reread.total_typed;
    }

    // 极端情况（连续冲突 3 次）：返回服务端当前状态，前端以服务端为准校正
    return NextResponse.json({
      correct: true,
      correct_round: lastRound,
      recite_count: reciteCount,
      total_typed: totalTyped,
      completed_round: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '拼写校验失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
