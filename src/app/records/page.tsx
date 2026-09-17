'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Repeat, Flame, Sun, ArrowRight, History, CalendarDays, TrendingUp, Trophy, AlertCircle, Ruler, Repeat2,
  Star, X, Sparkles, BookMarked, Theater, CheckCircle2, Heart, MessageCircle, Send, ShieldCheck, Trash2, EyeOff,
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

/** 气泡池槽位（百分比坐标，居中锚点，覆盖池子四角与中部，避免重叠） */
const BUBBLE_SLOTS = [
  { x: 18, y: 24 }, { x: 50, y: 52 }, { x: 82, y: 24 }, { x: 80, y: 66 },
  { x: 18, y: 70 }, { x: 48, y: 20 }, { x: 66, y: 76 }, { x: 12, y: 48 },
];

/** 气泡尺寸与单词长度成比例（短词小泡、长词大泡，封顶防止溢出） */
function sizeForWord(word: string): number {
  return Math.min(78, Math.round(40 + word.length * 2.6));
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/** 词源/台词详情弹层（结果本地缓存，二次打开秒出） */
function WordDetailModal({ starred, onClose }: { starred: StarredWord; onClose: () => void }) {
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // v4：原句改为三级兜底（核验引用→真实网页摘句→通用例句），保证有句可用；旧缓存可能为空句直接失效
  const cacheKey = `jelly-detail:v4:${starred.word}`;

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
                  这个词的例句暂时没能生成，关闭弹窗稍后再试一次。
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

/** 行星外观皮肤：纸感和谐色板（低饱和，避免霓虹），kind 决定表面画法 */
type PlanetKind = 'rocky' | 'gas' | 'ringed' | 'ice';
interface PlanetSkin { kind: PlanetKind; base: string; dark: string; light: string; }

const PLANET_SKINS: PlanetSkin[] = [
  { kind: 'rocky', base: '#C96F3D', dark: '#8F4A26', light: '#E89B6B' },
  { kind: 'gas', base: '#7FA3C9', dark: '#53719A', light: '#A9C4DE' },
  { kind: 'ice', base: '#AFCBE0', dark: '#7F9FB8', light: '#EAF4FA' },
  { kind: 'ringed', base: '#E9C96A', dark: '#B49A45', light: '#F5E3A8' },
  { kind: 'rocky', base: '#A88BC9', dark: '#7C5FA3', light: '#C9B2E3' },
  { kind: 'gas', base: '#7E9F7A', dark: '#58795A', light: '#A8C2A3' },
  { kind: 'ringed', base: '#E57373', dark: '#B54F4F', light: '#F2A19C' },
  { kind: 'ice', base: '#9FB8CE', dark: '#6E8CA6', light: '#D9E7F2' },
];

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hexA(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 多层渐变绘制行星表面：高光 + 陨石坑/条纹/冰原 */
function planetBackground(skin: PlanetSkin): string {
  const { base, dark, light } = skin;
  const highlight = 'radial-gradient(circle at 30% 26%, rgba(255,252,245,0.85) 0%, rgba(255,252,245,0) 42%)';
  if (skin.kind === 'rocky') {
    return [
      highlight,
      `radial-gradient(circle at 66% 70%, ${dark} 0 7%, rgba(0,0,0,0) 8%)`,
      `radial-gradient(circle at 36% 62%, ${dark} 0 5%, rgba(0,0,0,0) 6%)`,
      `radial-gradient(circle at 58% 30%, ${dark} 0 4%, rgba(0,0,0,0) 5%)`,
      `radial-gradient(circle at 34% 30%, ${light} 0%, ${base} 58%, ${dark} 100%)`,
    ].join(', ');
  }
  if (skin.kind === 'gas' || skin.kind === 'ringed') {
    return [
      highlight,
      `linear-gradient(180deg, ${light} 0 16%, ${base} 16% 34%, ${dark} 34% 52%, ${base} 52% 68%, ${light} 68% 84%, ${dark} 84% 100%)`,
    ].join(', ');
  }
  return [
    'radial-gradient(circle at 30% 24%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 46%)',
    `radial-gradient(circle at 70% 78%, ${dark} 0 9%, rgba(0,0,0,0) 10%)`,
    `linear-gradient(160deg, ${light} 0%, ${base} 48%, ${dark} 100%)`,
  ].join(', ');
}

interface PlanetSpec {
  word: string; id: number; pos: string | null; translation: string | null;
  skin: PlanetSkin; orbitR: number; angle0: number; speed: number; size: number;
  fontSize: number; textColor: string; t0: string; z0: number; o0: number;
}
interface BeltSpec { orbitR: number; angle0: number; speed: number; size: number; aspect: number; t0: string; z0: number; o0: number; }

const GALAXY = { SIZE: 380, TILT: 0.44, ORBITS: [72, 116, 158] as const, SPEEDS: [0.32, 0.23, 0.16] as const, BELT_R: 137, BELT_COUNT: 26 };

/** 星词行星系：星标词化作行星沿椭圆轨道公转（近大远小/后方虚化/前后遮挡的景深效果），透明背景 + 真实行星形状 + 环绕小行星带；悬浮放大，点击查看词源与剧目台词 */
function StarGalaxy({ words, onPick }: { words: StarredWord[]; onPick: (w: StarredWord) => void }) {
  const { SIZE, TILT, ORBITS, SPEEDS, BELT_R, BELT_COUNT } = GALAXY;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const hoveredRef = useRef<string | null>(null);
  const planetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const beltRefs = useRef<Array<HTMLSpanElement | null>>([]);

  const planets = useMemo<PlanetSpec[]>(() => {
    const slotCount = Math.max(Math.ceil(words.length / ORBITS.length), 1);
    return words.map((w, i) => {
      const h = stableHash(w.word);
      const orbitIdx = i % ORBITS.length;
      const slot = Math.floor(i / ORBITS.length);
      const slotAngle = (Math.PI * 2) / slotCount;
      const angle0 = -Math.PI / 2 + slot * slotAngle + ((h % 100) / 100 - 0.5) * slotAngle * 0.9;
      const size = ORBITS.length === 3 ? [36, 44, 52][orbitIdx] + (w.word.length > 9 ? 4 : 0) : 44;
      const depth0 = (Math.sin(angle0) + 1) / 2;
      const baseFont = [8.5, 10, 11.5][orbitIdx];
      const fontSize = Math.max(7.5, baseFont - (w.word.length > 12 ? 2.5 : w.word.length > 9 ? 1.5 : 0));
      const skin = PLANET_SKINS[h % PLANET_SKINS.length];
      return {
        ...w,
        skin,
        orbitR: ORBITS[orbitIdx],
        angle0,
        speed: SPEEDS[orbitIdx] + ((h % 7) - 3) * 0.004,
        size,
        fontSize,
        textColor: skin.kind === 'ice' ? '#2F3E4A' : '#FFF9F1',
        t0: `translate3d(${(CX + ORBITS[orbitIdx] * Math.cos(angle0) - size / 2).toFixed(1)}px, ${(CY + ORBITS[orbitIdx] * Math.sin(angle0) * TILT - size / 2).toFixed(1)}px, 0) scale(${(0.74 + depth0 * 0.42).toFixed(3)})`,
        z0: 10 + Math.round(depth0 * 40),
        o0: 0.66 + depth0 * 0.34,
      };
    });
  }, [words, ORBITS, SPEEDS, CX, CY, TILT]);

  const belt = useMemo<BeltSpec[]>(() => {
    return Array.from({ length: BELT_COUNT }, (_, i) => {
      const h = stableHash(`belt-${i}-${words.length}`);
      const angle0 = (i / BELT_COUNT) * Math.PI * 2 + ((h % 100) / 100 - 0.5) * 0.22;
      const orbitR = BELT_R + ((h % 9) - 4) * 2.2;
      const size = 2 + (h % 3);
      const depth0 = (Math.sin(angle0) + 1) / 2;
      return {
        orbitR,
        angle0,
        speed: 0.19 + ((h % 5) - 2) * 0.003,
        size,
        aspect: 0.6 + (h % 50) / 100,
        t0: `translate3d(${(CX + orbitR * Math.cos(angle0) - size / 2).toFixed(1)}px, ${(CY + orbitR * Math.sin(angle0) * TILT - size / 2).toFixed(1)}px, 0) scale(${(0.65 + depth0 * 0.55).toFixed(3)})`,
        z0: Math.round(depth0 * 34),
        o0: 0.22 + depth0 * 0.4,
      };
    });
  }, [words.length, BELT_COUNT, BELT_R, CX, CY, TILT]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      planets.forEach((p, i) => {
        const el = planetRefs.current[i];
        if (!el) return;
        const a = p.angle0 + t * p.speed;
        const sin = Math.sin(a);
        const x = CX + p.orbitR * Math.cos(a);
        const y = CY + p.orbitR * sin * TILT;
        const depth = (sin + 1) / 2;
        const hovered = hoveredRef.current === p.word;
        const scale = (0.74 + depth * 0.42) * (hovered ? 1.3 : 1);
        el.style.transform = `translate3d(${(x - p.size / 2).toFixed(1)}px, ${(y - p.size / 2).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        el.style.zIndex = hovered ? '99' : String(10 + Math.round(depth * 40));
        el.style.opacity = (0.66 + depth * 0.34).toFixed(2);
        el.style.filter = depth < 0.34 ? 'blur(0.8px) brightness(0.85) saturate(0.85)' : 'none';
      });
      belt.forEach((b, i) => {
        const el = beltRefs.current[i];
        if (!el) return;
        const a = b.angle0 + t * b.speed;
        const sin = Math.sin(a);
        const x = CX + b.orbitR * Math.cos(a);
        const y = CY + b.orbitR * sin * TILT;
        const depth = (sin + 1) / 2;
        el.style.transform = `translate3d(${(x - b.size / 2).toFixed(1)}px, ${(y - b.size / 2).toFixed(1)}px, 0) scale(${(0.65 + depth * 0.55).toFixed(3)})`;
        el.style.zIndex = String(Math.round(depth * 34));
        el.style.opacity = (0.22 + depth * 0.4).toFixed(2);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [planets, belt, CX, CY, TILT]);

  return (
    <div className="relative mx-auto" style={{ width: SIZE, maxWidth: '100%', height: SIZE }}>
      {/* 椭圆轨道虚线（透明背景上的淡轨道线） */}
      {ORBITS.map((r) => (
        <div
          key={`orbit-${r}`}
          className="absolute rounded-[50%] border border-dashed pointer-events-none"
          style={{ left: CX - r, top: CY - r * TILT, width: r * 2, height: r * 2 * TILT, borderColor: 'rgba(201, 111, 61, 0.13)' }}
        />
      ))}
      <div
        className="absolute rounded-[50%] border border-dashed pointer-events-none"
        style={{ left: CX - BELT_R, top: CY - BELT_R * TILT, width: BELT_R * 2, height: BELT_R * 2 * TILT, borderColor: 'rgba(139, 118, 98, 0.1)' }}
      />
      {/* 中心恒星 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[1]">
        <div className="sun-core" />
      </div>
      {/* 小行星带 */}
      {belt.map((b, i) => (
        <span
          key={`belt-${i}`}
          ref={(el) => { beltRefs.current[i] = el; }}
          className="absolute left-0 top-0 rounded-[40%] will-change-transform"
          style={{ width: b.size, height: b.size * b.aspect, background: '#8B7662', opacity: b.o0, transform: b.t0, zIndex: b.z0 }}
        />
      ))}
      {/* 行星（词） */}
      {planets.map((p, i) => (
        <div
          key={p.id}
          ref={(el) => { planetRefs.current[i] = el; }}
          className="absolute left-0 top-0 will-change-transform"
          style={{ width: p.size, height: p.size, transform: p.t0, zIndex: p.z0, opacity: p.o0 }}
        >
          <button
            type="button"
            onClick={() => onPick(p)}
            title={`${p.word}（点击看词源与台词）`}
            onMouseEnter={() => { hoveredRef.current = p.word; }}
            onMouseLeave={() => { hoveredRef.current = null; }}
            className="block w-full h-full rounded-full border-none cursor-pointer relative shadow-card transition-shadow duration-300 hover:shadow-float"
            style={{
              background: planetBackground(p.skin),
              fontSize: p.fontSize,
              color: p.textColor,
              textShadow: p.skin.kind === 'ice' ? 'none' : '0 1px 2px rgba(47, 32, 20, 0.4)',
              lineHeight: 1.12,
              wordBreak: 'break-all',
              padding: 3,
            }}
          >
            <span className="relative z-10 font-display font-bold">{p.word}</span>
            {p.skin.kind === 'ringed' && <span className="planet-ring" style={{ borderColor: hexA(p.skin.dark, 0.55) }} />}
          </button>
        </div>
      ))}
    </div>
  );
}

/** 气泡池：榜单词以透明气泡展现（气泡大小与单词长度成比例），点击进入当场拼写 */
function BubblePool({ items, empty }: { items: Array<{ key: string; label: string; value: string; size: number; translation?: string | null }>; empty: string }) {
  const [spelling, setSpelling] = useState<{ word: string; translation: string | null } | null>(null);
  if (items.length === 0) {
    return <p className="mt-3 text-xs text-on-surface-variant/70">{empty}</p>;
  }
  return (
    <>
      <div className="mt-3 relative h-44 rounded-xl bg-surface-container/50 overflow-hidden">
        {items.map((item, i) => {
          const slot = BUBBLE_SLOTS[i % BUBBLE_SLOTS.length];
          const color = RAINBOW_SOLID[i % RAINBOW_SOLID.length];
          return (
            <div
              key={item.key}
              className="absolute"
              style={{ left: `${slot.x}%`, top: `${slot.y}%`, transform: 'translate(-50%, -50%)', zIndex: 1 }}
            >
              <button
                type="button"
                onClick={() => setSpelling({ word: item.label, translation: item.translation ?? null })}
                title={`${item.label} · ${item.value}（点击当场拼写）`}
                className="rounded-full cursor-pointer flex items-center justify-center text-white font-display font-semibold border border-white/50 backdrop-blur-[2px] shadow-card hover:scale-[1.15] hover:shadow-float transition-transform duration-300 animate-float-soft"
                style={{
                  width: item.size,
                  height: item.size,
                  backgroundColor: `${color}A6`,
                  fontSize: item.size >= 68 ? 12 : item.size >= 58 ? 11 : item.size >= 48 ? 10 : 9,
                  padding: 3,
                  wordBreak: 'break-all',
                  lineHeight: 1.1,
                  textShadow: '0 1px 3px rgba(0,0,0,0.28)',
                  animationDelay: `${(i % 4) * 0.6}s`,
                }}
              >
                {item.label}
              </button>
            </div>
          );
        })}
        <span className="absolute bottom-2 right-3 text-[10px] text-on-surface-variant/60">点击气泡当场拼写</span>
      </div>
      {spelling && <SpellModal word={spelling.word} translation={spelling.translation} onClose={() => setSpelling(null)} />}
    </>
  );
}

/** 支持作者弹层：展示收款码与微信二维码（图片为 public/support-alipay.jpg / support-wechat.jpg，站长可自行替换） */
function SupportModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-float p-6 max-w-sm w-full relative animate-jelly-pop" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-3 right-3 border-none cursor-pointer text-on-surface-variant hover:text-on-surface transition-colors" aria-label="关闭">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-display font-bold text-on-surface text-lg inline-flex items-center gap-2">
          <Heart className="w-5 h-5 text-[#E57373] fill-[#E57373]" />
          支持作者
        </h3>
        <p className="mt-1 text-xs text-on-surface-variant">如果这个背单词小站对你有帮助，欢迎请作者喝一杯奶茶，或扫码加微信交流</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <figure>
            <div className="rounded-xl overflow-hidden bg-surface-container/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/support-alipay.jpg" alt="支付宝收款码" className="w-full block" />
            </div>
            <figcaption className="mt-1.5 text-center text-xs text-on-surface-variant">支付宝 · 赞赏</figcaption>
          </figure>
          <figure>
            <div className="rounded-xl overflow-hidden bg-surface-container/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/support-wechat.jpg" alt="微信二维码" className="w-full block" />
            </div>
            <figcaption className="mt-1.5 text-center text-xs text-on-surface-variant">微信 · 交流</figcaption>
          </figure>
        </div>
        <p className="mt-3 text-center text-xs text-on-surface-variant">扫码支持作者 · 随喜即可</p>
      </div>
    </div>
  );
}

interface FeedbackMessage {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
}

interface AdminFeedbackMessage extends FeedbackMessage {
  contact: string;
  status: string;
}

/** 问题反馈留言板：任何人可留言（昵称 + 联系方式必填），站长审核后公开展示；联系方式仅站长可见 */
function FeedbackBoard() {
  const [ready, setReady] = useState(true);
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nickname, setNickname] = useState('');
  const [contact, setContact] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [adminMsgs, setAdminMsgs] = useState<AdminFeedbackMessage[] | null>(null);
  const [adminErr, setAdminErr] = useState('');

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/feedback');
      const json = (await res.json()) as { ready?: boolean; messages?: FeedbackMessage[] };
      setReady(json.ready !== false);
      setMessages(json.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const submit = async () => {
    if (submitting) return;
    setNotice(null);
    if (!nickname.trim() || !contact.trim() || !content.trim()) {
      setNotice({ type: 'err', text: '昵称、联系方式和留言内容都要填写哦' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim(), contact: contact.trim(), content: content.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setNickname('');
        setContact('');
        setContent('');
        setNotice({ type: 'ok', text: '留言已收到！站长筛选后会展示在这里' });
      } else {
        setNotice({ type: 'err', text: json.error ?? '提交失败，请稍后再试' });
      }
    } catch {
      setNotice({ type: 'err', text: '网络异常，请稍后再试' });
    } finally {
      setSubmitting(false);
    }
  };

  const adminCall = async (action: 'list' | 'approve' | 'hide' | 'delete', id?: number) => {
    setAdminErr('');
    try {
      const res = await fetch('/api/feedback/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify(id === undefined ? { action } : { action, id }),
      });
      const json = (await res.json()) as { messages?: AdminFeedbackMessage[]; error?: string };
      if (!res.ok) {
        setAdminErr(json.error ?? '操作失败');
        return;
      }
      if (action === 'list') {
        setAdminMsgs(json.messages ?? []);
      } else {
        void adminCall('list');
      }
    } catch {
      setAdminErr('网络异常');
    }
  };

  return (
    <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 ${RAINBOW_BAR} opacity-70`} />
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
          <MessageCircle className="w-4.5 h-4.5 text-primary" />
          问题反馈 · 留言板
        </h2>
        <button
          type="button"
          onClick={() => setAdminOpen(true)}
          className="border-none cursor-pointer inline-flex items-center gap-1 text-xs text-on-surface-variant/70 hover:text-primary transition-colors"
          title="站长管理留言"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          站长管理
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          placeholder="昵称（必填，将展示）"
          className="w-full bg-surface-container border-none rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={100}
          placeholder="联系方式（必填，仅站长可见）"
          className="w-full bg-surface-container border-none rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={300}
        rows={3}
        placeholder="想说什么都可以：问题、建议、鼓励…"
        className="mt-3 w-full bg-surface-container border-none rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        {notice ? (
          <p className={`text-xs ${notice.type === 'ok' ? 'text-jelly-green' : 'text-jelly-red'}`}>{notice.text}</p>
        ) : (
          <p className="text-xs text-on-surface-variant/60">留言需站长筛选后才会公开展示；联系方式仅站长可见，不会公开</p>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="border-none cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          {submitting ? '提交中…' : '提交留言'}
        </button>
      </div>

      {loaded && (
        <div className="mt-5 space-y-3">
          {!ready ? (
            <p className="text-xs text-on-surface-variant/60">评论功能正在配置中，稍后再来看看～</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-on-surface-variant/60">还没有留言，来抢沙发！</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="bg-surface-container/60 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-on-surface">{m.nickname}</span>
                  <span className="text-[10px] text-on-surface-variant/60">{(m.created_at || '').slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-sm text-on-surface-variant whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ))
          )}
        </div>
      )}

      {adminOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setAdminOpen(false)}>
          <div className="bg-surface rounded-2xl shadow-float p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
                <ShieldCheck className="w-4.5 h-4.5 text-primary" />
                留言管理
              </h3>
              <button type="button" onClick={() => setAdminOpen(false)} className="border-none cursor-pointer text-on-surface-variant hover:text-on-surface" aria-label="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="管理密钥"
                className="flex-1 bg-surface-container border-none rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => void adminCall('list')}
                className="border-none cursor-pointer px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary/90 transition-colors"
              >
                查看
              </button>
            </div>
            {adminErr && <p className="mt-2 text-xs text-jelly-red">{adminErr}</p>}
            <div className="mt-4 space-y-3">
              {(adminMsgs ?? []).map((m) => (
                <div key={m.id} className="bg-surface-container/60 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium text-on-surface inline-flex items-center gap-2">
                      {m.nickname}
                      {m.status !== 'approved' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-jelly-orange/15 text-jelly-orange">待审核</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {m.status !== 'approved' ? (
                        <button
                          type="button"
                          onClick={() => void adminCall('approve', m.id)}
                          className="border-none cursor-pointer text-[10px] px-2 py-1 rounded-full bg-jelly-green/15 text-jelly-green inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          通过
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void adminCall('hide', m.id)}
                          className="border-none cursor-pointer text-[10px] px-2 py-1 rounded-full bg-surface-container text-on-surface-variant inline-flex items-center gap-1"
                        >
                          <EyeOff className="w-3 h-3" />
                          下架
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void adminCall('delete', m.id)}
                        className="border-none cursor-pointer text-[10px] px-2 py-1 rounded-full bg-jelly-red/15 text-jelly-red inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-on-surface-variant whitespace-pre-wrap break-words">{m.content}</p>
                  <p className="mt-1.5 text-[10px] text-on-surface-variant/70">联系方式：{m.contact}</p>
                </div>
              ))}
              {adminMsgs !== null && adminMsgs.length === 0 && (
                <p className="text-xs text-on-surface-variant/60">还没有任何留言</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function RecordsPage() {
  const [data, setData] = useState<RecordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailWord, setDetailWord] = useState<StarredWord | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);

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

  // 气泡大小与单词长度成比例（短词小泡、长词大泡）
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
        size: sizeForWord(m.word),
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
        size: sizeForWord(l.word),
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
        size: sizeForWord(r.word),
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
        <button
          type="button"
          onClick={() => setSupportOpen(true)}
          className="ml-auto border-none cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-white bg-[linear-gradient(90deg,#E57373,#F0A45B)] hover:opacity-90 active:scale-[0.97] transition-all shadow-card"
        >
          <Heart className="w-3.5 h-3.5 fill-white" />
          支持作者
        </button>
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
            <p className="mt-1 text-xs text-on-surface-variant/70">去背诵页点亮单词旁的小星星，它们会在这里化作行星环绕运行</p>
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

      {/* 问题反馈 · 留言板 */}
      <FeedbackBoard />

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

      {/* 支持作者弹层 */}
      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
    </div>
  );
}
