'use client';

import { ShieldCheck, UserRoundCheck, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleLabels, teamDataSchema } from '@/lib/auth/contracts';
import { EmptyData, ErrorData, LoadingData, useApiData } from '@/components/contentos/master-data/common';

const roleTone: Record<string, string> = {
  owner: 'bg-violet-50 text-violet-700', admin: 'bg-blue-50 text-blue-700', operator: 'bg-cyan-50 text-cyan-700',
  photographer: 'bg-amber-50 text-amber-700', editor: 'bg-fuchsia-50 text-fuchsia-700', viewer: 'bg-slate-100 text-slate-600',
};

export function TeamPage() {
  const state = useApiData('/api/team', teamDataSchema);
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const activeCount = state.data.members.filter(member => member.status === 'active').length;
  const assignedCount = state.data.members.filter(member => member.clientCount > 0).length;
  return <div className="space-y-6">
    <header><p className="eyebrow">组织与权限</p><h1 className="page-title">团队</h1><p className="page-description">查看成员基础角色与已负责客户数；权限由服务端统一校验。</p></header>
    <section className="grid gap-4 sm:grid-cols-3">
      {[
        { label: '团队成员', value: state.data.members.length, icon: UsersRound },
        { label: '启用成员', value: activeCount, icon: UserRoundCheck },
        { label: '已负责客户', value: assignedCount, icon: ShieldCheck },
      ].map(item => <Card key={item.label}><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-sm font-medium text-slate-500">{item.label}</CardTitle><item.icon className="size-4 text-cyan-700" /></CardHeader><CardContent><p className="text-3xl font-semibold tabular-nums">{item.value}</p></CardContent></Card>)}
    </section>
    <section className="surface-card !p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-semibold">成员与角色</h2><p className="mt-1 text-sm text-slate-500">Owner 与 Admin 可访问本页；客户数同时统计 client_members 和客户负责人。</p></div><Badge variant="outline">{state.data.members.length} 人</Badge></div>
      {state.data.members.length ? <Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>角色</TableHead><TableHead>负责客户数</TableHead><TableHead>状态</TableHead><TableHead>数据标记</TableHead></TableRow></TableHeader><TableBody>{state.data.members.map(member => <TableRow key={member.id}>
        <TableCell><p className="font-medium">{member.name}</p><p className="mt-1 font-mono text-xs text-slate-400">{member.id.slice(0, 8)}…</p></TableCell>
        <TableCell><Badge variant="secondary" className={roleTone[member.role]}>{roleLabels[member.role]}</Badge></TableCell>
        <TableCell className="tabular-nums">{member.clientCount}</TableCell>
        <TableCell><Badge variant="secondary" className={member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{member.status === 'active' ? '启用' : '停用'}</Badge></TableCell>
        <TableCell>{member.isDemo ? <Badge variant="outline">演示</Badge> : <span className="text-sm text-slate-400">正式</span>}</TableCell>
      </TableRow>)}</TableBody></Table> : <EmptyData title="暂无成员" description="当前组织还没有可显示的团队成员。" />}
    </section>
  </div>;
}
