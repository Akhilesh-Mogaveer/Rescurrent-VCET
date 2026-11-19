import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
/* ==========================================================================
   1. TIMING HOOKS
   ========================================================================== */

/**
 * useDelayedLoading:
 * Show the skeleton only if loading lasts longer than `delay` (default 200ms).
 * Once shown, keep it visible for at least `minVisible` (default 350ms) to prevent UI flash.
 */
export function useDelayedLoading(
  isLoading: boolean,
  options: { delay?: number; minVisible?: number } = {}
): boolean {
  const { delay = 200, minVisible = 350 } = options;
  const [shouldShow, setShouldShow] = useState(false);
  const shownAtRef = useRef<number | null>(null);
  const delayTimerRef = useRef<any>(null);
  const minVisibleTimerRef = useRef<any>(null);

  useEffect(() => {
    if (isLoading) {
      if (minVisibleTimerRef.current) {
        clearTimeout(minVisibleTimerRef.current);
        minVisibleTimerRef.current = null;
      }
      delayTimerRef.current = setTimeout(() => {
        shownAtRef.current = Date.now();
        setShouldShow(true);
      }, delay);
    } else {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      if (shownAtRef.current !== null) {
        const elapsed = Date.now() - shownAtRef.current;
        if (elapsed < minVisible) {
          minVisibleTimerRef.current = setTimeout(() => {
            setShouldShow(false);
            shownAtRef.current = null;
          }, minVisible - elapsed);
        } else {
          setShouldShow(false);
          shownAtRef.current = null;
        }
      } else {
        setShouldShow(false);
      }
    }

    return () => {
      if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
      if (minVisibleTimerRef.current) clearTimeout(minVisibleTimerRef.current);
    };
  }, [isLoading, delay, minVisible]);

  return shouldShow;
}

/**
 * useLoadTimeout:
 * Automatically triggers error state if loading runs continuously for 20 seconds.
 */
export function useLoadTimeout(
  isLoading: boolean,
  onTimeout: () => void,
  timeoutMs: number = 20000
) {
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [isLoading, onTimeout, timeoutMs]);
}

/* ==========================================================================
   2. SHARED SKELETON PRIMITIVES
   ========================================================================== */

export interface SkeletonBlockProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const SkeletonBlock: React.FC<SkeletonBlockProps> = ({
  width,
  height,
  radius = 6,
  className = '',
  style = {},
}) => {
  return (
    <div
      aria-hidden="true"
      className={`bg-[#e5e7eb] skeleton-pulse ${className}`}
      style={{
        width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : '100%',
        height: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : '1rem',
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        ...style,
      }}
    />
  );
};

export const SkeletonText: React.FC<{
  lines?: number;
  className?: string;
  lineHeight?: number;
}> = ({ lines = 3, className = '', lineHeight = 14 }) => {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          height={lineHeight}
          width={i === lines - 1 && lines > 1 ? '65%' : '100%'}
        />
      ))}
    </div>
  );
};

export const SkeletonKpiStrip: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div
      aria-hidden="true"
      aria-busy="true"
      className={`grid grid-cols-1 md:grid-cols-4 bg-white border border-[#e5e7eb] rounded-[6px] overflow-hidden ${className}`}
    >
      {[
        { label: 'Monitored Plots', w: 60 },
        { label: 'Available Crews', w: 45 },
        { label: 'Attention Required', w: 50 },
        { label: 'Spray Break Window', w: 120 },
      ].map((item, i) => (
        <div
          key={i}
          className={`p-4 flex flex-col justify-center space-y-2.5 ${
            i < 3 ? 'border-b md:border-b-0 md:border-r border-[#e5e7eb]' : ''
          }`}
        >
          <SkeletonBlock height={12} width={item.w + 40} />
          <SkeletonBlock height={28} width={item.w} />
          <SkeletonBlock height={10} width={item.w + 20} />
        </div>
      ))}
    </div>
  );
};

export const SkeletonTable: React.FC<{
  rows?: number;
  cols?: number;
  headerLabels?: string[];
  className?: string;
}> = ({ rows = 5, cols = 4, headerLabels, className = '' }) => {
  const columnCount = headerLabels ? headerLabels.length : cols;

  return (
    <div
      aria-hidden="true"
      aria-busy="true"
      className={`bg-white border border-[#e5e7eb] rounded-[6px] overflow-hidden ${className}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
              {Array.from({ length: columnCount }).map((_, colIdx) => (
                <th key={colIdx} className="p-3.5">
                  <SkeletonBlock height={12} width={headerLabels ? undefined : '70%'} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e7eb]">
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                {Array.from({ length: columnCount }).map((_, colIdx) => (
                  <td key={colIdx} className="p-3.5">
                    <SkeletonBlock
                      height={14}
                      width={colIdx === 0 ? '85%' : colIdx === columnCount - 1 ? '50%' : '75%'}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const SkeletonCard: React.FC<{
  height?: string | number;
  className?: string;
  children?: React.ReactNode;
}> = ({ height, className = '', children }) => {
  return (
    <div
      aria-hidden="true"
      aria-busy="true"
      className={`bg-white border border-[#e5e7eb] rounded-[6px] p-5 space-y-4 ${className}`}
      style={{ minHeight: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : undefined }}
    >
      {children || (
        <>
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e7eb]">
            <SkeletonBlock height={18} width="40%" />
            <SkeletonBlock height={14} width="20%" />
          </div>
          <SkeletonText lines={4} />
        </>
      )}
    </div>
  );
};

export const SkeletonChart: React.FC<{
  height?: string | number;
  className?: string;
  title?: string;
}> = ({ height = 300, className = '' }) => {
  return (
    <div
      aria-hidden="true"
      aria-busy="true"
      className={`bg-white border border-[#e5e7eb] rounded-[6px] p-5 space-y-4 ${className}`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-[#e5e7eb]">
        <SkeletonBlock height={16} width="35%" />
        <SkeletonBlock height={14} width="25%" />
      </div>
      <div
        className="w-full flex items-end gap-3 pt-6 pb-2 px-4 bg-[#f9fafb] rounded-[6px]"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {[45, 75, 30, 90, 60, 40, 80, 55, 70, 85, 50, 65].map((h, idx) => (
          <div key={idx} className="flex-1 flex flex-col justify-end items-center h-full gap-2">
            <SkeletonBlock height={`${h}%`} width="100%" radius={4} />
            <SkeletonBlock height={8} width="80%" radius={2} />
          </div>
        ))}
      </div>
    </div>
  );
};

export const SkeletonMap: React.FC<{
  height?: string | number;
  className?: string;
}> = ({ height = 360, className = '' }) => {
  return (
    <div
      aria-hidden="true"
      aria-busy="true"
      className={`bg-white border border-[#e5e7eb] rounded-[6px] p-5 space-y-4 ${className}`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-[#e5e7eb]">
        <SkeletonBlock height={16} width="40%" />
        <SkeletonBlock height={14} width="20%" />
      </div>
      <div
        className="w-full bg-[#f3f4f6] rounded-[6px] flex flex-col items-center justify-center p-6 border border-[#e5e7eb]"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        <SkeletonBlock height={40} width={40} radius="50%" className="mb-3" />
        <SkeletonBlock height={14} width="30%" className="mb-2" />
        <SkeletonBlock height={10} width="45%" />
      </div>
    </div>
  );
};

export const GenericPageSkeleton: React.FC = () => {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="bg-white border border-[#e5e7eb] rounded-[6px] p-6 space-y-3">
        <SkeletonBlock height={24} width="40%" />
        <SkeletonBlock height={14} width="70%" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SkeletonCard height={180} />
        <SkeletonCard height={180} />
        <SkeletonCard height={180} />
      </div>
      <SkeletonTable rows={5} cols={5} />
    </div>
  );
};

/* ==========================================================================
   3. ERROR AND EMPTY STATE COMPONENTS
   ========================================================================== */

export interface InlineErrorProps {
  message?: string;
  target?: string;
  onRetry: () => void;
  className?: string;
}

export const InlineError: React.FC<InlineErrorProps> = ({
  message,
  target,
  onRetry,
  className = '',
}) => {
  const displayMessage = message || (target ? `Could not load ${target}.` : 'Could not load data.');

  return (
    <div
      role="status"
      aria-live="polite"
      className={`p-4 rounded-[6px] border border-red-200 bg-red-50/90 text-red-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{displayMessage}</span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 rounded-[6px] border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-800 transition cursor-pointer self-start sm:self-auto shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-700"
      >
        Retry
      </button>
    </div>
  );
};

export interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  to?: string;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  actionLabel,
  onAction,
  to,
  className = '',
}) => {
  return (
    <div
      className={`p-6 text-center text-xs text-stone-500 bg-white rounded-[6px] border border-[#e5e7eb] ${className}`}
    >
      <span>{message}</span>
      {actionLabel && (
        <span className="ml-2">
          {to ? (
            <Link
              to={to}
              className="font-semibold text-emerald-800 hover:text-emerald-950 underline focus:outline-none focus:ring-2 focus:ring-emerald-700 rounded"
            >
              {actionLabel}
            </Link>
          ) : onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="font-semibold text-emerald-800 hover:text-emerald-950 underline cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-700 rounded"
            >
              {actionLabel}
            </button>
          ) : null}
        </span>
      )}
    </div>
  );
};

/* ==========================================================================
   4. LONG-RUNNING ACTION STATUS COMPONENT (Honest Progress)
   ========================================================================== */

export interface ActionStatusLineProps {
  isRunning: boolean;
  actionName: string; // e.g. "Optimizing", "Simulating", "Comparing policies", "Replanning", "Fetching live ensemble"
  timeLimit?: number; // e.g. 10
  isDone?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export const ActionStatusLine: React.FC<ActionStatusLineProps> = ({
  isRunning,
  actionName,
  timeLimit,
  isDone = false,
  error = null,
  onRetry,
  className = '',
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning && !isDone && !error) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`text-xs inline-flex items-center gap-2 ${className}`}
    >
      {isRunning && (
        <>
          <span className="text-stone-700 font-medium">
            {actionName}... {elapsed}s{timeLimit ? ` of up to ${timeLimit}s` : ''}
          </span>
        </>
      )}
      {!isRunning && isDone && (
        <span className="text-emerald-700 font-semibold flex items-center gap-1"> Done
        </span>
      )}
      {!isRunning && error && (
        <span className="text-red-700 font-medium flex items-center gap-2">
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="underline text-red-900 font-semibold hover:text-red-950 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-700"
            >
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  );
};
