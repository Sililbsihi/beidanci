'use client';

import { useEffect, useState } from 'react';
import {
  BookOpen, Repeat, Flame, Sun, ArrowRight, History, CalendarDays, TrendingUp, Trophy, AlertCircle, Ruler, Repeat2,
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
  mistakes: Array<{ word: string; count: number }>;
  longest: Array<{ word: string; length: number }>;
  reimported: Array<{ word: string; count: number }>;
}

interface RecordsData {
  stats: { totalWords: number; totalRecites: number; streakDays: number; todayCount: number };
  today: WordRow[];
  history: Array<{ date: string; count: number; items: HistoryItem[] }>;
  weekly: WeeklyDay[];
  rankings: Rankings;
}

const EMPTY_RANKINGS: Rankings = { mistakes: [], longest: [], reimported: [] };
const EMPTY_STATS = { totalWords: 0, totalRecites: 0, streakDays: 0, todayCount: 0 };

const RAINBOW_BAR =
  'bg-[linear-gradient(90deg,#E57373_0%,#F0A45B_20%,#E9C96A_40%,#7E9F7A_60%,#7FA3C9_80%,#A88BC9_100%)]';
const RAINBOW_SOLID = ['#E57373', '#F0A45B', '#E9C96A', '#7E9F7A', '#7FA3C9', '#A88BC9'];

function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

export default function RecordsPage() {
  const [data, setData] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);

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
        });
      } catch {
        setData({ stats: EMPTY_STATS, today: [], history: [], weekly: [], rankings: EMPTY_RANKINGS });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-on-surface-variant">正在加载背诵记录…</div>;
  }

  const stats = data!.stats;
  const statCards: Array<{ icon: ReactNode; bar: string; label: string; value: string; hint?: string }> = [
    { icon: <BookOpen className="w-5 h-5" />, bar: 'bg-jelly-red', label: '累计背诵单词', value: String(stats.totalWords) },
    { icon: <Repeat className="w-5 h-5" />, bar: 'bg-jelly-orange', label: '累计背诵次数', value: String(stats.totalRecites), hint: '正确拼写 3 遍计 1 次' },
    { icon: <Flame className="w-5 h-5" />, bar: 'bg-jelly-yellow', label: '连续背诵天数', value: `${stats.streakDays} 天` },
    { icon: <Sun className="w-5 h-5" />, bar: 'bg-jelly-green', label: '今日已背', value: `${stats.todayCount} 词` },
  ];

  const weekly = data!.weekly;
  const rankings = data!.rankings;
  const maxCount = Math.max(...weekly.map((d) => d.count), 1);
  const todayKey = new Date().toISOString().slice(0, 10);

  const rankingCards: Array<{ icon: ReactNode; bar: string; title: string; empty: string; items: Array<{ key: string; label: string; value: string }> }> = [
    {
      icon: <AlertCircle className="w-4.5 h-4.5" />,
      bar: 'bg-jelly-red',
      title: '犯错最多',
      empty: '还没有拼错记录，稳得很',
      items: rankings.mistakes.map((m) => ({ key: m.word, label: m.word, value: `拼错 ${m.count} 次` })),
    },
    {
      icon: <Ruler className="w-4.5 h-4.5" />,
      bar: 'bg-jelly-blue',
      title: '最长的单词',
      empty: '先导入一些单词吧',
      items: rankings.longest.map((l) => ({ key: l.word, label: l.word, value: `${l.length} 个字母` })),
    },
    {
      icon: <Repeat2 className="w-4.5 h-4.5" />,
      bar: 'bg-jelly-purple',
      title: '重复导入最多',
      empty: '还没有重复导入的单词',
      items: rankings.reimported.map((r) => ({ key: r.word, label: r.word, value: `导入 ${r.count} 次` })),
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

      {/* 统计卡片区 */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-1 ${card.bar} opacity-80`} />
            <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center text-primary">
              {card.icon}
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">{card.label}</p>
            <p className="font-display font-bold text-2xl text-on-surface leading-tight">{card.value}</p>
            {card.hint && <p className="text-[10px] text-on-surface-variant/70 mt-0.5">{card.hint}</p>}
          </div>
        ))}
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

      {/* 趣味排行榜 */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
          <Trophy className="w-4.5 h-4.5 text-primary" />
          趣味排行
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {rankingCards.map((card) => (
            <div key={card.title} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4 relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-1 ${card.bar} opacity-80`} />
              <h3 className="font-display font-semibold text-on-surface text-sm inline-flex items-center gap-1.5">
                <span className="text-primary">{card.icon}</span>
                {card.title}
              </h3>
              {card.items.length === 0 ? (
                <p className="mt-3 text-xs text-on-surface-variant/70">{card.empty}</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {card.items.map((item, index) => (
                    <li key={item.key} className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                        style={{ backgroundColor: RAINBOW_SOLID[index % RAINBOW_SOLID.length] }}
                      >
                        {index + 1}
                      </span>
                      <span className="font-display font-medium text-on-surface text-sm truncate flex-1">{item.label}</span>
                      <span className="text-xs text-on-surface-variant shrink-0">{item.value}</span>
                    </li>
                  ))}
                </ol>
              )}
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
    </div>
  );
}
