import type { SkillManifest } from '@/types/skill';
import SkillFieldRenderer from './SkillFieldRenderer';

interface SkillPanelProps {
  skill: SkillManifest;
  fieldValues: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
}

export default function SkillPanel({ skill, fieldValues, onFieldChange }: SkillPanelProps) {
  if (!skill.panel?.fields) return null;

  return (
    <div className="px-4 pt-1 pb-3 space-y-2">
      {skill.panel.fields
        .filter((field) => {
          // Handle showIf condition (supports single value or array of values)
          if (field.showIf) {
            const condValue = String(fieldValues[field.showIf.field]);
            const expected = field.showIf.value;
            return Array.isArray(expected) ? expected.includes(condValue) : condValue === expected;
          }
          return true;
        })
        .map((field) => (
          <SkillFieldRenderer
            key={field.key}
            field={field}
            value={fieldValues[field.key]}
            onChange={(value) => onFieldChange(field.key, value)}
            accentColor={skill.accentColor}
          />
        ))}
    </div>
  );
}
