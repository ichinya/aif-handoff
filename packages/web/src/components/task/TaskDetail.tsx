import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTask } from "@/hooks/useTasks";
import { ConfirmDialog } from "./ConfirmDialog";
import { TaskDescription } from "./TaskDescription";
import { TaskPlan } from "./TaskPlan";
import { TaskLog } from "./TaskLog";
import { AgentTimeline } from "./AgentTimeline";
import { TaskComments } from "./TaskComments";
import { TaskAttachments } from "./TaskAttachments";
import { PlanChangeDialog } from "./PlanChangeDialog";
import { TaskDetailHeader, type TaskDetailTab } from "./TaskDetailHeader";
import { Section } from "./Section";
import { useTaskDetailActions } from "./useTaskDetailActions";

interface TaskDetailProps {
  taskId: string | null;
  onClose: () => void;
}

export function TaskDetail({ taskId, onClose }: TaskDetailProps) {
  const { data: task } = useTask(taskId);
  const [selectedTab, setSelectedTab] = useState<TaskDetailTab | null>(null);
  const actions = useTaskDetailActions(task, onClose);
  const defaultTab: TaskDetailTab = task?.status === "review" ? "review" : "implementation";
  const activeTab: TaskDetailTab = selectedTab ?? defaultTab;

  return (
    <>
      <Sheet open={!!taskId} onOpenChange={() => onClose()}>
        <SheetContent className="h-full w-full overflow-hidden p-0 md:w-[88vw] md:max-w-none">
          {task && (
            <div className="flex h-full flex-col">
              <TaskDetailHeader
                task={task}
                activeTab={activeTab}
                onTabChange={setSelectedTab}
                onActionClick={actions.handleActionClick}
                isDisabled={actions.isSubmittingPlanChange}
                isCheckingStartAi={actions.isCheckingStartAiPlanFile}
                planChangeSuccess={actions.planChangeSuccess}
                onClose={onClose}
              />

              <div className="grid flex-1 gap-4 overflow-hidden p-4 md:grid-cols-2">
                {/* Left column */}
                <div className="space-y-4 overflow-y-auto pr-1">
                  <Section title="Description">
                    <TaskDescription
                      description={task.description}
                      onSave={(description) =>
                        actions.updateTask.mutate({ id: task.id, input: { description } })
                      }
                    />
                  </Section>

                  <Section title="Attachments">
                    <TaskAttachments
                      taskId={task.id}
                      attachments={task.attachments ?? []}
                      onFilesSelected={(files) => void actions.handleTaskAttachmentsSelected(files)}
                      onRemove={actions.handleRemoveTaskAttachment}
                    />
                  </Section>

                  <Section
                    title="Plan"
                    actions={
                      task.plan?.trim() ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => actions.setShowSyncPlanConfirm(true)}
                          disabled={actions.syncTaskPlanIsPending}
                        >
                          {actions.syncTaskPlanIsPending ? "Syncing..." : "Sync"}
                        </Button>
                      ) : undefined
                    }
                  >
                    <TaskPlan plan={task.plan} />
                  </Section>

                  <div className="border-t border-border pt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => actions.setShowDeleteConfirm(true)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Delete task
                    </Button>
                  </div>
                </div>

                {/* Right column */}
                <div className="space-y-4 overflow-y-auto pr-1">
                  {activeTab === "implementation" && (
                    <Section title="Implementation Log">
                      <TaskLog log={task.implementationLog} label="Implementation log" />
                    </Section>
                  )}
                  {activeTab === "review" && (
                    <Section title="Review Comments">
                      <TaskLog log={task.reviewComments} label="Review comments" />
                    </Section>
                  )}
                  {activeTab === "comments" && (
                    <Section title="Comments">
                      <TaskComments taskId={task.id} />
                    </Section>
                  )}
                  {activeTab === "activity" && (
                    <Section
                      title="Agent Activity"
                      actions={
                        task.agentActivityLog?.trim() ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => actions.setShowClearActivityConfirm(true)}
                            disabled={actions.updateTaskIsPending}
                          >
                            {actions.updateTaskIsPending ? "Clearing..." : "Clear log"}
                          </Button>
                        ) : undefined
                      }
                    >
                      <AgentTimeline activityLog={task.agentActivityLog} />
                    </Section>
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Toast notifications */}
      {actions.maintenanceSuccess && (
        <div className="fixed bottom-4 left-4 z-[70] border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {actions.maintenanceSuccess}
        </div>
      )}
      {actions.maintenanceError && (
        <div className="fixed bottom-4 right-4 z-[70] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actions.maintenanceError}
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={actions.showDeleteConfirm}
        onOpenChange={actions.setShowDeleteConfirm}
        title="Delete task?"
        description={`This action cannot be undone. The task "${task?.title ?? ""}" will be permanently deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={actions.handleDelete}
      />
      <ConfirmDialog
        open={actions.showClearActivityConfirm}
        onOpenChange={actions.setShowClearActivityConfirm}
        title="Clear agent activity log?"
        description="This action cannot be undone. All agent activity entries for this task will be removed."
        confirmLabel={actions.updateTaskIsPending ? "Clearing..." : "Clear"}
        variant="destructive"
        disabled={actions.updateTaskIsPending}
        onConfirm={actions.handleClearActivityLog}
      />
      <ConfirmDialog
        open={actions.showSyncPlanConfirm}
        onOpenChange={actions.setShowSyncPlanConfirm}
        title="Sync plan from file?"
        description="This will overwrite the current plan in DB with the content from the physical plan file."
        confirmLabel={actions.syncTaskPlanIsPending ? "Syncing..." : "Sync"}
        disabled={actions.syncTaskPlanIsPending}
        onConfirm={actions.handleSyncPlanFromFile}
      />
      <ConfirmDialog
        open={actions.showStartAiConfirm}
        onOpenChange={actions.setShowStartAiConfirm}
        title="Plan file already exists"
        description={`A plan file already exists${actions.startAiPlanPath ? ` (${actions.startAiPlanPath})` : ""}. AI will overwrite it. Continue?`}
        confirmLabel="Continue"
        onConfirm={() => {
          actions.setShowStartAiConfirm(false);
          actions.triggerStartAi();
        }}
      />
      <Dialog
        open={actions.showApproveDoneConfirm}
        onOpenChange={actions.setShowApproveDoneConfirm}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve done task?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The task will move from <strong>Done</strong> to <strong>Verified</strong>.
          </p>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={actions.deletePlanOnApprove}
              onChange={(event) => actions.setDeletePlanOnApprove(event.target.checked)}
            />
            Delete plan file ({task?.isFix ? "FIX_PLAN.md" : "PLAN.md"})
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                actions.setShowApproveDoneConfirm(false);
                actions.setDeletePlanOnApprove(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={actions.handleApproveDone}>
              Approve
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Plan change dialog */}
      <PlanChangeDialog
        open={actions.showReplanModal}
        mode={actions.planChangeMode}
        comment={actions.replanComment}
        onCommentChange={actions.setReplanComment}
        files={actions.replanFiles}
        onFilesChange={actions.setReplanFiles}
        isSubmitting={actions.isSubmittingPlanChange}
        error={actions.planChangeError}
        onSubmit={actions.handlePlanChangeRequest}
        onCancel={actions.resetReplanModal}
      />
    </>
  );
}
