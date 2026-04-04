/* LinguClaw Web UI - JavaScript Application */

class LinguClawApp {
    constructor() {
        this.ws = null;
        this.taskRunning = false;
        this.currentTab = 'dashboard';
        this.init();
    }

    init() {
        this.setupTabs();
        this.setupWebSocket();
        this.setupEventListeners();
        this.loadStatus();
        this.loadPlugins();
    }

    setupTabs() {
        const navBtns = document.querySelectorAll('.nav-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                this.switchTab(tabId);
            });
        });
    }

    switchTab(tabId) {
        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Update tab content
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.id === tabId);
        });

        this.currentTab = tabId;
    }

    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.updateConnectionStatus(true);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus(false);
            // Reconnect after 3 seconds
            setTimeout(() => this.setupWebSocket(), 3000);
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }

    updateConnectionStatus(connected) {
        const badge = document.getElementById('connection-status');
        if (connected) {
            badge.textContent = '● Connected';
            badge.className = 'badge';
        } else {
            badge.textContent = '● Disconnected';
            badge.style.color = 'var(--accent-red)';
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'state':
                this.updateState(data);
                break;
            case 'started':
                this.onTaskStarted(data);
                break;
            case 'completed':
                this.onTaskCompleted(data);
                break;
            case 'error':
                this.onError(data);
                break;
        }
    }

    updateState(data) {
        document.getElementById('stat-tokens').textContent = `Tokens: ${data.token_usage || 0}`;
        document.getElementById('stat-risk').textContent = `Risk: ${data.risk_score || 'Low'}`;
    }

    onTaskStarted(data) {
        this.taskRunning = true;
        document.getElementById('btn-run').disabled = true;
        document.getElementById('btn-stop').disabled = false;
        this.addLog('system', 'Task started', 'info');
    }

    onTaskCompleted(data) {
        this.taskRunning = false;
        document.getElementById('btn-run').disabled = false;
        document.getElementById('btn-stop').disabled = true;
        this.addLog('system', `Completed: ${data.result}`, 'success');
    }

    onError(data) {
        this.addLog('system', `Error: ${data.message}`, 'error');
    }

    setupEventListeners() {
        // Run button
        document.getElementById('btn-run').addEventListener('click', () => {
            this.startTask();
        });

        // Stop button
        document.getElementById('btn-stop').addEventListener('click', () => {
            this.stopTask();
        });

        // Settings
        document.getElementById('setting-model').addEventListener('change', (e) => {
            localStorage.setItem('linguclaw-model', e.target.value);
        });

        document.getElementById('setting-steps').addEventListener('change', (e) => {
            localStorage.setItem('linguclaw-steps', e.target.value);
        });

        // Load saved settings
        const savedModel = localStorage.getItem('linguclaw-model');
        if (savedModel) {
            document.getElementById('setting-model').value = savedModel;
        }

        const savedSteps = localStorage.getItem('linguclaw-steps');
        if (savedSteps) {
            document.getElementById('setting-steps').value = savedSteps;
        }
    }

    async startTask() {
        const prompt = document.getElementById('task-prompt').value.trim();
        if (!prompt) {
            alert('Please enter a task');
            return;
        }

        const model = document.getElementById('setting-model').value;
        const maxSteps = parseInt(document.getElementById('setting-steps').value) || 15;

        try {
            const response = await fetch('/api/task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task: prompt,
                    model: model,
                    max_steps: maxSteps
                })
            });

            const data = await response.json();
            if (data.status === 'started') {
                this.clearLogs();
                this.addLog('system', `Task ${data.task_id} started`, 'info');
            }
        } catch (error) {
            this.addLog('system', `Failed to start task: ${error.message}`, 'error');
        }
    }

    stopTask() {
        // TODO: Implement stop functionality
        this.addLog('system', 'Stop requested', 'warning');
    }

    async loadStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            
            document.getElementById('stat-sandbox').textContent = 
                `Sandbox: ${data.docker_available ? 'Docker' : 'Fallback'}`;
        } catch (error) {
            console.error('Failed to load status:', error);
        }
    }

    async loadPlugins() {
        try {
            const response = await fetch('/api/plugins');
            const plugins = await response.json();
            
            // Update sidebar plugin list
            const pluginList = document.getElementById('plugin-list');
            pluginList.innerHTML = plugins.map(p => `
                <div class="plugin-item">
                    <span class="plugin-name">${p.name}</span>
                    <span class="plugin-status">${p.enabled ? '✓' : '○'}</span>
                </div>
            `).join('');
            
            // Update plugins grid
            const pluginsGrid = document.getElementById('plugins-grid');
            if (plugins.length === 0) {
                pluginsGrid.innerHTML = '<div class="empty">No plugins loaded</div>';
            } else {
                pluginsGrid.innerHTML = plugins.map(p => `
                    <div class="plugin-card">
                        <h4>${p.name}</h4>
                        <span class="version">v${p.version}</span>
                        <p class="description">${p.description}</p>
                        <span class="author">by ${p.author}</span>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Failed to load plugins:', error);
        }
    }

    addLog(agent, message, level = 'info') {
        const logs = document.getElementById('logs');
        const time = new Date().toLocaleTimeString();
        
        const colors = {
            info: 'var(--text-primary)',
            success: 'var(--accent-green)',
            error: 'var(--accent-red)',
            warning: 'var(--accent-yellow)'
        };
        
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-agent" style="color: ${colors[level] || colors.info}">${agent}</span>
            <span class="log-action">${message}</span>
        `;
        
        logs.appendChild(entry);
        logs.scrollTop = logs.scrollHeight;
    }

    clearLogs() {
        document.getElementById('logs').innerHTML = '';
        document.getElementById('thoughts').innerHTML = '';
        document.getElementById('plan').innerHTML = '';
    }

    addThought(agent, content) {
        const thoughts = document.getElementById('thoughts');
        
        const entry = document.createElement('div');
        entry.className = 'thought-entry';
        entry.innerHTML = `
            <div class="thought-agent">${agent}</div>
            <div>${content}</div>
        `;
        
        thoughts.appendChild(entry);
        thoughts.scrollTop = thoughts.scrollHeight;
    }

    updatePlan(steps) {
        const plan = document.getElementById('plan');
        
        const icons = {
            pending: '⏳',
            running: '🔄',
            completed: '✅',
            failed: '❌'
        };
        
        plan.innerHTML = steps.map((step, idx) => `
            <div class="plan-step">
                <span class="step-icon">${icons[step.status] || '⏳'}</span>
                <span class="step-text">${step.description}</span>
                <span class="step-status ${step.status}">${step.status}</span>
            </div>
        `).join('');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new LinguClawApp();
});
