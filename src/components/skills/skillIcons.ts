import {
  ScrollText,
  Globe,
  Car,
  FileSearch,
  Sparkles,
  UserRound,
  Clapperboard,
  Film,
  Wand2,
  PenTool,
  Tv,
  type LucideIcon,
} from 'lucide-react';

/** Map skill icon id → lucide component */
export const SKILL_ICON_MAP: Record<string, LucideIcon> = {
  'scroll-text': ScrollText,
  globe: Globe,
  car: Car,
  'file-search': FileSearch,
  sparkles: Sparkles,
  'user-round': UserRound,
  clapperboard: Clapperboard,
  film: Film,
  wand: Wand2,
  'pen-tool': PenTool,
  tv: Tv,
};
