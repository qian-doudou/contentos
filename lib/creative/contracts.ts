import { z } from 'zod';
import { hookTypes } from '@/db/constants';

export const shootingMethods = [
  'talking_head', 'documentary', 'comparison', 'experiment', 'plot', 'interview', 'voiceover',
] as const;
export const shootingDifficulties = ['simple', 'standard', 'advanced'] as const;
export const innovationLevels = ['safe', 'fresh', 'bold'] as const;
export const onCameraRoles = ['ai_recommended', 'owner', 'staff', 'customer', 'multiple', 'voiceover'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const hookOptionSchema = z.object({
  type: z.enum(hookTypes),
  text: text(2000),
}).strict();

export const creativeBriefSchema = z.object({
  sellingPoint: text(3000),
  sellingPointOptions: z.array(text(3000)).min(1).max(4),
  creativeConcept: text(2000),
  audienceMoment: text(500),
  storyStructure: z.array(text(500)).min(3).max(6),
  targetDurationSeconds: z.number().int().min(15).max(90),
  shootingMethod: z.enum(shootingMethods),
  shootingDifficulty: z.enum(shootingDifficulties),
  onCameraRole: z.enum(onCameraRoles),
  shootingRequirements: z.array(text(300)).max(8),
  ctaStrategy: text(2000),
  innovationLevel: z.enum(innovationLevels),
  hookType: z.enum(hookTypes),
  hookText: text(2000),
  hookOptions: z.array(hookOptionSchema).min(1).max(4),
}).strict();

export const shootingMethodLabels: Record<(typeof shootingMethods)[number], string> = {
  talking_head: '人物口播', documentary: '现场跟拍', comparison: '对比展示', experiment: '实测验证',
  plot: '剧情演绎', interview: '问答访谈', voiceover: '画外音解说',
};
export const shootingDifficultyLabels: Record<(typeof shootingDifficulties)[number], string> = {
  simple: '简单', standard: '一般', advanced: '较复杂',
};
export const shootingDifficultyByMethod: Record<(typeof shootingMethods)[number], (typeof shootingDifficulties)[number]> = {
  talking_head: 'simple', documentary: 'simple', comparison: 'standard', experiment: 'advanced',
  plot: 'advanced', interview: 'standard', voiceover: 'simple',
};
export const shootingRequirementsByMethod: Record<(typeof shootingMethods)[number], string[]> = {
  talking_head: ['安静的真实场景', '人物半身或近景', '产品或环境补充特写'],
  documentary: ['真实门店环境', '一个完整操作过程', '核心细节特写'],
  comparison: ['同一场景的对比素材', '统一景别和光线', '差异细节特写'],
  experiment: ['可重复的实测过程', '结果前后对照', '必要的安全措施'],
  plot: ['明确的角色和台词', '至少两个镜头场景', '冲突与反转表演'],
  interview: ['一问一答的双人机位', '环境和人物补充镜头', '收音清晰'],
  voiceover: ['完整的产品或现场素材', '旁白录音环境安静', '关键细节特写'],
};
export const storyStructureByInnovation: Record<(typeof innovationLevels)[number], string[]> = {
  safe: ['直接点题', '展示真实细节', '说清核心卖点', '自然行动引导'],
  fresh: ['具体钩子', '真实现场验证', '解释关键原因', '呈现结果', '自然行动引导'],
  bold: ['强反差或问题开场', '立即展示冲突/实验', '现场给出证据', '揭示核心卖点', '自然行动引导'],
};
export const innovationLevelLabels: Record<(typeof innovationLevels)[number], string> = {
  safe: '稳妥型', fresh: '创新型', bold: '突破型',
};
export const onCameraRoleLabels: Record<(typeof onCameraRoles)[number], string> = {
  ai_recommended: 'AI 推荐', owner: '老板/负责人', staff: '员工', customer: '顾客', multiple: '多人出镜', voiceover: '无人出镜',
};

export type CreativeBrief = z.infer<typeof creativeBriefSchema>;
