// Common utilities shared across all pages
const BASE_URL = (window && window.location && window.location.origin) 
  ? window.location.origin 
  : "http://localhost:5073";

async function fetchJSON(path, opts = {}) {
  const url = path.startsWith("http") 
    ? path 
    : (BASE_URL + (path.startsWith("/") ? path : "/" + path));
  
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    try { 
      return JSON.parse(text); 
    } catch (e) { 
      return { error: `HTTP ${res.status}`, body: text }; 
    }
  }
  return res.json();
}

function formatDate(dateString) {
  if (!dateString) return "-";
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch (e) {
    return dateString;
  }
}

function setActiveNavLink() {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });
}

