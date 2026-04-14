const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const getPlanningToken = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("planning_session");
};

const handleUnauthorized = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) {
    return;
  }
  window.localStorage.removeItem("planning_session");
  document.cookie = "planning_session=; path=/; max-age=0";
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
