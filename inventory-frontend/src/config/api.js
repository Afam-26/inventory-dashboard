// Central API base URL (Vercel / Local)
const API_BASE = import.meta.env.VITE_API_BASE;

if (!API_BASE) {
  console.error("❌ VITE_API_BASE is not defined");
}

export default API_BASE;
