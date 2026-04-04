/* Prism Workflow Visualization - JavaScript Module */

class PrismWorkflowUI {
    constructor() {
        this.workflowData = null;
        this.activeBranch = null;
        this.reflections = [];
        this.metrics = {};
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadWorkflowStatus();
    }

    setupEventListeners() {
        // Tab switching for workflow tab
        const workflowTab = document.querySelector('[data-tab="workflow"]');
        if (workflowTab) {
            workflowTab.addEventListener('click', () => {
                this.refreshWorkflowView();
            });
        }
    }

    async loadWorkflowStatus() {
        try {
            const response = await fetch('/api/workflow/status');
            const data = await response.json();
            this.updateWorkflowUI(data);
        } catch (error) {
            console.error('Failed to load workflow status:', error);
        }
    }

    updateWorkflowUI(data) {
        // Update branch tree
        this.updateBranchTree(data.branches);
        
        // Update metrics
        if (data.metrics) {
            this.updateMetrics(data.metrics);
        }
        
        // Update reflections
        if (data.reflections) {
            this.updateReflections(data.reflections);
        }
        
        // Update workflow graph
        if (data.branches && data.branches.length > 0) {
            this.renderWorkflowGraph(data.branches);
        }
    }

    updateBranchTree(branches) {
        const container = document.getElementById('branch-tree');
        if (!container || !branches) return;

        container.innerHTML = branches.map(branch => `
            <div class="branch-item ${branch.type} ${branch.id === this.activeBranch ? 'active' : ''}">
                <span class="branch-name">${branch.name}</span>
                <span class="branch-status ${branch.status.toLowerCase()}">${branch.status}</span>
            </div>
        `).join('');
    }

    updateMetrics(metrics) {
        const fitnessEl = document.getElementById('metric-fitness');
        const riskEl = document.getElementById('metric-risk');
        const validationEl = document.getElementById('metric-validation');

        if (fitnessEl) fitnessEl.textContent = metrics.fitness ? (metrics.fitness * 100).toFixed(0) + '%' : '-';
        if (riskEl) riskEl.textContent = metrics.risk !== undefined ? metrics.risk + '/100' : '-';
        if (validationEl) validationEl.textContent = metrics.validation ? (metrics.validation * 100).toFixed(0) + '%' : '-';
    }

    updateReflections(reflections) {
        const container = document.getElementById('reflections');
        if (!container || !reflections) return;

        if (reflections.length === 0) {
            container.innerHTML = '<div class="empty">No reflections yet...</div>';
            return;
        }

        container.innerHTML = reflections.map(r => `
            <div class="reflection-item">
                <span class="facet-name">[${r.facet || 'PRISM'}]</span>
                <span>${r.message}</span>
            </div>
        `).join('');

        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    renderWorkflowGraph(branches) {
        const container = document.getElementById('workflow-graph');
        if (!container) return;

        // Create a simple workflow visualization
        const html = `
            <div class="workflow-diagram">
                <div class="workflow-row">
                    <div class="workflow-node facet">Safety</div>
                    <span class="workflow-arrow">→</span>
                    <div class="workflow-node facet">Planning</div>
                    <span class="workflow-arrow">→</span>
                    <div class="workflow-node facet">Memory</div>
                </div>
                <div class="workflow-row">
                    <span class="workflow-arrow">↓</span>
                </div>
                <div class="workflow-row">
                    ${branches.map((b, i) => `
                        <div class="workflow-node branch ${b.status.toLowerCase()}">${b.name}</div>
                        ${i < branches.length - 1 ? '<span class="workflow-arrow">|</span>' : ''}
                    `).join('')}
                </div>
                <div class="workflow-row">
                    <span class="workflow-arrow">↓</span>
                </div>
                <div class="workflow-row">
                    <div class="workflow-node merged">Merged Result</div>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    addReflection(facet, message) {
        this.reflections.push({ facet, message, time: new Date() });
        this.updateReflections(this.reflections);
    }

    setActiveBranch(branchId) {
        this.activeBranch = branchId;
        this.refreshWorkflowView();
    }

    updateBranchStatus(branchId, status) {
        const branchEl = document.querySelector(`.branch-item[data-id="${branchId}"]`);
        if (branchEl) {
            const statusEl = branchEl.querySelector('.branch-status');
            if (statusEl) {
                statusEl.className = `branch-status ${status.toLowerCase()}`;
                statusEl.textContent = status;
            }
        }
    }

    refreshWorkflowView() {
        this.loadWorkflowStatus();
    }

    // WebSocket message handler
    handleWebSocketMessage(data) {
        if (data.type === 'prism_state') {
            this.updateWorkflowUI(data);
        } else if (data.type === 'reflection') {
            this.addReflection(data.facet, data.message);
        } else if (data.type === 'branch_update') {
            this.updateBranchStatus(data.branch_id, data.status);
        }
    }

    // Static factory method
    static create() {
        return new PrismWorkflowUI();
    }
}

// Integration with main app
if (window.app) {
    // Extend existing app with Prism workflow support
    window.app.prismWorkflow = PrismWorkflowUI.create();
    
    // Override WebSocket message handler to include Prism
    const originalHandleMessage = window.app.handleMessage;
    window.app.handleMessage = function(data) {
        // Call original handler
        if (originalHandleMessage) {
            originalHandleMessage.call(this, data);
        }
        
        // Handle Prism-specific messages
        if (window.app.prismWorkflow && 
            (data.type === 'prism_state' || data.type === 'reflection' || data.type === 'branch_update')) {
            window.app.prismWorkflow.handleWebSocketMessage(data);
        }
    };
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PrismWorkflowUI };
}
