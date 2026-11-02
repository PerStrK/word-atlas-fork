import { useSyncExternalStore } from "react";

export interface AuthUser {
  username: string;
  role: "admin" | "user";
}
export type SyncState = "off" | "idle" | "syncing" | "error";

const BASE = `${import.meta.env.BASE_URL}api`;

let user: AuthUser | null = null;
let syncState: SyncState = "off";
let registerOpen = true;
interface AuthSnapshot {
  user: AuthUser | null;
  syncState: SyncState;
  registerOpen: boolean;
}
let snapshot: AuthSnapshot = { user, syncState, registerOpen };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { user, syncState, registerOpen };
  listeners.forEach((l) => l());
}

export const auth = {
  get: () => snapshot,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  setUser(u: AuthUser | null) {
    user = u;
    if (!u) syncState = "off";
    emit();
  },
  setSync(s: SyncState) {
    if (syncState !== s) {
      syncState = s;
      emit();
    }
  },
  setRegisterOpen(v: boolean) {
    registerOpen = v;
    emit();
  },
};

export function useAuth() {
  return useSyncExternalStore(auth.subscribe, auth.get, auth.get);
}

export class ApiError extends Error {
  status = 0;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("连不上服务器，检查网络后再试。");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const e = new ApiError(data?.error || `请求失败（${res.status}）`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const apiGet = (p: string) => api(p);
export const apiPost = (p: string, body?: unknown) =>
  api(p, { method: "POST", body: JSON.stringify(body ?? {}) });
export const apiPut = (p: string, body: unknown) =>
  api(p, { method: "PUT", body: JSON.stringify(body) });

export async function fetchRegisterOpen(): Promise<boolean> {
  try {
    const d = await apiGet("/settings");
    const v = !!d.register_open;
    auth.setRegisterOpen(v);
    return v;
  } catch {
    return registerOpen;
  }
}

export async function refreshMe(): Promise<AuthUser | null> {
  try {
    const d = await apiGet("/auth/me");
    const u = { username: d.username, role: d.role } as AuthUser;
    auth.setUser(u);
    return u;
  } catch {
    auth.setUser(null);
    return null;
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const d = await apiPost("/auth/login", { username, password });
  const u = { username: d.username, role: d.role } as AuthUser;
  auth.setUser(u);
  return u;
}

export async function register(username: string, password: string): Promise<AuthUser> {
  const d = await apiPost("/auth/register", { username, password });
  const u = { username: d.username, role: d.role } as AuthUser;
  auth.setUser(u);
  return u;
}

export async function logout(): Promise<void> {
  try {
    await apiPost("/auth/logout");
  } catch {
    /* ignore */
  }
  auth.setUser(null);
}
