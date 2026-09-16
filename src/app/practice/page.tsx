'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target, Info, PencilLine, Lightbulb, SkipForward, CircleCheck, PartyPopper, BookOpen, Repeat, FileUp, Sparkles, Star,
} from 'lucide-react';

interface WordRow {
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
  created_at?: string;
  /** 星标（记录页星系展示） */
  starred?: boolean;
  /** 服务端计算的完成态：本轮背诵目标已达成（重复导入会重新变为未完成） */
  _done: boolean;
  /** 本地渲染专用：乐观更新版本号（不落库），用于丢弃迟到的服务端响应 */
  _rev?: number;
}

interface TypeResult {
  correct: boolean;
  correct_round: number;
  recite_count: number;
  total_typed: number;
  completed_round: boolean;
  error?: string;
}

const RAINBOW_BAR =
  'bg-[linear-gradient(90deg,#E57373_0%,#F0A45B_20%,#E9C96A_40%,#7E9F7A_60%,#7FA3C9_80%,#A88BC9_100%)]';
const JELLY_COLORS = ['#E57373', '#F0A45B', '#E9C96A', '#7E9F7A', '#7FA3C9', '#A88BC9'];
const ROUNDS_PER_RECITE = 3;

export default function PracticePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState<WordRow[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'idle' | 'correct' | 'error'; message: string }>({
    type: 'idle',
    message: '',
  });
  const [shaking, setShaking] = useState(false);
  const [enterPop, setEnterPop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roundAllDone, setRoundAllDone] = useState(false);
  /** 星标功能可用性：words.starred 列缺失（未执行 DDL）时为 false，隐藏星标入口 */
  const [starredReady, setStarredReady] = useState(false);

  const current = useMemo(() => words.find((w) => w.id === currentId) ?? null, [words, currentId]);

  /** 进度数据全部由 words 派生：乐观更新即时反映，无需手动同步 stats */
  const progress = useMemo(() => {
    const total = words.length;
    const done = words.filter((w) => w._done).length;
    // 最近一次导入的批次：取 created_at 最新的单词所属批次，统计该批总量与已背数量
    const withBatch = words.filter((w) => w.batch_id);
    let latestBatch: { total: number; done: number } | null = null;
    if (withBatch.length > 0) {
      const latestBatchId = withBatch.reduce((acc, w) =>
        new Date(w.created_at ?? 0).getTime() > new Date(acc.created_at ?? 0).getTime() ? w : acc,
      ).batch_id;
      const batchWords = words.filter((w) => w.batch_id === latestBatchId);
      latestBatch = { total: batchWords.length, done: batchWords.filter((w) => w._done).length };
    }
    return { total, done, remaining: total - done, latestBatch };
  }, [words]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/practice/today');
      const data = (await res.json()) as { words?: WordRow[] };
      const list = data.words ?? [];
      setWords(list);
      setStarredReady(list.some((w) => w.starred !== undefined));
      setCurrentId((prevId) => {
        const prev = prevId ? list.find((w) => w.id === prevId) : undefined;
        // 刷新保留位置的前提是该词还没完成本轮；否则定位队列中第一个未完成的词（严格顺序）
        if (prev && !prev._done) return prev.id;
        const firstUnfinished = list.find((w) => !w._done);
        return firstUnfinished?.id ?? list[0]?.id ?? null;
      });
      // 进入页面时若所有单词都已完成本轮背诵，直接展示完成态
      setRoundAllDone(list.length > 0 && list.every((w) => w._done));
    } catch {
      // 加载失败时保持空队列
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // 最新 words 引用（补译循环读取，避免旧闭包）
  const wordsRef = useRef<WordRow[]>([]);
  wordsRef.current = words;

  /** 把缺释义的未背完词（含历史导入）排队补译：每轮 36 词由服务端小批并发直译，结果直接回写库并同步本地 */
  const backfillBusyRef = useRef(false);
  const backfillTranslations = useCallback(async () => {
    if (backfillBusyRef.current) return;
    backfillBusyRef.current = true;
    try {
      for (;;) {
        const missing = wordsRef.current
          .filter((w) => !w.translation && !w._done)
          .map((w) => w.word);
        if (missing.length === 0) break;
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: missing.slice(0, 36) }),
        });
        if (!res.ok) break;
        const data = (await res.json()) as { translations?: Array<{ word: string; translation: string }> };
        const updates = (data.translations ?? []).filter((t) => t.translation);
        if (updates.length === 0) break;
        const defMap = new Map(updates.map((t) => [t.word, t.translation] as const));
        setWords((prev) =>
          prev.map((w) => (defMap.has(w.word) ? { ...w, translation: defMap.get(w.word)! } : w)),
        );
      }
    } catch {
      // 自动补译失败静默：用户可对当前词手动一键翻译
    } finally {
      backfillBusyRef.current = false;
    }
  }, []);

  // 队列就绪后自动补译所有缺释义且未背完的词
  useEffect(() => {
    if (loading) return;
    if (words.some((w) => !w.translation && !w._done)) {
      void backfillTranslations();
    }
  }, [loading, words, backfillTranslations]);

  /** 手动一键翻译当前词：单词单次直译调用，约 1 秒返回（服务端同步回写库） */
  const [translating, setTranslating] = useState(false);
  const [translateFailed, setTranslateFailed] = useState(false);
  const handleTranslateCurrent = useCallback(
    async (word: string) => {
      if (translating) return;
      setTranslating(true);
      setTranslateFailed(false);
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: [word] }),
        });
        if (!res.ok) throw new Error('translate failed');
        const data = (await res.json()) as { translations?: Array<{ word: string; translation: string }> };
        const hit = data.translations?.find((t) => t.word === word && t.translation);
        if (hit) {
          setWords((prev) =>
            prev.map((w) => (w.word === word ? { ...w, translation: hit.translation } : w)),
          );
        } else {
          setTranslateFailed(true);
        }
      } catch {
        setTranslateFailed(true);
      } finally {
        setTranslating(false);
        if (translateFailed) {
          setTimeout(() => setTranslateFailed(false), 3000);
        }
      }
    },
    [translating],
  );

  /** 星标/取消星标：星标词会在记录页组成星系；乐观更新，失败回滚 */
  const toggleStarred = useCallback(async (row: WordRow) => {
    const next = !row.starred;
    setWords((prev) => prev.map((w) => (w.id === row.id ? { ...w, starred: next } : w)));
    try {
      const res = await fetch(`/api/words/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: next }),
      });
      if (!res.ok) throw new Error('star failed');
    } catch {
      setWords((prev) => prev.map((w) => (w.id === row.id ? { ...w, starred: !next } : w)));
    }
  }, []);

  /** 切换单词后聚焦键入区，并播放轻微果冻弹入动画（拼错的震动与此互斥） */
  useEffect(() => {
    if (!currentId) return;
    inputRef.current?.focus();
    setEnterPop(true);
    const timer = window.setTimeout(() => setEnterPop(false), 450);
    return () => window.clearTimeout(timer);
  }, [currentId]);

  /**
   * 局部更新单词。rev 语义：调用方基于的快照版本（w._rev 当前值）。
   * 版本一致才应用，应用后内部原子 +1——调用方永远不手写 _rev，杜绝版本号错位导致更新被静默丢弃。
   * 迟到的服务端响应（rev 不等于当前版本）直接丢弃，不回滚本地乐观进度。
   */
  const patchWord = useCallback((id: number, patch: Partial<WordRow>, rev?: number) => {
    setWords((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const currentRev = w._rev ?? 0;
        if (rev !== undefined && currentRev !== rev) return w;
        return { ...w, ...patch, _rev: (rev ?? currentRev) + 1 };
      }),
    );
  }, []);

  /** 挑选下一个该背的单词：从当前词位置向下找第一个未完成的词（含背了一半的），到队列尾部则回头补漏；全部完成返回 null。严格保持队列顺序，不回跳 */
  const pickNextWord = (list: WordRow[], excludeId: number | null): WordRow | null => {
    const idx = excludeId === null ? -1 : list.findIndex((w) => w.id === excludeId);
    for (let i = idx + 1; i < list.length; i++) {
      if (!list[i]._done) return list[i];
    }
    for (let i = 0; i <= idx; i++) {
      if (list[i].id !== excludeId && !list[i]._done) return list[i];
    }
    return null;
  };

  /** 后台静默持久化拼写结果（乐观更新后调用，返回权威数据用于校正）。rev 为提交时的快照版本 */
  const persistType = useCallback(async (wordId: number, input: string, rev?: number) => {
    try {
      const res = await fetch('/api/practice/type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordId, input }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as TypeResult;
      if (typeof data.correct !== 'boolean') return;
      // 乐观更新已把版本推进到 rev+1；服务端权威校正基于 rev+1 应用。
      // 若用户在此期间又提交了输入（版本更高），本响应视为迟到数据被丢弃，避免回滚
      patchWord(
        wordId,
        {
          correct_round: data.correct_round,
          recite_count: data.recite_count,
          total_typed: data.total_typed,
          status: data.completed_round ? 'done' : 'practicing',
          _done: data.completed_round,
        },
        (rev ?? 0) + 1,
      );
    } catch {
      // 持久化失败静默：本地已乐观推进，下次进入页面由服务端数据校正
    }
  }, [patchWord]);

  /** 提交本轮照抄结果：本地即时校验 + 乐观更新（0 等待），后台异步持久化 */
  const submitTyped = useCallback(() => {
    if (!current || !typed) return;
    const wordId = current.id;

    // 本地即时校验，拼写错误立即反馈（不等待网络）
    if (typed.trim().toLowerCase() !== current.word.toLowerCase()) {
      const snapshotRev = current._rev ?? 0;
      setShaking(true);
      window.setTimeout(() => setShaking(false), 550);
      setFeedback({ type: 'error', message: '拼写错误，重新拼写 3 遍直至全部正确' });
      patchWord(wordId, { correct_round: 0, status: 'practicing', _done: false }, snapshotRev);
      setTyped('');
      inputRef.current?.focus();
      void persistType(wordId, typed, snapshotRev);
      return;
    }

    // 正确：本地乐观计算进度，UI 立即响应
    const nextRound = current.correct_round + 1;
    const completedRound = nextRound >= ROUNDS_PER_RECITE;
    const snapshotRev = current._rev ?? 0;
    patchWord(
      wordId,
      {
        correct_round: completedRound ? 0 : nextRound,
        recite_count: completedRound ? current.recite_count + 1 : current.recite_count,
        total_typed: current.total_typed + 1,
        status: completedRound ? 'done' : 'practicing',
        _done: completedRound,
      },
      snapshotRev,
    );
    setTyped('');
    void persistType(wordId, typed, snapshotRev);

    if (completedRound) {
      setFeedback({ type: 'idle', message: '' });
      // 在事件处理器内直接选词（updater 内不能有副作用，StrictMode 下 setCurrentId 会被吞掉导致不切词）
      // 完成一轮的当前词已通过上方 patchWord 标记为完成，此处按队列向下找第一个未完成的词
      const next = pickNextWord(words, wordId);
      if (next) {
        setCurrentId(next.id);
      } else {
        setRoundAllDone(true);
      }
    } else {
      setFeedback({ type: 'correct', message: `正确！继续第 ${nextRound + 1} 遍` });
      inputRef.current?.focus();
    }
  }, [current, typed, words, persistType]);

  const handleHint = () => {
    if (!current) return;
    setTyped((prev) => (prev.length === 0 ? current.word[0] : prev));
    inputRef.current?.focus();
  };

  const handleSkip = () => {
    if (words.length === 0) return;
    const next = pickNextWord(words, currentId);
    if (!next) return;
    setTyped('');
    setFeedback({ type: 'idle', message: '' });
    setRoundAllDone(false);
    setCurrentId(next.id);
  };

  const goUpload = () => router.push('/');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-on-surface-variant gap-2">
        <BookOpen className="w-5 h-5 animate-pulse" />
        正在准备今日单词…
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="text-center py-24 space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/12 flex items-center justify-center">
          <PartyPopper className="w-7 h-7 text-primary" />
        </div>
        <p className="font-display font-bold text-lg text-on-surface">还没有待背单词</p>
        <p className="text-sm text-on-surface-variant">先上传文件识别单词，再回到这里开始照抄背诵</p>
        <button
          className="bg-primary text-white border-none px-5 py-2.5 rounded-full text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all"
          onClick={goUpload}
        >
          去上传文件
        </button>
      </div>
    );
  }

  const letters = current ? current.word.split('') : [];

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold font-display text-on-surface">今日背诵练习</h1>
        <p className="text-sm text-on-surface-variant mt-1">看着单词逐字母照抄键入，正确 3 遍即完成背诵</p>
      </div>

      {/* 顶部进度摘要条 */}
      <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-primary/12 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-on-surface-variant">今日进度</p>
              <p className="font-display font-bold text-on-surface leading-tight">
                <span className="text-2xl">{progress.remaining}</span>
                <span className="text-sm font-sans font-medium text-on-surface-variant"> 个单词还未背诵</span>
              </p>
            </div>
          </div>
          {progress.latestBatch && (
            <p className="text-xs text-on-surface-variant inline-flex items-center gap-1.5 pb-1">
              <Info className="w-3.5 h-3.5" />
              最近导入 {progress.latestBatch.total} 个 · 已背 {progress.latestBatch.done} 个
            </p>
          )}
        </div>
        <div className="mt-4 h-2.5 rounded-full bg-surface-container overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${RAINBOW_BAR}`}
            style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* 左列：核心单词卡 */}
        <div className="lg:col-span-2">
          {roundAllDone && (
            <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-float p-10 relative overflow-hidden text-center animate-jelly-pop">
              <div className={`absolute top-0 left-0 right-0 h-1 ${RAINBOW_BAR} opacity-70`} />
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/12 flex items-center justify-center">
                <PartyPopper className="w-8 h-8 text-primary" />
              </div>
              <h2 className="mt-5 font-display font-bold text-2xl text-on-surface">本批单词已全部完成一轮背诵</h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                共 {words.length} 个单词 · 重复导入的单词会重新进入队列再背一遍。
              </p>
              <div className={`mt-5 mx-auto h-[3px] w-40 rounded-full ${RAINBOW_BAR} opacity-70`} />
              <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
                <button
                  className="bg-primary text-white border-none px-5 py-2.5 rounded-full text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all inline-flex items-center gap-2"
                  onClick={() => {
                    setRoundAllDone(false);
                    setTyped('');
                    setFeedback({ type: 'idle', message: '' });
                    setCurrentId(words[0]?.id ?? null);
                  }}
                >
                  <Repeat className="w-4 h-4" />
                  再背一轮（累加次数）
                </button>
                <button
                  className="bg-surface-container text-on-surface border-none px-5 py-2.5 rounded-full text-sm font-medium hover:bg-surface-container-high active:scale-[0.98] transition-all inline-flex items-center gap-2"
                  onClick={goUpload}
                >
                  <FileUp className="w-4 h-4 text-primary" />
                  上传新单词
                </button>
              </div>
            </section>
          )}
          {!roundAllDone && current && (
            <section
              className={`bg-surface/80 backdrop-blur-md rounded-2xl shadow-float p-6 md:p-8 relative overflow-hidden ${
                shaking ? 'animate-jelly-shake' : enterPop ? 'animate-jelly-pop' : ''
              }`}
            >
              <div className={`absolute top-0 left-0 right-0 h-1 ${RAINBOW_BAR} opacity-70`} />

              {/* 卡片顶部：词性 + 轮次 */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {current.pos ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-jelly-blue/15 text-jelly-blue">
                      {current.pos}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-surface-container text-on-surface-variant">
                      单词
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {starredReady && (
                    <button
                      type="button"
                      onClick={() => void toggleStarred(current)}
                      title={current.starred ? '取消星标' : '星标这个词（记录页组成星系）'}
                      className="border-none bg-transparent p-1 rounded-full transition-transform active:scale-90 cursor-pointer"
                    >
                      <Star
                        className={`w-5 h-5 transition-colors ${current.starred ? 'text-[#E9C96A] fill-[#E9C96A]' : 'text-on-surface-variant/40 hover:text-[#E9C96A]'}`}
                      />
                    </button>
                  )}
                  <span className="text-xs font-medium text-on-surface-variant">
                    第 {Math.min(current.correct_round + 1, ROUNDS_PER_RECITE)} 遍 / 共 {ROUNDS_PER_RECITE} 遍
                  </span>
                </div>
              </div>

              {/* 英文单词展示区（为主，大号）：照着此单词逐字母抄写 */}
              <div className="mt-8 text-center">
                <p className="text-5xl md:text-7xl font-display font-bold text-on-surface tracking-[0.08em] leading-tight break-all">
                  {current.word}
                </p>
                <div className={`mt-4 mx-auto h-[3px] w-44 rounded-full ${RAINBOW_BAR} opacity-70`} />
                {/* 中文释义（为辅，位于单词底部，较小）；缺释义时可一键翻译 */}
                {current.translation ? (
                  <p className="mt-4 text-sm md:text-base text-on-surface-variant">
                    {current.pos ? `${current.pos} ` : ''}
                    {current.translation}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleTranslateCurrent(current.word)}
                    disabled={translating}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-jelly-blue/15 px-4 py-1.5 text-xs font-medium text-jelly-blue transition-colors hover:bg-jelly-blue/25 disabled:opacity-60"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${translating ? 'animate-spin' : ''}`} />
                    {translating ? '翻译中…' : translateFailed ? '未匹配到释义' : '一键翻译'}
                  </button>
                )}
                <p className="mt-1.5 text-xs text-on-surface-variant/70">照着上方单词，逐字母键入抄写本遍</p>
              </div>

              {/* 逐字母键入区（大格子果冻键入，键入的字母一格一格显示） */}
              <div className="mt-9 max-w-2xl mx-auto relative cursor-text" onClick={() => inputRef.current?.focus()}>
                <div className="flex flex-wrap justify-center gap-2.5 md:gap-3">
                  {letters.map((char, index) => {
                    if (char === ' ') {
                      // 词间空格：渲染为间隔，无需键入（自动填充）
                      return <div key={index} className="w-3 md:w-4 shrink-0" aria-hidden="true" />;
                    }
                    if (index < typed.length) {
                      return (
                        <div
                          key={index}
                          className="w-12 h-14 md:w-14 md:h-16 rounded-xl bg-surface-container-lowest shadow-card flex items-center justify-center border-b-4 transition-colors"
                          style={{ borderBottomColor: `${JELLY_COLORS[index % JELLY_COLORS.length]}99` }}
                        >
                          <span className="text-2xl md:text-3xl font-display font-bold text-on-surface">
                            {typed[index]}
                          </span>
                        </div>
                      );
                    }
                    if (index === typed.length) {
                      return (
                        <div
                          key={index}
                          className="w-12 h-14 md:w-14 md:h-16 rounded-xl bg-primary/5 flex items-center justify-center ring-2 ring-primary/50 border-b-4 border-transparent transition-colors"
                        >
                          <span className="w-0.5 h-7 md:h-8 bg-primary/70 rounded-full animate-pulse" />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={index}
                        className="w-12 h-14 md:w-14 md:h-16 rounded-xl bg-surface-container flex items-center justify-center border-b-4 border-transparent transition-colors"
                      />
                    );
                  })}
                </div>
                {/* 隐藏输入框：覆盖键入区捕获键盘输入，回车确认本遍 */}
                <input
                  ref={inputRef}
                  value={typed}
                  onChange={(e) => {
                    let value = e.target.value.toLowerCase().replace(/[^a-z0-9\s'-]/g, '').replace(/\s+/g, ' ');
                    // 短语中的空格自动填充，用户只需键入字母
                    if (current) {
                      while (value.length < letters.length && current.word[value.length] === ' ') {
                        value += ' ';
                      }
                    }
                    value = value.slice(0, letters.length);
                    setTyped(value);
                    if (feedback.type === 'error') setFeedback({ type: 'idle', message: '' });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitTyped();
                  }}
                  className="absolute inset-0 opacity-0 cursor-text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label="逐字母键入抄写单词"
                />
              </div>

              {/* 键入状态行 */}
              <div className="mt-5 flex items-center justify-center gap-6 flex-wrap">
                <p className="text-xs text-on-surface-variant">
                  已抄写 {typed.replace(/ /g, '').length} / {letters.filter((c) => c !== ' ').length} 个字母
                </p>
                <p
                  className={`text-xs font-medium inline-flex items-center gap-1 ${
                    feedback.type === 'error' ? 'text-error' : 'text-primary'
                  }`}
                >
                  <PencilLine className="w-3.5 h-3.5" />
                  {feedback.message || `正在第 ${Math.min(current.correct_round + 1, ROUNDS_PER_RECITE)} 遍 · 抄完按回车确认`}
                </p>
              </div>

              {/* 拼写进度圆点 */}
              <div className="mt-6 flex items-center justify-center gap-2.5">
                <span className="text-xs text-on-surface-variant mr-1">拼写进度</span>
                {Array.from({ length: ROUNDS_PER_RECITE }).map((_, index) => (
                  <span
                    key={index}
                    className={`w-3.5 h-3.5 rounded-full ${
                      index < current.correct_round
                        ? index % 2 === 0
                          ? 'bg-[linear-gradient(135deg,#E57373_0%,#F0A45B_50%,#E9C96A_100%)]'
                          : 'bg-[linear-gradient(135deg,#7E9F7A_0%,#7FA3C9_50%,#A88BC9_100%)]'
                        : 'border-2 border-outline bg-transparent'
                    }`}
                  />
                ))}
              </div>

              {/* 提示按钮行 */}
              <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
                <button
                  className="bg-surface-container text-on-surface border-none px-4 py-2 rounded-full text-sm font-medium hover:bg-surface-container-high active:scale-[0.98] transition-all inline-flex items-center gap-2"
                  onClick={handleHint}
                >
                  <Lightbulb className="w-4 h-4 text-jelly-yellow" />
                  提示首字母
                </button>
                <button
                  className="bg-surface-container text-on-surface border-none px-4 py-2 rounded-full text-sm font-medium hover:bg-surface-container-high active:scale-[0.98] transition-all inline-flex items-center gap-2"
                  onClick={handleSkip}
                >
                  <SkipForward className="w-4 h-4 text-on-surface-variant" />
                  跳过这个单词
                </button>
              </div>
            </section>
          )}
        </div>

        {/* 右列：今日待背队列 */}
        <aside className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5 lg:sticky lg:top-24">
          <h2 className="font-display font-bold text-on-surface">今日待背队列</h2>
          <div className="mt-3 space-y-2.5 max-h-[32rem] overflow-y-auto pr-1">
            {words.map((w) => {
              const active = w.id === currentId;
              const finished = w.recite_count >= 1 && w.correct_round === 0;
              return (
                <button
                  key={w.id}
                  onClick={() => {
                    setRoundAllDone(false);
                    setCurrentId(w.id);
                    setTyped('');
                    setFeedback({ type: 'idle', message: '' });
                  }}
                  className={`w-full text-left rounded-xl px-3 py-2.5 transition-all border-none cursor-pointer ${
                    active
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'bg-surface-container/60 hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-display font-bold text-sm flex items-center gap-1 min-w-0 ${finished ? 'text-success' : 'text-on-surface'}`}>
                      {w.starred && <Star className="w-3 h-3 text-[#E9C96A] fill-[#E9C96A] shrink-0" />}
                      <span className="truncate">{w.word}</span>
                    </span>
                    {finished ? (
                      <CircleCheck className="w-4 h-4 text-success shrink-0" />
                    ) : (
                      <span className="flex items-center gap-1 shrink-0">
                        {Array.from({ length: ROUNDS_PER_RECITE }).map((_, i) => (
                          <span
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full ${
                              i < w.correct_round ? 'bg-primary' : 'bg-outline'
                            }`}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-on-surface-variant truncate">
                    {finished ? `已背诵 ${w.recite_count} 遍 · 累计 ${w.total_typed} 次` : (w.translation ?? '暂无释义')}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
