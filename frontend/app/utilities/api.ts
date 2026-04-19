const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const SESSION_KEY = "planning_session";
const SESSION_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 7;

function readSessionCookie() {
  if (typeof window === "undefined") return null;
  const part = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_KEY}=`));
  if (!part) return null;
  return decodeURIComponent(part.slice(SESSION_KEY.length + 1));
}

function writeSessionCookie(token: string) {
  document.cookie = `${SESSION_KEY}=${encodeURIComponent(token)}; path=/; max-age=${SESSION_COOKIE_TTL_SECONDS}; samesite=lax`;
}

export function clearPlanningSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
  document.cookie = `${SESSION_KEY}=; path=/; max-age=0`;
}

export function setPlanningSession(token: string) {
  if (typeof window === "undefined") return;
  const cleanedToken = token.trim();
  if (!cleanedToken) return;
  window.localStorage.setItem(SESSION_KEY, cleanedToken);
  writeSessionCookie(cleanedToken);
}

export function getPlanningToken() {
  if (typeof window === "undefined") return null;

  const cookieToken = readSessionCookie()?.trim() ?? "";
  if (!cookieToken) {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }

  const localStorageToken = window.localStorage.getItem(SESSION_KEY)?.trim() ?? "";
  if (localStorageToken !== cookieToken) {
    window.localStorage.setItem(SESSION_KEY, cookieToken);
  }

  return cookieToken;
}

export function hasPlanningSession() {
  return getPlanningToken() !== null;
}

const handleUnauthorized = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) {
    return;
  }
  clearPlanningSession();
  window.location.href = "/login";
};

type RequestBody = Record<string, unknown> | Array<unknown>;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: RequestBody;
};

async function request(path: string, options: RequestOptions = {}) {
  const token = getPlanningToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    handleUnauthorized();
  }

  return res;
}

export async function get(path: string) {
  return request(path);
}

export async function post(path: string, body: RequestBody) {
  return request(path, { method: "POST", body });
}

export async function put(path: string, body: RequestBody) {
  return request(path, { method: "PUT", body });
}

export async function patch(path: string, body: RequestBody) {
  return request(path, { method: "PATCH", body });
}

export async function del(path: string) {
  return request(path, { method: "DELETE" });
}
