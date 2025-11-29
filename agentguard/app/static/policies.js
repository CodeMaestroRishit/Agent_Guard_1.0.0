// Policies page-specific JavaScript
async function loadPolicies() {
  try {
    const el = document.getElementById("policy-list");
    if (!el) return;
    
    el.textContent = "Loading policies...";
    
    const policies = await fetchJSON("/policies");
    
    if (!Array.isArray(policies) || policies.length === 0) {
      el.textContent = "No policies found";
      return;
    }
    
    // Sort by created_at descending
    policies.sort((a, b) => {
      const ta = a.created_at || "";
      const tb = b.created_at || "";
      return ta < tb ? 1 : (ta > tb ? -1 : 0);
    });
    
    el.textContent = JSON.stringify(policies, null, 2);
  } catch (e) {
    console.error("loadPolicies", e);
    const el = document.getElementById("policy-list");
    if (el) {
      el.textContent = "Error loading policies: " + e.message;
    }
  }
}

function setupPolicyApply() {
  const textarea = document.getElementById("policy-input");
  const button = document.getElementById("apply-policy-btn");
  if (!textarea || !button) return;

  button.addEventListener("click", async () => {
    let payload;
    try {
      payload = JSON.parse(textarea.value);
      if (Array.isArray(payload)) {
        payload = { rules: payload };
      }
    } catch (e) {
      alert("Invalid JSON: " + e.message);
      return;
    }

    button.disabled = true;
    button.textContent = "Applying...";

    try {
      const res = await fetch(`${BASE_URL}/policies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const text = await res.text();
        alert(`Failed to apply policy (${res.status}): ${text}`);
        return;
      }
      
      alert("Policy applied successfully!");
      textarea.value = "";
      loadPolicies();
    } catch (err) {
      alert("Network error while applying policy: " + err);
    } finally {
      button.disabled = false;
      button.textContent = "Apply Policy";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setActiveNavLink();
  loadPolicies();
  setupPolicyApply();
});

