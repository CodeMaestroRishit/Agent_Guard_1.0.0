# Agents & Tools Panels - Testing Guide

## Overview
The dashboard now includes two side panels: **Agents** and **Tools**, which allow you to filter the audit log table by clicking on specific agents or tools.

## How to Test Locally

1. **Start the server:**
   ```bash
   PORT=5073 python3 -m app.main
   ```

2. **Open the dashboard:**
   - Navigate to `http://localhost:5073/static/dashboard.html`
   - You should see two panels on the left side: Agents and Tools

3. **Test Agent Filtering:**
   - Click on any agent in the Agents panel
   - The audit table will filter to show only entries for that agent
   - A filter pill will appear at the top showing "Filtered: [agent-id]"
   - Click the × button in the filter pill to clear the filter

4. **Test Tool Filtering:**
   - Click on any tool in the Tools panel
   - The audit table will filter to show only entries for that tool
   - The filter pill will update accordingly

5. **Test Agent Search:**
   - Type in the search box in the Agents panel
   - The agent list will filter in real-time

6. **Clear Filters:**
   - Click the × button in the filter pill, or
   - Click the same agent/tool again to deselect

## Features
- **Agents Panel**: Shows unique agent IDs with last-seen timestamp, allow/block counts, and search functionality
- **Tools Panel**: Shows tool IDs with version, call count, and signature health indicators (green = valid, orange = missing)
- **Responsive**: Panels stack vertically on screens smaller than 920px
- **Keyboard Accessible**: All interactive elements support keyboard navigation

