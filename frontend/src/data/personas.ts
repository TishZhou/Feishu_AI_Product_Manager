import type { LucideIcon } from 'lucide-react'
import { Code2, Compass, Cpu, FileText, FlaskConical, Package, ShieldCheck } from 'lucide-react'

export type PersonaHue = 'violet' | 'blue' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'teal'

export interface Persona {
  name: string
  role: string
  statusVerb: string
  heroTitle: string
  initial: string
  hue: PersonaHue
  icon: LucideIcon
}

export interface HueTokens {
  heroGradient: string
  heroHighlight: string
  avatarGradient: string
  avatarShadow: string
  softBg: string
  softText: string
  softBorder: string
  pulseRGB: string
  solid: string
  solidDark: string
}

export const STAGE_PERSONAS: Record<string, Persona> = {
  requirement_analysis: {
    name: 'Pria',
    role: '产品经理 AI',
    statusVerb: '正在拆解需求与验收标准',
    heroTitle: 'AI 正在为你梳理\n需求与验收标准',
    initial: 'P',
    hue: 'violet',
    icon: Compass,
  },
  solution_architecture: {
    name: 'Aria',
    role: '软件架构师 AI',
    statusVerb: '正在设计技术架构',
    heroTitle: 'AI 正在为你的需求\n设计技术架构',
    initial: 'A',
    hue: 'blue',
    icon: Cpu,
  },
  detailed_spec: {
    name: 'Specy',
    role: '系统设计师 AI',
    statusVerb: '正在精炼实现规格',
    heroTitle: 'AI 正在精炼\n可执行的实现规格',
    initial: 'S',
    hue: 'indigo',
    icon: FileText,
  },
  code_generation: {
    name: 'Eden',
    role: '软件工程师 AI',
    statusVerb: '正在按规格生成代码',
    heroTitle: 'AI 正在按规格\n生成代码',
    initial: 'E',
    hue: 'emerald',
    icon: Code2,
  },
  test_generation: {
    name: 'Quill',
    role: 'QA 工程师 AI',
    statusVerb: '正在编写并执行测试',
    heroTitle: 'AI 正在编写\n并执行自动化测试',
    initial: 'Q',
    hue: 'amber',
    icon: FlaskConical,
  },
  code_review: {
    name: 'Rex',
    role: '代码审查员 AI',
    statusVerb: '正在审查代码质量与安全',
    heroTitle: 'AI 正在审查\n代码质量与安全',
    initial: 'R',
    hue: 'rose',
    icon: ShieldCheck,
  },
  delivery: {
    name: 'Devon',
    role: 'DevOps AI',
    statusVerb: '正在打包并准备交付',
    heroTitle: 'AI 正在打包\n并准备交付',
    initial: 'D',
    hue: 'teal',
    icon: Package,
  },
}

export const HUE_TOKENS: Record<PersonaHue, HueTokens> = {
  violet: tokens('#7C3AED', '#8B5CF6', '#6D28D9', '139, 92, 246'),
  blue: tokens('#2563EB', '#3B82F6', '#1D4ED8', '59, 130, 246'),
  indigo: tokens('#4F46E5', '#6366F1', '#4338CA', '99, 102, 241'),
  emerald: tokens('#059669', '#10B981', '#047857', '16, 185, 129'),
  amber: tokens('#D97706', '#F59E0B', '#B45309', '245, 158, 11'),
  rose: tokens('#E11D48', '#F43F5E', '#BE123C', '244, 63, 94'),
  teal: tokens('#0D9488', '#14B8A6', '#0F766E', '20, 184, 166'),
}

function tokens(from: string, mid: string, to: string, rgb: string): HueTokens {
  return {
    heroGradient: `linear-gradient(135deg, ${from} 0%, ${mid} 50%, ${to} 100%)`,
    heroHighlight: 'radial-gradient(ellipse at top right, rgba(255,255,255,0.18), transparent 50%), radial-gradient(ellipse at bottom left, rgba(0,0,0,0.22), transparent 60%)',
    avatarGradient: `linear-gradient(135deg, ${mid}, ${to})`,
    avatarShadow: `rgba(${rgb}, 0.30)`,
    softBg: `rgba(${rgb}, 0.10)`,
    softText: to,
    softBorder: `rgba(${rgb}, 0.22)`,
    pulseRGB: rgb,
    solid: mid,
    solidDark: to,
  }
}

export function getPersona(stageKey: string | null | undefined): Persona {
  if (stageKey && STAGE_PERSONAS[stageKey]) return STAGE_PERSONAS[stageKey]
  return STAGE_PERSONAS.solution_architecture
}
