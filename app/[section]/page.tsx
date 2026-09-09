import { notFound } from 'next/navigation';
import { SectionPage, type SectionConfig } from '@/components/contentos/section-page';

const sections = {
  clients: { slug: 'clients', title: '客户', eyebrow: '客户资产', description: '统一承载客户档案、服务边界与合作状态。', entity: '客户档案' },
  accounts: { slug: 'accounts', title: '品牌与账号', eyebrow: '账号资产', description: '管理品牌、门店与抖音账号的归属关系。', entity: '品牌、门店与账号' },
  contents: { slug: 'contents', title: '内容运营', eyebrow: '内容生产', description: '从月度计划、策划、脚本到审核与发布的内容流转。', entity: '内容项' },
  shoots: { slug: 'shoots', title: '拍摄管理', eyebrow: '生产排期', description: '统一管理拍摄任务、场地、人员与素材交付。', entity: '拍摄排期' },
  ai: { slug: 'ai', title: 'AI 运营', eyebrow: 'AI WORKBENCH', description: '承载脚本生成、历史去重、长期记忆与策略建议。', entity: 'AI 执行任务' },
  analytics: { slug: 'analytics', title: '运营数据', eyebrow: '数据复盘', description: '汇总内容表现并支撑下一周期运营策略。', entity: '运营数据' },
  ops: { slug: 'ops', title: '运营中心', eyebrow: '系统执行', description: '追踪生产、测试与评测 Run 的执行状态。', entity: '运营 Run' },
  skills: { slug: 'skills', title: 'AI Skill', eyebrow: 'CAPABILITY', description: '统一管理可复用的 AI 运营能力与版本。', entity: 'AI Skill' },
  evals: { slug: 'evals', title: '评测中心', eyebrow: 'QUALITY', description: '用固定数据集与指标验证 AI 输出质量。', entity: '评测集与 Eval Run' },
  team: { slug: 'team', title: '团队', eyebrow: '组织管理', description: '管理团队成员、角色与组织范围。', entity: '成员与权限' },
  settings: { slug: 'settings', title: '系统设置', eyebrow: 'SYSTEM', description: '管理数据库、LLM 与 Embedding 的服务端配置。', entity: '系统配置' },
} satisfies Record<string, SectionConfig>;

export function generateStaticParams() {
  return Object.keys(sections).filter(section => !['clients', 'accounts', 'contents', 'shoots', 'skills', 'team', 'ai', 'ops'].includes(section)).map((section) => ({ section }));
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const config = sections[section as keyof typeof sections];
  if (!config) notFound();
  return <SectionPage config={config} />;
}
