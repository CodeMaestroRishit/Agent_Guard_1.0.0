// Simulator page-specific JavaScript
function setupSimulator() {
  const form = document.getElementById("sim-form");
  if (!form) return;
  
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    
    const payload = {
      agent_id: data.get("agent_id"),
      agent_roles: (data.get("agent_roles") || "").split(",").map(s => s.trim()).filter(Boolean),
      tool_id: data.get("tool_id"),
      tool_version: data.get("tool_version") || "1.0.0",
      params: (() => {
        try {
          return JSON.parse(data.get("params") || "{}");
        } catch (e) {
          return {};
        }
      })(),
      request_id: data.get("request_id") || ("rid-" + Math.random().toString(36).slice(2, 9))
    };
    
    const display = document.getElementById("sim-result");
    const submitBtn = form.querySelector('button[type="submit"]');
    
    display.textContent = "Sending request...";
    display.style.background = "transparent";
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    
    try {
      const res = await fetch(`${BASE_URL}/enforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const body = await res.json();
      display.textContent = JSON.stringify(body, null, 2);
      
      const decision = (body.decision || "").toLowerCase();
      if (decision === "allow") {
        display.style.background = "linear-gradient(90deg, rgba(22, 163, 74, 0.1), transparent)";
        display.style.borderLeft = "4px solid var(--success-color)";
      } else {
        display.style.background = "linear-gradient(90deg, rgba(220, 38, 38, 0.1), transparent)";
        display.style.borderLeft = "4px solid var(--danger-color)";
      }
    } catch (err) {
      display.textContent = "Error: " + err.message;
      display.style.background = "transparent";
      display.style.borderLeft = "4px solid var(--warning-color)";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enforce";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setActiveNavLink();
  setupSimulator();
});

