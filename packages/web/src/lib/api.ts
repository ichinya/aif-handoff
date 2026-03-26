import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskEvent,
  TaskComment,
  CreateTaskCommentInput,
  Project,
  CreateProjectInput,
} from "@aif/shared/browser";

const API_BASE = "/tasks";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Projects
  listProjects(): Promise<Project[]> {
    console.debug("[api] GET /projects");
    return request<Project[]>("/projects");
  },

  createProject(input: CreateProjectInput): Promise<Project> {
    console.debug("[api] POST /projects", input);
    return request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateProject(id: string, input: CreateProjectInput): Promise<Project> {
    console.debug("[api] PUT /projects/%s", id, input);
    return request<Project>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteProject(id: string): Promise<void> {
    console.debug("[api] DELETE /projects/%s", id);
    return request(`/projects/${id}`, { method: "DELETE" });
  },

  // Tasks
  listTasks(projectId?: string): Promise<Task[]> {
    const qs = projectId ? `?projectId=${projectId}` : "";
    console.debug("[api] GET /tasks%s", qs);
    return request<Task[]>(`${API_BASE}${qs}`);
  },

  getTask(id: string): Promise<Task> {
    console.debug("[api] GET /tasks/%s", id);
    return request<Task>(`${API_BASE}/${id}`);
  },

  createTask(input: CreateTaskInput): Promise<Task> {
    console.debug("[api] POST /tasks", input);
    return request<Task>(API_BASE, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    console.debug("[api] PUT /tasks/%s", id, input);
    return request<Task>(`${API_BASE}/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  deleteTask(id: string): Promise<void> {
    console.debug("[api] DELETE /tasks/%s", id);
    return request(`${API_BASE}/${id}`, { method: "DELETE" });
  },

  taskEvent(id: string, event: TaskEvent): Promise<Task> {
    console.debug("[api] POST /tasks/%s/events →", id, event);
    return request<Task>(`${API_BASE}/${id}/events`, {
      method: "POST",
      body: JSON.stringify({ event }),
    });
  },

  listTaskComments(id: string): Promise<TaskComment[]> {
    console.debug("[api] GET /tasks/%s/comments", id);
    return request<TaskComment[]>(`${API_BASE}/${id}/comments`);
  },

  createTaskComment(id: string, input: CreateTaskCommentInput): Promise<TaskComment> {
    console.debug("[api] POST /tasks/%s/comments", id, input);
    return request<TaskComment>(`${API_BASE}/${id}/comments`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  reorderTask(id: string, position: number): Promise<Task> {
    console.debug("[api] PATCH /tasks/%s/position →", id, position);
    return request<Task>(`${API_BASE}/${id}/position`, {
      method: "PATCH",
      body: JSON.stringify({ position }),
    });
  },
};
