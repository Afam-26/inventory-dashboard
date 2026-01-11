const API_BASE = "http://localhost:5000/api";

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || "Invalid server response");
  }
}

export async function getCategories() {
  const res = await fetch(`${API_BASE}/categories`);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load categories");
  return data;
}

export async function addCategory(name) {
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to add category");
  return data;
}

export async function getProducts() {
  const res = await fetch(`${API_BASE}/products`);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load products");
  return data;
}

export async function addProduct(payload) {
  const res = await fetch(`${API_BASE}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to add product");
  return data;
}

export async function updateStock(payload) {
  const res = await fetch(`${API_BASE}/stock/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Stock update failed");
  return data;
}

export async function getMovements() {
  const res = await fetch(`${API_BASE}/stock/movements`);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load movements");
  return data;
}
