// Dashboard-specific JavaScript
let allLogs = [];
let allPolicies = [];
let currentFilter = { agent_id: null, tool_id: null };
let selectedAgentId = null;

async function loadStats() {
  try {
    const [logs, policies] = await Promise.all([
      fetchJSON("/audit").catch(() => []),
      fetchJSON("/policies").catch(() => [])
    ]);

    allLogs = logs || [];
    allPolicies = policies || [];

    // Calculate stats
    const uniqueAgents = new Set(allLogs.map(log => log.agent_id).filter(Boolean));
    const totalRequests = allLogs.length;
    const threatsBlocked = allLogs.filter(log => 
      (log.decision || "").toLowerCase() !== "allow"
    ).length;
    const activePolicies = allPolicies.length;

    // Update stat cards
    document.getElementById("stat-total-agents").textContent = uniqueAgents.size;
    document.getElementById("stat-total-requests").textContent = totalRequests.toLocaleString();
    document.getElementById("stat-threats-blocked").textContent = threatsBlocked.toLocaleString();
    document.getElementById("stat-active-policies").textContent = activePolicies;
  } catch (e) {
    console.error("loadStats error", e);
  }
}

async function loadAgentAndToolPanels() {
  try {
    const [logs, tools] = await Promise.all([
      fetchJSON("/audit").catch(() => []),
      fetchJSON("/tools").catch(() => [])
    ]);

    allLogs = logs || [];
    const toolsData = tools || [];

    // Aggregate agents from audit logs
    const agentsMap = new Map();
    allLogs.forEach(log => {
      const agentId = log.agent_id;
      if (!agentId) return;

      if (!agentsMap.has(agentId)) {
        agentsMap.set(agentId, {
          agent_id: agentId,
          last_seen: log.created_at || "",
          allow_count: 0,
          block_count: 0,
          last_decision: null,
          last_policy: null
        });
      }

      const agent = agentsMap.get(agentId);
      const decision = (log.decision || "").toLowerCase();
      if (decision === "allow") {
        agent.allow_count++;
      } else {
        agent.block_count++;
      }

      // Update last_seen and last decision if this log is newer
      if (log.created_at && (!agent.last_seen || log.created_at > agent.last_seen)) {
        agent.last_seen = log.created_at;
        agent.last_decision = log.decision;
        agent.last_policy = log.policy_version;
      }
    });

    const agentsAggregated = Array.from(agentsMap.values()).sort((a, b) => {
      return (b.last_seen || "") > (a.last_seen || "") ? 1 : -1;
    });

    renderAgentsPanel(agentsAggregated);
    renderToolsPanel(toolsData);
  } catch (e) {
    console.error("loadAgentAndToolPanels error", e);
  }
}

function getAgentStatus(lastSeen) {
  if (!lastSeen) return { status: "offline", label: "Offline", color: "red" };
  
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const minutesAgo = (now - lastSeenDate) / (1000 * 60);
  
  if (minutesAgo < 5) return { status: "online", label: "Online", color: "green" };
  if (minutesAgo < 30) return { status: "idle", label: "Idle", color: "yellow" };
  return { status: "offline", label: "Offline", color: "red" };
}

function renderAgentsPanel(agentsAggregated) {
  const container = document.getElementById("agents-list");
  const countEl = document.getElementById("agents-count");
  if (!container) return;

  countEl.textContent = agentsAggregated.length;

  const searchInput = document.getElementById("agent-search");
  let filteredAgents = agentsAggregated;

  const updateList = () => {
    const searchTerm = (searchInput?.value || "").toLowerCase();
    filteredAgents = agentsAggregated.filter(a => 
      (a.agent_id || "").toLowerCase().includes(searchTerm)
    );

    container.innerHTML = "";
    if (filteredAgents.length === 0) {
      container.innerHTML = "<div class='empty-state'>No agents found</div>";
      return;
    }

    filteredAgents.forEach(agent => {
      const item = document.createElement("div");
      item.className = "agent-card";
      if (currentFilter.agent_id === agent.agent_id) {
        item.classList.add("active");
      }
      item.setAttribute("tabindex", "0");
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `View agent ${agent.agent_id}`);

      const lastSeen = formatDate(agent.last_seen) || "Never";
      const status = getAgentStatus(agent.last_seen);
      const relativeTime = getRelativeTime(agent.last_seen);

      item.innerHTML = `
        <div class="agent-card-header">
          <div class="agent-name">${agent.agent_id || "-"}</div>
          <span class="status-pill status-${status.status}" title="${status.label}">
            <span class="status-dot"></span>
            ${status.label}
          </span>
        </div>
        <div class="agent-card-meta">
          <span class="text-small text-muted">Last seen: ${relativeTime}</span>
        </div>
        <div class="agent-card-stats">
          <span class="decision-badge badge-allow">
            <span class="badge-icon">✓</span>
            Allow: ${agent.allow_count}
          </span>
          <span class="decision-badge badge-deny">
            <span class="badge-icon">✗</span>
            Deny: ${agent.block_count}
          </span>
        </div>
      `;

      item.addEventListener("click", () => {
        setAgentFilter(agent.agent_id);
        openAgentDrawer(agent.agent_id);
      });

      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setAgentFilter(agent.agent_id);
          openAgentDrawer(agent.agent_id);
        }
      });

      container.appendChild(item);
    });
  };

  if (searchInput) {
    searchInput.addEventListener("input", updateList);
  }
  updateList();
}

function getRelativeTime(dateString) {
  if (!dateString) return "Never";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateString);
  } catch (e) {
    return dateString;
  }
}

function renderToolsPanel(tools) {
  const container = document.getElementById("tools-list");
  const countEl = document.getElementById("tools-count");
  if (!container) return;

  countEl.textContent = tools.length;

  container.innerHTML = "";
  if (tools.length === 0) {
    container.innerHTML = "<div class='empty-state'>No tools found</div>";
    return;
  }

  const toolCallCounts = new Map();
  allLogs.forEach(log => {
    const toolId = log.tool_id;
    if (toolId) {
      toolCallCounts.set(toolId, (toolCallCounts.get(toolId) || 0) + 1);
    }
  });

  const toolDescriptions = {
    "read_logs": "Reads audit logs",
    "list_tools": "Lists available tools",
    "get_policy": "Fetches policy details",
    "modify_policy": "Modifies policy entries",
    "execute_tool_wrapper": "Wraps tool execution",
    "run_shell_sim": "Simulated shell command",
    "read_sensitive_sim": "Simulated sensitive file read",
    "metrics_write": "Writes metrics data"
  };

  tools.forEach(tool => {
    const item = document.createElement("div");
    item.className = "tool-card";
    if (currentFilter.tool_id === tool.id) {
      item.classList.add("active");
    }
    item.setAttribute("tabindex", "0");
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Filter by tool ${tool.id}`);

    const toolId = tool.id || "-";
    const version = tool.version || "?";
    const exampleCallsCount = toolCallCounts.get(toolId) || 0;
    const signature = tool.signature || "";
    const sigHealth = signature && signature.length >= 32 ? "ok" : "missing";
    const description = toolDescriptions[toolId] || tool.description || "Tool description";

    item.innerHTML = `
      <div class="tool-card-header">
        <div class="tool-name">${toolId}</div>
        <span class="sig-indicator sig-${sigHealth}" title="Signature: ${sigHealth === 'ok' ? 'Valid' : 'Missing'}"></span>
      </div>
      <div class="tool-card-meta">
        <span class="text-small text-muted">v${version} • ${exampleCallsCount} calls</span>
      </div>
      <div class="tool-card-desc text-small text-muted">${description}</div>
    `;

    item.addEventListener("click", () => {
      setToolFilter(toolId);
    });

    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setToolFilter(toolId);
      }
    });

    container.appendChild(item);
  });
}

function setAgentFilter(agentId) {
  currentFilter.agent_id = agentId;
  currentFilter.tool_id = null;
  updateFilterPill();
  loadDashboard();
}

function setToolFilter(toolId) {
  currentFilter.tool_id = toolId;
  currentFilter.agent_id = null;
  updateFilterPill();
  loadDashboard();
}

function clearFilter() {
  currentFilter.agent_id = null;
  currentFilter.tool_id = null;
  updateFilterPill();
  loadDashboard();
}

function updateFilterPill() {
  const container = document.getElementById("filter-pill-container");
  const textEl = document.getElementById("filter-pill-text");

  if (currentFilter.agent_id) {
    container.style.display = "block";
    textEl.textContent = `Filtered: ${currentFilter.agent_id}`;
  } else if (currentFilter.tool_id) {
    container.style.display = "block";
    textEl.textContent = `Filtered: ${currentFilter.tool_id}`;
  } else {
    container.style.display = "none";
  }
}

function openAgentDrawer(agentId) {
  selectedAgentId = agentId;
  const drawer = document.getElementById("agent-drawer");
  const drawerName = document.getElementById("drawer-agent-name");
  const drawerTotalCalls = document.getElementById("drawer-total-calls");
  const drawerLastDecision = document.getElementById("drawer-last-decision");
  const drawerLastPolicy = document.getElementById("drawer-last-policy");
  const drawerLogs = document.getElementById("drawer-logs");

  if (!drawer) return;

  // Get agent data
  const agentLogs = allLogs.filter(log => log.agent_id === agentId);
  const totalCalls = agentLogs.length;
  const lastLog = agentLogs.sort((a, b) => 
    (b.created_at || "") > (a.created_at || "") ? 1 : -1
  )[0];

  drawerName.textContent = agentId;
  drawerTotalCalls.textContent = totalCalls;
  drawerLastDecision.textContent = lastLog?.decision || "-";
  drawerLastPolicy.textContent = lastLog?.policy_version || "-";

  // Render recent logs
  drawerLogs.innerHTML = "";
  agentLogs.slice(0, 10).forEach(log => {
    const logItem = document.createElement("div");
    logItem.className = "drawer-log-item";
    const decision = (log.decision || "").toLowerCase();
    logItem.innerHTML = `
      <div class="drawer-log-decision decision-pill decision-${decision}">
        ${log.decision || "-"}
      </div>
      <div class="drawer-log-details">
        <div class="drawer-log-tool">${log.tool_id || "-"}</div>
        <div class="drawer-log-meta text-small text-muted">
          ${log.reason || "-"} • ${formatDate(log.created_at)}
        </div>
      </div>
    `;
    drawerLogs.appendChild(logItem);
  });

  drawer.classList.add("open");
}

function closeAgentDrawer() {
  const drawer = document.getElementById("agent-drawer");
  if (drawer) {
    drawer.classList.remove("open");
  }
}

async function loadDashboard() {
  try {
    const logs = await fetchJSON("/audit");
    const tbody = document.querySelector("#audit-table tbody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    // Apply filters
    let filteredLogs = logs || [];
    
    // Time range filter
    const timeRange = document.getElementById("time-range-filter")?.value || "all";
    if (timeRange !== "all") {
      const now = new Date();
      let cutoff = new Date();
      if (timeRange === "5m") cutoff.setMinutes(now.getMinutes() - 5);
      else if (timeRange === "1h") cutoff.setHours(now.getHours() - 1);
      else if (timeRange === "24h") cutoff.setHours(now.getHours() - 24);
      
      filteredLogs = filteredLogs.filter(log => {
        if (!log.created_at) return false;
        return new Date(log.created_at) >= cutoff;
      });
    }
    
    // Decision filter
    const decisionFilter = document.getElementById("decision-filter")?.value || "all";
    if (decisionFilter !== "all") {
      filteredLogs = filteredLogs.filter(log => 
        (log.decision || "").toLowerCase() === decisionFilter
      );
    }
    
    // Search filter
    const searchTerm = (document.getElementById("audit-search")?.value || "").toLowerCase();
    if (searchTerm) {
      filteredLogs = filteredLogs.filter(log =>
        (log.agent_id || "").toLowerCase().includes(searchTerm) ||
        (log.tool_id || "").toLowerCase().includes(searchTerm) ||
        (log.reason || "").toLowerCase().includes(searchTerm)
      );
    }
    
    if (currentFilter.agent_id) {
      filteredLogs = filteredLogs.filter(log => log.agent_id === currentFilter.agent_id);
    }
    if (currentFilter.tool_id) {
      filteredLogs = filteredLogs.filter(log => log.tool_id === currentFilter.tool_id);
    }
    
    if (filteredLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No audit logs found${currentFilter.agent_id || currentFilter.tool_id ? " (filtered)" : ""}</td></tr>`;
      return;
    }
    
    filteredLogs.slice(0, 100).forEach((log, index) => {
      const tr = document.createElement("tr");
      const decision = (log.decision || "").toLowerCase();
      tr.className = `audit-row ${decision === "allow" ? "row-allow" : "row-block"}`;
      tr.style.animationDelay = `${index * 0.01}s`;
      
      const decisionIcon = decision === "allow" ? "✓" : "✗";
      const reasonClass = log.reason ? "reason-pill" : "";
      
      tr.innerHTML = `
        <td><strong>${log.agent_id || "-"}</strong></td>
        <td>
          <div>${log.tool_id || "-"}</div>
          <div class="text-small text-muted">v${log.tool_version || "?"}</div>
        </td>
        <td>
          <span class="decision-pill decision-${decision}">
            <span class="decision-icon">${decisionIcon}</span>
            ${log.decision || "-"}
          </span>
        </td>
        <td>
          <span class="${reasonClass}">${log.reason || "-"}</span>
        </td>
        <td class="text-right text-small text-muted">${formatDate(log.created_at)}</td>
      `;
      tbody.appendChild(tr);
    });

    const anomalies = await fetchJSON("/anomalies");
    const list = document.getElementById("anomaly-list");
    if (list) {
      list.innerHTML = "";
      if (!anomalies || anomalies.length === 0) {
        list.innerHTML = "<li class='text-muted'>No anomalies detected</li>";
      } else {
        anomalies.forEach(a => {
          const li = document.createElement("li");
          li.innerHTML = `
            <strong>${a.agent_id || "?"}</strong>
            <div class="text-small text-muted">${a.detail || JSON.stringify(a)}</div>
            <div class="text-small text-muted">${formatDate(a.created_at)}</div>
          `;
          list.appendChild(li);
        });
      }
    }
  } catch (e) {
    console.error("loadDashboard error", e);
    const tbody = document.querySelector("#audit-table tbody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Error loading audit logs</td></tr>`;
    }
  }
}

// Dark Mode Functions
function initDarkMode() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  const html = document.documentElement;
  
  if (savedTheme === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else {
    html.removeAttribute('data-theme');
  }
  
  updateDarkModeIcon();
}

function toggleDarkMode() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme');
  
  if (currentTheme === 'dark') {
    html.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    html.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  
  updateDarkModeIcon();
}

function updateDarkModeIcon() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const darkIcon = document.querySelector('.dark-mode-icon');
  const lightIcon = document.querySelector('.light-mode-icon');
  
  if (darkIcon && lightIcon) {
    if (isDark) {
      darkIcon.style.display = 'none';
      lightIcon.style.display = 'inline-block';
    } else {
      darkIcon.style.display = 'inline-block';
      lightIcon.style.display = 'none';
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setActiveNavLink();
  
  // Initialize dark mode
  initDarkMode();
  
  // Setup dark mode toggle
  const darkModeToggle = document.getElementById("dark-mode-toggle");
  if (darkModeToggle) {
    darkModeToggle.addEventListener("click", toggleDarkMode);
  }
  
  // Setup clear filter button
  const clearBtn = document.getElementById("clear-filter-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearFilter);
  }

  // Setup drawer close
  const drawer = document.getElementById("agent-drawer");
  const drawerClose = document.querySelector(".drawer-close");
  const drawerOverlay = document.querySelector(".drawer-overlay");
  
  if (drawerClose) {
    drawerClose.addEventListener("click", closeAgentDrawer);
  }
  if (drawerOverlay) {
    drawerOverlay.addEventListener("click", closeAgentDrawer);
  }

  // Setup audit controls
  const timeRangeFilter = document.getElementById("time-range-filter");
  const decisionFilter = document.getElementById("decision-filter");
  const auditSearch = document.getElementById("audit-search");

  if (timeRangeFilter) {
    timeRangeFilter.addEventListener("change", loadDashboard);
  }
  if (decisionFilter) {
    decisionFilter.addEventListener("change", loadDashboard);
  }
  if (auditSearch) {
    auditSearch.addEventListener("input", loadDashboard);
  }

  // Load all data
  loadStats();
  loadAgentAndToolPanels();
  loadDashboard();
  
  // Auto-refresh every 5 seconds
  setInterval(() => {
    loadStats();
    loadAgentAndToolPanels();
    loadDashboard();
  }, 5000);
});
