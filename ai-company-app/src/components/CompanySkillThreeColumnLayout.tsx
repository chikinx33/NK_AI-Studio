import type { ReactNode } from "react";

export interface CompanySkillWorkspaceSlots {
  OverviewFields: ReactNode;
  PreviewRenderer: ReactNode;
  PreviewToolbar?: ReactNode;
  ReportRenderer: ReactNode;
  CompletionActions?: ReactNode;
  ApprovalPanel?: ReactNode;
}

export default function CompanySkillThreeColumnLayout({ slots }: { slots: CompanySkillWorkspaceSlots }) {
  return (
    <div
      data-company-skill-layout="three-column"
      className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[320px_minmax(0,1fr)_290px] xl:overflow-hidden"
    >
      <aside className="border-b border-edge p-3 xl:overflow-hidden xl:border-b-0 xl:border-r">
        <div className="h-full rounded-xl border border-edge bg-panel p-3">
          <div data-skill-slot="OverviewFields">{slots.OverviewFields}</div>
          {slots.ApprovalPanel ? <div data-skill-slot="ApprovalPanel">{slots.ApprovalPanel}</div> : null}
        </div>
      </aside>

      <main className="min-w-0 p-3 xl:overflow-hidden">
        <div className="mx-auto flex h-full max-w-5xl flex-col">
          {slots.PreviewToolbar ? <div data-skill-slot="PreviewToolbar">{slots.PreviewToolbar}</div> : null}
          <div data-skill-slot="PreviewRenderer" className="min-h-0 flex-1">{slots.PreviewRenderer}</div>
        </div>
      </main>

      <aside className="flex flex-col border-t border-edge p-3 xl:overflow-hidden xl:border-l xl:border-t-0">
        <div data-skill-slot="ReportRenderer" className="min-h-0 flex-1">{slots.ReportRenderer}</div>
        {slots.CompletionActions ? (
          <div data-skill-slot="CompletionActions" className="mt-auto pt-3">{slots.CompletionActions}</div>
        ) : null}
      </aside>
    </div>
  );
}
