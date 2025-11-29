// AgentGuard Dashboard - Unified JavaScript
const BASE_URL = (window && window.location && window.location.origin) 
  ? window.location.origin 
  : "http://localhost:5073";

// State
let currentFilters = { agent_id: null, tool_id: null, role: null };
let auditData = [];
let agentsData = new Map();
let toolsData = new Map();
let currentTab = 'overview';
let auditPageSize = 50;
let auditOffset = 0;

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  initTabs();
  initSidebar();
  loadOverviewTab();
  
  // Dark mode toggle
  const toggle = document.getElementById('dark-mode-toggle');
  if (toggle) {
    toggle.addEventListener('click', toggleDarkMode);
  }
  
  // Modal close handlers
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', closeModal);
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
});

// ============================================================================
// Dark Mode
// ============================================================================

function initDarkMode() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateDarkModeIcon();
}

function toggleDarkMode() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateDarkModeIcon();
}

function updateDarkModeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const darkIcon = document.querySelector('.dark-mode-icon');
  const lightIcon = document.querySelector('.light-mode-icon');
  if (darkIcon && lightIcon) {
    darkIcon.style.display = isDark ? 'none' : 'inline-block';
    lightIcon.style.display = isDark ? 'inline-block' : 'none';
  }
}

// ============================================================================
// Tab Management
// ============================================================================

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    const tab = e.state?.tab || 'overview';
    switchTab(tab, false);
  });
  
  // Initialize from URL hash
  const hash = window.location.hash.slice(1);
  if (hash && ['overview', 'anomalies', 'policies', 'tools', 'simulator', 'ai-policy'].includes(hash)) {
    switchTab(hash, false);
  }
}

function switchTab(tabName, pushState = true) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Remove active from all buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected tab
  const tabContent = document.getElementById(`tab-${tabName}`);
  const tabButton = document.querySelector(`[data-tab="${tabName}"]`);
  
  if (tabContent) {
    tabContent.classList.add('active');
    currentTab = tabName;
  }
  
  if (tabButton) {
    tabButton.classList.add('active');
  }
  
  // Update URL
  if (pushState) {
    window.history.pushState({ tab: tabName }, '', `#${tabName}`);
  }
  
  // Load tab content
  switch(tabName) {
    case 'overview':
      loadOverviewTab();
      break;
    case 'anomalies':
      loadAnomaliesTab();
      break;
    case 'policies':
      loadPoliciesTab();
      break;
    case 'tools':
      loadToolsTab();
      break;
    case 'simulator':
      loadSimulatorTab();
      break;
    case 'ai-policy':
      loadAIPolicyTab();
      break;
  }
}

// ============================================================================
// Sidebar Management
// ============================================================================

function initSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      localStorage.setItem('agentguard_sidebar_collapsed', collapsed);
    });
    
    // Restore collapsed state
    const saved = localStorage.getItem('agentguard_sidebar_collapsed');
    if (saved === 'true') {
      sidebar.classList.add('collapsed');
    }
  }
}

// ============================================================================
// Overview Tab
// ============================================================================

async function loadOverviewTab() {
  await Promise.all([
    loadAgentAndToolPanels(),
    loadDashboard()
  ]);
  loadAnomaliesPreview();
}

async function loadAgentAndToolPanels() {
  try {
    const [auditLogs, tools] = await Promise.all([
      fetchJSON('/audit').catch(() => []),
      fetchJSON('/tools').catch(() => [])
    ]);
    
    // Aggregate agents
    const agentsAgg = new Map();
    auditLogs.forEach(log => {
      if (!log.agent_id) return;
      const agentId = log.agent_id;
      if (!agentsAgg.has(agentId)) {
        agentsAgg.set(agentId, {
          agent_id: agentId,
          last_seen: log.created_at,
          allow_count: 0,
          block_count: 0,
          roles: new Set()
        });
      }
      const agent = agentsAgg.get(agentId);
      if (log.decision === 'ALLOW') agent.allow_count++;
      else if (log.decision === 'BLOCK' || log.decision === 'DENY') agent.block_count++;
      if (log.roles) {
        log.roles.split(',').forEach(r => agent.roles.add(r.trim()));
      }
      if (new Date(log.created_at) > new Date(agent.last_seen)) {
        agent.last_seen = log.created_at;
      }
    });
    
    agentsData = agentsAgg;
    toolsData = new Map(tools.map(t => [t.id, t]));
    
    renderAgentsPanel(Array.from(agentsAgg.values()));
    renderToolsPanel(tools, auditLogs);
  } catch (e) {
    console.error('loadAgentAndToolPanels error', e);
    showError('Failed to load agents and tools');
  }
}

function renderAgentsPanel(agents) {
  const container = document.getElementById('agents-list');
  if (!container) return;
  
  // Sort by last_seen desc
  agents.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
  
  if (agents.length === 0) {
    container.innerHTML = '<div class="empty-state">No agents found</div>';
    return;
  }
  
  container.innerHTML = '';
  
  agents.forEach(agent => {
    const item = document.createElement('div');
    item.className = 'panel-item';
    if (currentFilters.agent_id === agent.agent_id) {
      item.classList.add('selected');
    }
    
    const lastSeen = formatDateRelative(agent.last_seen);
    
    item.innerHTML = `
      <div class="panel-item-info">
        <div class="panel-item-title">${escapeHtml(agent.agent_id)}</div>
        <div class="panel-item-meta">
          <span>${lastSeen}</span>
        </div>
      </div>
      <div class="panel-item-badges">
        <span class="badge badge-success">${agent.allow_count}</span>
        <span class="badge badge-danger">${agent.block_count}</span>
      </div>
    `;
    
    item.addEventListener('click', () => {
      applyFilter({ agent_id: agent.agent_id });
    });
    
    container.appendChild(item);
  });
  
  // Search
  const searchInput = document.getElementById('agent-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      Array.from(container.children).forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(term) ? '' : 'none';
      });
    });
  }
}

function renderToolsPanel(tools, auditLogs) {
  const container = document.getElementById('tools-list');
  if (!container) return;
  
  // Count tool usage
  const toolCounts = new Map();
  auditLogs.forEach(log => {
    if (log.tool_id) {
      toolCounts.set(log.tool_id, (toolCounts.get(log.tool_id) || 0) + 1);
    }
  });
  
  if (tools.length === 0) {
    container.innerHTML = '<div class="empty-state">No tools found</div>';
    return;
  }
  
  container.innerHTML = '';
  
  tools.forEach(tool => {
    const item = document.createElement('div');
    item.className = 'panel-item';
    if (currentFilters.tool_id === tool.id) {
      item.classList.add('selected');
    }
    
    const signature = tool.signature || '';
    const sigHealth = signature && /^[0-9a-f]{32,}$/i.test(signature) ? 'ok' : 'missing';
    const callCount = toolCounts.get(tool.id) || 0;
    
    item.innerHTML = `
      <div class="panel-item-info">
        <div class="panel-item-title">${escapeHtml(tool.id)}</div>
        <div class="panel-item-meta">
          <span>v${tool.version || 'N/A'}</span>
          <span class="dot-indicator dot-${sigHealth}"></span>
          <span>${callCount} calls</span>
        </div>
      </div>
      <button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="event.stopPropagation(); prefillSimulatorFromTool('${escapeHtml(tool.id)}')">Use</button>
    `;
    
    item.addEventListener('click', () => {
      applyFilter({ tool_id: tool.id });
    });
    
    container.appendChild(item);
  });
}

async function loadDashboard(filters = {}) {
  try {
    const auditLogs = await fetchJSON('/audit').catch(() => []);
    auditData = auditLogs;
    renderAuditTable(auditLogs, filters);
  } catch (e) {
    console.error('loadDashboard error', e);
    showError('Failed to load audit logs');
  }
}

function renderAuditTable(logs, filters = {}) {
  const tbody = document.querySelector('#audit-table tbody');
  const countEl = document.getElementById('audit-count');
  if (!tbody) return;
  
  // Apply filters
  let filtered = logs;
  if (filters.agent_id) {
    filtered = filtered.filter(log => log.agent_id === filters.agent_id);
  }
  if (filters.tool_id) {
    filtered = filtered.filter(log => {
      const toolId = log.tool_id || '';
      return toolId === filters.tool_id || toolId === filters.tool_id.replace('mcp:', '') || toolId.replace('mcp:', '') === filters.tool_id;
    });
  }
  if (filters.role) {
    filtered = filtered.filter(log => {
      const roles = (log.roles || '').split(',').map(r => r.trim());
      return roles.includes(filters.role);
    });
  }
  
  // Sort by time desc
  filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  
  // Paginate
  const paginated = filtered.slice(0, auditOffset + auditPageSize);
  const hasMore = filtered.length > paginated.length;
  
  if (countEl) {
    countEl.textContent = `${filtered.length} entries`;
  }
  
  const loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = hasMore ? 'block' : 'none';
    loadMoreBtn.onclick = () => {
      auditOffset += auditPageSize;
      renderAuditTable(logs, filters);
    };
  }
  
  if (paginated.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No audit logs found</td></tr>';
    return;
  }
  
  tbody.innerHTML = '';
  
  paginated.forEach(log => {
    const tr = document.createElement('tr');
    const decision = (log.decision || '').toLowerCase();
    const decisionClass = decision === 'allow' ? 'allow' : 'block';
    
    tr.innerHTML = `
      <td>${formatDate(log.created_at)}</td>
      <td>${escapeHtml(log.agent_id || 'N/A')}</td>
      <td>${escapeHtml(log.tool_id || 'N/A')} ${log.tool_version ? `v${log.tool_version}` : ''}</td>
      <td><span class="decision-chip ${decisionClass}">${escapeHtml(decision.toUpperCase())}</span></td>
      <td title="${escapeHtml(log.reason || '')}">${truncate(escapeHtml(log.reason || 'N/A'), 30)}</td>
      <td>${escapeHtml(log.policy_version || 'N/A')}</td>
    `;
    
    tbody.appendChild(tr);
  });
}

function applyFilter(filter) {
  if (filter.agent_id) {
    currentFilters.agent_id = filter.agent_id;
    currentFilters.tool_id = null;
  }
  if (filter.tool_id) {
    currentFilters.tool_id = filter.tool_id;
    currentFilters.agent_id = null;
  }
  if (filter.role) {
    currentFilters.role = filter.role;
  }
  
  // Update UI
  updateFilterPill();
  renderAgentsPanel(Array.from(agentsData.values()));
  renderToolsPanel(Array.from(toolsData.values()), auditData);
  renderAuditTable(auditData, currentFilters);
}

function clearFilter() {
  currentFilters = { agent_id: null, tool_id: null, role: null };
  updateFilterPill();
  renderAgentsPanel(Array.from(agentsData.values()));
  renderToolsPanel(Array.from(toolsData.values()), auditData);
  renderAuditTable(auditData, currentFilters);
}

function updateFilterPill() {
  const container = document.getElementById('filter-pill-container');
  const text = document.getElementById('filter-pill-text');
  
  if (!container || !text) return;
  
  let filterText = '';
  if (currentFilters.agent_id) {
    filterText = `Agent: ${currentFilters.agent_id}`;
  } else if (currentFilters.tool_id) {
    filterText = `Tool: ${currentFilters.tool_id}`;
  } else if (currentFilters.role) {
    filterText = `Role: ${currentFilters.role}`;
  }
  
  if (filterText) {
    text.textContent = filterText;
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
  }
  
  const clearBtn = document.getElementById('clear-filter-btn');
  if (clearBtn) {
    clearBtn.onclick = clearFilter;
  }
}

async function loadAnomaliesPreview() {
  try {
    const anomalies = await fetchJSON('/anomalies').catch(() => []);
    const container = document.getElementById('anomalies-preview');
    const badge = document.getElementById('anomaly-badge');
    
    if (badge) {
      badge.textContent = anomalies.length;
      badge.className = `badge ${anomalies.length > 5 ? 'badge-warning' : 'badge-info'}`;
    }
    
    if (container) {
      if (anomalies.length === 0) {
        container.innerHTML = '<div class="text-muted text-small">No anomalies</div>';
      } else {
        const recent = anomalies.slice(0, 3);
        container.innerHTML = recent.map(a => `
          <div class="anomaly-item">
            <div class="anomaly-item-title">${escapeHtml(a.agent_id || 'Unknown')}</div>
            <div class="anomaly-item-time">${formatDateRelative(a.created_at)}</div>
          </div>
        `).join('');
      }
    }
    
    const viewAllBtn = document.getElementById('view-all-anomalies');
    if (viewAllBtn) {
      viewAllBtn.onclick = () => switchTab('anomalies');
    }
  } catch (e) {
    console.error('loadAnomaliesPreview error', e);
  }
}

// ============================================================================
// Anomalies Tab
// ============================================================================

async function loadAnomaliesTab() {
  try {
    const anomalies = await fetchJSON('/anomalies').catch(() => []);
    const container = document.getElementById('anomalies-list');
    if (!container) return;
    
    if (anomalies.length === 0) {
      container.innerHTML = '<div class="empty-state">No anomalies found</div>';
      return;
    }
    
    container.innerHTML = anomalies.map(a => `
      <div class="card-item" style="margin-bottom: 1rem;">
        <div class="card-item-header">
          <h3>${escapeHtml(a.agent_id || 'Unknown')}</h3>
          <span class="text-muted text-small">${formatDate(a.created_at)}</span>
        </div>
        <p class="text-muted">${escapeHtml(a.detail || 'No details')}</p>
      </div>
    `).join('');
  } catch (e) {
    console.error('loadAnomaliesTab error', e);
    showError('Failed to load anomalies');
  }
}

// ============================================================================
// Policies Tab
// ============================================================================

async function loadPoliciesTab() {
  await loadPoliciesList();
  setupPolicyForm();
}

async function loadPoliciesList() {
  try {
    const policies = await fetchJSON('/policies').catch(() => []);
    const container = document.getElementById('policies-container');
    if (!container) return;
    
    if (!Array.isArray(policies) || policies.length === 0) {
      container.innerHTML = '<div class="empty-state">No policies found</div>';
      return;
    }
    
    container.innerHTML = policies.map(p => {
      const rules = Array.isArray(p.rules) ? p.rules : [];
      return `
        <div class="card-item">
          <div class="card-item-header">
            <h3>${escapeHtml(p.name || 'Untitled')}</h3>
            <span class="badge badge-info">v${p.version || 'N/A'}</span>
          </div>
          <div class="text-muted text-small" style="margin-top: 0.5rem;">
            Created: ${formatDate(p.created_at)} | ${rules.length} rules
          </div>
          <button class="btn-secondary" style="margin-top: 0.75rem; width: 100%;" onclick="openPolicyModal(${escapeHtml(JSON.stringify(p))})">View JSON</button>
        </div>
      `;
    }).join('');
    
    // Search
    const searchInput = document.getElementById('policy-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        Array.from(container.children).forEach(card => {
          const text = card.textContent.toLowerCase();
          card.style.display = text.includes(term) ? '' : 'none';
        });
      });
    }
  } catch (e) {
    console.error('loadPoliciesList error', e);
    showError('Failed to load policies');
  }
}

function setupPolicyForm() {
  const form = document.getElementById('policy-form');
  const input = document.getElementById('policy-input');
  const validateBtn = document.getElementById('validate-policy-btn');
  const applyBtn = document.getElementById('apply-policy-btn');
  const errorEl = document.getElementById('policy-json-error');
  
  if (!form || !input || !validateBtn || !applyBtn) return;
  
  const validateJSON = () => {
    try {
      JSON.parse(input.value);
      if (errorEl) {
        errorEl.style.display = 'none';
        input.classList.remove('input-error');
      }
      return true;
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = `Invalid JSON: ${e.message}`;
        errorEl.style.display = 'block';
        input.classList.add('input-error');
      }
      return false;
    }
  };
  
  validateBtn.addEventListener('click', validateJSON);
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateJSON()) {
      showError('Please fix JSON errors before submitting');
      return;
    }
    
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
    
    try {
      const policy = JSON.parse(input.value);
      const res = await fetchJSON('/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy)
      });
      
      if (res.status && res.status >= 400) {
        showError(`Failed: ${res.error || res.detail || JSON.stringify(res)}`);
      } else {
        showSuccess('Policy applied successfully!');
        input.value = '';
        await loadPoliciesList();
      }
    } catch (err) {
      showError('Network error: ' + err.message);
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Policy';
    }
  });
}

function openPolicyModal(policy) {
  const modal = document.getElementById('json-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-json-content');
  
  if (modal && title && content) {
    title.textContent = `Policy: ${policy.name || 'Untitled'}`;
    
    // Defensive parsing: handle rules as string or object
    let parsedPolicy = { ...policy };
    if (parsedPolicy.rules !== undefined) {
      try {
        // If rules is a string, parse it; otherwise use as-is
        parsedPolicy.rules = typeof parsedPolicy.rules === "string" 
          ? JSON.parse(parsedPolicy.rules) 
          : parsedPolicy.rules;
      } catch (e) {
        // If parsing fails, show error and keep original
        console.error('Failed to parse policy rules JSON:', e);
        showToast('Invalid JSON in policy rules', 'error');
        parsedPolicy.rules = parsedPolicy.rules; // Keep original
      }
    }
    
    // Handle missing rules
    if (!parsedPolicy.rules || (Array.isArray(parsedPolicy.rules) && parsedPolicy.rules.length === 0)) {
      parsedPolicy.rules = "No rules";
    }
    
    try {
      content.textContent = JSON.stringify(parsedPolicy, null, 2);
    } catch (e) {
      console.error('Failed to stringify policy:', e);
      content.textContent = 'Error displaying policy JSON';
      showToast('Failed to display policy JSON', 'error');
    }
    
    modal.setAttribute('aria-hidden', 'false');
  }
}

// ============================================================================
// Tools Tab
// ============================================================================

async function loadToolsTab() {
  try {
    const [tools, auditLogs] = await Promise.all([
      fetchJSON('/tools').catch(() => []),
      fetchJSON('/audit').catch(() => [])
    ]);
    
    const toolCounts = new Map();
    auditLogs.forEach(log => {
      if (log.tool_id) {
        toolCounts.set(log.tool_id, (toolCounts.get(log.tool_id) || 0) + 1);
      }
    });
    
    const container = document.getElementById('tools-container');
    if (!container) return;
    
    if (tools.length === 0) {
      container.innerHTML = '<div class="empty-state">No tools found</div>';
      return;
    }
    
    container.innerHTML = tools.map(tool => {
      const signature = tool.signature || '';
      const sigHealth = signature && /^[0-9a-f]{32,}$/i.test(signature) ? 'ok' : 'missing';
      const callCount = toolCounts.get(tool.id) || 0;
      const sigShort = signature ? signature.substring(0, 8) + '...' : 'No signature';
      
      return `
        <div class="card-item">
          <div class="card-item-header">
            <h3>${escapeHtml(tool.id)}</h3>
            <span class="dot-indicator dot-${sigHealth}" title="Signature: ${sigShort}"></span>
          </div>
          <div class="text-muted text-small" style="margin-top: 0.5rem;">
            v${tool.version || 'N/A'} | ${callCount} calls
          </div>
          <p class="text-muted text-small" style="margin-top: 0.5rem;">${escapeHtml(tool.description || 'No description')}</p>
          <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
            <button class="btn-secondary" style="flex: 1;" onclick="prefillSimulatorFromTool('${escapeHtml(tool.id)}')">Use in Simulator</button>
            <button class="btn-secondary" style="flex: 1;" onclick="showExamplePayloads('${escapeHtml(tool.id)}')">Examples</button>
            <button class="btn-secondary" style="flex: 1;" onclick="runToolExample('${escapeHtml(tool.id)}')">Run Example</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('loadToolsTab error', e);
    showError('Failed to load tools');
  }
}

function prefillSimulatorFromTool(toolId) {
  switchTab('simulator');
  setTimeout(() => {
    const toolInput = document.getElementById('tool_id');
    if (toolInput) {
      toolInput.value = toolId;
      const tool = Array.from(toolsData.values()).find(t => t.id === toolId);
      if (tool) {
        const paramsInput = document.getElementById('params');
        if (paramsInput) {
          paramsInput.value = JSON.stringify(tool.input_schema || {}, null, 2);
        }
        const versionInput = document.getElementById('tool_version');
        if (versionInput) {
          versionInput.value = tool.version || '1.0.0';
        }
      }
    }
  }, 100);
}

function showExamplePayloads(toolId) {
  const tool = Array.from(toolsData.values()).find(t => t.id === toolId);
  if (!tool) return;
  
  const modal = document.getElementById('example-modal');
  const title = document.getElementById('example-modal-title');
  const content = document.getElementById('example-payloads-content');
  
  if (modal && title && content) {
    title.textContent = `Example Payloads: ${toolId}`;
    const example = {
      agent_id: 'demo-agent',
      agent_roles: ['user'],
      tool_id: toolId,
      tool_version: tool.version || '1.0.0',
      params: tool.input_schema || {},
      request_id: `req-${Math.random().toString(36).substring(2, 9)}`
    };
    content.innerHTML = `<pre><code>${escapeHtml(JSON.stringify(example, null, 2))}</code></pre>`;
    modal.setAttribute('aria-hidden', 'false');
  }
}

async function runToolExample(toolId) {
  const tool = Array.from(toolsData.values()).find(t => t.id === toolId);
  if (!tool) return;
  
  const payload = {
    agent_id: 'demo-agent',
    agent_roles: ['user'],
    tool_id: toolId,
    tool_version: tool.version || '1.0.0',
    params: tool.input_schema || {},
    request_id: `req-${Math.random().toString(36).substring(2, 9)}`
  };
  
  showInfo(`Running example for ${toolId}...`);
  
  try {
    const res = await fetchJSON('/enforce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.decision === 'ALLOW') {
      showSuccess(`Example for ${toolId}: ALLOWED!`);
    } else {
      showError(`Example for ${toolId}: BLOCKED - ${res.reason}`);
    }
    
    // Refresh dashboard
    if (currentTab === 'overview') {
      await loadDashboard();
    }
  } catch (err) {
    showError(`Failed: ${err.message}`);
  }
}

// ============================================================================
// Simulator Tab
// ============================================================================

async function loadSimulatorTab() {
  setupSimulatorForm();
  await loadSimulatorPresets();
}

function setupSimulatorForm() {
  const form = document.getElementById('sim-form');
  const paramsInput = document.getElementById('params');
  const paramsError = document.getElementById('params-json-error');
  
  if (!form || !paramsInput || !paramsError) return;
  
  // JSON validation
  paramsInput.addEventListener('input', () => {
    validateJSONInput(paramsInput, paramsError);
  });
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!validateJSONInput(paramsInput, paramsError)) {
      showError('Invalid JSON in parameters');
      return;
    }
    
    const data = new FormData(form);
    const payload = {
      agent_id: data.get('agent_id'),
      agent_roles: (data.get('agent_roles') || '').split(',').map(s => s.trim()).filter(Boolean),
      tool_id: data.get('tool_id'),
      tool_version: data.get('tool_version') || '1.0.0',
      params: JSON.parse(data.get('params') || '{}'),
      request_id: data.get('request_id') || `req-${Math.random().toString(36).substring(2, 9)}`
    };
    
    const resultEl = document.getElementById('sim-result');
    if (resultEl) {
      resultEl.textContent = 'Sending...';
    }
    
    try {
      const res = await fetchJSON('/enforce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (resultEl) {
        resultEl.textContent = JSON.stringify(res, null, 2);
      }
      
      if (res.decision === 'ALLOW') {
        showSuccess('Enforcement: ALLOWED');
      } else {
        showError(`Enforcement: BLOCKED - ${res.reason}`);
      }
      
      // Refresh dashboard and highlight new entry
      if (currentTab === 'overview') {
        await loadDashboard();
        // Try to highlight the new entry
        setTimeout(() => {
          const rows = document.querySelectorAll('#audit-table tbody tr');
          if (rows.length > 0) {
            rows[0].classList.add('highlight');
            setTimeout(() => rows[0].classList.remove('highlight'), 2000);
          }
        }, 500);
      }
    } catch (err) {
      if (resultEl) {
        resultEl.textContent = `Error: ${err.message || JSON.stringify(err)}`;
      }
      showError('Enforcement failed: ' + err.message);
    }
  });
}

function validateJSONInput(input, errorEl) {
  try {
    JSON.parse(input.value);
    if (errorEl) {
      errorEl.style.display = 'none';
      input.classList.remove('input-error');
    }
    return true;
  } catch (e) {
    if (errorEl) {
      errorEl.textContent = `Invalid JSON: ${e.message}`;
      errorEl.style.display = 'block';
      input.classList.add('input-error');
    }
    return false;
  }
}

async function loadSimulatorPresets() {
  const select = document.getElementById('preset-select');
  if (!select) return;
  
  try {
    const [logs, tools] = await Promise.all([
      fetchJSON('/audit').catch(() => []),
      fetchJSON('/tools').catch(() => [])
    ]);
    
    // Top agents
    const agentCounts = new Map();
    logs.forEach(log => {
      if (log.agent_id) {
        agentCounts.set(log.agent_id, (agentCounts.get(log.agent_id) || 0) + 1);
      }
    });
    const topAgents = Array.from(agentCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id]) => id);
    
    // Top tools
    const toolCounts = new Map();
    logs.forEach(log => {
      if (log.tool_id) {
        toolCounts.set(log.tool_id, (toolCounts.get(log.tool_id) || 0) + 1);
      }
    });
    const topTools = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
    
    select.innerHTML = '<option value="">-- Select Preset --</option>';
    
    if (topAgents.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Top Agents';
      topAgents.forEach(agentId => {
        const option = document.createElement('option');
        option.value = `agent:${agentId}`;
        option.textContent = `Agent: ${agentId}`;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    }
    
    if (topTools.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Top Tools';
      topTools.forEach(toolId => {
        const option = document.createElement('option');
        option.value = `tool:${toolId}`;
        option.textContent = `Tool: ${toolId}`;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    }
    
    select.addEventListener('change', (e) => {
      const value = e.target.value;
      if (value.startsWith('agent:')) {
        const agentId = value.split(':')[1];
        document.getElementById('agent_id').value = agentId;
        document.getElementById('agent_roles').value = 'user';
      } else if (value.startsWith('tool:')) {
        const toolId = value.split(':')[1];
        const tool = Array.from(toolsData.values()).find(t => t.id === toolId);
        if (tool) {
          document.getElementById('tool_id').value = tool.id;
          document.getElementById('tool_version').value = tool.version || '1.0.0';
          document.getElementById('params').value = JSON.stringify(tool.input_schema || {}, null, 2);
          document.getElementById('agent_id').value = 'demo-agent';
          document.getElementById('agent_roles').value = 'user';
        }
      }
      document.getElementById('request_id').value = `req-${Math.random().toString(36).substring(2, 9)}`;
      validateJSONInput(document.getElementById('params'), document.getElementById('params-json-error'));
    });
  } catch (e) {
    console.error('loadSimulatorPresets error', e);
  }
}

// ============================================================================
// AI Policy Tab
// ============================================================================

function loadAIPolicyTab() {
  setupAIPolicyForm();
}

function setupAIPolicyForm() {
  const generateBtn = document.getElementById('generate-policy-btn');
  const applyBtn = document.getElementById('apply-generated-policy-btn');
  const copyBtn = document.getElementById('copy-policy-btn');
  const input = document.getElementById('nl-policy-input');
  const output = document.getElementById('generated-policy-output');
  const modelSelect = document.getElementById('model-select');
  
  if (!generateBtn || !input || !output) return;
  
  // Set default model from env if available
  const defaultModel = 'models/gemini-2.5-pro';
  if (modelSelect) {
    modelSelect.value = defaultModel;
  }
  
  generateBtn.addEventListener('click', async () => {
    const nl = input.value.trim();
    if (!nl) {
      showError('Please enter a policy description');
      return;
    }
    
    const model = modelSelect ? modelSelect.value : defaultModel;
    
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    output.textContent = 'Generating policy...';
    
    try {
      await generatePolicyFromNL(nl, model);
    } catch (err) {
      showError('Generation failed: ' + err.message);
      output.textContent = `Error: ${err.message}`;
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate';
    }
  });
  
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const policyText = output.textContent.trim();
      if (!policyText || policyText.startsWith('No policy') || policyText.startsWith('Error')) {
        showError('No valid policy to apply');
        return;
      }
      
      try {
        const policy = JSON.parse(policyText);
        const res = await fetchJSON('/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(policy)
        });
        
        if (res.status && res.status >= 400) {
          showError(`Failed to apply: ${res.error || res.detail || JSON.stringify(res)}`);
        } else {
          showSuccess('Policy applied successfully!');
          addGenerationLog('Policy applied', true);
          if (currentTab === 'policies') {
            await loadPoliciesList();
          }
        }
      } catch (err) {
        showError('Invalid policy JSON: ' + err.message);
      }
    });
  }
  
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = output.textContent;
      navigator.clipboard.writeText(text).then(() => {
        showSuccess('Copied to clipboard!');
      }).catch(() => {
        showError('Failed to copy');
      });
    });
  }
}

async function generatePolicyFromNL(nl, model) {
  const output = document.getElementById('generated-policy-output');
  const applyBtn = document.getElementById('apply-generated-policy-btn');
  const copyBtn = document.getElementById('copy-policy-btn');
  
  try {
    const res = await fetchJSON('/generate_policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nl, model })
    });
    
    if (res.status === 'error') {
      throw new Error(res.error || 'Generation failed');
    }
    
    const policy = res.policy;
    if (output) {
      output.textContent = JSON.stringify(policy, null, 2);
    }
    
    if (applyBtn) {
      applyBtn.style.display = 'block';
    }
    if (copyBtn) {
      copyBtn.style.display = 'block';
    }
    
    addGenerationLog(`Generated policy using ${model}`, true);
    showSuccess('Policy generated successfully!');
  } catch (err) {
    if (output) {
      output.textContent = `Error: ${err.message}`;
    }
    addGenerationLog(`Generation failed: ${err.message}`, false);
    throw err;
  }
}

function addGenerationLog(message, success) {
  const logContainer = document.getElementById('generation-log');
  if (!logContainer) return;
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${success ? 'success' : 'error'}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  
  logContainer.insertBefore(entry, logContainer.firstChild);
  
  // Keep only last 10 entries
  while (logContainer.children.length > 10) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// ============================================================================
// Utilities
// ============================================================================

async function fetchJSON(path, opts = {}) {
  const url = path.startsWith('http') ? path : BASE_URL + (path.startsWith('/') ? path : '/' + path);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: `HTTP ${res.status}`, body: text };
    }
  }
  return res.json();
}

function formatDate(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch {
    return dateString;
  }
}

function formatDateRelative(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.round((now - date) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.substring(0, len) + '...';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function closeModal() {
  document.querySelectorAll('.modal-json').forEach(modal => {
    modal.setAttribute('aria-hidden', 'true');
  });
}

function showError(message) {
  showToast(message, 'error');
}

function showSuccess(message) {
  showToast(message, 'success');
}

function showInfo(message) {
  showToast(message, 'info');
}

function showToast(message, type = 'info') {
  // Simple toast implementation
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--accent)' : 'var(--info)'};
    color: white;
    border-radius: var(--panel-radius);
    box-shadow: var(--shadow-lg);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);
