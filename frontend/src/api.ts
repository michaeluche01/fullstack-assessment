import type { Order, Product } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || res.statusText);
  }
  return data as T;
}

export function listProducts(q?: string): Promise<Product[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<Product[]>(`/products${qs}`);
}

export function getProduct(id: number | string): Promise<Product> {
  return request<Product>(`/products/${id}`);
}

export function createOrder(body: {
  customerId: string;
  items: { productId: number; quantity: number }[];
  totalAmount: number;
}): Promise<Order> {
  return request<Order>("/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getOrder(id: number | string): Promise<Order> {
  return request<Order>(`/orders/${id}`);
}

export function chargeOrder(orderId: number): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/payments/charge`, {
    method: "POST",
    headers: {
      // Stable per order: retrying the same order sends the same key,
      // which hits the Redis cache and returns the cached result without
      // calling the gateway again.
      "Idempotency-Key": `charge-${orderId}`,
    },
    body: JSON.stringify({ orderId }),
  });
}

export function listOrdersAdmin(): Promise<Order[]> {
  return request<Order[]>(`/orders`);
}

export function updateProductAdmin(
  id: number,
  body: { price?: number; stock?: number; description?: string; name?: string },
): Promise<Product> {
  const token =
    localStorage.getItem("admin_token") ??
    import.meta.env.VITE_ADMIN_TOKEN ??
    "";
  return request<Product>(`/admin/products/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}
