// Tools page-specific JavaScript
async function loadTools() {
  try {
    const el = document.getElementById("tool-list");
    if (!el) return;
    
    el.textContent = "Loading tools...";
    
    const tools = await fetchJSON("/tools");
    
    if (!Array.isArray(tools) || tools.length === 0) {
      el.textContent = "No tools found";
      return;
    }
    
    el.textContent = JSON.stringify(tools, null, 2);
  } catch (e) {
    console.error("loadTools", e);
    const el = document.getElementById("tool-list");
    if (el) {
      el.textContent = "Error loading tools: " + e.message;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setActiveNavLink();
  loadTools();
});

