"use client";

import Link from "next/link";
import { useStore } from "@/state/store";
import { LESSONS } from "@/lib/lessons";
import SchemaLogo from "@/components/SchemaLogo";

const STEPS: { icon: string; title: string; body: string }[] = [
  {
    icon: "stacks",
    title: "Three depth levels",
    body: "Switch between Architecture, Modules, and Detail to see the same repo at three altitudes.",
  },
  {
    icon: "ads_click",
    title: "Click to inspect, double-click to drill",
    body: "Click any cluster, file or function to inspect it. Double-click drills one level deeper.",
  },
  {
    icon: "lightbulb",
    title: "Problems panel lists issues",
    body: "The Problems panel lists architectural issues and suggests fixes. Click one to jump to the affected nodes and run a typed plan.",
  },
];

export default function Onboarding() {
  const dismissed = useStore((s) => s.onboardingDismissed);
  const completed = useStore((s) => s.completedLessons);
  const dismiss = useStore((s) => s.dismissOnboarding);

  const allLessonsDone = completed.length === LESSONS.length;

  if (dismissed) return null;

  return (
    <div
      data-testid="onboarding"
      className="absolute left-1/2 top-6 -translate-x-1/2 z-30 w-[min(94vw,760px)] border border-outline bg-surface/95 backdrop-blur shadow-xl"
    >
      <div className="px-5 py-3 border-b border-outline-variant flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <SchemaLogo className="w-5 h-5" />
          <span className="text-sm text-white">Welcome to Schema</span>
        </span>
        <div className="flex items-center gap-3">
          {!allLessonsDone && (
            <Link
              href="/tutorial"
              data-testid="onboarding-start-tour"
              className="px-3 py-1 rounded-md border border-schema-accent/40 text-schema-accent hover:bg-schema-accent/10 hover:border-schema-accent/70 transition-colors text-xs"
            >
              Start tour
            </Link>
          )}
          <button
            onClick={() => dismiss()}
            data-testid="onboarding-dismiss"
            className="text-xs text-neutral-300 hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-outline-variant/50">
        {STEPS.map((s) => (
          <div key={s.title} className="bg-surface px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[18px] text-schema-accent leading-none">
                {s.icon}
              </span>
              <p className="text-sm text-white">{s.title}</p>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
