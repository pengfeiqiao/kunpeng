import type { SkillManifest, PanelField } from '@/types/skill';

/**
 * Build the final prompt by replacing {{variable}} placeholders in the template.
 *
 * Reserved variables:
 *   {{userContent}}    - user's text input
 *
 * Panel field values are injected by their `key`.
 * If a field has a `labelMap`, the mapped label is used instead of the raw value.
 *
 * NOTE: API-key placeholders ({{geminiApiKey}} / {{dmxApiKey}} / {{bananaProApiKey}})
 * were removed — injected keys ended up in prompts, chat history and logs.
 * They now resolve to an empty string; tools read keys from settings directly.
 */
export function buildPrompt(
  skill: SkillManifest,
  fieldValues: Record<string, unknown>,
  userContent: string,
  // Deprecated and ignored. Kept so existing call sites compile unchanged.
  _apiKeys: { geminiApiKey?: string; dmxApiKey?: string; bananaProApiKey?: string } = {},
): string {
  let prompt = skill.promptTemplate;

  // Build a lookup for labelMap resolution
  const fieldDefs = new Map<string, PanelField>();
  if (skill.panel?.fields) {
    for (const f of skill.panel.fields) {
      fieldDefs.set(f.key, f);
    }
  }

  // Replace all {{variable}} placeholders
  prompt = prompt.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    // Reserved variables
    if (key === 'userContent') return userContent;
    // Key placeholders are intentionally NOT resolved (see header note).
    if (key === 'geminiApiKey' || key === 'dmxApiKey' || key === 'bananaProApiKey') return '';

    // Panel field values
    const value = fieldValues[key];
    if (value === undefined || value === null) return '';

    // Skip fields whose showIf condition is not met (hidden fields)
    const fieldDef = fieldDefs.get(key);
    if (fieldDef?.showIf) {
      const depValue = String(fieldValues[fieldDef.showIf.field] ?? '');
      const expected = fieldDef.showIf.value;
      if (Array.isArray(expected) ? !expected.includes(depValue) : depValue !== expected) return '';
    }

    // If field has a labelMap, resolve the display label
    if (fieldDef?.labelMap && typeof value === 'string' && fieldDef.labelMap[value]) {
      return fieldDef.labelMap[value];
    }

    // Array values (e.g. file-multi)
    if (Array.isArray(value)) {
      return value.join('\n');
    }

    return String(value);
  });

  return prompt;
}

/**
 * Get the default values for all fields in a skill manifest.
 */
export function getFieldDefaults(skill: SkillManifest): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  if (skill.panel?.fields) {
    for (const field of skill.panel.fields) {
      if (field.default !== undefined) {
        defaults[field.key] = field.default;
      } else {
        // Type-based defaults
        switch (field.type) {
          case 'toggle':
            defaults[field.key] = false;
            break;
          case 'number':
            defaults[field.key] = field.min ?? 0;
            break;
          case 'file-multi':
            defaults[field.key] = [];
            break;
          case 'input':
          case 'textarea':
          case 'file':
          case 'directory':
            defaults[field.key] = '';
            break;
          case 'select':
          case 'radio':
            defaults[field.key] = field.options?.[0]?.value ?? '';
            break;
        }
      }
    }
  }
  return defaults;
}
