'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  FlaskConical,
  RotateCcw,
  Save,
  Settings2,
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
import { modelProfiles, runStatuses, runTypes } from '@/db/constants';
import {
  aiSettingsDataSchema,
  modelPriceConfigSchema,
  runListDataSchema,
  skillDetailDataSchema,
  skillListDataSchema,
  skillTestResultSchema,
  type SkillDetailData,
  type SkillTestResult,
} from '@/lib/ai/contracts';
import {
  EmptyData,
  ErrorData,
  fetchData,
  LoadingData,
  RequestError,
  useApiData,
} from './master-data/common';

const modelProfileLabels = {
  light: 'Light',
  standard: 'Standard',
  strong: 'Strong',
} as const;
const runTypeLabels = {
  production: '正式 Run',
  test: 'Test Run',
  eval: 'Eval Run',
} as const;
const runStatusLabels = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  completed_with_warnings: '完成但有警告',
  manual_review_required: '需人工审核',
  failed: '已失败',
  cancelled: '已取消',
} as const;

function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">AI 基础设施</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </header>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
      {value || '无'}
    </pre>
  );
}

function formString(form: FormData, key: string) {
  const value = form.get(key);
  if (typeof value !== 'string') throw new Error(`${key} 必须是文本`);
  return value;
}

export function SkillsPage() {
  const state = useApiData('/api/skills', skillListDataSchema);
  return (
    <div className="space-y-6">
      <Heading
        title="AI Skill"
        description="统一管理 Prompt、Schema、模型档位、Points 和不可变版本。"
      >
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ops" />}
        >
          运营中心
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ops/ai-cost" />}
        >
          AI 成本
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ops/runs" />}
        >
          查看 Run
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/settings/ai" />}
        >
          <Settings2 />
          AI 设置
        </Button>
      </Heading>
      {state.loading ? (
        <LoadingData />
      ) : state.error ? (
        <ErrorData error={state.error} retry={state.reload} />
      ) : (
        state.data && (
          <section className="surface-card !p-0">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="font-semibold">内置能力</h2>
                <p className="mt-1 text-sm text-slate-500">
                  系统 Skill 可为全局定义，组织 Skill 按 organization_id 隔离。
                </p>
              </div>
              <Badge variant="outline">{state.data.total} 个</Badge>
            </div>
            {state.data.items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Skill</TableHead>
                    <TableHead>模型档位</TableHead>
                    <TableHead>Points</TableHead>
                    <TableHead>版本</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.data.items.map((skill) => (
                    <TableRow key={skill.id}>
                      <TableCell>
                        <Link
                          className="font-medium text-cyan-800 hover:underline"
                          href={`/skills/${skill.id}`}
                        >
                          {skill.name}
                        </Link>
                        <p className="mt-1 font-mono text-xs text-slate-400">
                          {skill.code}
                        </p>
                        <p className="mt-1 max-w-xl text-xs text-slate-500">
                          {skill.description}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {modelProfileLabels[skill.modelProfile]}
                        </Badge>
                      </TableCell>
                      <TableCell>{skill.pointCost}</TableCell>
                      <TableCell>v{skill.currentVersion}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Badge
                            className={
                              skill.enabled
                                ? 'bg-emerald-50 text-emerald-700'
                                : ''
                            }
                            variant="secondary"
                          >
                            {skill.enabled ? '启用' : '停用'}
                          </Badge>
                          {skill.organizationId === null && (
                            <Badge variant="outline">系统内置</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyData
                title="暂无 Skill"
                description="数据库中尚未初始化 Skill。"
              />
            )}
          </section>
        )
      )}
    </div>
  );
}

function SkillEditor({
  data,
  reload,
}: {
  data: SkillDetailData;
  reload: () => void;
}) {
  const skill = data.skill;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function save(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await fetchData(`/api/skills/${skill.id}`, skillDetailDataSchema, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description'),
          systemPrompt: form.get('systemPrompt'),
          userPromptTemplate: form.get('userPromptTemplate'),
          modelProfile: form.get('modelProfile'),
          pointCost: Number(form.get('pointCost')),
          enabled: form.get('enabled') === 'true',
          inputSchemaJson: JSON.parse(formString(form, 'inputSchemaJson')),
          outputSchemaJson: JSON.parse(formString(form, 'outputSchemaJson')),
          changeReason: form.get('changeReason'),
        }),
      });
      setMessage('已创建新版本');
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="surface-card space-y-5"
      key={skill.currentVersion}
      onSubmit={save}
    >
      <div>
        <h2 className="text-lg font-semibold">版本化配置</h2>
        <p className="mt-1 text-sm text-slate-500">
          任何保存都会新建快照，不覆盖历史。
        </p>
      </div>
      <fieldset disabled={pending} className="grid gap-4 lg:grid-cols-2">
        <label htmlFor="skill-name" className="space-y-1.5 text-sm">
          Skill 名称
          <Input
            id="skill-name"
            name="name"
            defaultValue={skill.name}
            required
          />
        </label>
        <label htmlFor="skill-description" className="space-y-1.5 text-sm">
          描述
          <Input
            id="skill-description"
            name="description"
            defaultValue={skill.description}
          />
        </label>
        <label htmlFor="skill-model-profile" className="space-y-1.5 text-sm">
          模型档位
          <NativeSelect
            id="skill-model-profile"
            className="w-full"
            name="modelProfile"
            defaultValue={skill.modelProfile}
          >
            {modelProfiles.map((value) => (
              <option value={value} key={value}>
                {modelProfileLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label htmlFor="skill-point-cost" className="space-y-1.5 text-sm">
          Point 成本
          <Input
            id="skill-point-cost"
            type="number"
            min="0"
            step="1"
            name="pointCost"
            defaultValue={skill.pointCost}
            required
          />
        </label>
        <label htmlFor="skill-enabled" className="space-y-1.5 text-sm">
          状态
          <NativeSelect
            id="skill-enabled"
            className="w-full"
            name="enabled"
            defaultValue={String(skill.enabled)}
          >
            <option value="true">启用</option>
            <option value="false">停用</option>
          </NativeSelect>
        </label>
        <label htmlFor="skill-change-reason" className="space-y-1.5 text-sm">
          变更原因
          <Input
            id="skill-change-reason"
            name="changeReason"
            required
            maxLength={1000}
            placeholder="说明本次调整"
          />
        </label>
        <label
          htmlFor="skill-system-prompt"
          className="space-y-1.5 text-sm lg:col-span-2"
        >
          System Prompt
          <Textarea
            id="skill-system-prompt"
            className="min-h-36 font-mono"
            name="systemPrompt"
            defaultValue={skill.systemPrompt}
            required
          />
        </label>
        <label
          htmlFor="skill-user-prompt"
          className="space-y-1.5 text-sm lg:col-span-2"
        >
          User Prompt Template
          <Textarea
            id="skill-user-prompt"
            className="min-h-28 font-mono"
            name="userPromptTemplate"
            defaultValue={skill.userPromptTemplate}
            required
          />
        </label>
        <label htmlFor="skill-input-schema" className="space-y-1.5 text-sm">
          Input Schema JSON
          <Textarea
            id="skill-input-schema"
            className="min-h-72 font-mono text-xs"
            name="inputSchemaJson"
            defaultValue={JSON.stringify(skill.inputSchemaJson, null, 2)}
            required
          />
        </label>
        <label htmlFor="skill-output-schema" className="space-y-1.5 text-sm">
          Output Schema JSON
          <Textarea
            id="skill-output-schema"
            className="min-h-72 font-mono text-xs"
            name="outputSchemaJson"
            defaultValue={JSON.stringify(skill.outputSchemaJson, null, 2)}
            required
          />
        </label>
      </fieldset>
      <div className="flex items-center justify-end gap-3">
        {message && (
          <output className="mr-auto text-sm text-cyan-800">{message}</output>
        )}
        <Button disabled={pending}>
          <Save />
          {pending ? '保存中…' : '保存为新版本'}
        </Button>
      </div>
    </form>
  );
}

function SkillHistory({
  data,
  reload,
}: {
  data: SkillDetailData;
  reload: () => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  async function rollback(version: number) {
    setPending(version);
    setMessage('');
    try {
      await fetchData(
        `/api/skills/${data.skill.id}/rollback`,
        skillDetailDataSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version, changeReason: reason }),
        },
      );
      setReason('');
      setMessage(`已使用 v${version} 的快照创建新版本`);
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '回滚失败');
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="surface-card">
      <h2 className="text-lg font-semibold">版本历史</h2>
      <p className="mt-1 text-sm text-slate-500">
        回滚会新建版本，历史快照永不删除。
      </p>
      {data.permissions.canWrite && (
        <label
          htmlFor="skill-rollback-reason"
          className="mt-4 block space-y-1.5 text-sm"
        >
          回滚原因
          <Input
            id="skill-rollback-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            placeholder="选择旧版本前先填写原因"
          />
        </label>
      )}
      {message && (
        <output className="mt-3 block text-sm text-cyan-800">{message}</output>
      )}
      <ol className="mt-5 space-y-3">
        {data.versions.map((version) => (
          <li key={version.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge>v{version.version}</Badge>
                <Badge variant="outline">
                  {modelProfileLabels[version.modelProfile]}
                </Badge>
                <span className="text-sm text-slate-500">
                  {version.pointCost} Points
                </span>
              </div>
              {data.permissions.canWrite &&
                version.version !== data.skill.currentVersion && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!reason.trim() || pending !== null}
                    onClick={() => void rollback(version.version)}
                  >
                    <RotateCcw />
                    {pending === version.version
                      ? '回滚中…'
                      : '使用此快照新建版本'}
                  </Button>
                )}
            </div>
            <p className="mt-3 text-sm text-slate-700">
              {version.changeReason}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {new Date(version.createdAt).toLocaleString('zh-CN')}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SkillTest({ data }: { data: SkillDetailData }) {
  const [input, setInput] = useState('{\n  "brief": "验证 AI 基础设施链路"\n}');
  const [result, setResult] = useState<SkillTestResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setPending(true);
    setError('');
    setResult(undefined);
    try {
      const value = await fetchData(
        `/api/skills/${data.skill.id}/test`,
        skillTestResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: JSON.parse(input) }),
        },
      );
      setResult(value);
    } catch (caught) {
      setError(
        caught instanceof RequestError
          ? `${caught.message}（${caught.code}）`
          : caught instanceof Error
            ? caught.message
            : '测试失败',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="surface-card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Skill 测试</h2>
          <p className="mt-1 text-sm text-slate-500">
            运行类型固定为 Test，记录 usage 但不消耗正式 Points。
          </p>
        </div>
        <Badge className="bg-violet-50 text-violet-700">
          <FlaskConical />
          TEST RUN
        </Badge>
      </div>
      <form className="space-y-3" onSubmit={run}>
        <label htmlFor="skill-test-input" className="space-y-1.5 text-sm">
          输入 JSON
          <Textarea
            id="skill-test-input"
            className="min-h-36 font-mono"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            required
          />
        </label>
        <Button disabled={pending}>
          <FlaskConical />
          {pending ? '运行中…' : '运行 Test Run'}
        </Button>
      </form>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      {result && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Run 状态</p>
              <p className="mt-1 font-medium">
                {runStatusLabels[result.run.status]}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">模型 / 模式</p>
              <p className="mt-1 font-medium">
                {result.usage.model} / {result.mode}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Tokens</p>
              <p className="mt-1 font-medium">
                {result.usage.inputTokens ?? '未知'} /{' '}
                {result.usage.outputTokens ?? '未知'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">成本 / 计费 Points</p>
              <p className="mt-1 font-medium">
                {result.usage.estimatedCost === null
                  ? '未知'
                  : result.usage.estimatedCost.toFixed(6)}{' '}
                / {result.usage.billedPoints}
              </p>
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">渲染 Prompt</h3>
            <CodeBlock
              value={`[SYSTEM]\n${result.renderedPrompt.system}\n\n[USER]\n${result.renderedPrompt.user}`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 font-medium">原始输出</h3>
              <CodeBlock value={result.rawOutput} />
            </div>
            <div>
              <h3 className="mb-2 font-medium">解析 JSON</h3>
              <CodeBlock value={JSON.stringify(result.parsedJson, null, 2)} />
            </div>
          </div>
          <div
            className={`rounded-xl p-3 text-sm ${result.schemaResult.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}
          >
            Schema 校验：
            {result.schemaResult.valid
              ? '通过'
              : result.schemaResult.issues.join('；')}
          </div>
          <p className="text-xs text-slate-500">
            provider_request_id：{result.usage.providerRequestId ?? '未提供'} ·
            耗时 {result.usage.durationMs} ms · 尝试 {result.attempts} 次
          </p>
        </div>
      )}
    </section>
  );
}

export function SkillDetailPage({ id }: { id: string }) {
  const state = useApiData(`/api/skills/${id}`, skillDetailDataSchema);
  if (state.loading) return <LoadingData />;
  if (state.error)
    return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  return (
    <div className="space-y-6">
      <Heading
        title={state.data.skill.name}
        description={`${state.data.skill.code} · v${state.data.skill.currentVersion}`}
      >
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/skills" />}
        >
          <ArrowLeft />
          Skill 列表
        </Button>
      </Heading>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,.6fr)]">
        <div className="space-y-6">
          {state.data.permissions.canWrite ? (
            <SkillEditor data={state.data} reload={state.reload} />
          ) : (
            <section className="surface-card">
              <p className="text-sm text-slate-500">
                当前身份只能查看和测试 Skill，不能新建版本。
              </p>
              <div className="mt-4">
                <CodeBlock value={state.data.skill.systemPrompt} />
              </div>
            </section>
          )}
          {state.data.permissions.canTest && <SkillTest data={state.data} />}
        </div>
        <SkillHistory data={state.data} reload={state.reload} />
      </div>
    </div>
  );
}

export function AiSettingsPage() {
  const state = useApiData('/api/settings/ai', aiSettingsDataSchema);
  const [message, setMessage] = useState('');
  async function addPrice(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await fetchData('/api/settings/ai/prices', modelPriceConfigSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: form.get('model'),
          inputPricePerMillion:
            form.get('inputPricePerMillion') === ''
              ? null
              : Number(form.get('inputPricePerMillion')),
          outputPricePerMillion:
            form.get('outputPricePerMillion') === ''
              ? null
              : Number(form.get('outputPricePerMillion')),
          effectiveAt: new Date(formString(form, 'effectiveAt')).toISOString(),
          status: 'active',
        }),
      });
      setMessage('价格版本已新增');
      event.currentTarget.reset();
      state.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  }
  return (
    <div className="space-y-6">
      <Heading
        title="AI 设置"
        description="只展示安全的运行状态；API Key、Base URL 和完整环境变量不会返回前端。"
      >
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/skills" />}
        >
          返回 Skill
        </Button>
      </Heading>
      {state.loading ? (
        <LoadingData />
      ) : state.error ? (
        <ErrorData error={state.error} retry={state.reload} />
      ) : (
        state.data && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="surface-card">
                <p className="text-sm text-slate-500">提供方</p>
                <p className="mt-2 font-semibold">{state.data.provider}</p>
              </div>
              <div className="surface-card">
                <p className="text-sm text-slate-500">运行模式</p>
                <p className="mt-2 font-semibold">
                  {state.data.mode === 'mock' ? '确定性 Mock' : '百炼 Live'}
                </p>
              </div>
              <div className="surface-card">
                <p className="text-sm text-slate-500">超时 / 重试</p>
                <p className="mt-2 font-semibold">
                  {state.data.timeoutMs} ms / 最多 {state.data.retryCount} 次
                </p>
              </div>
              <div className="surface-card">
                <p className="text-sm text-slate-500">剩余 Points</p>
                <p className="mt-2 text-2xl font-semibold">
                  {state.data.remainingPoints}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {state.data.quota
                    ? `${state.data.quota.usedPoints} / ${state.data.quota.quotaPoints} 已使用`
                    : '当前无有效额度期'}
                </p>
              </div>
            </section>
            <section className="surface-card">
              <h2 className="text-lg font-semibold">模型档位</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {modelProfiles.map((profile) => (
                  <div className="rounded-xl border p-4" key={profile}>
                    <Badge variant="secondary">
                      {modelProfileLabels[profile]}
                    </Badge>
                    <p className="mt-3 font-mono text-sm">
                      {state.data!.models[profile]}
                    </p>
                  </div>
                ))}
              </div>
            </section>
            <section className="surface-card !p-0">
              <div className="border-b p-5">
                <h2 className="text-lg font-semibold">模型价格版本</h2>
                <p className="mt-1 text-sm text-slate-500">
                  只根据已生效的配置计算；未配置时 estimated_cost 为 null。
                </p>
              </div>
              {state.data.prices.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模型</TableHead>
                      <TableHead>输入 / 百万 Token</TableHead>
                      <TableHead>输出 / 百万 Token</TableHead>
                      <TableHead>生效时间</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.prices.map((price) => (
                      <TableRow key={price.id}>
                        <TableCell className="font-mono">
                          {price.model}
                        </TableCell>
                        <TableCell>
                          {price.inputPricePerMillion ?? '未知'}
                        </TableCell>
                        <TableCell>
                          {price.outputPricePerMillion ?? '未知'}
                        </TableCell>
                        <TableCell>
                          {new Date(price.effectiveAt).toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell>{price.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyData
                  title="尚未配置价格"
                  description="当前所有 AI usage 的估算成本都显示“未知”，不会使用猜测价格。"
                />
              )}
            </section>
            {state.data.permissions.canWrite && (
              <form
                className="surface-card grid items-end gap-3 md:grid-cols-2 xl:grid-cols-5"
                onSubmit={addPrice}
              >
                <label htmlFor="price-model" className="space-y-1.5 text-sm">
                  模型
                  <Input
                    id="price-model"
                    name="model"
                    required
                    placeholder="qwen..."
                  />
                </label>
                <label htmlFor="price-input" className="space-y-1.5 text-sm">
                  输入价格
                  <Input
                    id="price-input"
                    name="inputPricePerMillion"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="留空为未知"
                  />
                </label>
                <label htmlFor="price-output" className="space-y-1.5 text-sm">
                  输出价格
                  <Input
                    id="price-output"
                    name="outputPricePerMillion"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="留空为未知"
                  />
                </label>
                <label
                  htmlFor="price-effective-at"
                  className="space-y-1.5 text-sm"
                >
                  生效时间
                  <Input
                    id="price-effective-at"
                    name="effectiveAt"
                    type="datetime-local"
                    required
                  />
                </label>
                <Button>新增价格版本</Button>
                {message && (
                  <output className="text-sm text-cyan-800 md:col-span-2 xl:col-span-5">
                    {message}
                  </output>
                )}
              </form>
            )}
          </>
        )
      )}
    </div>
  );
}

export function RunsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData(`/api/ops/runs?${query}`, runListDataSchema);
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const next = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === 'string' && value) next.set(key, value);
    });
    router.push(`/ops/runs?${next}`);
  }
  return (
    <div className="space-y-6">
      <Heading
        title="Run 追踪"
        description="区分 Production、Test 与 Eval，查看 Step、usage、成本和计费 Points。"
      >
        <Button variant="outline" nativeButton={false} render={<Link href="/ops" />}>运营中心</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/ops/ai-cost" />}>AI 成本</Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/skills" />}
        >
          AI Skill
        </Button>
      </Heading>
      <form
        className="surface-card flex flex-wrap items-end gap-3"
        onSubmit={filter}
      >
        <label htmlFor="run-type-filter" className="space-y-1.5 text-sm">
          运行类型
          <NativeSelect
            id="run-type-filter"
            className="w-44"
            name="runType"
            defaultValue={params.get('runType') ?? ''}
          >
            <option value="">全部</option>
            {runTypes.map((value) => (
              <option key={value} value={value}>
                {runTypeLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label htmlFor="run-status-filter" className="space-y-1.5 text-sm">
          状态
          <NativeSelect
            id="run-status-filter"
            className="w-52"
            name="status"
            defaultValue={params.get('status') ?? ''}
          >
            <option value="">全部</option>
            {runStatuses.map((value) => (
              <option key={value} value={value}>
                {runStatusLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button>筛选</Button>
      </form>
      {state.loading ? (
        <LoadingData />
      ) : state.error ? (
        <ErrorData error={state.error} retry={state.reload} />
      ) : (
        state.data && (
          <section className="surface-card !p-0">
            <div className="flex items-center justify-between border-b p-5">
              <h2 className="font-semibold">执行记录</h2>
              <Badge variant="outline">{state.data.total} 条</Badge>
            </div>
            {state.data.items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>类型 / 状态</TableHead>
                    <TableHead>Skill / 模型</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>成本 / Points</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.data.items.map((run) => {
                    const usage = run.usage[0];
                    return (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Link className="font-mono text-xs text-cyan-800 hover:underline" href={`/ops/runs/${run.id}`}>{run.id}</Link>
                          <p className="mt-1 text-xs text-slate-400">
                            {run.steps.length} Steps
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              run.runType === 'test'
                                ? 'bg-violet-50 text-violet-700'
                                : ''
                            }
                            variant="secondary"
                          >
                            {runTypeLabels[run.runType]}
                          </Badge>
                          <p className="mt-2 text-sm">
                            {runStatusLabels[run.status]}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="font-mono text-xs">
                            {usage?.skillCode ?? run.subjectType}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {usage?.model ?? '未调用'}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {usage
                            ? `${usage.inputTokens ?? '未知'} / ${usage.outputTokens ?? '未知'} tokens`
                            : '无'}
                        </TableCell>
                        <TableCell>
                          <p>
                            {usage?.estimatedCost === null ||
                            usage === undefined
                              ? '未知'
                              : usage.estimatedCost.toFixed(6)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {usage?.billedPoints ?? 0} Points
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(run.createdAt).toLocaleString('zh-CN')}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyData
                title="暂无 Run"
                description="从 Skill 详情页执行 Test Run 后，执行记录会持久化显示在这里。"
              />
            )}
          </section>
        )
      )}
    </div>
  );
}
