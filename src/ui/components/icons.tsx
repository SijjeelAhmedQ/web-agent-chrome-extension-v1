import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  ClipboardList,
  ClipboardPen,
  Compass,
  CornerDownLeft,
  Eraser,
  FileText,
  Globe,
  GraduationCap,
  Hourglass,
  Keyboard,
  Layers,
  ListChecks,
  ListTree,
  Mail,
  MousePointer2,
  MousePointerClick,
  PenLine,
  Plug,
  ScanText,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  SquarePlus,
  SquareX,
  Stethoscope,
  TextSearch,
  TextSelect,
  Wand,
  Webhook,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

/** Icons referenced by name from config (agent avatars, tool catalogue, suggestions). */
const ICONS: Record<string, LucideIcon> = {
  ArrowDownUp, ArrowLeft, ArrowLeftRight, ArrowRight, BookOpen, Bot, Briefcase, ClipboardList, ClipboardPen, Compass,
  CornerDownLeft, Eraser, FileText, Globe, GraduationCap, Hourglass, Keyboard, Layers, ListChecks, ListTree, Mail, MousePointer2, MousePointerClick, PenLine,
  Plug, ScanText, Search, Shield, ShoppingBag, Sparkles, SquarePlus, SquareX, Stethoscope, TextSearch, TextSelect, Wand, Webhook,
};

export function NamedIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon aria-hidden {...props} />;
}
