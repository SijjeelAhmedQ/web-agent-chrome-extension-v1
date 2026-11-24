import type { AgentAvatar as Avatar } from '@/shared/types/config';
import { NamedIcon } from './icons';

/** The four-point sparkle, drawn as an astroid so it stays crisp at any size. */
export function Sparkle({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5C11.5 16.9 7.1 12.5 1.5 12 7.1 11.5 11.5 7.1 12 1.5Z"
      />
    </svg>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.32 }}>
      <Sparkle size={size * 0.56} />
    </span>
  );
}

export function AgentAvatar({ avatar, size = 28 }: { avatar: Avatar; size?: number }) {
  return (
    <span
      className="agent-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: `linear-gradient(140deg, ${avatar.color}, color-mix(in srgb, ${avatar.color} 70%, #0f172a))`,
      }}
    >
      <NamedIcon name={avatar.icon} size={size * 0.52} strokeWidth={2.1} />
    </span>
  );
}
