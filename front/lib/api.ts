export const API_URL = process.env.NEXT_PUBLIC_API_URL
  || (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:4000/api`
    : "http://localhost:4000/api");

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("news-builder-token");
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "خطا در ارتباط با سرور");
  return data as T;
}

export function logout() {
  localStorage.removeItem("news-builder-token");
  window.location.reload();
}
