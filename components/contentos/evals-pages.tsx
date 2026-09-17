'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, FlaskConical,
  GitCompareArrows, Save, ShieldCheck, Sparkles, Star, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ratingIssueTags } from '@/db/constants';
import {
  evalCaseSchema, evalDashboardDataSchema, evalExperimentSchema,
  improvementProposalSchema, ratingSchema, scanRunsResultSchema,
  type AggregateEvalMetrics, type EvalCase, type ImprovementProposal,
} from '@/lib/evals/contracts';
import { EmptyData, ErrorData, fetchData, LoadingData, useApiData } from './master-data/common';

const issueLabels: Record<(typeof ratingIssueTags)[number], string> = {
  brand_fact_error: '品牌事实错误', expired_information: '过期信息', duplicate_content: '内容重复',
  wrong_style: '风格错误', unusable_script: '脚本不可用', wrong_content_goal: '内容目标错误',
  poor_strategy: '策略质量差', invalid_json: 'JSON 无效', context_missing: '上下文缺失', other: '其他',
};
const categoryLabels: Record<string, string> = {
  ...issueLabels, low_rating: '低评分', memory_status_violation: '失效后台资料被引用',
  high_duplicate_default: '高重复仍默认推荐', schema_repeated_failure: 'Schema 连续失败', manual_flag: '人工标记',
};
const severityLabels = { low: '低', medium: '中', high: '高', critical: '严重' } as const;
const proposalStatusLabels = { draft: '草案', evaluated: '已评测', applied: '已应用', rejected: '已拒绝' } as const;
const verdictLabels = { data_insufficient: '数据不足', passed: '通过门槛', regressed: '存在退化' } as const;

function QualityHeading({ title, description, back = false }: { title: string; description: string; back?: boolean }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">AI 质量闭环 / 人工控制上线</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {back && <Button variant="outline" nativeButton={false} render={<Link href="/evals" />}><ArrowLeft />评测中心</Button>}
        <Button variant="outline" nativeButton={false} render={<Link href="/skills" />}>生产 Skill</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}>Run 追踪</Button>
      </div>
    </header>
  );
}

function percent(value: number | null) {
  return value === null ? '数据不足' : `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number | null) {
  return value === null ? 'unknown' : value.toFixed(6);
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  if (typeof value !== 'string') throw new Error(`${key} 必须是文本`);
  return value;
}

function ScoreCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader><CardContent><p className="text-xs leading-5 text-slate-500">{note}</p></CardContent></Card>;
}

function MetricsPanel({ data }: { data: ReturnType<typeof evalDashboardDataSchema.parse>['metrics'] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">确定性质量指标</h2>
        <p className="mt-1 text-sm text-slate-500">事实由代码和已保存标注计算；没有样本时明确显示数据不足。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreCard label="Planner Schema 通过率" value={percent(data.planner.schemaPassRate)} note={`${data.planner.totalRuns} 个 Production Run`} />
        <ScoreCard label="高重复默认推荐违规" value={data.planner.highDuplicateDefaultViolations} note={`无效动态事实 ${data.planner.invalidDynamicFacts}`} />
        <ScoreCard label="Script Schema 通过率" value={percent(data.script.schemaPassRate)} note={`${data.script.totalRuns} 个 Production Run`} />
        <ScoreCard label="Duplicate Judge 准确率" value={percent(data.duplicateJudge.accuracy)} note={`${data.duplicateJudge.labeledCases} 个人工标注 Case · high 召回 ${percent(data.duplicateJudge.highRecall)}`} />
      </div>
      <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">
        Script 确定性违规：禁用信息 <b>{data.script.forbiddenInformationViolations}</b> · 失效后台资料 <b>{data.script.supersededMemoryUses}</b> · 品牌事实错误 <b>{data.script.brandFactErrors}</b>
      </div>
    </section>
  );
}

function RatingForm({ reload }: { reload: () => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await fetchData('/api/evals/ratings', ratingSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: form.get('runId'), overallScore: Number(form.get('overallScore')),
          brandConsistency: Number(form.get('brandConsistency')), usability: Number(form.get('usability')),
          novelty: Number(form.get('novelty')), comment: form.get('comment'),
          issueTags: ratingIssueTags.filter((tag) => form.get(tag) === 'on'),
          markedBadCase: form.get('markedBadCase') === 'on',
        }),
      });
      event.currentTarget.reset();
      setMessage('评分已保存；低评分和关键问题已生成可追踪 Bad Case。');
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '评分保存失败');
    } finally { setPending(false); }
  }
  return (
    <form className="surface-card space-y-5" onSubmit={submit}>
      <div><h2 className="text-lg font-semibold">评价 Production Run</h2><p className="mt-1 text-sm text-slate-500">只接受当前组织中有权限的 Production Run；修改评分会新增历史版本。</p></div>
      <label htmlFor="rating-run" className="block space-y-1.5 text-sm">Run ID<Input id="rating-run" name="runId" placeholder="从 Run 追踪页复制 UUID" required /></label>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([['overallScore', '综合评分'], ['brandConsistency', '品牌一致性'], ['usability', '可用性'], ['novelty', '新颖度']] as const).map(([name, label]) => (
          <label className="space-y-1.5 text-sm" key={name}>{label}<NativeSelect className="w-full" name={name} defaultValue="3">{[5, 4, 3, 2, 1].map((score) => <option value={score} key={score}>{score} 分</option>)}</NativeSelect></label>
        ))}
      </div>
      <fieldset><legend className="text-sm">人工问题标签</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{ratingIssueTags.map((tag) => <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" key={tag}><input type="checkbox" name={tag} />{issueLabels[tag]}</label>)}</div></fieldset>
      <label htmlFor="rating-comment" className="block space-y-1.5 text-sm">评语<Textarea id="rating-comment" name="comment" maxLength={5000} placeholder="说明可复现问题或值得保留的质量表现" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="markedBadCase" />人工标记为 Bad Case</label>
      {message && <output className="block rounded-lg bg-slate-50 p-3 text-sm text-cyan-800">{message}</output>}
      <Button disabled={pending}><Star />{pending ? '保存中…' : '保存评分'}</Button>
    </form>
  );
}

function EvalCaseForm({ reload }: { reload: () => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const sourceType = formText(form, 'sourceType');
      await fetchData('/api/evals/cases', evalCaseSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          sourceType, sourceId: form.get('sourceId') || null, name: form.get('name'), skillCode: form.get('skillCode'),
          inputSnapshot: JSON.parse(formText(form, 'inputSnapshot')), contextSnapshot: JSON.parse(formText(form, 'contextSnapshot')),
          expectedBehavior: form.get('expectedBehavior'), expectedDuplicateLevel: form.get('expectedDuplicateLevel') || null,
          assertions: {
            requiredText: formText(form, 'requiredText').split('\n').map((item) => item.trim()).filter(Boolean),
            forbiddenText: formText(form, 'forbiddenText').split('\n').map((item) => item.trim()).filter(Boolean), requireSchemaValid: true,
          },
        }),
      });
      event.currentTarget.reset(); setMessage('Eval Case 已保存。'); reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '创建失败'); }
    finally { setPending(false); }
  }
  return (
    <form className="surface-card space-y-4" onSubmit={submit}>
      <div><h2 className="text-lg font-semibold">创建 Eval Case</h2><p className="mt-1 text-sm text-slate-500">可来自 Bad Case、高评分 Production Run 或人工构造；所有 Snapshot 均保存在本地库。</p></div>
      <div className="grid gap-3 md:grid-cols-3">
        <label htmlFor="eval-case-source" className="space-y-1.5 text-sm">来源<NativeSelect id="eval-case-source" className="w-full" name="sourceType" defaultValue="manual"><option value="manual">人工创建</option><option value="bad_case">Bad Case</option><option value="high_rating_production">高评分 Production Run</option></NativeSelect></label>
        <label htmlFor="eval-case-source-id" className="space-y-1.5 text-sm">来源 ID（可选）<Input id="eval-case-source-id" name="sourceId" placeholder="Bad Case 或评分 UUID" /></label>
        <label htmlFor="eval-case-name" className="space-y-1.5 text-sm">名称<Input id="eval-case-name" name="name" required /></label>
        <label htmlFor="eval-case-skill" className="space-y-1.5 text-sm">Skill code<Input id="eval-case-skill" name="skillCode" required placeholder="content_planner" /></label>
        <label htmlFor="eval-case-duplicate" className="space-y-1.5 text-sm">期望重复等级<NativeSelect id="eval-case-duplicate" className="w-full" name="expectedDuplicateLevel"><option value="">不校验</option><option value="new">new</option><option value="mild">mild</option><option value="remixable">remixable</option><option value="high">high</option></NativeSelect></label>
        <label htmlFor="eval-case-expected" className="space-y-1.5 text-sm">期望行为<Input id="eval-case-expected" name="expectedBehavior" required /></label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2"><label htmlFor="eval-case-input" className="space-y-1.5 text-sm">固定输入 JSON<Textarea id="eval-case-input" className="min-h-32 font-mono text-xs" name="inputSnapshot" defaultValue="{}" required /></label><label htmlFor="eval-case-context" className="space-y-1.5 text-sm">固定 Context Snapshot JSON<Textarea id="eval-case-context" className="min-h-32 font-mono text-xs" name="contextSnapshot" defaultValue="{}" required /></label></div>
      <div className="grid gap-3 lg:grid-cols-2"><label htmlFor="eval-case-required" className="space-y-1.5 text-sm">必须包含（每行一条）<Textarea id="eval-case-required" name="requiredText" /></label><label htmlFor="eval-case-forbidden" className="space-y-1.5 text-sm">不得包含（每行一条）<Textarea id="eval-case-forbidden" name="forbiddenText" /></label></div>
      {message && <output className="block text-sm text-cyan-800">{message}</output>}<Button disabled={pending}><Save />{pending ? '创建中…' : '创建 Case'}</Button>
    </form>
  );
}

export function EvalsPage() {
  const state = useApiData('/api/evals', evalDashboardDataSchema);
  const scanned = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const canManage = state.data?.permissions.canManage ?? false;
  useEffect(() => {
    if (!state.data?.permissions.canManage || scanned.current) return;
    scanned.current = true;
    void fetchData('/api/evals/scan', scanRunsResultSchema, { method: 'POST' })
      .then((result) => { if (result.createdCases > 0) state.reload(); })
      .catch(() => undefined);
  }, [state]);
  async function createProposal() {
    setPending(true); setMessage('');
    try {
      const proposal = await fetchData('/api/evals/proposals', improvementProposalSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ badCaseIds: selected }),
      });
      window.location.href = `/evals/proposals/${proposal.id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : '草案生成失败'); setPending(false); }
  }
  async function caseFromBadCase(row: NonNullable<typeof state.data>['badCases'][number]) {
    setMessage('');
    try {
      await fetchData('/api/evals/cases', evalCaseSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          sourceType: 'bad_case', sourceId: row.id, name: `Bad Case · ${categoryLabels[row.category] ?? row.category}`,
          skillCode: row.skillCode, inputSnapshot: {}, contextSnapshot: {}, expectedBehavior: row.expectedBehavior,
          expectedDuplicateLevel: null, assertions: { requiredText: [], forbiddenText: [], requireSchemaValid: true },
        }),
      });
      setMessage('已从 Bad Case 创建 Eval Case。'); state.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '创建 Case 失败'); }
  }
  return (
    <div className="space-y-6">
      <QualityHeading title="评测中心" description="从生产反馈发现 Bad Case，以冻结输入的 A/B Eval 决定 Prompt 是否可以发布。" />
      {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && <>
        <MetricsPanel data={state.data.metrics} />
        <Tabs defaultValue="cases">
          <TabsList><TabsTrigger value="cases">Bad Case</TabsTrigger><TabsTrigger value="proposals">改进草案</TabsTrigger><TabsTrigger value="eval-cases">Eval Case</TabsTrigger><TabsTrigger value="ratings">评分</TabsTrigger></TabsList>
          <TabsContent value="cases" className="space-y-4 pt-4">
            {state.data.permissions.canManage && <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4"><Button disabled={!selected.length || pending} onClick={() => void createProposal()}><Sparkles />{pending ? '生成中…' : `为已选 ${selected.length} 条生成 Draft`}</Button><span className="text-sm text-slate-500">所选 Case 必须属于同一 Skill；生成只保存草案，不修改生产 Prompt。</span></div>}
            {message && <output className="block rounded-lg bg-cyan-50 p-3 text-sm text-cyan-800">{message}</output>}
            <section className="surface-card !p-0 overflow-hidden">{state.data.badCases.length ? <Table><TableHeader><TableRow><TableHead className="w-12">选择</TableHead><TableHead>问题</TableHead><TableHead>Skill / Run</TableHead><TableHead>期望行为</TableHead><TableHead>状态</TableHead><TableHead className="text-right">行动</TableHead></TableRow></TableHeader><TableBody>{state.data.badCases.map((row) => <TableRow key={row.id}>
              <TableCell><input aria-label={`选择 ${categoryLabels[row.category] ?? row.category}`} type="checkbox" disabled={!canManage} checked={selected.includes(row.id)} onChange={(event) => setSelected((items) => event.target.checked ? [...items, row.id] : items.filter((id) => id !== row.id))} /></TableCell>
              <TableCell><div className="flex flex-wrap gap-2"><Badge className={row.severity === 'critical' ? 'bg-rose-100 text-rose-800' : row.severity === 'high' ? 'bg-orange-100 text-orange-800' : ''}>{categoryLabels[row.category] ?? row.category}</Badge><Badge variant="outline">{severityLabels[row.severity]}</Badge>{row.ruleGenerated && <Badge variant="secondary">规则生成</Badge>}</div><p className="mt-2 text-xs text-slate-500">{new Date(row.createdAt).toLocaleString('zh-CN')}</p></TableCell>
              <TableCell><p className="font-mono text-xs">{row.skillCode} · v{row.skillVersion}</p><Link className="mt-1 block text-xs text-cyan-800 hover:underline" href={`/ops/runs/${row.runId}`}>{row.runId.slice(0, 8)}…</Link></TableCell>
              <TableCell><p className="max-w-md text-sm leading-6">{row.expectedBehavior || '待补充'}</p></TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
              <TableCell className="text-right">{canManage && <Button size="sm" variant="outline" onClick={() => void caseFromBadCase(row)}><FlaskConical />转 Eval Case</Button>}</TableCell>
            </TableRow>)}</TableBody></Table> : <EmptyData title="暂无 Bad Case" description="生产 Run 的低评分、关键问题和规则违规会在这里形成可行动记录。" />}</section>
          </TabsContent>
          <TabsContent value="proposals" className="pt-4"><section className="surface-card !p-0 overflow-hidden">{state.data.proposals.length ? <Table><TableHeader><TableRow><TableHead>Skill / 基线</TableHead><TableHead>根因</TableHead><TableHead>风险</TableHead><TableHead>状态</TableHead><TableHead className="text-right">行动</TableHead></TableRow></TableHeader><TableBody>{state.data.proposals.map((row) => <TableRow key={row.id}><TableCell><p className="font-medium">{row.skillName}</p><p className="mt-1 font-mono text-xs text-slate-500">{row.skillCode} · v{row.baseSkillVersion}</p></TableCell><TableCell className="max-w-lg text-sm">{row.rootCause}</TableCell><TableCell>{row.risks.length} 项</TableCell><TableCell><Badge>{proposalStatusLabels[row.status]}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/evals/proposals/${row.id}`} />}>查看 Diff<GitCompareArrows /></Button></TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="暂无改进草案" description="先选择同一 Skill 的 Bad Case，再生成不影响生产的 Draft。" />}</section></TabsContent>
          <TabsContent value="eval-cases" className="space-y-4 pt-4">
            {state.data.permissions.canManage && <EvalCaseForm reload={state.reload} />}
            <section className="surface-card !p-0 overflow-hidden">{state.data.evalCases.length ? <Table><TableHeader><TableRow><TableHead>Case</TableHead><TableHead>来源</TableHead><TableHead>Skill</TableHead><TableHead>期望</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{state.data.evalCases.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.name}</TableCell><TableCell>{row.sourceType}</TableCell><TableCell className="font-mono text-xs">{row.skillCode} · v{row.skillVersion}</TableCell><TableCell className="max-w-md text-sm">{row.expectedBehavior}</TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="暂无 Eval Case" description="从 Bad Case、高评分 Production Run 或人工样本创建固定评测输入。" />}</section>
          </TabsContent>
          <TabsContent value="ratings" className="space-y-4 pt-4">
            {state.data.permissions.canRate && <RatingForm reload={state.reload} />}
            <section className="surface-card !p-0 overflow-hidden">{state.data.ratings.length ? <Table><TableHeader><TableRow><TableHead>Run</TableHead><TableHead>评分</TableHead><TableHead>问题标签</TableHead><TableHead>版本</TableHead><TableHead>时间</TableHead></TableRow></TableHeader><TableBody>{state.data.ratings.map((row) => <TableRow key={row.id}><TableCell><Link className="font-mono text-xs text-cyan-800 hover:underline" href={`/ops/runs/${row.runId}`}>{row.runId.slice(0, 12)}…</Link></TableCell><TableCell><span className="font-semibold">{row.overallScore}</span> / 5</TableCell><TableCell><div className="flex max-w-lg flex-wrap gap-1">{row.issueTags.length ? row.issueTags.map((tag) => <Badge variant="secondary" key={tag}>{issueLabels[tag]}</Badge>) : <span className="text-slate-400">无</span>}</div></TableCell><TableCell>v{row.currentVersion} · 保留 {row.versions.length} 版</TableCell><TableCell className="text-xs text-slate-500">{new Date(row.ratedAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="暂无评分" description="可从 Run 追踪选择 Production Run 并在这里评分。" />}</section>
          </TabsContent>
        </Tabs>
      </>}
    </div>
  );
}

function DiffBlock({ title, lines }: { title: string; lines: ImprovementProposal['diff']['system'] }) {
  return <section className="rounded-xl border bg-white"><div className="border-b px-4 py-3 font-medium">{title}</div><pre className="max-h-[32rem] overflow-auto p-4 text-xs leading-6">{lines.map((row, index) => <div className={row.type === 'add' ? 'bg-emerald-50 text-emerald-800' : row.type === 'remove' ? 'bg-rose-50 text-rose-800' : 'text-slate-600'} key={`${row.type}-${index}`}><span className="mr-3 inline-block w-4 select-none">{row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}</span>{row.line || ' '}</div>)}</pre></section>;
}

function MetricComparison({ a, b }: { a: AggregateEvalMetrics; b: AggregateEvalMetrics }) {
  const rows = [
    ['样本数', a.sampleSize, b.sampleSize], ['Schema 通过率', percent(a.schemaPassRate), percent(b.schemaPassRate)],
    ['关键规则通过率', percent(a.keyRulePassRate), percent(b.keyRulePassRate)],
    ['品牌事实错误', a.brandFactErrors, b.brandFactErrors], ['失效后台资料使用', a.supersededMemoryUses, b.supersededMemoryUses],
    ['高重复违规', a.highDuplicateDefaultViolations, b.highDuplicateDefaultViolations],
    ['平均耗时', `${Math.round(a.averageDurationMs)} ms`, `${Math.round(b.averageDurationMs)} ms`],
    ['平均成本', formatCost(a.averageEstimatedCost), formatCost(b.averageEstimatedCost)],
  ];
  return <Table><TableHeader><TableRow><TableHead>指标</TableHead><TableHead>A · 当前生产</TableHead><TableHead>B · 改进草案</TableHead></TableRow></TableHeader><TableBody>{rows.map(([label, av, bv]) => <TableRow key={String(label)}><TableCell>{label}</TableCell><TableCell>{av}</TableCell><TableCell>{bv}</TableCell></TableRow>)}</TableBody></Table>;
}

export function ProposalDetailPage({ id }: { id: string }) {
  const proposal = useApiData(`/api/evals/proposals/${id}`, improvementProposalSchema);
  const dashboard = useApiData('/api/evals', evalDashboardDataSchema);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const eligible = dashboard.data?.evalCases.filter((row) => row.status === 'active' && row.skillCode === proposal.data?.skillCode) ?? [];
  async function run() {
    setPending('run'); setMessage('');
    try {
      await fetchData(`/api/evals/proposals/${id}/run`, evalExperimentSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evalCaseIds: selected }) });
      setMessage('A/B Eval 已完成。'); proposal.reload(); dashboard.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'A/B Eval 失败'); }
    finally { setPending(''); }
  }
  async function apply() {
    setPending('apply'); setMessage('');
    try {
      await fetchData(`/api/evals/proposals/${id}/apply`, improvementProposalSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'APPLY_EVALUATED_PROMPT' }) });
      setMessage('人工确认已记录，生产 Skill 已创建新版本。'); proposal.reload(); dashboard.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '应用失败'); }
    finally { setPending(''); }
  }
  if (proposal.loading || dashboard.loading) return <LoadingData />;
  if (proposal.error) return <ErrorData error={proposal.error} retry={proposal.reload} />;
  if (dashboard.error) return <ErrorData error={dashboard.error} retry={dashboard.reload} />;
  if (!proposal.data || !dashboard.data) return null;
  const row = proposal.data;
  const experiment = row.latestExperiment;
  return (
    <div className="space-y-6">
      <QualityHeading back title={`${row.skillName} · Prompt 改进`} description={`生产基线 v${row.baseSkillVersion} 保持不变；只有通过门槛并人工确认后才创建新版本。`} />
      <section className="grid gap-4 lg:grid-cols-3"><Card><CardHeader><CardDescription>草案状态</CardDescription><CardTitle>{proposalStatusLabels[row.status]}</CardTitle></CardHeader></Card><Card><CardHeader><CardDescription>关联 Bad Case</CardDescription><CardTitle>{row.affectedCases.length}</CardTitle></CardHeader></Card><Card><CardHeader><CardDescription>Proposal Run</CardDescription><CardTitle className="font-mono text-sm"><Link className="text-cyan-800 hover:underline" href={`/ops/runs/${row.proposalRunId}`}>{row.proposalRunId.slice(0, 18)}…</Link></CardTitle></CardHeader></Card></section>
      <section className="surface-card grid gap-5 lg:grid-cols-2"><div><h2 className="font-semibold">根因</h2><p className="mt-2 text-sm leading-6 text-slate-600">{row.rootCause}</p></div><div><h2 className="font-semibold">变更原因</h2><p className="mt-2 text-sm leading-6 text-slate-600">{row.changeReason}</p></div><div className="lg:col-span-2"><h2 className="font-semibold">风险</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{row.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div></section>
      <div className="grid gap-5 xl:grid-cols-2"><DiffBlock title="System Prompt · 行级 Diff" lines={row.diff.system} /><DiffBlock title="User Prompt Template · 行级 Diff" lines={row.diff.user} /></div>
      {dashboard.data.permissions.canManage && row.status !== 'applied' && <section className="surface-card space-y-4"><div><h2 className="text-lg font-semibold">选择冻结 Eval Case</h2><p className="mt-1 text-sm text-slate-500">A 与 B 使用完全相同的 input、Context Snapshot 和模型档位；只比较 Prompt。</p></div>{eligible.length ? <div className="grid gap-2 lg:grid-cols-2">{eligible.map((evalCase: EvalCase) => <label aria-label={`选择 Eval Case：${evalCase.name}`} className="flex items-start gap-3 rounded-xl border p-3 text-sm" key={evalCase.id}><input className="mt-1" type="checkbox" checked={selected.includes(evalCase.id)} onChange={(event) => setSelected((items) => event.target.checked ? [...items, evalCase.id] : items.filter((caseId) => caseId !== evalCase.id))} /><span><b className="block">{evalCase.name}</b><span className="mt-1 block text-xs text-slate-500">{evalCase.sourceType} · {evalCase.expectedBehavior}</span></span></label>)}</div> : <EmptyData title="没有匹配的 Eval Case" description={`先在评测中心为 ${row.skillCode} 创建 Eval Case。`} />}<Button disabled={!selected.length || Boolean(pending)} onClick={() => void run()}><FlaskConical />{pending === 'run' ? '评测中…' : `运行 A/B · ${selected.length} Case`}</Button></section>}
      {message && <output className="block rounded-xl bg-cyan-50 p-4 text-sm text-cyan-800">{message}</output>}
      {experiment && <section className="surface-card !p-0 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="text-lg font-semibold">最近一次 A/B 结果</h2><p className="mt-1 text-sm text-slate-500">模型档位 {experiment.modelProfile} · A/B 各 {experiment.caseIds.length} 个相同 Case</p></div><Badge className={experiment.comparison.canApply ? 'bg-emerald-100 text-emerald-800' : experiment.verdict === 'regressed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>{verdictLabels[experiment.verdict]}</Badge></div><MetricComparison a={experiment.metricsA} b={experiment.metricsB} /><div className="border-t p-5"><div className="flex items-start gap-3">{experiment.comparison.canApply ? <CheckCircle2 className="mt-0.5 text-emerald-600" /> : experiment.verdict === 'regressed' ? <XCircle className="mt-0.5 text-rose-600" /> : <AlertTriangle className="mt-0.5 text-amber-600" />}<div><h3 className="font-medium">上线门槛</h3><p className="mt-1 text-sm text-slate-500">相同输入与 Context：是 · 相同模型档位：是 · 改善 {experiment.comparison.improvedCaseIds.length} · 退化 {experiment.comparison.regressedCaseIds.length}</p>{experiment.comparison.reasons.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-700">{experiment.comparison.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</div></div></div></section>}
      {experiment?.comparison.canApply && row.status === 'evaluated' && dashboard.data.permissions.canApply && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 text-emerald-700" /><div><h2 className="font-semibold text-emerald-950">人工确认发布新版本</h2><p className="mt-1 text-sm leading-6 text-emerald-800">此操作不会覆盖历史，会保存当前生产快照并创建 v{row.baseSkillVersion + 1}；只有后续新 Run 使用新版本。</p><Button className="mt-4" disabled={Boolean(pending)} onClick={() => void apply()}><Save />{pending === 'apply' ? '应用中…' : '确认应用已评测 Prompt'}</Button></div></div></section>}
      {row.status === 'applied' && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900"><CheckCircle2 className="mr-2 inline" />已应用为生产 Skill v{row.appliedSkillVersion}，历史版本和所有 Eval Run 均已保留。</section>}
    </div>
  );
}
