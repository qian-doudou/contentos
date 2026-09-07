'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Activity, BarChart3, Building2, Camera, Clapperboard, Cpu, FileCheck2,
  Gauge, Menu, PanelTop, Settings, ShieldCheck, Sparkles, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/', label: '工作台', icon: Gauge },
  { href: '/clients', label: '客户', icon: Building2 },
  { href: '/accounts', label: '品牌与账号', icon: PanelTop },
  { href: '/contents', label: '内容运营', icon: Clapperboard },
  { href: '/shoots', label: '拍摄管理', icon: Camera },
  { href: '/ai', label: 'AI 运营', icon: Sparkles },
  { href: '/analytics', label: '运营数据', icon: BarChart3 },
  { href: '/ops', label: '运营中心', icon: Activity },
  { href: '/skills', label: 'AI Skill', icon: Cpu },
  { href: '/evals', label: '评测中心', icon: FileCheck2 },
  { href: '/team', label: '团队', icon: Users },
  { href: '/settings', label: '系统设置', icon: Settings },
] as const;

function ProductMark() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-cyan-400 text-[#101c2c]"><Clapperboard className="size-5" /></span>
      <div><p className="text-lg font-semibold tracking-tight text-white">ContentOS</p><p className="text-xs text-slate-500">OPERATIONS SYSTEM</p></div>
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
            className={cn('nav-item', active && 'bg-white/10 text-white')}
            href={href}
            key={href}
            onClick={onNavigate}
          >
            <Icon className={cn('size-4', active && 'text-cyan-300')} /><span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-[#101c2c] px-4 py-5 text-slate-300 lg:flex">
        <div className="px-2 pb-7"><ProductMark /></div>
        <Navigation />
        <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white"><ShieldCheck className="size-4 text-emerald-400" />本地演示模式</div>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">不接入真实企业数据与外部平台</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 px-5 py-3 backdrop-blur lg:px-8">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between">
            <div className="flex items-center gap-3 lg:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger render={<Button variant="outline" size="icon" aria-label="打开导航" />}><Menu /></SheetTrigger>
                <SheetContent side="left" className="w-[280px] border-slate-800 bg-[#101c2c] p-4 text-slate-300">
                  <SheetHeader className="px-2"><SheetTitle className="sr-only">ContentOS 导航</SheetTitle><ProductMark /></SheetHeader>
                  <Navigation onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>
              <div><p className="font-semibold">ContentOS</p><p className="text-xs text-slate-400">AI 内容运营</p></div>
            </div>
            <div className="hidden text-sm text-slate-500 lg:block">星火本地生活运营有限公司</div>
            <div className="flex items-center gap-3"><span className="hidden rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 sm:inline-flex">Phase 01 · 工程基础</span><span className="grid size-9 place-items-center rounded-full bg-[#101c2c] text-sm font-semibold text-white">运</span></div>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

