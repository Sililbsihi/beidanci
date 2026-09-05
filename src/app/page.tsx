'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CloudUpload, Image as ImageIcon, FileText, File as FileIcon, Presentation, Table2,
  ShieldCheck, Loader2, Search, Pencil, Trash2, Sparkles, CircleCheck, CircleAlert,
} from 'lucide-react';

interface UploadTask {
  key: string;
  filename: string;
  fileId?: number;
  batchId?: string;
  status: 'uploading' | 'recognizing' | 'done' | 'error';
  progress: number;
  error?: string;
}

interface WordDraft {
  word: string;
  pos?: string;
  translation: string;
  translationSource: 'upload' | 'search' | 'none';
  sourceFile?: string;
  batchId?: string;
  searching?: boolean;
  editing?: boolean;
}

const FORMAT_TAGS = [
  { icon: ImageIcon, label: '图片', hint: 'jpg / png / jpeg', color: 'text-jelly-red bg-jelly-red/12' },
  { icon: FileText, label: 'Word', hint: 'doc / docx', color: 'text-jelly-blue bg-jelly-blue/12' },
  { icon: FileIcon, label: 'PDF', hint: 'pdf', color: 'text-jelly-orange bg-jelly-orange/12' },
  { icon: Presentation, label: 'PPT', hint: 'ppt / pptx', color: 'text-jelly-purple bg-jelly-purple/12' },
  { icon: Table2, label: 'Excel', hint: 'xls / xlsx / csv', color: 'text-jelly-green bg-jelly-green/12' },
];

const RAINBOW_BAR =
  'bg-[linear-gradient(90deg,#E57373_0%,#F0A45B_20%,#E9C96A_40%,#7E9F7A_60%,#7FA3C9_80%,#A88BC9_100%)]';

export default function HomePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [words, setWords] = useState<WordDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const patchTask = useCallback((key: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  /** 无释义单词批量搜索中文释义 */
  const fillTranslations = useCallback(async () => {
    let missing: string[] = [];
    setWords((prev) => {
      missing = prev.filter((w) => !w.translation).map((w) => w.word);
      return prev.map((w) => (!w.translation ? { ...w, searching: true } : w));
    });
    if (missing.length === 0) return;

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: missing }),
      });
      const data = (await res.json()) as { translations?: Array<{ word: string; translation: string }> };
      if (!res.ok) throw new Error(data instanceof Object ? '释义匹配失败' : '释义匹配失败');
      const hits = data.translations ?? [];
      setWords((prev) =>
        prev.map((w) => {
          const hit = hits.find((t) => t.word === w.word);
          if (hit?.translation) return { ...w, translation: hit.translation, translationSource: 'search', searching: false };
          return { ...w, searching: false };
        }),
      );
    } catch {
      setWords((prev) => prev.map((w) => ({ ...w, searching: false })));
      showToast('部分单词释义匹配失败，可手动补充');
    }
  }, [showToast]);

  /** 上传并识别：图片走多模态 OCR，文档走解析选词 */
  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).slice(0, 5);
      if (files.length === 0) return;
      setBusy(true);

      for (const file of files) {
        const taskKey = `${file.name}-${Date.now()}`;
        setTasks((prev) => [...prev, { key: taskKey, filename: file.name, status: 'uploading', progress: 6 }]);
        const timer = window.setInterval(() => {
          setTasks((prev) =>
            prev.map((t) => (t.key === taskKey && t.progress < 88 ? { ...t, progress: t.progress + 6 } : t)),
          );
        }, 350);

        try {
          const formData = new FormData();
          formData.append('file', file);
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
          const uploadData = (await uploadRes.json()) as {
            file?: { id: number; filename: string; batch_id: string };
            error?: string;
          };
          if (!uploadRes.ok || !uploadData.file) throw new Error(uploadData.error ?? '上传失败');

          patchTask(taskKey, { status: 'recognizing', progress: 92, fileId: uploadData.file.id, batchId: uploadData.file.batch_id });

          const recRes = await fetch('/api/recognize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: uploadData.file.id }),
          });
          const recData = (await recRes.json()) as {
            words?: Array<{ word: string; pos?: string }>;
            error?: string;
          };
          if (!recRes.ok) throw new Error(recData.error ?? '识别失败');
          clearInterval(timer);
          patchTask(taskKey, { status: 'done', progress: 100 });

          setWords((prev) => {
            const next = [...prev];
            for (const item of recData.words ?? []) {
              if (next.some((w) => w.word === item.word)) continue;
              next.push({
                word: item.word,
                pos: item.pos,
                translation: '',
                translationSource: 'none',
                sourceFile: uploadData.file?.filename,
                batchId: uploadData.file?.batch_id,
              });
            }
            return next;
          });
        } catch (error) {
          clearInterval(timer);
          patchTask(taskKey, {
            status: 'error',
            error: error instanceof Error ? error.message : '处理失败',
          });
        }
      }

      setBusy(false);
      await fillTranslations();
    },
    [fillTranslations, patchTask],
  );

  /** 校对完成，全部加入背诵 */
  const handleAddAll = useCallback(async () => {
    const valid = words.filter((w) => w.word);
    if (valid.length === 0) {
      showToast('请先上传文件并识别出单词');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: valid.map((w) => ({
            word: w.word,
            pos: w.pos,
            translation: w.translation,
            translation_source: w.translationSource,
            source_file: w.sourceFile,
            batchId: w.batchId,
          })),
        }),
      });
      const data = (await res.json()) as { added?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? '加入背诵失败');
      router.push('/practice');
    } catch (error) {
      setBusy(false);
      showToast(error instanceof Error ? error.message : '加入背诵失败');
    }
  }, [router, showToast, words]);

  const saveWordEdit = (index: number, patch: Partial<WordDraft>) => {
    setWords((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch, editing: false } : w)));
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold font-display text-on-surface">上传文件，识别单词</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          支持图片（jpg/png/jpeg）、Word、PDF、PPT、Excel，自动提取英文单词并匹配中文释义
        </p>
      </div>

      {/* 临时存储说明 */}
      <div className="flex items-center gap-2.5 bg-success/10 text-success rounded-xl px-4 py-3 text-sm">
        <ShieldCheck className="w-4.5 h-4.5 shrink-0" />
        <span>上传文件仅临时保存用于本次单词识别，背诵完成后自动删除</span>
      </div>

      {/* 上传区域 */}
      <section
        id="upload-card"
        className={`bg-surface/80 backdrop-blur-md rounded-2xl shadow-card border-2 border-dashed transition-all cursor-pointer p-10 text-center hover:-translate-y-1 hover:shadow-float ${
          dragOver ? 'border-primary/60 bg-primary/5' : 'border-outline-variant'
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/12 flex items-center justify-center">
          <CloudUpload className="w-7 h-7 text-primary" />
        </div>
        <p className="mt-4 font-display font-bold text-lg text-on-surface">点击或拖拽文件到此处</p>
        <p className="mt-1 text-xs text-on-surface-variant">单次最多 5 个文件，单个不超过 20MB</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {FORMAT_TAGS.map((tag) => (
            <span
              key={tag.label}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${tag.color}`}
            >
              <tag.icon className="w-3.5 h-3.5" />
              {tag.label}
              <span className="text-on-surface-variant/70">{tag.hint}</span>
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </section>

      {/* 上传 / 识别进度 */}
      {tasks.length > 0 && (
        <section className="space-y-3">
          {tasks.map((task) => (
            <div key={task.key} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4.5 h-4.5 text-primary shrink-0" />
                  <span className="text-sm font-medium text-on-surface truncate">{task.filename}</span>
                </div>
                <span className="text-xs text-on-surface-variant shrink-0 inline-flex items-center gap-1.5">
                  {task.status === 'uploading' && (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> 上传中 {task.progress}%
                    </>
                  )}
                  {task.status === 'recognizing' && (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在识别单词
                    </>
                  )}
                  {task.status === 'done' && (
                    <>
                      <CircleCheck className="w-3.5 h-3.5 text-success" /> 识别完成
                    </>
                  )}
                  {task.status === 'error' && (
                    <>
                      <CircleAlert className="w-3.5 h-3.5 text-error" /> {task.error ?? '失败'}
                    </>
                  )}
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-surface-container overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${task.status === 'error' ? 'bg-error/60' : RAINBOW_BAR}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 识别结果 */}
      {words.length > 0 && (
        <section className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-display font-bold text-on-surface inline-flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-jelly-yellow" />
              识别出 {words.length} 个单词
            </h2>
            <div className="flex items-center gap-2.5">
              <button
                className="bg-primary text-white border-none px-4 py-2 rounded-full text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1.5"
                onClick={() => void handleAddAll()}
                disabled={busy}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleCheck className="w-4 h-4" />}
                全部加入背诵
              </button>
            </div>
          </div>

          <div className="mt-4 divide-y divide-outline-variant/70">
            {words.map((w, index) => (
              <div key={`${w.word}-${index}`} className="py-3 flex items-start gap-3">
                <div
                  className="mt-1 w-1 h-10 rounded-full shrink-0"
                  style={{
                    backgroundColor: ['#E57373', '#F0A45B', '#E9C96A', '#7E9F7A', '#7FA3C9', '#A88BC9'][index % 6],
                  }}
                />
                <div className="flex-1 min-w-0">
                  {w.editing ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        defaultValue={w.word}
                        className="bg-surface-container border-none rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        onBlur={(e) => saveWordEdit(index, { word: e.target.value.trim().toLowerCase() })}
                        placeholder="单词"
                      />
                      <input
                        defaultValue={w.pos}
                        className="bg-surface-container border-none rounded-lg px-3 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        onBlur={(e) => saveWordEdit(index, { pos: e.target.value.trim() })}
                        placeholder="词性"
                      />
                      <input
                        defaultValue={w.translation}
                        className="bg-surface-container border-none rounded-lg px-3 py-1.5 text-sm flex-1 min-w-40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        onBlur={(e) => saveWordEdit(index, { translation: e.target.value.trim() })}
                        placeholder="中文释义（; 分隔）"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-display font-bold text-lg text-on-surface">{w.word}</span>
                        {w.pos && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-jelly-blue/15 text-jelly-blue">{w.pos}</span>
                        )}
                        {w.sourceFile && (
                          <span className="text-xs text-on-surface-variant/70 inline-flex items-center gap-1">
                            <FileIcon className="w-3 h-3" />
                            {w.sourceFile}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-on-surface-variant">
                        {w.searching ? (
                          <span className="inline-flex items-center gap-1.5 text-on-surface-variant/70">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            正在搜索释义…
                          </span>
                        ) : w.translation ? (
                          <>
                            {w.translationSource === 'search' && (
                              <span className="inline-flex items-center gap-1 mr-2 text-xs text-jelly-green bg-jelly-green/12 px-2 py-0.5 rounded-full align-middle">
                                <Search className="w-3 h-3" />搜索匹配
                              </span>
                            )}
                            {w.translation}
                          </>
                        ) : (
                          <span className="text-on-surface-variant/50">暂无释义，可在编辑中手动补充</span>
                        )}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                    onClick={() => setWords((prev) => prev.map((x, i) => (i === index ? { ...x, editing: true } : x)))}
                    title="编辑"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    className="p-2 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                    onClick={() => setWords((prev) => prev.filter((_, i) => i !== index))}
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 轻量 Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-on-surface text-surface rounded-full px-5 py-2.5 text-sm shadow-float">
          {toast}
        </div>
      )}
    </div>
  );
}
