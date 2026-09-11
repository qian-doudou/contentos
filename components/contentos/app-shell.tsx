'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Activity, BarChart3, Building2, Camera, Clapperboard, Cpu, FileCheck2, Film,
  Gauge, Menu, PanelTop, Settings, ShieldCheck, Sparkles, Users, FilePenLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { devIdentityDataSchema, roleLabels } from '@/lib/auth/contracts';
import { fetchData, useApiData } from '@/components/contentos/master-data/common';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/', label: '工作台', icon: Gauge },
  { href: '/scripts/new', label: 'AI 写脚本', icon: FilePenLine },
  { href: '/clients', label: '客户', icon: Building2 },
  { href: '/accounts', label: '品牌与账号', icon: PanelTop },
  { href: '/contents', label: '内容运营', icon: Clapperboard },
  { href: '/shoots', label: '拍摄管理', icon: Camera },
  { href: '/edits', label: '剪辑审核', icon: Film },
  { href: '/ai', label: 'AI 运营', icon: Sparkles },
  { href: '/analytics/content', label: '运营数据', icon: BarChart3 },
  { href: '/ops', label: '运营中心', icon: Activity },
  { href: '/skills', label: 'AI Skill', icon: Cpu },
  { href: '/evals', label: '评测中心', icon: FileCheck2 },
  { href: '/team', label: '团队', icon: Users },
  { href: '/settings', label: '系统设置', icon: Settings },
] as const;

function ProductMark() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-8 place-items-center rounded-md bg-[#37352f] text-white"><Clapperboard className="size-4" /></span>
      <div><p className="text-base font-semibold tracking-[-0.02em] text-[#37352f]">ContentOS</p><p className="text-xs text-[#9b9a97]">内容运营工作区</p></div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1" aria-label="主导航">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={cn('nav-item', active && 'bg-[#eeece9] text-[#37352f]')}
            href={href}
            key={href}
            onClick={onNavigate}
          >
            <Icon className={cn('size-4 text-[#9b9a97]', active && 'text-[#37352f]')} /><span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const identity = useApiData('/api/dev/identity', devIdentityDataSchema);
  async function switchIdentity(userId: string) {
    setSwitching(true);
    try {
      await fetchData('/api/dev/identity', devIdentityDataSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
      });
      window.location.reload();
    } catch {
      setSwitching(false);
      identity.reload();
    }
  }
  return (
    <div className="min-h-screen bg-white text-[#37352f]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[#e9e9e7] bg-[#fbfbfa] px-3 py-4 text-[#787774] lg:flex">
        <div className="px-2 pb-6"><ProductMark /></div>
        <Navigation />
        <div className="mt-auto rounded-md border border-[#e9e9e7] bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[#37352f]"><ShieldCheck className="size-4 text-[#0f7b6c]" />本地演示模式</div>
          <p className="mt-1.5 text-xs leading-5 text-[#9b9a97]">不接入真实企业数据与外部平台</p>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 h-14 border-b border-[#e9e9e7] bg-white/95 px-5 backdrop-blur lg:px-8">
          <div className="mx-auto flex h-full max-w-[1360px] items-center justify-between">
            <div className="flex items-center gap-3 lg:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger render={<Button variant="outline" size="icon" aria-label="打开导航" />}><Menu /></SheetTrigger>
                <SheetContent side="left" className="w-[280px] border-[#e9e9e7] bg-[#fbfbfa] p-4 text-[#787774]">
                  <SheetHeader className="px-2"><SheetTitle className="sr-only">ContentOS 导航</SheetTitle><ProductMark /></SheetHeader>
                  <Navigation onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>
              <div><p className="font-semibold tracking-[-0.02em]">ContentOS</p><p className="text-xs text-[#9b9a97]">内容运营工作区</p></div>
            </div>
            <div className="hidden text-sm text-[#787774] lg:block">{identity.data?.organization.name || '正在读取组织…'}</div>
            <div className="flex items-center gap-3">
              {identity.loading ? <span className="text-xs text-[#9b9a97]">身份加载中…</span> : identity.error ? <Button variant="outline" size="sm" onClick={identity.reload}>身份加载失败</Button> : identity.data && (
                identity.data.switchingEnabled
                  ? <NativeSelect aria-label="开发用户切换器" className="w-40" value={identity.data.currentUser.id} disabled={switching} onChange={event => void switchIdentity(event.target.value)}>
                    {identity.data.users.map(user => <option key={user.id} value={user.id}>{user.name} · {roleLabels[user.role]}</option>)}
                  </NativeSelect>
                  : <span className="text-sm font-medium">{identity.data.currentUser.name}</span>
              )}
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#eeece9] text-sm font-semibold text-[#37352f]">{identity.data?.currentUser.name.slice(0, 1) || '运'}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1360px] p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/review/')) {
    return <main className="min-h-screen bg-white px-4 py-8 text-[#37352f] sm:px-6 lg:py-12">{children}</main>;
  }
  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}
