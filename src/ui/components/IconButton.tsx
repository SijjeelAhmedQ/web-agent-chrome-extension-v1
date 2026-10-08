import { Tooltip } from 'antd';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  children: ReactNode;
  tooltip?: boolean;
}

/** Square icon button with an accessible name and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ label, shortcut, children, tooltip = true, className, ...rest }, ref) {
  const button = (
    <button ref={ref} type="button" aria-label={label} className={`icon-btn ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip
      title={
        shortcut ? (
          <span>
            {label} <span style={{ opacity: 0.6, marginLeft: 6 }}>{shortcut}</span>
          </span>
        ) : (
          label
        )
      }
      mouseEnterDelay={0.4}
    >
      {button}
    </Tooltip>
  );
});
