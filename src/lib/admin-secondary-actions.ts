type ActionOptions = {
  key: string;
  pending: Set<string>;
  confirm?: () => boolean;
  mutate: () => PromiseLike<{ error: unknown }>;
  failureMessage: string | ((error: unknown) => string);
  refreshFailureMessage: string;
  refresh: () => unknown | Promise<unknown>;
  onBusyChange: () => void;
  onError: (message: string) => void;
  onRefreshError?: (message: string) => void;
  onStart?: () => void;
  onSuccess?: () => void;
};

// Synchronous protection covers repeated invocations before React renders disabled controls.
// Keep the write and refresh in separate failure boundaries: a saved change stays saved.
export async function runAdminSecondaryAction(options: ActionOptions): Promise<void> {
  const { key, pending, onBusyChange, onError, failureMessage } = options;
  if (pending.has(key) || (options.confirm && !options.confirm())) return;
  pending.add(key);
  onBusyChange();
  try {
    options.onStart?.();
    try {
      const { error } = await options.mutate();
      if (error) throw error;
    } catch (error) {
      onError(typeof failureMessage === "string" ? failureMessage : failureMessage(error));
      return;
    }
    options.onSuccess?.();
    try {
      await options.refresh();
    } catch {
      (options.onRefreshError ?? onError)(options.refreshFailureMessage);
    }
  } finally {
    pending.delete(key);
    onBusyChange();
  }
}

export function blogCategoryErrorMessage(action: "save" | "delete", error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (action === "save" && code === "23505") {
    return "A blog category with that name or slug already exists.";
  }
  if (action === "delete" && code === "23503") {
    return "This blog category is still referenced by one or more posts and cannot be deleted.";
  }
  if (code === "42501") return `You do not have permission to ${action} this blog category.`;
  return `Could not ${action} this blog category. Please try again.`;
}
