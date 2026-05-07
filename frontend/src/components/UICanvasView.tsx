import { useState, useMemo } from 'react'
import {
  Wand2, Check, X, GripVertical, Loader2, ChevronLeft,
  Download, Eye, RotateCcw, Search, ChevronDown,
  Menu, LayoutGrid, Image, Tag, MessageCircle,
  BarChart2, Users, Mail, HelpCircle, Zap, Clock,
  Star, Layout, Columns, FileText, Hash,
} from 'lucide-react'
import { apiClient } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldType = 'text' | 'textarea' | 'select'

interface FieldDef {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  hint?: string
  options?: string[]
  rows?: number
}

interface CanvasModule {
  id: string
  type: string
  name: string
  category: string
  props: Record<string, string>
}

interface UICanvasViewProps {
  runId: string
  onBack: () => void
}

// ─── Module Fields ────────────────────────────────────────────────────────────

const MODULE_FIELDS: Record<string, FieldDef[]> = {
  navbar: [
    { key: 'brand', label: '品牌名称', type: 'text', placeholder: '例：DevFlow' },
    { key: 'links', label: '导航链接（逗号分隔）', type: 'text', placeholder: '功能, 定价, 文档, 关于' },
    { key: 'cta', label: 'CTA 按钮文案', type: 'text', placeholder: '免费试用' },
  ],
  sidebar_nav: [
    { key: 'brand', label: '品牌名称', type: 'text', placeholder: '' },
    { key: 'sections', label: '导航项（每行一项，用 / 分隔分区标题）', type: 'textarea', placeholder: '/ 主菜单\nHome\n仪表盘\n设置\n/ 工具\n文档\n支持', rows: 5 },
  ],
  hero_centered: [
    { key: 'headline', label: '主标题', type: 'text', placeholder: '一句话说清楚产品的核心价值' },
    { key: 'sub', label: '副标题', type: 'textarea', placeholder: '展开描述，2-3句话，说明产品如何帮助用户...', rows: 3 },
    { key: 'cta1', label: '主要按钮', type: 'text', placeholder: '免费开始' },
    { key: 'cta2', label: '次要按钮（可选）', type: 'text', placeholder: '查看演示' },
    { key: 'style', label: '背景风格', type: 'select', options: ['渐变背景', '图片背景', '极简白', '深色'] },
  ],
  hero_split: [
    { key: 'headline', label: '主标题', type: 'text', placeholder: '产品核心价值' },
    { key: 'sub', label: '副标题', type: 'textarea', placeholder: '详细说明...', rows: 3 },
    { key: 'cta', label: 'CTA 按钮', type: 'text', placeholder: '立即体验' },
    { key: 'image_desc', label: '右侧图片描述', type: 'text', placeholder: '例：产品界面截图，展示核心功能' },
  ],
  hero_minimal: [
    { key: 'headline', label: '主标题', type: 'text', placeholder: '简短有力的一句话' },
    { key: 'sub', label: '副标题（可选）', type: 'text', placeholder: '' },
    { key: 'cta', label: 'CTA 按钮', type: 'text', placeholder: '开始使用' },
  ],
  features_grid: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '核心功能' },
    { key: 'subtitle', label: '区块副标题（可选）', type: 'text', placeholder: '' },
    { key: 'features', label: '功能列表（每行：名称 | 描述）', type: 'textarea', placeholder: 'AI 分析 | 自动分析代码并提供改进建议\n实时协作 | 多人同时编辑，无缝衔接\n一键部署 | 从代码到上线只需一步\n安全可靠 | 企业级数据安全保障', rows: 5 },
  ],
  features_list: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '产品优势' },
    { key: 'features', label: '功能列表（每行：名称 | 描述）', type: 'textarea', placeholder: '功能名称 | 简短描述', rows: 4 },
  ],
  cards_row: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '我们的服务' },
    { key: 'cards', label: '卡片内容（每行：标题 | 描述）', type: 'textarea', placeholder: '卡片标题 | 卡片描述内容', rows: 4 },
  ],
  timeline: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '使用流程' },
    { key: 'steps', label: '步骤（每行一步，支持：步骤名 | 说明）', type: 'textarea', placeholder: '注册账号 | 30秒完成注册\n上传代码 | 支持 GitHub 直连\nAI 自动分析 | 深度扫描代码\n获取报告 | 可下载详细报告', rows: 5 },
  ],
  testimonials: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '用户怎么说' },
    { key: 'items', label: '用户评价（每行：评价内容 | 姓名 · 职位）', type: 'textarea', placeholder: '这个产品让我们团队效率提升了3倍！ | 张三 · CTO\n非常好用，强烈推荐给每位工程师。 | 李四 · 高级工程师\n部署后第一天就发现了10个潜在 Bug。 | 王五 · 技术负责人', rows: 4 },
  ],
  stats: [
    { key: 'metrics', label: '核心数据（每行：数值 | 标签）', type: 'textarea', placeholder: '10,000+ | 活跃用户\n99.9% | 系统可用性\n2x | 平均效率提升\n< 24h | 平均响应时间', rows: 4 },
  ],
  logos: [
    { key: 'title', label: '标题（可选）', type: 'text', placeholder: '受到以下企业信任' },
    { key: 'companies', label: '企业名称（逗号分隔）', type: 'text', placeholder: '腾讯, 阿里巴巴, 字节跳动, 百度, 美团, 滴滴' },
  ],
  pricing: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '选择适合你的方案' },
    { key: 'tier1', label: '方案 1（每行：名称 / 价格 / 特性...）', type: 'textarea', placeholder: '免费版\n¥0/月\n基础 AI 分析\n5个项目\n社区支持', rows: 4 },
    { key: 'tier2', label: '方案 2（推荐 · 高亮显示）', type: 'textarea', placeholder: '专业版\n¥99/月\n完整 AI 分析\n无限项目\n优先邮件支持\n团队协作', rows: 5 },
    { key: 'tier3', label: '方案 3（可选）', type: 'textarea', placeholder: '企业版\n联系我们\n私有部署\n定制集成\n专属客户经理', rows: 4 },
  ],
  cta: [
    { key: 'headline', label: '主标题', type: 'text', placeholder: '立即开始，免费试用 14 天' },
    { key: 'sub', label: '副文案', type: 'text', placeholder: '无需信用卡，随时取消' },
    { key: 'cta', label: 'CTA 按钮', type: 'text', placeholder: '免费注册' },
    { key: 'style', label: '背景风格', type: 'select', options: ['深色渐变', '品牌主色', '浅色背景', '图片背景'] },
  ],
  contact_form: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '联系我们' },
    { key: 'subtitle', label: '副标题（可选）', type: 'text', placeholder: '我们将在 24 小时内回复' },
    { key: 'fields', label: '表单字段（逗号分隔）', type: 'text', placeholder: '姓名, 邮箱, 公司, 电话, 留言' },
    { key: 'submit', label: '提交按钮文案', type: 'text', placeholder: '发送消息' },
  ],
  faq: [
    { key: 'title', label: '区块标题', type: 'text', placeholder: '常见问题' },
    { key: 'items', label: '问答（每行：问题 | 答案）', type: 'textarea', placeholder: '如何开始使用？ | 注册账号后即可，无需信用卡，5分钟上手。\n支持哪些编程语言？ | 支持 Python、JavaScript、Go 等 20+ 种语言。\n数据安全如何保障？ | 采用 AES-256 加密，符合 ISO 27001 标准。', rows: 5 },
  ],
  newsletter: [
    { key: 'title', label: '标题', type: 'text', placeholder: '订阅最新动态' },
    { key: 'sub', label: '副标题', type: 'text', placeholder: '每周精选内容，不发垃圾邮件，随时退订' },
    { key: 'btn', label: '按钮文案', type: 'text', placeholder: '立即订阅' },
  ],
  section: [
    { key: 'bg', label: '背景', type: 'select', options: ['白色', '浅灰', '深色', '品牌色渐变'] },
    { key: 'padding', label: '内边距', type: 'select', options: ['紧凑 (py-8)', '标准 (py-16)', '宽松 (py-24)'] },
    { key: 'content_hint', label: '内容描述（供 AI 参考）', type: 'textarea', placeholder: '这个区段用于...', rows: 2 },
  ],
  grid: [
    { key: 'cols', label: '列数', type: 'select', options: ['2列', '3列', '4列', '自适应'] },
    { key: 'gap', label: '间距', type: 'select', options: ['紧凑', '标准', '宽松'] },
    { key: 'content', label: '网格内容说明', type: 'textarea', placeholder: '每格内容...', rows: 3 },
  ],
  footer_simple: [
    { key: 'brand', label: '品牌名称', type: 'text', placeholder: '' },
    { key: 'links', label: '底部链接（逗号分隔）', type: 'text', placeholder: '关于我们, 隐私政策, 使用条款, 帮助中心' },
    { key: 'copyright', label: '版权信息', type: 'text', placeholder: '© 2025 DevFlow Inc. All rights reserved.' },
  ],
  footer_rich: [
    { key: 'brand', label: '品牌名称', type: 'text', placeholder: '' },
    { key: 'tagline', label: '品牌口号', type: 'text', placeholder: '让开发更简单' },
    { key: 'col1', label: '链接列 1（首行为标题，以下为链接）', type: 'textarea', placeholder: '产品\n功能介绍\n定价\n更新日志\nAPI', rows: 4 },
    { key: 'col2', label: '链接列 2', type: 'textarea', placeholder: '公司\n关于我们\n博客\n招聘\n联系我们', rows: 4 },
    { key: 'social', label: '社交媒体（逗号分隔）', type: 'text', placeholder: 'Twitter, GitHub, LinkedIn, 微信公众号' },
  ],
}

// ─── Module Library ───────────────────────────────────────────────────────────

interface LibModule { type: string; name: string; desc: string }
interface LibCategory { label: string; color: string; icon: React.ReactNode; modules: LibModule[] }

const LIBRARY_CATEGORIES: LibCategory[] = [
  {
    label: '布局', color: '#6366F1',
    icon: <Layout size={13} />,
    modules: [
      { type: 'section', name: 'Section', desc: '区段容器' },
      { type: 'grid', name: 'Grid', desc: '网格布局' },
    ],
  },
  {
    label: '导航', color: '#3B82F6',
    icon: <Menu size={13} />,
    modules: [
      { type: 'navbar', name: 'Navbar', desc: '顶部导航栏' },
      { type: 'sidebar_nav', name: 'Sidebar', desc: '侧边栏' },
    ],
  },
  {
    label: '内容', color: '#10B981',
    icon: <FileText size={13} />,
    modules: [
      { type: 'hero_centered', name: 'Hero', desc: '主图区' },
      { type: 'features_grid', name: 'Feature Grid', desc: '特性介绍 · 3列' },
      { type: 'cards_row', name: 'Card', desc: '卡片行' },
      { type: 'pricing', name: 'Pricing', desc: '定价区' },
      { type: 'faq', name: 'FAQ', desc: '问题答疑' },
      { type: 'testimonials', name: 'Testimonials', desc: '用户评价' },
      { type: 'stats', name: 'Stats', desc: '核心数据指标' },
      { type: 'logos', name: 'Logos', desc: '品牌 / 合作方' },
      { type: 'cta', name: 'CTA', desc: '行动召唤区' },
      { type: 'timeline', name: 'Timeline', desc: '步骤 / 时间线' },
      { type: 'newsletter', name: 'Newsletter', desc: '邮件订阅' },
    ],
  },
  {
    label: '数据 · 表单', color: '#F59E0B',
    icon: <Hash size={13} />,
    modules: [
      { type: 'contact_form', name: 'Form', desc: '联系 / 报名表单' },
      { type: 'stats', name: 'Data Table', desc: '数据展示区' },
    ],
  },
  {
    label: '页脚', color: '#6B7280',
    icon: <Columns size={13} />,
    modules: [
      { type: 'footer_simple', name: 'Footer', desc: '简洁页脚' },
      { type: 'footer_rich', name: 'Footer Pro', desc: '多列丰富页脚' },
    ],
  },
]

// icon map for module types
const MODULE_ICON: Record<string, React.ReactNode> = {
  section: <Layout size={14} />,
  grid: <LayoutGrid size={14} />,
  navbar: <Menu size={14} />,
  sidebar_nav: <Columns size={14} />,
  hero_centered: <Image size={14} />,
  hero_split: <Image size={14} />,
  hero_minimal: <Image size={14} />,
  features_grid: <LayoutGrid size={14} />,
  features_list: <FileText size={14} />,
  cards_row: <Layout size={14} />,
  timeline: <Clock size={14} />,
  testimonials: <Users size={14} />,
  stats: <BarChart2 size={14} />,
  logos: <Star size={14} />,
  pricing: <Tag size={14} />,
  cta: <Zap size={14} />,
  contact_form: <Mail size={14} />,
  faq: <HelpCircle size={14} />,
  newsletter: <Mail size={14} />,
  footer_simple: <Hash size={14} />,
  footer_rich: <Columns size={14} />,
}

const CATEGORY_COLOR: Record<string, string> = {
  '布局': '#6366F1', '导航': '#3B82F6', '内容': '#10B981',
  '数据 · 表单': '#F59E0B', '页脚': '#6B7280',
}

// ─── Compact Wireframe ────────────────────────────────────────────────────────

const WC = { line: 'rgba(0,0,0,0.09)', btn: 'rgba(59,130,246,0.25)', img: 'rgba(0,0,0,0.07)', card: 'rgba(255,255,255,0.8)' }

function MiniBar({ w = '100%', h = 5, color = WC.line }: { w?: string | number; h?: number; color?: string }) {
  return <div style={{ width: w, height: h, background: color, borderRadius: h, flexShrink: 0 }} />
}

function CompactWireframe({ type }: { type: string }) {
  const base: React.CSSProperties = {
    padding: '7px 12px', height: 46, display: 'flex', alignItems: 'center',
    userSelect: 'none', overflow: 'hidden', flexShrink: 0, gap: 6,
  }
  switch (type) {
    case 'navbar':
    case 'sidebar_nav':
      return (
        <div style={{ ...base, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, background: WC.btn, flexShrink: 0 }} />
            <MiniBar w={44} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[32, 28, 26].map((w, i) => <MiniBar key={i} w={w} />)}
            <div style={{ width: 42, height: 18, background: WC.btn, borderRadius: 4, flexShrink: 0 }} />
          </div>
        </div>
      )
    case 'hero_centered':
    case 'hero_minimal':
      return (
        <div style={{ ...base, flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
          <MiniBar w="55%" h={7} />
          <MiniBar w="75%" h={5} />
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <div style={{ width: 52, height: 16, background: WC.btn, borderRadius: 4 }} />
            <div style={{ width: 44, height: 16, background: WC.line, borderRadius: 4 }} />
          </div>
        </div>
      )
    case 'hero_split':
      return (
        <div style={{ ...base }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <MiniBar w="85%" h={6} />
            <MiniBar w="70%" h={5} />
            <div style={{ width: 50, height: 16, background: WC.btn, borderRadius: 4, marginTop: 2 }} />
          </div>
          <div style={{ width: 72, height: 34, background: WC.img, borderRadius: 5, border: '1px dashed rgba(0,0,0,0.12)', flexShrink: 0 }} />
        </div>
      )
    case 'features_grid':
    case 'cards_row':
      return (
        <div style={{ ...base, gap: 5 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ flex: 1, height: 32, background: WC.card, border: '1px solid rgba(0,0,0,0.07)', borderRadius: 5, padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: WC.btn }} />
              <MiniBar w="80%" h={4} />
            </div>
          ))}
        </div>
      )
    case 'pricing':
      return (
        <div style={{ ...base, gap: 5, alignItems: 'stretch' }}>
          {[false, true, false].map((hi, i) => (
            <div key={i} style={{ flex: 1, height: 34, background: hi ? 'rgba(59,130,246,0.10)' : WC.card, border: `1px solid ${hi ? 'rgba(59,130,246,0.3)' : 'rgba(0,0,0,0.07)'}`, borderRadius: 5, padding: '4px 5px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <MiniBar w="70%" h={5} />
              <MiniBar w="50%" h={4} color={hi ? WC.btn : WC.line} />
            </div>
          ))}
        </div>
      )
    case 'stats':
      return (
        <div style={{ ...base, justifyContent: 'space-around' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <MiniBar w={32} h={9} color={WC.btn} />
              <MiniBar w={24} h={4} />
            </div>
          ))}
        </div>
      )
    case 'cta':
      return (
        <div style={{ ...base, background: 'rgba(59,130,246,0.07)', borderRadius: 6, margin: '0 2px', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <MiniBar w={100} h={6} color={WC.btn} />
            <MiniBar w={130} h={4} />
          </div>
          <div style={{ width: 54, height: 22, background: WC.btn, borderRadius: 5 }} />
        </div>
      )
    case 'testimonials':
      return (
        <div style={{ ...base, gap: 5 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ flex: 1, height: 34, background: WC.card, border: '1px solid rgba(0,0,0,0.07)', borderRadius: 5, padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <MiniBar w="90%" h={4} />
              <MiniBar w="70%" h={4} />
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: WC.btn }} />
                <MiniBar w={36} h={3} />
              </div>
            </div>
          ))}
        </div>
      )
    case 'faq':
      return (
        <div style={{ ...base, flexDirection: 'column', gap: 4, padding: '6px 12px', justifyContent: 'center' }}>
          {[1, 2].map(i => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 3 }}>
              <MiniBar w="65%" h={4} />
              <span style={{ fontSize: 10, opacity: 0.35 }}>+</span>
            </div>
          ))}
        </div>
      )
    case 'timeline':
      return (
        <div style={{ ...base, flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: WC.btn, flexShrink: 0, fontSize: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(59,130,246,0.7)', fontWeight: 700 }}>{i}</div>
              <MiniBar w="65%" h={4} />
            </div>
          ))}
        </div>
      )
    case 'logos':
      return (
        <div style={{ ...base, justifyContent: 'space-around' }}>
          {[1, 2, 3, 4, 5].map(i => <div key={i} style={{ width: 28, height: 12, background: WC.line, borderRadius: 3 }} />)}
        </div>
      )
    case 'newsletter':
      return (
        <div style={{ ...base, flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
          <MiniBar w="40%" h={6} />
          <div style={{ display: 'flex', gap: 5 }}>
            <div style={{ width: 90, height: 18, background: WC.img, borderRadius: 4, border: '1px solid rgba(0,0,0,0.08)' }} />
            <div style={{ width: 42, height: 18, background: WC.btn, borderRadius: 4 }} />
          </div>
        </div>
      )
    case 'contact_form':
      return (
        <div style={{ ...base, gap: 6 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[1, 2].map(i => <div key={i} style={{ height: 14, background: WC.img, borderRadius: 3, border: '1px solid rgba(0,0,0,0.07)' }} />)}
          </div>
          <div style={{ flex: 1, height: 30, background: WC.img, borderRadius: 4, border: '1px solid rgba(0,0,0,0.07)' }} />
        </div>
      )
    case 'section':
    case 'grid':
      return (
        <div style={{ ...base, flexDirection: 'column', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3].map(i => <div key={i} style={{ width: 36, height: 22, background: WC.card, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 5 }} />)}
          </div>
        </div>
      )
    case 'footer_simple':
      return (
        <div style={{ ...base, justifyContent: 'space-between', background: 'rgba(0,0,0,0.03)', borderRadius: '0 0 4px 4px' }}>
          <MiniBar w={50} h={5} />
          <div style={{ display: 'flex', gap: 6 }}>{[28, 24, 30].map((w, i) => <MiniBar key={i} w={w} />)}</div>
        </div>
      )
    case 'footer_rich':
      return (
        <div style={{ ...base, flexDirection: 'column', background: 'rgba(0,0,0,0.03)', borderRadius: '0 0 4px 4px', gap: 5, padding: '6px 12px', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {[1, 2, 3].map(col => (
              <div key={col} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <MiniBar w="60%" h={5} />
                <MiniBar w="75%" h={3} />
                <MiniBar w="55%" h={3} />
              </div>
            ))}
          </div>
        </div>
      )
    default:
      return (
        <div style={{ ...base, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <MiniBar w="50%" h={6} />
          <MiniBar w="70%" h={4} />
        </div>
      )
  }
}

// ─── Field Editor ─────────────────────────────────────────────────────────────

function FieldEditor({
  fields, values, onChange,
}: {
  fields: FieldDef[]
  values: Record<string, string>
  onChange: (key: string, val: string) => void
}) {
  const inputBase: React.CSSProperties = {
    width: '100%', padding: '6px 9px', border: '1px solid rgba(0,0,0,0.11)',
    borderRadius: 6, fontSize: 12, fontFamily: 'inherit', color: '#111827',
    background: '#FAFAFA', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(249,250,251,0.8)' }}>
      {fields.map(f => (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', letterSpacing: '0.01em' }}>{f.label}</label>
          {f.type === 'select' ? (
            <select
              value={values[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
              style={{ ...inputBase, cursor: 'pointer', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239CA3AF\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'%3E%3C/polyline%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="">请选择…</option>
              {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea
              value={values[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              rows={f.rows || 3}
              style={{ ...inputBase, resize: 'vertical', lineHeight: 1.5 }}
              onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.45)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(0,0,0,0.11)' }}
            />
          ) : (
            <input
              type="text"
              value={values[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              style={{ ...inputBase, height: 30 }}
              onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.45)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(0,0,0,0.11)' }}
            />
          )}
          {f.hint && <span style={{ fontSize: 10.5, color: '#9CA3AF' }}>{f.hint}</span>}
        </div>
      ))}
    </div>
  )
}

// ─── Canvas Module Card ───────────────────────────────────────────────────────

function ModuleCard({
  mod, idx, isExpanded, dragFromIdx, dragOverIdx,
  onToggle, onRemove, onFieldChange,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  mod: CanvasModule
  idx: number
  isExpanded: boolean
  dragFromIdx: number | null
  dragOverIdx: number | null
  onToggle: () => void
  onRemove: () => void
  onFieldChange: (key: string, val: string) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const catColor = CATEGORY_COLOR[mod.category] || '#6B7280'
  const fields = MODULE_FIELDS[mod.type] || []
  const filledCount = Object.values(mod.props).filter(v => v && v.trim()).length

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        background: 'white',
        border: `1.5px solid ${dragOverIdx === idx ? 'rgba(59,130,246,0.45)' : isExpanded ? 'rgba(59,130,246,0.25)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: 10,
        marginBottom: 6,
        opacity: dragFromIdx === idx ? 0.45 : 1,
        boxShadow: isExpanded ? '0 4px 16px rgba(59,130,246,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s, border-color 0.2s, opacity 0.15s',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Drop indicator */}
      {dragOverIdx === idx && dragFromIdx !== idx && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: '#3B82F6', zIndex: 2 }} />
      )}

      {/* Module header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px 7px 8px',
          background: isExpanded ? 'rgba(59,130,246,0.03)' : 'rgba(0,0,0,0.015)',
          borderBottom: isExpanded ? '1px solid rgba(59,130,246,0.10)' : '1px solid rgba(0,0,0,0.05)',
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        {/* Drag handle */}
        <GripVertical
          size={13}
          style={{ color: '#D1D5DB', cursor: 'grab', flexShrink: 0 }}
          onClick={e => e.stopPropagation()}
        />

        {/* Module icon + name */}
        <div style={{
          width: 22, height: 22, borderRadius: 5, flexShrink: 0,
          background: `${catColor}14`,
          border: `1px solid ${catColor}25`,
          display: 'grid', placeItems: 'center',
          color: catColor,
        }}>
          {MODULE_ICON[mod.type] || <Layout size={12} />}
        </div>

        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#111827', flex: 1 }}>{mod.name}</span>

        {/* Field fill progress */}
        {fields.length > 0 && (
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 999, flexShrink: 0,
            background: filledCount > 0 ? `${catColor}14` : 'rgba(0,0,0,0.04)',
            color: filledCount > 0 ? catColor : '#9CA3AF',
            border: `1px solid ${filledCount > 0 ? catColor + '25' : 'transparent'}`,
          }}>
            {filledCount}/{fields.length} 已填
          </span>
        )}

        {/* Expand / collapse */}
        {fields.length > 0 && (
          <div style={{ color: '#9CA3AF', flexShrink: 0 }}>
            {isExpanded ? <ChevronDown size={13} /> : <ChevronDown size={13} style={{ transform: 'rotate(-90deg)' }} />}
          </div>
        )}

        {/* Delete */}
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', padding: 2, display: 'flex', borderRadius: 4, transition: 'color 0.15s', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#EF4444' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#D1D5DB' }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Compact wireframe */}
      <CompactWireframe type={mod.type} />

      {/* Expandable fields */}
      {isExpanded && fields.length > 0 && (
        <FieldEditor
          fields={fields}
          values={mod.props}
          onChange={onFieldChange}
        />
      )}
    </div>
  )
}

// ─── Library Panel ────────────────────────────────────────────────────────────

function LibraryPanel({
  onAdd, onDragStart, onDragEnd,
}: {
  onAdd: (type: string, name: string, category: string) => void
  onDragStart: (type: string) => void
  onDragEnd: () => void
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return LIBRARY_CATEGORIES
    const q = search.toLowerCase()
    return LIBRARY_CATEGORIES.map(cat => ({
      ...cat,
      modules: cat.modules.filter(m =>
        m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.modules.length > 0)
  }, [search])

  return (
    <div style={{
      width: 260, flexShrink: 0,
      borderLeft: '1px solid rgba(0,0,0,0.07)',
      background: 'white', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Library header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', marginBottom: 2 }}>模块库</div>
        <div style={{ fontSize: 11.5, color: '#9CA3AF', marginBottom: 10 }}>拖拽到画布 · 或点击添加</div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索模块"
            style={{
              width: '100%', height: 30, padding: '0 8px 0 26px',
              border: '1px solid rgba(0,0,0,0.10)', borderRadius: 7,
              fontSize: 12, fontFamily: 'inherit', color: '#111827',
              background: '#F9FAFB', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <kbd style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: '#9CA3AF', background: 'rgba(0,0,0,0.04)', padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(0,0,0,0.08)', lineHeight: 1.5 }}>⌘K</kbd>
        </div>
      </div>

      {/* Categories */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px 20px' }}>
        {filtered.map(cat => (
          <div key={cat.label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '6px 4px 5px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: cat.color }}>{cat.icon}</span>
              {cat.label}
            </div>

            {cat.modules.map(mod => (
              <button
                key={`${cat.label}-${mod.type}-${mod.name}`}
                draggable
                onDragStart={() => onDragStart(mod.type)}
                onDragEnd={onDragEnd}
                onClick={() => onAdd(mod.type, mod.name, cat.label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                  padding: '7px 8px', borderRadius: 7,
                  background: 'transparent', border: '1px solid transparent',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  transition: 'all 0.13s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `${cat.color}08`
                  e.currentTarget.style.borderColor = `${cat.color}20`
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.borderColor = 'transparent'
                }}
              >
                {/* Module icon tile */}
                <div style={{
                  width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                  background: `${cat.color}0F`,
                  border: `1px solid ${cat.color}22`,
                  display: 'grid', placeItems: 'center',
                  color: cat.color,
                }}>
                  {MODULE_ICON[mod.type] || <Layout size={14} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>{mod.name}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mod.desc}</div>
                </div>
                {/* drag handle dots */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: 0.25, flexShrink: 0 }}>
                  {[1, 2].map(r => (
                    <div key={r} style={{ display: 'flex', gap: 2 }}>
                      {[1, 2].map(c => <div key={c} style={{ width: 2, height: 2, borderRadius: '50%', background: '#6B7280' }} />)}
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UICanvasView({ runId, onBack }: UICanvasViewProps) {
  const [description, setDescription] = useState('')
  const [modules, setModules] = useState<CanvasModule[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isBuilding, setIsBuilding] = useState(false)
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [htmlContent, setHtmlContent] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [draggingLibType, setDraggingLibType] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [isRefining, setIsRefining] = useState(false)
  const [chatLog, setChatLog] = useState<{ role: 'user' | 'agent'; text: string }[]>([])
  const [framework, setFramework] = useState<'html' | 'react'>('html')
  const [previewTab, setPreviewTab] = useState<'preview' | 'code'>('preview')

  const handleAiSuggest = async () => {
    if (!description.trim()) return
    setIsGenerating(true)
    setError(null)
    try {
      const res = await apiClient.suggestLayout(runId, description)
      setModules(res.modules.map(m => ({
        ...m,
        props: (m.props || {}) as Record<string, string>,
      })))
      setRationale(res.rationale)
      setExpandedId(null)
    } catch (e: unknown) {
      setError('AI 生成失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateCode = async () => {
    if (modules.length === 0) return
    setIsBuilding(true)
    setError(null)
    try {
      const res = await apiClient.generateCanvasCode(runId, modules, description, framework)
      setHtmlContent(res.html_content)
      setPreviewTab('preview')
      setChatLog([])
      setShowPreview(true)
    } catch (e: unknown) {
      setError('代码生成失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setIsBuilding(false)
    }
  }

  const handleRefine = async () => {
    if (!feedback.trim() || !htmlContent) return
    const userText = feedback.trim()
    setFeedback('')
    setChatLog(prev => [...prev, { role: 'user', text: userText }])
    setIsRefining(true)
    try {
      const res = await apiClient.refineCanvas(runId, modules, userText, description, htmlContent, framework)
      setHtmlContent(res.html_content)
      setChatLog(prev => [...prev, { role: 'agent', text: res.message || '已根据反馈更新页面' }])
    } catch (e: unknown) {
      setChatLog(prev => [...prev, { role: 'agent', text: '优化失败：' + (e instanceof Error ? e.message : String(e)) }])
    } finally {
      setIsRefining(false)
    }
  }

  const extractJsx = () => {
    const m = htmlContent.match(/\/\/ === JSX_COMPONENT_START ===\s*([\s\S]*?)\s*\/\/ === JSX_COMPONENT_END ===/)
    return m ? m[1].trim() : htmlContent
  }

  const addModule = (type: string, name: string, category: string) => {
    const id = Math.random().toString(36).slice(2)
    setModules(prev => [...prev, { id, type, name, category, props: {} }])
    setExpandedId(id)
    setTimeout(() => {
      document.getElementById(`mod-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }

  const removeModule = (id: string) => {
    setModules(prev => prev.filter(m => m.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const updateProp = (id: string, key: string, val: string) => {
    setModules(prev => prev.map(m => m.id === id ? { ...m, props: { ...m.props, [key]: val } } : m))
  }

  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault()
    if (draggingLibType) {
      const libMod = LIBRARY_CATEGORIES.flatMap(c => c.modules.map(m => ({ ...m, cat: c.label }))).find(m => m.type === draggingLibType)
      if (libMod) {
        const id = Math.random().toString(36).slice(2)
        setModules(prev => {
          const next = [...prev, { id, type: draggingLibType, name: libMod.name, category: libMod.cat, props: {} }]
          const [moved] = next.splice(next.length - 1, 1)
          next.splice(toIdx, 0, moved)
          return next
        })
        setExpandedId(id)
      }
      setDraggingLibType(null)
    } else if (dragFromIdx !== null && dragFromIdx !== toIdx) {
      setModules(prev => {
        const next = [...prev]
        const [moved] = next.splice(dragFromIdx, 1)
        next.splice(toIdx, 0, moved)
        return next
      })
    }
    setDragFromIdx(null)
    setDragOverIdx(null)
  }

  const handleDropOnCanvas = (e: React.DragEvent) => {
    e.preventDefault()
    if (draggingLibType) {
      const libMod = LIBRARY_CATEGORIES.flatMap(c => c.modules.map(m => ({ ...m, cat: c.label }))).find(m => m.type === draggingLibType)
      if (libMod) addModule(draggingLibType, libMod.name, libMod.cat)
      setDraggingLibType(null)
    }
    setDragFromIdx(null)
    setDragOverIdx(null)
  }

  const downloadHtml = () => {
    if (!htmlContent) return
    const blob = new Blob([htmlContent], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = framework === 'react' ? 'ui_design_react.html' : 'ui_design.html'; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadJsx = () => {
    if (!htmlContent) return
    const jsxContent = extractJsx()
    const blob = new Blob([jsxContent], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'App.jsx'; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Preview mode ───────────────────────────────────────────────────────────
  if (showPreview) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#F8FAFC' }}>
        {/* Preview toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 52, background: 'white', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setShowPreview(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'transparent', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7, fontSize: 12.5, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <ChevronLeft size={13} /> 返回画板
            </button>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              前端代码预览
              {chatLog.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: '#059669', background: 'rgba(5,150,105,0.08)', padding: '2px 8px', borderRadius: 999 }}>
                  已优化 {Math.floor(chatLog.length / 2)} 次
                </span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {framework === 'react' && (
              <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', borderRadius: 7, padding: 3, border: '1px solid rgba(0,0,0,0.07)' }}>
                {(['preview', 'code'] as const).map(tab => (
                  <button key={tab} onClick={() => setPreviewTab(tab)} style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11.5, fontFamily: 'inherit', fontWeight: 500,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: previewTab === tab ? 'white' : 'transparent',
                    color: previewTab === tab ? '#111827' : '#9CA3AF',
                    boxShadow: previewTab === tab ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                  }}>
                    {tab === 'preview' ? '预览' : 'JSX 代码'}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => { setHtmlContent(''); setShowPreview(false); setChatLog([]) }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'transparent', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7, fontSize: 12.5, color: '#6B7280', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <RotateCcw size={12} /> 重新生成
            </button>
            {framework === 'react' && (
              <button
                onClick={downloadJsx}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'linear-gradient(135deg,#2563EB,#4F46E5)', border: 'none', borderRadius: 7, fontSize: 12.5, color: 'white', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
              >
                <Download size={13} /> 下载 JSX
              </button>
            )}
            <button
              onClick={downloadHtml}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', borderRadius: 7, fontSize: 12.5, color: 'white', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
            >
              <Download size={13} /> {framework === 'react' ? 'HTML 预览' : '下载 HTML'}
            </button>
          </div>
        </div>

        {/* Main area: iframe + right AI chat panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* iframe preview */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {isRefining && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 14,
                background: 'rgba(248,250,252,0.90)', backdropFilter: 'blur(8px)',
              }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#3B82F6' }} />
                <div style={{ fontSize: 14, color: '#374151', fontWeight: 500 }}>AI 正在优化…</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>根据你的反馈重新生成页面</div>
              </div>
            )}
            {framework === 'react' && previewTab === 'code' ? (
              <pre style={{
                width: '100%', height: '100%', margin: 0, overflow: 'auto',
                padding: '20px 24px', fontSize: 12.5, lineHeight: 1.7,
                fontFamily: "'JetBrains Mono','Fira Code',monospace",
                background: '#0F172A', color: '#E2E8F0',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {extractJsx()}
              </pre>
            ) : (
              <iframe
                key={htmlContent.length}
                srcDoc={htmlContent}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="UI Preview"
                sandbox="allow-scripts"
              />
            )}
          </div>

          {/* Right: AI feedback panel */}
          <div style={{
            width: 300, flexShrink: 0,
            borderLeft: '1px solid rgba(0,0,0,0.07)',
            background: 'white', display: 'flex', flexDirection: 'column',
          }}>
            {/* Panel header */}
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#2563EB,#4F46E5)', display: 'grid', placeItems: 'center' }}>
                  <MessageCircle size={12} color="white" />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>AI 迭代优化</span>
              </div>
              <p style={{ fontSize: 11.5, color: '#9CA3AF', margin: 0 }}>
                描述你的修改意见，AI 会立刻更新页面
              </p>
            </div>

            {/* Chat log */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chatLog.length === 0 ? (
                <div style={{ padding: '20px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>💬</div>
                  <div style={{ fontSize: 12.5, color: '#6B7280', marginBottom: 6 }}>告诉 AI 你想要什么修改</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {['改成深色主题', '添加用户评价区块', '让设计更简洁现代', '改为蓝色系配色'].map(hint => (
                      <button
                        key={hint}
                        onClick={() => setFeedback(hint)}
                        style={{
                          padding: '6px 10px', background: '#F9FAFB', border: '1px solid rgba(0,0,0,0.08)',
                          borderRadius: 7, fontSize: 11.5, color: '#374151', cursor: 'pointer',
                          fontFamily: 'inherit', textAlign: 'left',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)' }}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatLog.map((msg, i) => (
                  <div key={i} style={{
                    display: 'flex', flexDirection: 'column', gap: 2,
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}>
                    <span style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 1 }}>
                      {msg.role === 'user' ? '你' : 'AI'}
                    </span>
                    <div style={{
                      maxWidth: '90%', padding: '7px 10px', borderRadius: 10, fontSize: 12.5,
                      background: msg.role === 'user' ? 'linear-gradient(135deg,#2563EB,#4F46E5)' : '#F3F4F6',
                      color: msg.role === 'user' ? 'white' : '#374151',
                      borderBottomRightRadius: msg.role === 'user' ? 3 : 10,
                      borderBottomLeftRadius: msg.role === 'agent' ? 3 : 10,
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input area */}
            <div style={{ padding: '10px 12px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRefine() }}
                placeholder="例：改成深色主题，导航栏加毛玻璃效果…"
                disabled={isRefining}
                rows={3}
                style={{
                  width: '100%', padding: '8px 10px', border: '1px solid rgba(0,0,0,0.11)',
                  borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', color: '#111827',
                  background: isRefining ? '#F9FAFB' : '#FAFAFA', outline: 'none',
                  resize: 'none', lineHeight: 1.5, boxSizing: 'border-box',
                  marginBottom: 8,
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.45)' }}
                onBlur={e => { e.target.style.borderColor = 'rgba(0,0,0,0.11)' }}
              />
              <button
                onClick={handleRefine}
                disabled={isRefining || !feedback.trim()}
                style={{
                  width: '100%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  background: isRefining || !feedback.trim() ? '#E5E7EB' : 'linear-gradient(135deg,#2563EB,#4F46E5)',
                  color: isRefining || !feedback.trim() ? '#9CA3AF' : 'white',
                  border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  cursor: isRefining || !feedback.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.2s',
                }}
              >
                {isRefining
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> 优化中…</>
                  : <><Wand2 size={13} /> AI 优化</>
                }
              </button>
              <div style={{ fontSize: 10.5, color: '#9CA3AF', textAlign: 'center', marginTop: 6 }}>
                ⌘↵ 快捷发送
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Editing mode ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#F8FAFC' }}>

      {/* ── TOOLBAR ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 16px', height: 54, flexShrink: 0,
        background: 'white', borderBottom: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: 'transparent', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 7, fontSize: 12, color: '#6B7280', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          <ChevronLeft size={12} /> 当前流水线
        </button>

        <div style={{ width: 1, height: 18, background: 'rgba(0,0,0,0.08)', flexShrink: 0 }} />

        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAiSuggest() }}
          placeholder="描述你的产品，AI 自动推荐模块组合…"
          style={{ flex: 1, height: 34, padding: '0 12px', border: '1px solid rgba(0,0,0,0.11)', borderRadius: 8, fontSize: 13, color: '#111827', background: '#F9FAFB', outline: 'none', fontFamily: 'inherit' }}
        />

        <button
          onClick={handleAiSuggest}
          disabled={isGenerating || !description.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, flexShrink: 0,
            background: isGenerating || !description.trim() ? '#E5E7EB' : 'linear-gradient(135deg, #2563EB, #4F46E5)',
            color: isGenerating || !description.trim() ? '#9CA3AF' : 'white',
            border: 'none', cursor: isGenerating || !description.trim() ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', fontWeight: 500,
            boxShadow: isGenerating || !description.trim() ? 'none' : '0 2px 8px rgba(59,130,246,0.28)',
          }}
        >
          {isGenerating ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={13} />}
          {isGenerating ? 'AI 生成中…' : 'AI 推荐布局'}
        </button>

        {/* Framework selector */}
        <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', borderRadius: 8, padding: 3, flexShrink: 0, border: '1px solid rgba(0,0,0,0.07)' }}>
          {(['html', 'react'] as const).map(fw => (
            <button
              key={fw}
              onClick={() => setFramework(fw)}
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11.5, fontFamily: 'inherit', fontWeight: 500,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: framework === fw ? 'white' : 'transparent',
                color: framework === fw ? '#111827' : '#9CA3AF',
                boxShadow: framework === fw ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
              }}
            >
              {fw === 'html' ? 'HTML' : '⚛ React'}
            </button>
          ))}
        </div>

        <button
          onClick={handleGenerateCode}
          disabled={isBuilding || modules.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, flexShrink: 0,
            background: isBuilding || modules.length === 0 ? '#E5E7EB' : 'linear-gradient(135deg, #059669, #047857)',
            color: isBuilding || modules.length === 0 ? '#9CA3AF' : 'white',
            border: 'none', cursor: isBuilding || modules.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', fontWeight: 500,
            boxShadow: isBuilding || modules.length === 0 ? 'none' : '0 2px 8px rgba(5,150,105,0.28)',
          }}
        >
          {isBuilding ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
          {isBuilding ? '生成中…' : `批准 → 生成${framework === 'react' ? ' React' : ' HTML'}`}
        </button>

        {htmlContent && (
          <button
            onClick={() => setShowPreview(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.20)', borderRadius: 7, fontSize: 12.5, color: '#059669', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
          >
            <Eye size={12} /> 预览
          </button>
        )}
      </div>

      {/* ── ERROR ── */}
      {error && (
        <div style={{ padding: '8px 16px', background: '#FEF2F2', borderBottom: '1px solid #FECACA', fontSize: 12.5, color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', display: 'flex' }}><X size={14} /></button>
        </div>
      )}

      {/* ── BODY: Canvas + Library ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Canvas */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 48px', position: 'relative' }}>

          {/* Rationale */}
          {rationale && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10, fontSize: 12.5, color: '#1D4ED8', display: 'flex', gap: 8 }}>
              <Wand2 size={13} style={{ marginTop: 1, flexShrink: 0, opacity: 0.7 }} />
              <span style={{ flex: 1 }}>{rationale}</span>
              <button onClick={() => setRationale('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93C5FD', display: 'flex', flexShrink: 0 }}><X size={12} /></button>
            </div>
          )}

          {/* Empty state */}
          {modules.length === 0 ? (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDropOnCanvas}
              style={{ height: 260, border: '2px dashed rgba(0,0,0,0.10)', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#9CA3AF', background: 'white', cursor: 'default' }}
            >
              <div style={{ fontSize: 28, opacity: 0.3 }}>⬜</div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>从右侧模块库拖入或点击添加</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>或在上方输入描述，点击「AI 推荐布局」</div>
            </div>
          ) : (
            <div onDragOver={e => e.preventDefault()} onDrop={handleDropOnCanvas}>
              {modules.map((mod, idx) => (
                <div key={mod.id} id={`mod-${mod.id}`}>
                  <ModuleCard
                    mod={mod}
                    idx={idx}
                    isExpanded={expandedId === mod.id}
                    dragFromIdx={dragFromIdx}
                    dragOverIdx={dragOverIdx}
                    onToggle={() => setExpandedId(expandedId === mod.id ? null : mod.id)}
                    onRemove={() => removeModule(mod.id)}
                    onFieldChange={(key, val) => updateProp(mod.id, key, val)}
                    onDragStart={() => setDragFromIdx(idx)}
                    onDragEnd={() => { setDragFromIdx(null); setDragOverIdx(null) }}
                    onDragOver={e => { e.preventDefault(); setDragOverIdx(idx) }}
                    onDrop={e => handleDrop(e, idx)}
                  />
                </div>
              ))}

              {/* Bottom drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOverIdx(modules.length) }}
                onDrop={e => { e.preventDefault(); handleDropOnCanvas(e); setDragOverIdx(null) }}
                style={{ height: dragOverIdx === modules.length ? 42 : 20, borderRadius: 8, border: dragOverIdx === modules.length ? '2px dashed rgba(59,130,246,0.35)' : '2px dashed transparent', background: dragOverIdx === modules.length ? 'rgba(59,130,246,0.04)' : 'transparent', transition: 'all 0.15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, color: '#93C5FD' }}
              >
                {dragOverIdx === modules.length ? '释放以添加到末尾' : ''}
              </div>

              {/* Footer actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 8 }}>
                <button
                  onClick={() => { setModules([]); setExpandedId(null); setRationale('') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', background: 'white', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 7, fontSize: 12, color: '#6B7280', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <RotateCcw size={11} /> 清空画板
                </button>
                <span style={{ fontSize: 11.5, color: '#9CA3AF' }}>
                  {modules.length} 个模块 · {modules.reduce((n, m) => n + Object.values(m.props).filter(v => v).length, 0)} 个配置项已填写
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Module library (right panel) */}
        <LibraryPanel
          onAdd={addModule}
          onDragStart={type => setDraggingLibType(type)}
          onDragEnd={() => setDraggingLibType(null)}
        />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
