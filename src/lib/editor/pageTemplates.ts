/**
 * pageTemplates — 页面模板库索引。
 *
 * 汇合所有布局文件 → 调用引擎叉乘生成 → 导出 PAGE_TEMPLATES + 辅助函数。
 * UI (LeftPanel) 直接消费本模块。
 */
import { generatePageTemplates, type PageTemplateDef, type PageCategory, type StyleId } from './pageLayoutEngine';
import { GENERAL_LAYOUTS } from './layouts/generalLayouts';
import { SPECIAL_LAYOUTS } from './layouts/specialLayouts';

const ALL_LAYOUTS = [...GENERAL_LAYOUTS, ...SPECIAL_LAYOUTS];

export const PAGE_TEMPLATES: PageTemplateDef[] = generatePageTemplates(ALL_LAYOUTS);

export function findPageTemplate(id: string): PageTemplateDef | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id);
}

export function pageTemplatesByCategory(cat: PageCategory): PageTemplateDef[] {
  return PAGE_TEMPLATES.filter((t) => t.category === cat);
}

export function pageTemplatesByStyle(style: StyleId): PageTemplateDef[] {
  return PAGE_TEMPLATES.filter((t) => t.styleId === style);
}

export function pageTemplatesByCategoryAndStyle(cat: PageCategory, style: StyleId): PageTemplateDef[] {
  return PAGE_TEMPLATES.filter((t) => t.category === cat && t.styleId === style);
}

export function pageTemplatesDoc(): string {
  const layoutGuide: Record<string, string> = {
    'hero-center': '居中大标题——开场/章节/结尾全屏大字',
    'split-text-visual': '左文右图——图文并排展示',
    'full-data': '全屏数据——多指标仪表板',
    'bullet-stack': '要点堆叠——逐条罗列要点',
    'quote-spotlight': '大引用——金句/证言大字居中',
    'lower-bar': '底部信息条——口播时不遮人脸，信息在下方',
    'side-panel': '侧边面板——口播时侧边展示要点',
    'floating-cards': '浮动卡片——多张卡片错落排布',
    'product-showcase': '产品展示——聚光灯+卖点标签',
    'compare-grid': '对比网格——多列对比+推荐标记',
    'promo-banner': '促销横幅——价格+CTA+紧迫感',
    'step-timeline': '步骤时间线——流程/教程分步',
    'code-explain': '代码讲解——终端风格代码+注解',
    'brand-statement': '品牌宣言——大字间距+电影感',
    'data-dashboard': '数据大屏——多卡片+趋势+进度条',
  };
  const cats: Record<string, string[]> = {
    '口播': ['lower-bar', 'side-panel', 'floating-cards'],
    '通用': ['hero-center', 'split-text-visual', 'full-data', 'bullet-stack', 'quote-spotlight'],
    '电商': ['product-showcase', 'compare-grid', 'promo-banner'],
    '知识': ['step-timeline', 'code-explain'],
    '品牌': ['brand-statement', 'data-dashboard'],
  };
  const lines: string[] = [];
  for (const [cat, ids] of Object.entries(cats)) {
    lines.push(`【${cat}】`);
    for (const id of ids) lines.push(`  - ${id}：${layoutGuide[id] ?? ''}`);
  }
  lines.push('');
  lines.push('风格（每页必选 1 种，模板 ID = 布局__风格，如 hero-center__linear）：');
  lines.push('linear(精致)/minimal(极简)/fluid(流体)/metal(金属)/keynote(发布会)/capcut(剪映)/pixel(像素)/cyberpunk(赛博)/editorial(杂志)/warm(温暖)/luxury(奢华)/vibrant(活力)/glass(毛玻璃)/neon(霓虹)/retro(复古)/nature(自然)');
  lines.push('口播推荐 capcut/linear，干货推荐 editorial/minimal，品牌推荐 luxury/keynote');
  lines.push('');
  lines.push('page_params 字段：title/subtitle/body/items(string[])/data({label,value}[])/quote/author/price/originalPrice/cta/steps(string[])/code/stats({value,label}[])');
  return lines.join('\n');
}
