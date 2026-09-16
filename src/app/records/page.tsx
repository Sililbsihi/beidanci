'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, Repeat, Flame, Sun, ArrowRight, History, CalendarDays, TrendingUp, Trophy, AlertCircle, Ruler, Repeat2,
  Star, X, Sparkles, BookMarked, Theater, CheckCircle2,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface WordRow {
  id: number;
  word: string;
  pos: string | null;
  translation: string | null;
  recite_count: number;
  total_typed: number;
}

interface HistoryItem {
  word: string;
  pos: string | null;
  translation: string | null;
  session_no: number;
}

interface WeeklyDay {
  date: string;
  count: number;
  words: string[];
}

interface Rankings {
  mistakes: Array<{ word: string; count: number; translation?: string | null }>;
  longest: Array<{ word: string; length: number; translation?: string | null }>;
  reimported: Array<{ word: string; count: number; translation?: string | null }>;
}

interface StarredWord {
  id: number;
  word: string;
  pos: string | null;
  translation: string | null;
}

interface WordDetail {
  etymology: string;
  roots: string[];
  sentence: string;
  play: string;
  character: string;
  sentenceTranslation: string;
  context: string;
}

interface RecordsData {
  stats: { totalWords: number; totalRecites: number; streakDays: number; todayCount: number };
  today: WordRow[];
  history: Array<{ date: string; count: number; items: HistoryItem[] }>;
  weekly: WeeklyDay[];
  rankings: Rankings;
  starredWords: StarredWord[];
}

const EMPTY_RANKINGS: Rankings = { mistakes: [], longest: [], reimported: [] };
const EMPTY_STATS = { totalWords: 0, totalRecites: 0, streakDays: 0, todayCount: 0 };

const RAINBOW_BAR =
  'bg-[linear-gradient(90deg,#E57373_0%,#F0A45B_20%,#E9C96A_40%,#7E9F7A_60%,#7FA3C9_80%,#A88BC9_100%)]';
const RAINBOW_SOLID = ['#E57373', '#F0A45B', '#E9C96A', '#7E9F7A', '#7FA3C9', '#A88BC9'];

/** 气泡池槽位（百分比坐标，覆盖池子四角与中部，避免重叠） */
const BUBBLE_SLOTS = [
  { x: 6, y: 16 }, { x: 34, y: 46 }, { x: 62, y: 10 }, { x: 80, y: 44 },
  { x: 16, y: 54 }, { x: 48, y: 20 }, { x: 70, y: 60 }, { x: 4, y: 38 },
];

function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/** 词源/台词详情弹层（结果本地缓存，二次打开秒出） */
function WordDetailModal({ starred, onClose }: { starred: StarredWord; onClose: () => void }) {
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // v3：原句改为"真实原句+联网核验，宁缺毋滥"，旧缓存可能含未核验引用，直接失效
  const cacheKey = `jelly-detail:v3:${starred.word}`;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setDetail(JSON.parse(cached) as WordDetail);
          setLoading(false);
          return;
        }
      } catch {
        // 缓存读取失败则走网络
      }
      try {
        const res = await fetch('/api/word-detail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: starred.word }),
        });
        if (!res.ok) throw new Error('detail failed');
        const data = (await res.json()) as { detail?: WordDetail };
        if (!alive) return;
        if (data.detail) {
          setDetail(data.detail);
          try {
            localStorage.setItem(cacheKey, JSON.stringify(data.detail));
          } catch {
            // 忽略缓存写入失败
          }
        } else {
          setFailed(true);
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [cacheKey, starred.word]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-float max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 relative animate-jelly-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 border-none bg-transparent cursor-pointer p-1 rounded-full hover:bg-surface-container"
        >
          <X className="w-4.5 h-4.5 text-on-surface-variant" />
        </button>
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <h3 className="font-display font-bold text-2xl text-on-surface">{starred.word}</h3>
          {starred.pos && <span className="text-xs px-2 py-0.5 rounded-full bg-jelly-blue/15 text-jelly-blue">{starred.pos}</span>}
          {starred.translation && <span className="text-sm text-on-surface-variant">{starred.translation}</span>}
        </div>

        {loading && (
          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
            <Sparkles className="w-4 h-4 animate-spin" />
            正在翻阅词源词典与剧目手册…
          </div>
        )}
        {failed && <p className="mt-6 text-sm text-on-surface-variant">生成失败，请关闭后重试</p>}

        {detail && !loading && (
          <div className="mt-5 space-y-5">
            {detail.etymology && (
              <section>
                <h4 className="text-xs font-semibold text-primary inline-flex items-center gap-1.5">
                  <BookMarked className="w-3.5 h-3.5" />
                  词源故事
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-on-surface">{detail.etymology}</p>
              </section>
            )}
            {detail.roots.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold text-primary inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  词根拆解
                </h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.roots.map((root, i) => (
                    <span
                      key={`${root}-${i}`}
                      className="text-xs px-2.5 py-1 rounded-full bg-surface-container text-on-surface"
                      style={{ borderBottom: `2px solid ${RAINBOW_SOLID[i % RAINBOW_SOLID.length]}55` }}
                    >
                      {root}
                    </span>
                  ))}
                </div>
              </section>
            )}
            {detail.sentence ? (
              <section>
                <h4 className="text-xs font-semibold text-primary inline-flex items-center gap-1.5">
                  <Theater className="w-3.5 h-3.5" />
                  经典原句
                </h4>
                <div className="mt-2 rounded-xl bg-surface-container/70 p-4">
                  <p className="font-display text-sm md:text-base text-on-surface leading-relaxed">&ldquo;{detail.sentence}&rdquo;</p>
                  {detail.sentenceTranslation && <p className="mt-2 text-xs text-on-surface-variant leading-relaxed">{detail.sentenceTranslation}</p>}
                  {detail.context && (
                    <p className="mt-2 text-xs text-on-surface-variant leading-relaxed">
                      <span className="text-primary font-medium">剧情：</span>
                      {detail.context}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-on-surface-variant inline-flex items-center gap-1.5">
                    <Theater className="w-3.5 h-3.5" />
                    {detail.play}
                    {detail.character && <span className="text-primary font-medium">· {detail.character}</span>}
                  </p>
                </div>
              </section>
            ) : (
              <section>
                <h4 className="text-xs font-semibold text-primary inline-flex items-center gap-1.5">
                  <Theater className="w-3.5 h-3.5" />
                  经典原句
                </h4>
                <p className="mt-2 rounded-xl bg-surface-container/50 p-4 text-xs leading-relaxed text-on-surface-variant">
                  这个词暂未找到 100% 可靠的真实用例——宁可空着，也不编造出处。
                </p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 当场拼写小游戏：逐字母键入，拼错即清空重拼（不写入背诵进度） */
function SpellModal({ word, translation, onClose }: { word: string; translation: string | null; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [shaking, setShaking] = useState(false);
  const letters = word.split('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (typed.length >= word.length) return;
      const key = e.key;
      if (/^[a-zA-Z'-]$/.test(key)) {
        e.preventDefault();
        const expected = word[typed.length];
        if (key.toLowerCase() === expected.toLowerCase()) {
          setTyped((prev) => prev + key.toLowerCase());
        } else {
          setShaking(true);
          setTimeout(() => {
            setShaking(false);
            setTyped('');
          }, 450);
        }
      } else if (key === 'Backspace') {
        e.preventDefault();
        setTyped((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typed, word, onClose]);

  const done = typed.length >= word.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`bg-surface rounded-2xl shadow-float max-w-xl w-full p-6 relative ${shaking ? 'animate-jelly-shake' : 'animate-jelly-pop'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 border-none bg-transparent cursor-pointer p-1 rounded-full hover:bg-surface-container"
        >
          <X className="w-4.5 h-4.5 text-on-surface-variant" />
        </button>
        <p className="text-xs text-on-surface-variant">当场拼写 · {translation ?? '直接照着提示拼'}</p>
        <p className="mt-1 font-display font-bold text-xl text-on-surface">{translation ? word[0].toUpperCase() + '____?' : '拼出这个单词'}</p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {letters.map((char, index) => {
            if (char === ' ') return <div key={index} className="w-2.5 shrink-0" aria-hidden="true" />;
            const filled = index < typed.length;
            return (
              <div
                key={index}
                className="w-9 h-11 rounded-lg bg-surface-container-lowest shadow-card flex items-center justify-center border-b-4"
                style={{ borderBottomColor: filled ? `${RAINBOW_SOLID[index % RAINBOW_SOLID.length]}99` : 'transparent' }}
              >
                <span className="text-lg font-display font-bold text-on-surface">{typed[index] ?? ''}</span>
              </div>
            );
          })}
        </div>

        {done ? (
          <div className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-success animate-jelly-pop">
            <CheckCircle2 className="w-4.5 h-4.5" />
            拼对了！{word}
          </div>
        ) : (
          <p className="mt-5 text-center text-xs text-on-surface-variant">
            {shaking ? '拼错了，重新拼一遍！' : '直接敲键盘输入字母 · 拼错会清空重拼'}
          </p>
        )}
      </div>
    </div>
  );
}

/** 星词星系：星标词以球体彼此连线，整体缓慢旋转，悬浮放大，点击查看词源与剧目台词 */
function StarGalaxy({ words, onPick }: { words: StarredWord[]; onPick: (w: StarredWord) => void }) {
  const SIZE = 360;
  const center = SIZE / 2;
  const n = words.length;
  const placed = words.map((w, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const radius = n <= 5 ? 108 : i % 2 === 0 ? 132 : 88;
    const ballSize = w.word.length > 9 ? 74 : 62;
    const x = center + radius * Math.cos(angle) - ballSize / 2;
    const y = center + radius * Math.sin(angle) - ballSize / 2;
    return { ...w, angle, radius, x, y, ballSize };
  });

  return (
    <div className="relative mx-auto" style={{ width: SIZE, maxWidth: '100%', height: SIZE }}>
      {/* 旋转盘：静态坐标的球与连线随盘整体缓慢转动 */}
      <div className="absolute inset-0 animate-galaxy-spin">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 w-full h-full pointer-events-none">
          {placed.map((p, i) => {
            const next = placed[(i + 1) % placed.length];
            if (placed.length < 2) return null;
            return (
              <line
                key={`line-${p.id}`}
                x1={p.x + p.ballSize / 2}
                y1={p.y + p.ballSize / 2}
                x2={next.x + next.ballSize / 2}
                y2={next.y + next.ballSize / 2}
                stroke="#C96F3D"
                strokeOpacity="0.28"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
            );
          })}
        </svg>
        {placed.map((p, i) => (
          <div
            key={p.id}
            className="absolute animate-galaxy-spin-reverse"
            style={{ left: p.x, top: p.y, width: p.ballSize, height: p.ballSize }}
          >
            <button
              type="button"
              onClick={() => onPick(p)}
              title={`${p.word}（点击看词源与台词）`}
              className="w-full h-full rounded-full border-none cursor-pointer flex items-center justify-center text-white font-display font-bold shadow-card hover:scale-125 hover:shadow-float hover:z-10 transition-transform duration-300"
              style={{
                backgroundColor: RAINBOW_SOLID[i % RAINBOW_SOLID.length],
                fontSize: p.word.length > 9 ? 10 : p.word.length > 6 ? 12 : 14,
                padding: 4,
                wordBreak: 'break-all',
                lineHeight: 1.1,
              }}
            >
              {p.word}
            </button>
          </div>
        ))}
      </div>
      {/* 中心装饰（不随盘转） */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <Sparkles className="w-6 h-6 text-[#E9C96A]" />
      </div>
    </div>
  );
}

/** 气泡池：榜单词以漂浮气泡展现，点击进入当场拼写 */
function BubblePool({ items, empty }: { items: Array<{ key: string; label: string; value: string; size: number; translation?: string | null }>; empty: string }) {
  const [spelling, setSpelling] = useState<{ word: string; translation: string | null } | null>(null);
  if (items.length === 0) {
    return <p className="mt-3 text-xs text-on-surface-variant/70">{empty}</p>;
  }
  return (
    <>
      <div className="mt-3 relative h-36 rounded-xl bg-surface-container/50 overflow-hidden">
        {items.map((item, i) => {
          const slot = BUBBLE_SLOTS[i % BUBBLE_SLOTS.length];
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSpelling({ word: item.label, translation: item.translation ?? null })}
              title={`${item.label} · ${item.value}（点击当场拼写）`}
              className="absolute rounded-full border-none cursor-pointer flex items-center justify-center text-white font-display font-semibold shadow-card hover:scale-[1.15] hover:shadow-float hover:z-10 transition-transform duration-300 animate-float-soft"
              style={{
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                width: item.size,
                height: item.size,
                backgroundColor: RAINBOW_SOLID[i % RAINBOW_SOLID.length],
                fontSize: item.size >= 58 ? 13 : item.size >= 46 ? 11 : 9,
                padding: 3,
                wordBreak: 'break-all',
                lineHeight: 1.1,
                animationDelay: `${(i % 4) * 0.6}s`,
              }}
            >
              {item.label}
            </button>
          );
        })}
        <span className="absolute bottom-2 right-3 text-[10px] text-on-surface-variant/60">点击气泡当场拼写</span>
      </div>
      {spelling && <SpellModal word={spelling.word} translation={spelling.translation} onClose={() => setSpelling(null)} />}
    </>
  );
}

export default function RecordsPage() {
  const [data, setData] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailWord, setDetailWord] = useState<StarredWord | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/records');
        const json = (await res.json()) as Partial<RecordsData>;
        setData({
          stats: json.stats ?? EMPTY_STATS,
          today: json.today ?? [],
          history: json.history ?? [],
          weekly: json.weekly ?? [],
          rankings: { ...EMPTY_RANKINGS, ...(json.rankings ?? {}) },
          starredWords: json.starredWords ?? [],
        });
      } catch {
        setData({ stats: EMPTY_STATS, today: [], history: [], weekly: [], rankings: EMPTY_RANKINGS, starredWords: [] });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const closeDetail = useCallback(() => setDetailWord(null), []);

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-on-surface-variant">正在加载背诵记录…</div>;
  }

  const stats = data!.stats;
  const weekly = data!.weekly;
  const rankings = data!.rankings;
  const starredWords = data!.starredWords;
  const maxCount = Math.max(...weekly.map((d) => d.count), 1);
  const todayKey = new Date().toISOString().slice(0, 10);

  const compactStats: Array<{ dot: string; label: string; value: string }> = [
    { dot: 'bg-jelly-red', label: '累计单词', value: String(stats.totalWords) },
    { dot: 'bg-jelly-orange', label: '背诵次数', value: String(stats.totalRecites) },
    { dot: 'bg-jelly-yellow', label: '连续天数', value: `${stats.streakDays} 天` },
    { dot: 'bg-jelly-green', label: '今日已背', value: `${stats.todayCount} 词` },
  ];

  // 气泡大小按榜单数值映射（错误数 / 长度 / 导入次数）
  const maxMistake = Math.max(...rankings.mistakes.map((m) => m.count), 1);
  const maxLen = Math.max(...rankings.longest.map((l) => l.length), 1);
  const maxReimport = Math.max(...rankings.reimported.map((r) => r.count), 1);

  const bubbleCards: Array<{ icon: ReactNode; bar: string; title: string; empty: string; items: Array<{ key: string; label: string; value: string; size: number; translation?: string | null }> }> = [
    {
      icon: <AlertCircle className="w-4.5 h-4.5" />,
      bar: 'bg-jelly-red',
      title: '犯错最多',
      empty: '还没有拼错记录，稳得很',
      items: rankings.mistakes.map((m) => ({
        key: m.word,
        label: m.word,
        value: `拼错 ${m.count} 次`,
        size: Math.round(40 + (m.count / maxMistake) * 26),
        translation: m.translation ?? null,
      })),
    },
    {
      icon: <Ruler className="w-4.5 h-4.5" />,
      bar: 'bg-jelly-blue',
      title: '最长的单词',
      empty: '先导入一些单词吧',
      items: rankings.longest.map((l) => ({
        key: l.word,
        label: l.word,
        value: `${l.length} 个字母`,
        size: Math.round(40 + (l.length / maxLen) * 26),
        translation: l.translation ?? null,
      })),
    },
    {
      icon: <Repeat2 className="w-4.5 h-4.5" />,
      bar: 'bg-jelly-purple',
      title: '重复导入最多',
      empty: '还没有重复导入的单词',
      items: rankings.reimported.map((r) => ({
        key: r.word,
        label: r.word,
        value: `导入 ${r.count} 次`,
        size: Math.round(40 + (r.count / maxReimport) * 26),
        translation: r.translation ?? null,
      })),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface">背诵记录</h1>
          <p className="text-sm text-on-surface-variant mt-1">每一次照抄正确的拼写，都会被记录下来</p>
          <div className={`mt-2 h-[3px] w-32 rounded-full ${RAINBOW_BAR} opacity-70`} />
        </div>
        <a
          href="/practice"
          className="bg-primary text-white border-none px-4 py-2 rounded-full text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
        >
          去背诵
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>

      {/* 紧凑统计条（让出面积给互动板块） */}
      <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card px-5 py-3.5 flex flex-wrap items-center gap-x-7 gap-y-2">
        {compactStats.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${item.dot}`} />
            <span className="text-xs text-on-surface-variant">{item.label}</span>
            <span className="font-display font-bold text-lg text-on-surface leading-none">{item.value}</span>
          </div>
        ))}
      </section>

      {/* 星词星系 */}
      <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5 relative overflow-hidden">
        <div className={`absolute top-0 left-0 right-0 h-1 ${RAINBOW_BAR} opacity-70`} />
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
            <Star className="w-4.5 h-4.5 text-[#E9C96A] fill-[#E9C96A]" />
            我的星词星系
          </h2>
          <span className="text-xs text-on-surface-variant">悬浮放大 · 点击看词源与剧目台词</span>
        </div>
        {starredWords.length === 0 ? (
          <div className="py-10 text-center">
            <Star className="w-8 h-8 mx-auto text-on-surface-variant/30" />
            <p className="mt-3 text-sm text-on-surface-variant">还没有星标单词</p>
            <p className="mt-1 text-xs text-on-surface-variant/70">去背诵页点亮单词旁的小星星，它们会在这里连成星座</p>
          </div>
        ) : (
          <div className="mt-4">
            <StarGalaxy words={starredWords} onPick={setDetailWord} />
          </div>
        )}
      </section>

      {/* 近 7 天背诵趋势 */}
      <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
            <TrendingUp className="w-4.5 h-4.5 text-primary" />
            近 7 天背诵趋势
          </h2>
          <span className="text-xs text-on-surface-variant">每天完成背诵的轮次数量</span>
        </div>
        <div className="mt-5 flex items-end gap-2 h-40">
          {weekly.map((day, index) => (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <span className={`text-xs font-medium ${day.count > 0 ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
                {day.count > 0 ? day.count : ''}
              </span>
              <div
                className={`w-full max-w-10 rounded-t-xl transition-all duration-500 ${day.date === todayKey ? 'ring-2 ring-primary/40' : ''}`}
                style={{
                  height: `${Math.max((day.count / maxCount) * 100, day.count > 0 ? 8 : 3)}%`,
                  backgroundColor: RAINBOW_SOLID[index % RAINBOW_SOLID.length],
                  opacity: day.count > 0 ? 0.85 : 0.3,
                }}
                title={day.count > 0 ? `${day.date}：${day.words.join('、')}` : day.date}
              />
              <span className={`text-[10px] ${day.date === todayKey ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
                {day.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 趣味排行：气泡池 */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
          <Trophy className="w-4.5 h-4.5 text-primary" />
          趣味排行 · 点气泡当场拼写
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bubbleCards.map((card) => (
            <div key={card.title} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4 relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-1 ${card.bar} opacity-80`} />
              <h3 className="font-display font-semibold text-on-surface text-sm inline-flex items-center gap-1.5">
                <span className="text-primary">{card.icon}</span>
                {card.title}
              </h3>
              <BubblePool items={card.items} empty={card.empty} />
            </div>
          ))}
        </div>
      </section>

      {/* 今日记录 */}
      <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
            <CalendarDays className="w-4.5 h-4.5 text-primary" />
            今日 · {formatDay(new Date().toISOString().slice(0, 10))}
          </h2>
          <span className="text-xs text-on-surface-variant">共 {data!.today.length} 词</span>
        </div>
        {data!.today.length === 0 ? (
          <p className="mt-4 text-sm text-on-surface-variant/70">今天还没有完成背诵，去练习页开始吧</p>
        ) : (
          <div className="mt-4 divide-y divide-outline-variant/70">
            {data!.today.map((w, index) => (
              <div key={w.id} className="py-3 flex items-center gap-3">
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm text-white shrink-0"
                  style={{ backgroundColor: RAINBOW_SOLID[index % RAINBOW_SOLID.length] }}
                >
                  {w.word[0]?.toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-display font-bold text-on-surface">{w.word}</span>
                    {w.pos && <span className="text-xs px-2 py-0.5 rounded-full bg-jelly-blue/15 text-jelly-blue">{w.pos}</span>}
                    <span className="text-sm text-on-surface-variant truncate">{w.translation}</span>
                  </div>
                </div>
                <span className="text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full shrink-0">
                  已背诵 {w.recite_count} 遍 · 累计拼写 {w.total_typed} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 历史记录（按日期分组） */}
      {data!.history.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
            <History className="w-4.5 h-4.5 text-on-surface-variant" />
            历史记录
          </h2>
          {data!.history.map((group) => (
            <div key={group.date} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display font-semibold text-on-surface">{formatDay(group.date)}</h3>
                <span className="text-xs text-on-surface-variant">{group.count} 词</span>
              </div>
              <div className="mt-3 divide-y divide-outline-variant/70">
                {group.items.map((item, index) => (
                  <div key={`${item.word}-${item.session_no}-${index}`} className="py-3 flex items-center gap-3">
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm text-white shrink-0"
                      style={{ backgroundColor: RAINBOW_SOLID[index % RAINBOW_SOLID.length] }}
                    >
                      {item.word[0]?.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-display font-bold text-on-surface">{item.word}</span>
                        {item.pos && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-jelly-blue/15 text-jelly-blue">{item.pos}</span>
                        )}
                        <span className="text-sm text-on-surface-variant truncate">{item.translation}</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-on-surface-variant bg-surface-container px-2.5 py-1 rounded-full shrink-0">
                      第 {item.session_no} 遍背诵
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 词详情弹层 */}
      {detailWord && <WordDetailModal starred={detailWord} onClose={closeDetail} />}
    </div>
  );
}
