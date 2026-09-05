'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target, Info, PencilLine, Lightbulb, SkipForward, CircleCheck, Trash2, PartyPopper, BookOpen,
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
  const [stats, setStats] = useState({ total: 0, done: 0 });
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'idle' | 'correct' | 'error' | 'round-done'; message: string }>({
    type: 'idle',
    message: '',
  });
  const [shaking, setShaking] = useState(false);
  const [cleanedFiles, setCleanedFiles] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const current = useMemo(() => words.find((w) => w.id === currentId) ?? null, [words, currentId]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/practice/today');
      const data = (await res.json()) as { words?: WordRow[]; stats?: { total: number; done: number } };
      const list = data.words ?? [];
      setWords(list);
      setStats(data.stats ?? { total: list.length, done: 0 });
      setCurrentId((prevId) => {
        if (prevId && list.some((w) => w.id === prevId)) return prevId;
        const firstActive = list.find((w) => w.correct_round > 0 || w.recite_count === 0);
        return firstActive?.id ?? list[0]?.id ?? null;
      });
    } catch {
      // 加载失败时保持空队列
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  /** 切换单词后聚焦键入区 */
  useEffect(() => {
    inputRef.current?.focus();
  }, [currentId]);

  /** 批次内全部单词完成至少一轮背诵后，自动清理临时文件 */
  useEffect(() => {
    if (words.length === 0 || cleanedFiles) return;
    const allDone = words.every((w) => w.recite_count >= 1 && w.correct_round === 0);
    if (!allDone) return;
    const batchIds = [...new Set(words.map((w) => w.batch_id).filter((b): b is string => Boolean(b)))];
    if (batchIds.length === 0) return;
    void (async () => {
      const filenames: string[] = [];
      for (const batchId of batchIds) {
        try {
          const res = await fetch('/api/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId }),
          });
          const data = (await res.json()) as { filenames?: string[] };
          filenames.push(...(data.filenames ?? []));
        } catch {
          // 清理失败不阻塞背诵流程，记录页仍会展示待清理状态
        }
      }
      setCleanedFiles(filenames);
    })();
  }, [words, cleanedFiles]);

  const patchWord = (id: number, patch: Partial<WordRow>) => {
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  };

  /** 提交本轮照抄结果 */
  const submitTyped = useCallback(async () => {
    if (!current || !typed) return;
    try {
      const res = await fetch('/api/practice/type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordId: current.id, input: typed }),
      });
      const data = (await res.json()) as TypeResult;
      if (!res.ok) throw new Error(data.error ?? '校验失败');

      if (!data.correct) {
        // 拼写错误：果冻抖动 + 本轮 3 遍进度清零，重新拼写
        setShaking(true);
        window.setTimeout(() => setShaking(false), 550);
        setFeedback({ type: 'error', message: '拼写错误，重新拼写 3 遍直至全部正确' });
        patchWord(current.id, { correct_round: 0, status: 'practicing' });
        setTyped('');
        inputRef.current?.focus();
        return;
      }

      patchWord(current.id, {
        correct_round: data.correct_round,
        recite_count: data.recite_count,
        total_typed: data.total_typed,
        status: data.completed_round ? 'done' : 'practicing',
      });
      setTyped('');

      if (data.completed_round) {
        setFeedback({ type: 'round-done', message: `已背诵 1 遍 · 累计 ${data.recite_count} 次` });
        // 完成一轮后短暂庆祝，自动切到下一个未完成的单词
        window.setTimeout(() => {
          setStats((prev) => ({ ...prev, done: Math.min(prev.done + 1, prev.total) }));
          setFeedback({ type: 'idle', message: '' });
          setWords((prev) => {
            const next = prev.find((w) => w.correct_round === 0 && (w.recite_count === 0 || w.id !== current.id) && w.id !== current.id);
            if (next) setCurrentId(next.id);
            return prev;
          });
        }, 1300);
      } else {
        setFeedback({ type: 'correct', message: `正确！继续第 ${data.correct_round + 1} 遍` });
        inputRef.current?.focus();
      }
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '校验失败' });
    }
  }, [current, typed]);

  const handleHint = () => {
    if (!current) return;
    setTyped((prev) => (prev.length === 0 ? current.word[0] : prev));
    inputRef.current?.focus();
  };

  const handleSkip = () => {
    if (words.length === 0) return;
    const index = words.findIndex((w) => w.id === currentId);
    const next = words[(index + 1) % words.length];
    setTyped('');
    setFeedback({ type: 'idle', message: '' });
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
                <span className="text-2xl">{stats.done}</span>
                <span className="text-sm font-sans font-medium text-on-surface-variant"> / {stats.total} 词已完成</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant inline-flex items-center gap-1.5 pb-1">
            <Info className="w-3.5 h-3.5" />
            照抄正确 3 遍 = 已背诵 1 遍
          </p>
        </div>
        <div className="mt-4 h-2.5 rounded-full bg-surface-container overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${RAINBOW_BAR}`}
            style={{ width: stats.total > 0 ? `${(stats.done / stats.total) * 100}%` : '0%' }}
          />
        </div>
      </section>

      {/* 临时文件清理提示 */}
      {cleanedFiles && cleanedFiles.length > 0 && (
        <div className="flex items-center gap-2.5 bg-success/10 text-success rounded-xl px-4 py-3 text-sm">
          <Trash2 className="w-4.5 h-4.5 shrink-0" />
          <span>本批上传的 {cleanedFiles.length} 个临时文件（{cleanedFiles.join('、')}）已在背诵完成后自动删除</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* 左列：核心单词卡 */}
        <div className="lg:col-span-2">
          {current && (
            <section
              className={`bg-surface/80 backdrop-blur-md rounded-2xl shadow-float p-6 md:p-8 relative overflow-hidden ${
                shaking ? 'animate-jelly-shake' : feedback.type === 'round-done' ? 'animate-jelly-pop' : ''
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
                <span className="text-xs font-medium text-on-surface-variant">
                  第 {Math.min(current.correct_round + 1, ROUNDS_PER_RECITE)} 遍 / 共 {ROUNDS_PER_RECITE} 遍
                </span>
              </div>

              {/* 英文单词展示区（为主，大号）：照着此单词逐字母抄写 */}
              <div className="mt-8 text-center">
                <p className="text-5xl md:text-7xl font-display font-bold text-on-surface tracking-[0.08em] leading-tight break-all">
                  {current.word}
                </p>
                <div className={`mt-4 mx-auto h-[3px] w-44 rounded-full ${RAINBOW_BAR} opacity-70`} />
                {/* 中文释义（为辅，位于单词底部，较小） */}
                <p className="mt-4 text-sm md:text-base text-on-surface-variant">
                  {current.pos ? `${current.pos} ` : ''}
                  {current.translation ?? '暂无释义'}
                </p>
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
                    feedback.type === 'error'
                      ? 'text-error'
                      : feedback.type === 'round-done'
                        ? 'text-success'
                        : 'text-primary'
                  }`}
                >
                  {feedback.type === 'round-done' ? (
                    <CircleCheck className="w-3.5 h-3.5" />
                  ) : (
                    <PencilLine className="w-3.5 h-3.5" />
                  )}
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
                    <span className={`font-display font-bold text-sm ${finished ? 'text-success' : 'text-on-surface'}`}>
                      {w.word}
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
