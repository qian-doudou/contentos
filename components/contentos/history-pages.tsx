'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  FileSearch,
  FileUp,
  LoaderCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { contentGoals, contentTypes } from '@/db/constants';
import { contentGoalLabels, contentTypeLabels } from '@/lib/content/contracts';
import {
  contentImportCommitResultSchema,
  contentImportPageDataSchema,
  contentImportPreviewSchema,
  dedupTestResultSchema,
  type ContentImportPreview,
  type DedupTestResult,
} from '@/lib/history/contracts';
import {
  EmptyData,
  ErrorData,
  fetchData,
  LoadingData,
  useApiData,
} from './master-data/common';
import { ContentHeading, formatLocalDate } from './content/common';

const importStatusLabels = {
  previewed: '已预览',
  committed: '已写入',
  failed: '失败',
} as const;
const dedupLabels = {
  new: '新题材',
  mild: '轻度相似',
  remixable: '可重构',
  high: '高度重复',
} as const;
const dedupTones = {
  new: 'bg-emerald-50 text-emerald-700',
  mild: 'bg-sky-50 text-sky-700',
  remixable: 'bg-amber-50 text-amber-700',
  high: 'bg-rose-50 text-rose-700',
} as const;

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function ContentImportPage({ embedded = false }: { embedded?: boolean } = {}) {
  const state = useApiData('/api/contents/import', contentImportPageDataSchema);
  const [preview, setPreview] = useState<ContentImportPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function previewFile(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    setPreview(null);
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    try {
      if (!(file instanceof File) || file.size === 0)
        throw new Error('请选择 CSV 或 JSON 文件');
      if (file.size > 1_000_000) throw new Error('单次导入文件不得超过 1 MB');
      const result = await fetchData(
        '/api/contents/import/preview',
        contentImportPreviewSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format: form.get('format'),
            dedupStrategy: form.get('dedupStrategy'),
            payload: await file.text(),
          }),
        },
      );
      setPreview(result);
      setMessage(
        result.canCommit
          ? '预览完成，确认后才会写入内容库。'
          : '预览完成，请先修正无效行。',
      );
      state.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '预览失败');
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setPending(true);
    setMessage('');
    try {
      const result = await fetchData(
        '/api/contents/import/commit',
        contentImportCommitResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: preview.batch.id }),
        },
      );
      setMessage(
        `已写入 ${result.contentIds.length} 条，Embedding 索引 ${result.embedding.indexed} 条（${result.embedding.mode === 'live' ? '百炼' : '确定性 Fallback'}）。`,
      );
      setPreview(null);
      state.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '正式写入失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {embedded ? <section className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">历史导入</h2><p className="mt-1 text-sm text-slate-500">CSV / JSON 先预览校验，再写入 SQLite 并建立内容索引。</p></div><Button variant="outline" nativeButton={false} render={<Link href="/ai/dedup-test" />}><FileSearch />去重测试</Button></section> : <ContentHeading
        title="历史内容导入"
        description="CSV / JSON 先预览校验，再写入 SQLite 并建立可失效的内容索引。"
      >
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/contents" />}
        >
          内容与脚本
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ai/dedup-test" />}
        >
          <FileSearch />
          去重测试
        </Button>
      </ContentHeading>}
      {state.loading ? (
        <LoadingData />
      ) : state.error ? (
        <ErrorData error={state.error} retry={state.reload} />
      ) : state.data ? (
        <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
            <form className="surface-card space-y-5" onSubmit={previewFile}>
              <div>
                <h2 className="text-lg font-semibold">选择文件并预览</h2>
                <p className="mt-1 text-sm text-slate-500">
                  单次最多 200 行、1 MB；预览批次不会创建 Content。
                </p>
              </div>
              {state.data.permissions.canImport ? (
                <fieldset
                  disabled={pending}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <label
                    htmlFor="import-format"
                    className="space-y-1.5 text-sm"
                  >
                    文件格式
                    <NativeSelect
                      id="import-format"
                      name="format"
                      className="w-full"
                      defaultValue="csv"
                    >
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </NativeSelect>
                  </label>
                  <label htmlFor="import-dedup" className="space-y-1.5 text-sm">
                    去重键
                    <NativeSelect
                      id="import-dedup"
                      name="dedupStrategy"
                      className="w-full"
                      defaultValue="external_id"
                    >
                      <option value="external_id">外部 ID</option>
                      <option value="title_published_at">
                        标题 + 发布时间
                      </option>
                      <option value="canonical">结构化内容 Hash</option>
                    </NativeSelect>
                  </label>
                  <label
                    htmlFor="import-file"
                    className="space-y-1.5 text-sm sm:col-span-2"
                  >
                    CSV / JSON 文件
                    <Input
                      id="import-file"
                      name="file"
                      type="file"
                      accept=".csv,.json,text/csv,application/json"
                      required
                    />
                  </label>
                  <Button className="sm:col-span-2" type="submit">
                    {pending ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <FileUp />
                    )}
                    仅预览与校验
                  </Button>
                </fieldset>
              ) : (
                <EmptyData
                  title="无导入权限"
                  description="当前身份没有可管理的客户账号。"
                />
              )}
              {message && (
                <output className="block rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                  {message}
                </output>
              )}
            </form>
            <aside className="surface-card space-y-4">
              <div>
                <h2 className="font-semibold">字段约定</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  JSON 根节点为数组；CSV
                  首行使用下列英文字段。枚举值也使用稳定英文值。
                </p>
              </div>
              <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                account_id,account_identifier,external_id,title,{`\n`}
                content_type,content_goal,topic,angle,hook_text,{`\n`}
                core_message,published_at
              </pre>
              <div>
                <p className="text-sm font-medium">可解析账号</p>
                <div className="mt-2 space-y-2">
                  {state.data.accounts.map((account) => (
                    <div
                      className="rounded-lg border p-3 text-sm"
                      key={account.id}
                    >
                      <p className="font-medium">
                        {account.clientName} / {account.accountName}
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-400">
                        {account.id}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </section>

          {preview && (
            <section className="surface-card !p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                <div>
                  <h2 className="font-semibold">预览结果</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    有效 {preview.batch.validRows} · 重复{' '}
                    {preview.batch.duplicateRows} · 无效{' '}
                    {preview.batch.invalidRows}
                  </p>
                </div>
                <Button
                  disabled={!preview.canCommit || pending}
                  onClick={commit}
                >
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}
                  确认写入 {preview.batch.validRows} 条
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>行</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>账号 / 标题</TableHead>
                      <TableHead>类型 / 目标</TableHead>
                      <TableHead>发布时间</TableHead>
                      <TableHead>校验说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.items.map((item) => (
                      <TableRow key={item.rowNumber}>
                        <TableCell>{item.rowNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              item.status === 'valid'
                                ? 'bg-emerald-50 text-emerald-700'
                                : item.status === 'duplicate'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-rose-50 text-rose-700'
                            }
                          >
                            {item.status === 'valid'
                              ? '可写入'
                              : item.status === 'duplicate'
                                ? '将跳过'
                                : '无效'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-80">
                          <p className="font-medium">
                            {item.title || '未识别标题'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.accountName || '账号未解析'}
                          </p>
                        </TableCell>
                        <TableCell>
                          {item.contentType
                            ? contentTypeLabels[item.contentType]
                            : '未填'}{' '}
                          /{' '}
                          {item.contentGoal
                            ? contentGoalLabels[item.contentGoal]
                            : '未填'}
                        </TableCell>
                        <TableCell>
                          {formatLocalDate(item.publishedAt)}
                        </TableCell>
                        <TableCell className="max-w-80 text-xs text-slate-500">
                          {item.issues.join('；') || '通过'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          <section className="surface-card !p-0">
            <div className="border-b p-5">
              <h2 className="font-semibold">最近导入批次</h2>
            </div>
            {state.data.batches.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>格式 / 去重键</TableHead>
                    <TableHead>预览统计</TableHead>
                    <TableHead>已写入</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.data.batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        {new Date(batch.createdAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell>
                        {batch.format.toUpperCase()} / {batch.dedupStrategy}
                      </TableCell>
                      <TableCell>
                        有效 {batch.validRows} · 重复 {batch.duplicateRows} ·
                        无效 {batch.invalidRows}
                      </TableCell>
                      <TableCell>{batch.committedRows}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {importStatusLabels[batch.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyData
                title="尚无导入批次"
                description="选择文件完成第一次预览。"
              />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export function DedupTestPage() {
  const state = useApiData('/api/contents/import', contentImportPageDataSchema);
  const [result, setResult] = useState<DedupTestResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setPending(true);
    setError('');
    setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      setResult(
        await fetchData('/api/ai/dedup-test', dedupTestResultSchema, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: form.get('accountId'),
            title: form.get('title'),
            contentType: form.get('contentType') || null,
            contentGoal: form.get('contentGoal') || null,
            topic: form.get('topic') || null,
            angle: form.get('angle') || null,
            hookText: form.get('hookText') || null,
            coreMessage: form.get('coreMessage') || null,
          }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '去重测试失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">AI 运营</p>
          <h1 className="page-title">历史内容去重测试</h1>
          <p className="page-description">
            先在同组织、同账号内召回 Top10，再将规则初筛的最多 Top5 交给
            duplicate_judge。
          </p>
        </div>
        <div className="flex gap-2">
          <Badge className="bg-violet-50 text-violet-700" variant="secondary">
            Test Run · 不扣 Points
          </Badge>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/contents/import" />}
          >
            历史导入
          </Button>
        </div>
      </header>
      {state.loading ? (
        <LoadingData />
      ) : state.error ? (
        <ErrorData error={state.error} retry={state.reload} />
      ) : state.data ? (
        <>
          {state.data.permissions.canTest && state.data.accounts.length ? (
            <form className="surface-card space-y-5" onSubmit={submit}>
              <div className="grid gap-4 lg:grid-cols-3">
                <label htmlFor="dedup-account" className="space-y-1.5 text-sm">
                  账号
                  <NativeSelect
                    id="dedup-account"
                    name="accountId"
                    className="w-full"
                    required
                  >
                    {state.data.accounts.map((account) => (
                      <option value={account.id} key={account.id}>
                        {account.clientName} / {account.accountName}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label htmlFor="dedup-type" className="space-y-1.5 text-sm">
                  内容类型
                  <NativeSelect
                    id="dedup-type"
                    name="contentType"
                    className="w-full"
                  >
                    <option value="">未指定</option>
                    {contentTypes.map((value) => (
                      <option value={value} key={value}>
                        {contentTypeLabels[value]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label htmlFor="dedup-goal" className="space-y-1.5 text-sm">
                  内容目标
                  <NativeSelect
                    id="dedup-goal"
                    name="contentGoal"
                    className="w-full"
                  >
                    <option value="">未指定</option>
                    {contentGoals.map((value) => (
                      <option value={value} key={value}>
                        {contentGoalLabels[value]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label
                  htmlFor="dedup-title"
                  className="space-y-1.5 text-sm lg:col-span-3"
                >
                  候选标题
                  <Input
                    id="dedup-title"
                    name="title"
                    maxLength={160}
                    required
                    placeholder="例：掌柜现场教你挑当天鲜切羊肉"
                  />
                </label>
                <label htmlFor="dedup-topic" className="space-y-1.5 text-sm">
                  Topic
                  <Input
                    id="dedup-topic"
                    name="topic"
                    maxLength={300}
                    placeholder="内容主题"
                  />
                </label>
                <label
                  htmlFor="dedup-angle"
                  className="space-y-1.5 text-sm lg:col-span-2"
                >
                  Angle
                  <Input
                    id="dedup-angle"
                    name="angle"
                    maxLength={5000}
                    placeholder="从哪个视角切入"
                  />
                </label>
                <label
                  htmlFor="dedup-hook"
                  className="space-y-1.5 text-sm lg:col-span-3"
                >
                  Hook
                  <Textarea
                    id="dedup-hook"
                    name="hookText"
                    maxLength={5000}
                    className="min-h-20"
                  />
                </label>
                <label
                  htmlFor="dedup-core"
                  className="space-y-1.5 text-sm lg:col-span-3"
                >
                  Core Message
                  <Textarea
                    id="dedup-core"
                    name="coreMessage"
                    maxLength={5000}
                    className="min-h-20"
                  />
                </label>
              </div>
              <Button disabled={pending} type="submit">
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <DatabaseZap />
                )}
                运行去重测试
              </Button>
              {error && (
                <output className="block rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                  {error}
                </output>
              )}
            </form>
          ) : (
            <EmptyData
              title="无去重测试权限"
              description="当前身份不能执行 AI Test Run。"
            />
          )}

          {result && (
            <>
              <section className="grid gap-4 xl:grid-cols-4">
                <article className="surface-card xl:col-span-2">
                  <p className="section-kicker">duplicate_judge</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">判定结果</h2>
                    <Badge
                      className={dedupTones[result.judgment.duplicate_level]}
                      variant="secondary"
                    >
                      {dedupLabels[result.judgment.duplicate_level]}
                    </Badge>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-700">
                    {result.judgment.reason}
                  </p>
                  <p className="mt-3 text-sm font-medium">
                    {result.judgment.recommended_action}
                  </p>
                  {result.judgment.alternative_angles.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {result.judgment.alternative_angles.map((angle) => (
                        <Badge variant="outline" key={angle}>
                          {angle}
                        </Badge>
                      ))}
                    </div>
                  )}
                </article>
                <article className="surface-card">
                  <p className="section-kicker">Embedding</p>
                  <h2 className="mt-2 font-semibold">
                    {result.embedding.mode === 'live'
                      ? '百炼 Embedding'
                      : '中文 Fallback'}
                  </h2>
                  <p className="mt-3 break-all font-mono text-xs text-slate-500">
                    {result.embedding.model}
                  </p>
                  <p className="mt-3 text-sm text-slate-500">
                    {result.top10.length} 条 Top10 结果已持久化。
                  </p>
                </article>
                <article className="surface-card">
                  <p className="section-kicker">Run Trace</p>
                  <h2 className="mt-2 font-semibold">
                    {result.run ? result.run.status : '未调用 Skill'}
                  </h2>
                  <p className="mt-3 text-sm text-slate-500">
                    Billed Points：{result.run?.billedPoints ?? 0}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {result.run
                      ? `${result.run.mode.toUpperCase()} · Schema ${result.run.schemaValid ? '通过' : '失败'}`
                      : '无 Top5 时不创建无意义调用'}
                  </p>
                </article>
              </section>
              {result.fallbackUsed && (
                <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Fallback 已启用</p>
                    <p className="mt-1">{result.fallbackReason}</p>
                  </div>
                </section>
              )}
              <section className="surface-card !p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                  <div>
                    <h2 className="font-semibold">历史 Top10</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Topic 相同只占
                      10%，角度、钩子、核心信息和语义分数分别由代码计算。
                    </p>
                  </div>
                  <Badge variant="outline">
                    Top5 送审 {result.judgeInputContentIds.length} 条
                  </Badge>
                </div>
                {result.top10.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>历史内容</TableHead>
                          <TableHead>语义</TableHead>
                          <TableHead>Topic</TableHead>
                          <TableHead>Angle</TableHead>
                          <TableHead>Hook</TableHead>
                          <TableHead>Core</TableHead>
                          <TableHead>综合</TableHead>
                          <TableHead>处理</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.top10.map((item) => (
                          <TableRow key={item.contentId}>
                            <TableCell>{item.rank}</TableCell>
                            <TableCell className="max-w-80">
                              <Link
                                className="font-medium text-cyan-800 hover:underline"
                                href={`/contents/${item.contentId}`}
                              >
                                {item.title}
                              </Link>
                              <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                                {item.angle || item.topic || '未填写结构化摘要'}
                              </p>
                            </TableCell>
                            <TableCell>{percentage(item.similarity)}</TableCell>
                            <TableCell>
                              {percentage(item.ruleScore.topic)}
                            </TableCell>
                            <TableCell>
                              {percentage(item.ruleScore.angle)}
                            </TableCell>
                            <TableCell>
                              {percentage(item.ruleScore.hook)}
                            </TableCell>
                            <TableCell>
                              {percentage(item.ruleScore.coreMessage)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {percentage(item.ruleScore.combined)}
                            </TableCell>
                            <TableCell>
                              {item.sentToJudge ? (
                                <Badge
                                  className="bg-violet-50 text-violet-700"
                                  variant="secondary"
                                >
                                  进入 Top5
                                </Badge>
                              ) : (
                                <Badge variant="outline">仅召回</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyData
                    title="暂无历史内容"
                    description="请先导入或发布该账号的历史内容。"
                  />
                )}
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
