"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * A thin, NProgress-style progress bar at the top of the viewport.
 * Shows automatically whenever `active` is true, with a smooth
 * indeterminate crawl that accelerates on completion.
 *
 * Usage:
 *   <ProgressBar active={isLoading} />
 *
 * The bar crawls from 0% → ~90% while active (slowing down as
 * it approaches 90% to give the impression of "almost done"),
 * then snaps to 100% + fades out when `active` flips to false.
 */
export function ProgressBar({
  active,
  color = "var(--color-cluster-1, #5AB8B5)",
  height = 2,
}: {
  active: boolean;
  color?: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setWidth(0);
      let current = 0;
      timerRef.current = setInterval(() => {
        // Logarithmic crawl: fast at start, slows toward 90%
        const remaining = 90 - current;
        const increment = Math.max(0.5, remaining * 0.08);
        current = Math.min(90, current + increment);
        setWidth(current);
      }, 100);
    } else if (visible) {
      // Complete: snap to 100% then fade out
      if (timerRef.current) clearInterval(timerRef.current);
      setWidth(100);
      const t = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
      return () => clearTimeout(t);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active, visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height,
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          <motion.div
            style={{
              height: "100%",
              background: color,
              boxShadow: `0 0 8px ${color}80`,
              borderRadius: "0 1px 1px 0",
              width: `${width}%`,
              transition: width === 100
                ? "width 200ms cubic-bezier(0.22, 1, 0.36, 1)"
                : "width 100ms linear",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Inline progress bar for panels/sections. Not fixed-positioned —
 * flows with the layout.
 */
export function InlineProgress({
  active,
  color = "var(--color-cluster-1, #5AB8B5)",
  height = 2,
  className = "",
}: {
  active: boolean;
  color?: string;
  height?: number;
  className?: string;
}) {
  const [width, setWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      setWidth(0);
      let current = 0;
      timerRef.current = setInterval(() => {
        const remaining = 90 - current;
        current = Math.min(90, current + Math.max(0.5, remaining * 0.1));
        setWidth(current);
      }, 80);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (width > 0) {
        setWidth(100);
        setTimeout(() => setWidth(0), 300);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active]);

  if (width === 0 && !active) return null;

  return (
    <div
      className={className}
      style={{
        height,
        width: "100%",
        background: "rgba(255,255,255,0.04)",
        borderRadius: height,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${width}%`,
          background: color,
          borderRadius: height,
          transition: width === 100
            ? "width 200ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "width 80ms linear",
        }}
      />
    </div>
  );
}
