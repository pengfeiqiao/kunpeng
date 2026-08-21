// ── Skill Manifest (skill.json schema) ──────────────────────────────────────

export interface PanelFieldOption {
  value: string;
  label: string;
}

export interface ShowIfCondition {
  field: string;
  value: string | string[];
}

export type PanelFieldType =
  | 'select'
  | 'input'
  | 'textarea'
  | 'number'
  | 'toggle'
  | 'radio'
  | 'file'
  | 'directory'
  | 'file-multi'
  | 'image-select'   // 图片选择器（多选一）
  | 'image-grid';    // 图片网格展示

export interface PanelField {
  key: string;
  label: string;
  type: PanelFieldType;
  default?: string | number | boolean | string[];
  placeholder?: string;
  options?: PanelFieldOption[];
  /** Maps field values to display labels in prompt output */
  labelMap?: Record<string, string>;
  showIf?: ShowIfCondition;
  /** For number type */
  min?: number;
  max?: number;
  /** For number type: preset quick-select buttons */
  presets?: number[];
  /** For file/file-multi: file extension filters */
  extensions?: string[];
}

// ── Wizard Skill Types ──────────────────────────────────────────────────────

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  fields?: PanelField[];
  /** Custom component name for complex steps */
  component?: string;
  /** Condition to show this step */
  showIf?: ShowIfCondition;
}

export interface WizardConfig {
  steps: WizardStep[];
  /** Enable state persistence for resume */
  persistState?: boolean;
  /** Steps that can be skipped */
  allowSkip?: string[];
}

export interface SkillManifest {
  id: string;
  name: string;
  icon: string;
  description: string;
  version: string;
  hasPanel: boolean;
  accentColor?: string;
  placeholder?: string;
  panel?: {
    fields: PanelField[];
  };
  /** Template with {{variable}} placeholders */
  promptTemplate: string;
  /** Wizard mode configuration for multi-step skills */
  wizard?: WizardConfig;
  /** Product grouping used by compact capability menus. */
  category?: 'writing' | 'storyboard' | 'visual' | 'video' | 'marketing' | 'integration' | 'internal';
  /** Controls where a skill is exposed without removing its runtime capability. */
  visibility?: 'toolbar' | 'library' | 'internal';
}
