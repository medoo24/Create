/**
 * MCQ Pro - Advanced Study Application
 * Client-side only, IndexedDB persistence, Hierarchical navigation
 * Fixed for GitHub Pages and nested JSON structures
 */

// Database Manager for IndexedDB
class DatabaseManager {
    constructor() {
        this.DB_NAME = 'MCQProDB_v3';
        this.DB_VERSION = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: 'filename' });
                }
                
                if (!db.objectStoreNames.contains('progress')) {
                    const progressStore = db.createObjectStore('progress', { keyPath: 'questionId' });
                    progressStore.createIndex('fileId', 'fileId', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('favorites')) {
                    const favStore = db.createObjectStore('favorites', { keyPath: 'questionId' });
                    favStore.createIndex('fileId', 'fileId', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    async getFile(filename) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(filename);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveFile(filename, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.put({
                filename,
                data,
                timestamp: Date.now()
            });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getProgress(questionId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['progress'], 'readonly');
            const store = transaction.objectStore('progress');
            const request = store.get(questionId);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveProgress(questionId, fileId, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['progress'], 'readwrite');
            const store = transaction.objectStore('progress');
            const request = store.put({
                questionId,
                fileId,
                ...data,
                timestamp: Date.now()
            });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAllProgress() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['progress'], 'readonly');
            const store = transaction.objectStore('progress');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async isFavorite(questionId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['favorites'], 'readonly');
            const store = transaction.objectStore('favorites');
            const request = store.get(questionId);
            
            request.onsuccess = () => resolve(!!request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async toggleFavorite(questionId, fileId) {
        return new Promise(async (resolve, reject) => {
            const isFav = await this.isFavorite(questionId);
            const transaction = this.db.transaction(['favorites'], 'readwrite');
            const store = transaction.objectStore('favorites');
            
            if (isFav) {
                const request = store.delete(questionId);
                request.onsuccess = () => resolve(false);
                request.onerror = () => reject(request.error);
            } else {
                const request = store.put({ questionId, fileId, timestamp: Date.now() });
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            }
        });
    }

    async getAllFavorites() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['favorites'], 'readonly');
            const store = transaction.objectStore('favorites');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result.map(f => f.questionId));
            request.onerror = () => reject(request.error);
        });
    }

    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getSetting(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    }

    async saveSetting(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put({ key, value });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// Hierarchical Data Manager
class HierarchyManager {
    constructor() {
        this.hierarchy = {};
        this.flatQuestions = [];
        this.currentFiles = [];
        this.progressCache = new Map();
        this.favoritesCache = new Set();
        this.metadata = null;
    }

    async loadMultipleFiles(filesData, db) {
        this.flatQuestions = [];
        this.currentFiles = [];
        this.progressCache.clear();
        
        // Load progress and favorites for all files
        const allProgress = await db.getAllProgress();
        const allFavorites = await db.getAllFavorites();
        
        allProgress.forEach(p => this.progressCache.set(p.questionId, p));
        allFavorites.forEach(fav => this.favoritesCache.add(fav));
        
        // Process each file
        for (const { filename, data } of filesData) {
            let questions;
            if (Array.isArray(data)) {
                questions = data;
            } else if (data && Array.isArray(data.questions)) {
                questions = data.questions;
            } else {
                console.warn(`Invalid format in ${filename}, skipping`);
                continue;
            }
            
            this.currentFiles.push(filename);
            questions.forEach(q => {
                this.flatQuestions.push({
                    ...q,
                    fileId: filename,
                    solved: this.progressCache.has(q.id),
                    correct: this.progressCache.get(q.id)?.correct || false,
                    favorite: this.favoritesCache.has(q.id)
                });
            });
        }
        
        this.buildHierarchy();
        return this.hierarchy;
    }

    buildHierarchy() {
        // Hierarchy: Term -> Subject -> Lesson -> Chapter -> Questions
        this.hierarchy = {};
        
        this.flatQuestions.forEach(q => {
            const term = q.term || 'Uncategorized';
            const subject = q.subject || 'General';
            const lesson = q.lesson || 'General';
            const chapter = q.chapter || 'General';
            
            if (!this.hierarchy[term]) this.hierarchy[term] = {
                type: 'term', name: term, children: {}, stats: { total: 0, solved: 0, correct: 0 }
            };
            
            if (!this.hierarchy[term].children[subject]) this.hierarchy[term].children[subject] = {
                type: 'subject', name: subject, children: {}, stats: { total: 0, solved: 0, correct: 0 }
            };
            
            if (!this.hierarchy[term].children[subject].children[lesson]) this.hierarchy[term].children[subject].children[lesson] = {
                type: 'lesson', name: lesson, children: {}, stats: { total: 0, solved: 0, correct: 0 }
            };
            
            if (!this.hierarchy[term].children[subject].children[lesson].children[chapter]) {
                this.hierarchy[term].children[subject].children[lesson].children[chapter] = {
                    type: 'chapter', name: chapter, questions: [], stats: { total: 0, solved: 0, correct: 0 }
                };
            }
            
            this.hierarchy[term].children[subject].children[lesson].children[chapter].questions.push(q);
        });
        
        this.calculateStats();
    }

    calculateStats() {
        const calcNodeStats = (node) => {
            if (node.questions) {
                // Leaf node (chapter)
                node.stats.total = node.questions.length;
                node.stats.solved = node.questions.filter(q => q.solved).length;
                node.stats.correct = node.questions.filter(q => q.correct).length;
            } else {
                // Branch node
                node.stats = { total: 0, solved: 0, correct: 0 };
                Object.values(node.children).forEach(child => {
                    const childStats = calcNodeStats(child);
                    node.stats.total += childStats.total;
                    node.stats.solved += childStats.solved;
                    node.stats.correct += childStats.correct;
                });
            }
            return node.stats;
        };

        Object.values(this.hierarchy).forEach(term => calcNodeStats(term));
    }

    getQuestionsForSelection(path) {
        // Path is array: [term, subject, lesson, chapter]
        if (!path || path.length === 0) return this.flatQuestions;
        
        let current = this.hierarchy;
        for (const key of path) {
            if (current[key]) {
                current = current[key].children || current[key].questions;
            } else {
                // Check if it's a chapter with questions
                if (Array.isArray(current)) return current;
                return [];
            }
        }
        
        if (Array.isArray(current)) return current;
        
        // If we stopped at a branch, collect all questions below
        const collectQuestions = (node) => {
            if (node.questions) return node.questions;
            return Object.values(node.children).flatMap(child => collectQuestions(child));
        };
        
        return collectQuestions({ children: current });
    }

    getAllQuestions() {
        return this.flatQuestions;
    }

    updateQuestionStatus(questionId, correct) {
        // Update in flat array
        const q = this.flatQuestions.find(q => q.id === questionId);
        if (q) {
            q.solved = true;
            q.correct = correct;
        }
        
        // Update in hierarchy
        const updateInNode = (node) => {
            if (node.questions) {
                const q = node.questions.find(q => q.id === questionId);
                if (q) {
                    q.solved = true;
                    q.correct = correct;
                    return true;
                }
            } else {
                for (const child of Object.values(node.children)) {
                    if (updateInNode(child)) return true;
                }
            }
            return false;
        };

        Object.values(this.hierarchy).forEach(term => updateInNode(term));
        this.calculateStats();
    }

    toggleFavoriteStatus(questionId) {
       let newStatus = false;
    
       // Update in flat array
       const flatQ = this.flatQuestions.find(q => q.id === questionId);
       if (flatQ) {
           flatQ.favorite = !flatQ.favorite;
           newStatus = flatQ.favorite;
       }
    
       // Update in hierarchy
       const updateInNode = (node) => {
           if (node.questions) {
               const q = node.questions.find(q => q.id === questionId);
               if (q) {
                   q.favorite = !q.favorite;
                   return true;
               }
           } else {
               for (const child of Object.values(node.children)) {
                   if (updateInNode(child)) return true;
               }
           }
           return false;
       };

       for (const term of Object.values(this.hierarchy)) {
           updateInNode(term);
       }
    
       // Update cache immediately
       if (newStatus) {
           this.favoritesCache.add(questionId);
       } else {
           this.favoritesCache.delete(questionId);
       }
    
       return newStatus;
   }
}

// Quiz Manager
class QuizManager {
    constructor(app) {
        this.app = app;
        this.active = false;
        this.questions = [];
        this.currentIndex = 0;
        this.answers = new Map();
        this.timer = null;
        this.timeRemaining = 0;
    }

    start(questions, config = {}) {
        if (!questions || questions.length === 0) {
            this.app.ui.showToast('No questions available for quiz', 'error');
            return;
        }
        
        this.questions = questions.sort(() => Math.random() - 0.5).slice(0, Math.min(config.count || 20, questions.length));
        this.currentIndex = 0;
        this.answers.clear();
        this.timeRemaining = (config.time || 30) * 60;
        this.active = true;
        
        document.getElementById('quiz-setup-modal').classList.add('hidden');
        document.getElementById('quiz-modal').classList.remove('hidden');
        
        this.render();
        this.startTimer();
    }

    startTimer() {
        if (this.timer) clearInterval(this.timer);
        
        const updateDisplay = () => {
            const mins = Math.floor(this.timeRemaining / 60);
            const secs = this.timeRemaining % 60;
            const display = document.getElementById('quiz-timer');
            display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            
            if (this.timeRemaining < 300) display.classList.add('warning');
            else display.classList.remove('warning');
            
            if (this.timeRemaining <= 0) this.submit();
            this.timeRemaining--;
        };
        
        updateDisplay();
        this.timer = setInterval(updateDisplay, 1000);
    }

    render() {
        const q = this.questions[this.currentIndex];
        const body = document.getElementById('quiz-body');
        const selected = this.answers.get(q.id);
        
        body.innerHTML = `
            <div class="quiz-question">
                <div class="question-text markdown-content">${marked.parse(q.question)}</div>
                <div class="options-list" style="margin-top: 20px;">
                    ${q.options.map((opt, i) => `
                        <div class="option ${selected === i ? 'selected' : ''}" data-index="${i}" style="padding: 15px; border: 2px solid ${selected === i ? 'var(--accent-primary)' : 'var(--border-color)'};">
                            <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                            <span class="option-text">${marked.parseInline(opt)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        body.querySelectorAll('.option').forEach(opt => {
            opt.addEventListener('click', () => {
                const idx = parseInt(opt.dataset.index);
                this.answers.set(q.id, idx);
                this.render();
            });
        });
        
        document.getElementById('quiz-progress').textContent = `${this.currentIndex + 1}/${this.questions.length}`;
        document.getElementById('quiz-prev').disabled = this.currentIndex === 0;
        
        if (this.currentIndex === this.questions.length - 1) {
            document.getElementById('quiz-next').classList.add('hidden');
            document.getElementById('quiz-submit').classList.remove('hidden');
        } else {
            document.getElementById('quiz-next').classList.remove('hidden');
            document.getElementById('quiz-submit').classList.add('hidden');
        }
    }

    next() {
        if (this.currentIndex < this.questions.length - 1) {
            this.currentIndex++;
            this.render();
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.render();
        }
    }

    submit() {
        if (this.timer) clearInterval(this.timer);
        
        let correct = 0;
        this.questions.forEach(q => {
            const ans = this.answers.get(q.id);
            const isCorrect = ans === q.correct_option_id;
            if (isCorrect) correct++;
            
            // Save progress
            this.app.db.saveProgress(q.id, this.app.hierarchyManager.currentFiles[0], {
                correct: isCorrect,
                selectedOption: ans
            });
        });
        
        // Reload to update UI
        this.app.loadCurrentFiles().then(() => {
            this.showResults(correct);
        });
    }

    showResults(correct) {
        const body = document.getElementById('quiz-body');
        const footer = document.getElementById('quiz-footer');
        const pct = Math.round((correct / this.questions.length) * 100);
        
        body.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <h2 style="font-size: 2rem; margin-bottom: 20px;">Quiz Complete!</h2>
                <div style="font-size: 4rem; margin-bottom: 20px;">${pct >= 70 ? '🎉' : pct >= 50 ? '👍' : '💪'}</div>
                <div style="font-size: 1.5rem; margin-bottom: 10px;">${correct} / ${this.questions.length} Correct</div>
                <div style="color: var(--text-muted); font-size: 1.2rem;">${pct}% Accuracy</div>
            </div>
        `;
        
        footer.innerHTML = `
            <button class="btn secondary" onclick="app.quizManager.close()">Close</button>
            <button class="btn primary" onclick="app.quizManager.review()">Review Answers</button>
        `;
    }

    review() {
        document.getElementById('quiz-modal').classList.add('hidden');
        this.app.ui.switchView('history');
        this.close();
    }

    close() {
        this.active = false;
        if (this.timer) clearInterval(this.timer);
        document.getElementById('quiz-modal').classList.add('hidden');
        
        // Reset footer
        const footer = document.getElementById('quiz-footer');
        footer.innerHTML = `
            <button id="quiz-prev" class="btn secondary">Previous</button>
            <span id="quiz-progress">1/10</span>
            <button id="quiz-next" class="btn primary">Next</button>
            <button id="quiz-submit" class="btn success hidden">Submit</button>
        `;
        
        // Re-attach listeners
        document.getElementById('quiz-prev').addEventListener('click', () => this.prev());
        document.getElementById('quiz-next').addEventListener('click', () => this.next());
        document.getElementById('quiz-submit').addEventListener('click', () => this.submit());
    }
}

// UI Manager
class UIManager {
    constructor(app) {
        this.app = app;
        this.currentView = 'dashboard';
        this.selectedPath = [];
        this.expandedNodes = new Set();
        this.searchQuery = '';
        this.focusedCardIndex = -1;
        this.selectedCards = new Set();
        this.optionsVisible = true;
        this.answersRevealed = false;
        this.allExpanded = false;
        this.allSelected = false;
    }

    init() {
        this.setupEventListeners();
        this.applyTheme();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.switchView(view);
            });
        });

        // File selector - multiple selection
        const fileSelector = document.getElementById('file-selector');
        fileSelector.addEventListener('change', () => {
            const loadBtn = document.getElementById('load-selected');
            if (fileSelector.selectedOptions.length > 0) {
                loadBtn.style.display = 'inline-flex';
            } else {
                loadBtn.style.display = 'none';
            }
        });

        document.getElementById('load-selected').addEventListener('click', () => {
            const selector = document.getElementById('file-selector');
            const selectedFiles = Array.from(selector.selectedOptions).map(opt => opt.value);
            if (selectedFiles.length > 0) {
                this.app.loadFiles(selectedFiles);
            }
        });

        document.getElementById('refresh-files').addEventListener('click', () => {
            this.app.discoverFiles();
        });

        // Search
        document.getElementById('search-toggle').addEventListener('click', () => {
            document.getElementById('search-bar').classList.toggle('hidden');
            if (!document.getElementById('search-bar').classList.contains('hidden')) {
                document.getElementById('search-input').focus();
            }
        });

        document.getElementById('search-close').addEventListener('click', () => {
            document.getElementById('search-bar').classList.add('hidden');
            this.searchQuery = '';
            document.getElementById('search-input').value = '';
            this.render();
        });

        document.getElementById('search-input').addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            if (this.currentView !== 'dashboard') this.render();
        });

        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.openSettings();
        });

        document.getElementById('settings-close').addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('hidden');
        });

        document.getElementById('theme-select').addEventListener('change', (e) => {
            this.setTheme(e.target.value);
        });

        document.getElementById('font-size').addEventListener('input', (e) => {
            const size = e.target.value;
            document.documentElement.style.setProperty('--font-size-base', `${size}px`);
            document.getElementById('font-size-value').textContent = size;
            this.app.db.saveSetting('fontSize', size);
        });

        // Data management
        document.getElementById('reset-progress').addEventListener('click', () => {
            if (confirm('Reset all progress? This cannot be undone.')) {
                this.app.db.clearStore('progress').then(() => {
                    this.showToast('Progress reset successfully', 'success');
                    this.app.loadCurrentFiles();
                });
            }
        });

        document.getElementById('reset-favorites').addEventListener('click', () => {
            if (confirm('Clear all favorites?')) {
                this.app.db.clearStore('favorites').then(() => {
                    this.showToast('Favorites cleared', 'success');
                    this.app.loadCurrentFiles();
                });
            }
        });

        document.getElementById('clear-cache').addEventListener('click', () => {
            if (confirm('Clear all cached files? You will need to reload them.')) {
                this.app.db.clearStore('files').then(() => {
                    this.showToast('Cache cleared', 'success');
                    location.reload();
                });
            }
        });

        // Collapse all sidebar
        document.getElementById('collapse-all-sidebar').addEventListener('click', () => {
            this.expandedNodes.clear();
            this.renderSidebar();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch(e.key.toLowerCase()) {
                case 'j':
                case 'arrowdown':
                    e.preventDefault();
                    this.navigateCards(1);
                    break;
                case 'k':
                case 'arrowup':
                    e.preventDefault();
                    this.navigateCards(-1);
                    break;
                case 'enter':
                    if (document.activeElement.classList.contains('card-header')) {
                        document.activeElement.click();
                    }
                    break;
                case 'f':
                    if (document.activeElement.closest('.question-card')) {
                        const favBtn = document.activeElement.closest('.question-card').querySelector('.favorite-btn');
                        if (favBtn) favBtn.click();
                    }
                    break;
                case 's':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.toggleSelectAll();
                    }
                    break;
            }
            
            if (['1','2','3','4'].includes(e.key)) {
                const activeCard = document.querySelector('.question-card.focused');
                if (activeCard) {
                    const options = activeCard.querySelectorAll('.option');
                    const idx = parseInt(e.key) - 1;
                    if (options[idx] && !options[idx].classList.contains('disabled')) {
                        options[idx].click();
                    }
                }
            }
        });
        
        // Setup toolbar using event delegation on content area
        document.getElementById('content-area').addEventListener('click', (e) => {
            const target = e.target;
            
            if (target.id === 'toggle-select-btn') this.toggleSelectAll();
            else if (target.id === 'copy-selected-btn') this.copySelected();
            else if (target.id === 'toggle-expand-btn') this.toggleExpandAll();
            else if (target.id === 'toggle-options-btn') this.toggleOptions(target);
            else if (target.id === 'toggle-answers-btn') this.toggleAnswers(target);
        });
    }

    toggleSelectAll() {
        this.allSelected = !this.allSelected;
        const btn = document.getElementById('toggle-select-btn');
        if (btn) btn.textContent = this.allSelected ? 'Select None' : 'Select All';
        
        const cards = document.querySelectorAll('.question-card');
        cards.forEach(card => {
            const id = card.dataset.questionId;
            const checkbox = card.querySelector('.select-checkbox');
            if (this.allSelected) {
                this.selectedCards.add(id);
                card.classList.add('selected');
                if (checkbox) checkbox.checked = true;
            } else {
                this.selectedCards.delete(id);
                card.classList.remove('selected');
                if (checkbox) checkbox.checked = false;
            }
        });
    }

    copySelected() {
        const selectedIds = Array.from(this.selectedCards);
        if (selectedIds.length === 0) {
            this.showToast('No questions selected', 'error');
            return;
        }

        let text = '';
        selectedIds.forEach(id => {
            const q = this.app.hierarchyManager.flatQuestions.find(q => q.id == id);
            if (q) {
                text += `Question #${q.id}:\n${q.question}\n\nOptions:\n`;
                q.options.forEach((opt, i) => {
                    const marker = i === q.correct_option_id ? '✓' : ' ';
                    text += `${marker} ${String.fromCharCode(65 + i)}. ${opt}\n`;
                });
                text += `\nExplanation: ${q.explanation}\n`;
                text += `---\n\n`;
            }
        });

        navigator.clipboard.writeText(text).then(() => {
            this.showToast(`Copied ${selectedIds.length} questions to clipboard`, 'success');
        }).catch(() => {
            this.showToast('Failed to copy', 'error');
        });
    }

    toggleExpandAll() {
        this.allExpanded = !this.allExpanded;
        const btn = document.getElementById('toggle-expand-btn');
        if (btn) btn.textContent = this.allExpanded ? 'Collapse All' : 'Expand All';
        
        document.querySelectorAll('.card-body').forEach(body => {
            if (this.allExpanded) body.classList.add('expanded');
            else body.classList.remove('expanded');
        });
    }

    toggleOptions(btn) {
        this.optionsVisible = !this.optionsVisible;
        btn.textContent = this.optionsVisible ? 'Hide Options' : 'Show Options';
        document.querySelectorAll('.question-card').forEach(card => {
            if (this.optionsVisible) card.classList.remove('options-hidden');
            else card.classList.add('options-hidden');
        });
    }

    toggleAnswers(btn) {
        this.answersRevealed = !this.answersRevealed;
        btn.textContent = this.answersRevealed ? 'Hide Answers' : 'Show Answers';
        
        document.querySelectorAll('.question-card').forEach(card => {
            const explanation = card.querySelector('.explanation');
            if (this.answersRevealed) {
                card.classList.add('answers-revealed');
                if (explanation) explanation.style.display = 'block';
            } else {
                card.classList.remove('answers-revealed');
                // Only hide if not solved (for history/mistakes view keep visible)
                const isSolved = card.classList.contains('solved-correct') || card.classList.contains('solved-incorrect');
                if (!isSolved && explanation) {
                    explanation.style.display = 'none';
                }
            }
        });
    }

    switchView(view) {
        this.currentView = view;
        this.focusedCardIndex = -1;
        this.selectedCards.clear();
        this.allSelected = false;
        this.optionsVisible = true;
        this.answersRevealed = false;
        this.allExpanded = false;
        
        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        
        this.render();
    }

    render() {
        this.renderSidebar();
        
        if (this.currentView === 'dashboard') {
            this.renderDashboard();
        } else {
            this.renderQuestionView();
        }
        
        this.updateGlobalProgress();
    }

    renderSidebar() {
        const container = document.getElementById('tree-container');
        container.innerHTML = '';
        
        if (!this.app.hierarchyManager.hierarchy) return;
        
        const createNode = (key, node, path) => {
            const div = document.createElement('div');
            div.className = 'tree-node';
            
            const content = document.createElement('div');
            content.className = 'tree-node-content';
            if (JSON.stringify(this.selectedPath) === JSON.stringify(path)) {
                content.classList.add('active');
            }
            
            const hasChildren = !node.questions;
            const isExpanded = this.expandedNodes.has(path.join('/'));
            
            // Toggle icon
            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle' + (hasChildren ? '' : ' leaf');
            toggle.innerHTML = '▶';
            if (isExpanded) toggle.classList.add('expanded');
            
            // Icon based on type
            const icon = document.createElement('span');
            icon.className = 'tree-icon';
            const icons = { term: '📅', subject: '📚', lesson: '📝', chapter: '📄' };
            icon.textContent = icons[node.type] || '📄';
            
            // Label
            const label = document.createElement('span');
            label.className = 'tree-label';
            label.textContent = node.name;
            
            // Stats badge
            const stats = document.createElement('span');
            stats.className = 'stats-badge';
            const accuracy = node.stats.solved > 0 
                ? Math.round((node.stats.correct / node.stats.solved) * 100) 
                : 0;
            stats.textContent = `${node.stats.solved}/${node.stats.total} (${accuracy}%)`;
            stats.title = `Solved: ${node.stats.solved}, Total: ${node.stats.total}, Accuracy: ${accuracy}%`;
            
            content.appendChild(toggle);
            content.appendChild(icon);
            content.appendChild(label);
            content.appendChild(stats);
            
            // Click handlers
            content.addEventListener('click', (e) => {
                if (e.target === toggle || toggle.contains(e.target)) {
                    if (hasChildren) {
                        if (isExpanded) {
                            this.expandedNodes.delete(path.join('/'));
                        } else {
                            this.expandedNodes.add(path.join('/'));
                        }
                        this.renderSidebar();
                    }
                } else {
                    this.selectedPath = path;
                    if (hasChildren && !isExpanded) {
                        this.expandedNodes.add(path.join('/'));
                    }
                    this.render();
                }
            });
            
            div.appendChild(content);
            
            // Children
            if (hasChildren && isExpanded) {
                const children = document.createElement('div');
                children.className = 'tree-children expanded';
                
                Object.entries(node.children).forEach(([childKey, childNode]) => {
                    children.appendChild(createNode(childKey, childNode, [...path, childKey]));
                });
                
                div.appendChild(children);
            }
            
            return div;
        };
        
        Object.entries(this.app.hierarchyManager.hierarchy).forEach(([key, node]) => {
            container.appendChild(createNode(key, node, [key]));
        });
    }

    renderQuestionView() {
        const container = document.getElementById('content-area');
        container.innerHTML = '';
        
        const viewContainer = document.createElement('div');
        viewContainer.className = 'view-container';
        
        // Header
        const header = document.createElement('div');
        header.className = 'view-header';
        
        const titles = {
            solve: 'Study Mode',
            review: 'Review Mode',
            history: 'Answer History',
            mistakes: 'Mistakes Review',
            favorites: 'Favorites'
        };
        
        header.innerHTML = `
            <h2 class="view-title">${titles[this.currentView] || 'Questions'}</h2>
            <p class="view-subtitle">${this.getBreadcrumbText()}</p>
        `;
        viewContainer.appendChild(header);
        
        // Controls toolbar - create fresh instance
        const toolbarTemplate = document.getElementById('controls-toolbar');
        if (toolbarTemplate && (this.currentView === 'solve' || this.currentView === 'review' || this.currentView === 'history' || this.currentView === 'mistakes' || this.currentView === 'favorites')) {
            const toolbar = toolbarTemplate.cloneNode(true);
            toolbar.style.display = 'flex';
            toolbar.removeAttribute('id'); // Remove ID to avoid duplicates
            
            // Set initial button states
            const selectBtn = toolbar.querySelector('#toggle-select-btn');
            const expandBtn = toolbar.querySelector('#toggle-expand-btn');
            const optionsBtn = toolbar.querySelector('#toggle-options-btn');
            const answersBtn = toolbar.querySelector('#toggle-answers-btn');
            
            if (selectBtn) selectBtn.textContent = this.allSelected ? 'Select None' : 'Select All';
            if (expandBtn) expandBtn.textContent = this.allExpanded ? 'Collapse All' : 'Expand All';
            if (optionsBtn) optionsBtn.textContent = this.optionsVisible ? 'Hide Options' : 'Show Options';
            if (answersBtn) answersBtn.textContent = this.answersRevealed ? 'Hide Answers' : 'Show Answers';
            
            viewContainer.appendChild(toolbar);
        }
        
        // Get questions based on view and selection
        let questions = this.app.hierarchyManager.getQuestionsForSelection(this.selectedPath);
        
        // Filter by view type
        if (this.currentView === 'solve') {
            questions = questions.filter(q => !q.solved);
        } else if (this.currentView === 'mistakes') {
            questions = questions.filter(q => q.solved && !q.correct);
        } else if (this.currentView === 'favorites') {
            questions = questions.filter(q => q.favorite);
        } else if (this.currentView === 'history') {
            questions = questions.filter(q => q.solved);
        }
        // Review mode shows all questions (solved and unsolved)
        
        // Search filter
        if (this.searchQuery) {
            questions = questions.filter(q => 
                q.question.toLowerCase().includes(this.searchQuery) ||
                (q.explanation && q.explanation.toLowerCase().includes(this.searchQuery)) ||
                q.options.some(o => o.toLowerCase().includes(this.searchQuery))
            );
        }
        
        if (questions.length === 0) {
            viewContainer.innerHTML += `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <h3>No questions found</h3>
                    <p>Try adjusting your filters or selection.</p>
                </div>
            `;
            container.appendChild(viewContainer);
            return;
        }
        
        // Group questions
        const groups = this.groupQuestions(questions);
        
        // Render groups
        Object.entries(groups).forEach(([groupName, groupQuestions]) => {
            const groupEl = document.createElement('div');
            groupEl.className = 'question-group';
            
            const groupStats = this.calculateGroupStats(groupQuestions);
            const accuracy = groupStats.solved > 0 
                ? Math.round((groupStats.correct / groupStats.solved) * 100) 
                : 0;
            
            groupEl.innerHTML = `
                <div class="group-header">
                    <div>
                        <div class="group-title">${groupName}</div>
                        <div class="group-stats">${groupStats.solved}/${groupQuestions.length} solved • ${accuracy}% accuracy</div>
                    </div>
                    ${this.currentView === 'solve' || this.currentView === 'review' ? 
                        `<button class="btn primary quiz-btn" data-group="${groupName}">📝 Quiz</button>` 
                        : ''}
                </div>
                <div class="group-content" id="group-${this.escapeId(groupName)}">
                    <!-- Questions will be inserted here -->
                </div>
            `;
            
            // Add quiz button listener
            const quizBtn = groupEl.querySelector('.quiz-btn');
            if (quizBtn) {
                quizBtn.addEventListener('click', () => {
                    this.app.startQuiz(groupName);
                });
            }
            
            const content = groupEl.querySelector('.group-content');
            groupQuestions.forEach((q, idx) => {
                content.appendChild(this.createQuestionCard(q, idx));
            });
            
            viewContainer.appendChild(groupEl);
        });
        
        container.appendChild(viewContainer);
        
        // Apply current toggle states
        if (!this.optionsVisible) {
            document.querySelectorAll('.question-card').forEach(c => c.classList.add('options-hidden'));
        }
        if (this.answersRevealed) {
            document.querySelectorAll('.question-card').forEach(c => {
                c.classList.add('answers-revealed');
                const exp = c.querySelector('.explanation');
                if (exp) exp.style.display = 'block';
            });
        }
        if (this.allExpanded) {
            document.querySelectorAll('.card-body').forEach(b => b.classList.add('expanded'));
        }
        
        // Restore focus if navigating with keyboard
        if (this.focusedCardIndex >= 0) {
            const cards = container.querySelectorAll('.question-card');
            if (cards[this.focusedCardIndex]) {
                cards[this.focusedCardIndex].focus();
                cards[this.focusedCardIndex].classList.add('focused');
            }
        }
    }

    groupQuestions(questions) {
        // Group by the next level down from current selection
        const pathLen = this.selectedPath.length;
        const groups = {};
        
        questions.forEach(q => {
            let groupKey;
            if (pathLen === 0) groupKey = q.term || 'Uncategorized';
            else if (pathLen === 1) groupKey = q.subject || 'General';
            else if (pathLen === 2) groupKey = q.lesson || 'General';
            else if (pathLen === 3) groupKey = q.chapter || 'General';
            else groupKey = 'Questions';
            
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(q);
        });
        
        return groups;
    }

    calculateGroupStats(questions) {
        return {
            total: questions.length,
            solved: questions.filter(q => q.solved).length,
            correct: questions.filter(q => q.correct).length
        };
    }

    createQuestionCard(question, index) {
       const card = document.createElement('div');
       card.className = `question-card ${question.solved ? (question.correct ? 'solved-correct' : 'solved-incorrect') : ''}`;
       if (question.favorite) card.classList.add('favorited');
       if (this.selectedCards.has(String(question.id))) card.classList.add('selected');
       if (!this.optionsVisible) card.classList.add('options-hidden');
       if (this.answersRevealed) card.classList.add('answers-revealed');
    
       card.dataset.questionId = question.id;
       card.dataset.index = index;
       card.tabIndex = 0;
    
       const progress = this.app.hierarchyManager.progressCache.get(question.id);
       const selectedOption = progress?.selectedOption;
    
       // Checkbox for selection
       const checkbox = this.currentView !== 'dashboard' ? 
           `<input type="checkbox" class="select-checkbox" ${this.selectedCards.has(String(question.id)) ? 'checked' : ''}>` : '';
    
       // Build options HTML
       const optionsHtml = question.options.map((opt, i) => {
           const isCorrect = i === question.correct_option_id;
           const isSelected = selectedOption === i;
           const wasSelectedWrong = isSelected && !isCorrect && question.solved;
           const showCorrect = (question.solved || this.answersRevealed) && isCorrect;
        
           let optionClass = 'option';
           if (isSelected && isCorrect) optionClass += ' selected-correct';
           else if (isSelected && !isCorrect) optionClass += ' selected-incorrect';
           if (showCorrect) optionClass += ' correct-answer';
           if (question.solved) optionClass += ' disabled';
        
           const correctBadge = showCorrect ? '<span class="correct-indicator">✓ CORRECT</span>' : '';
        
           return `
               <div class="${optionClass}" data-index="${i}">
                   <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                   <span class="option-text">${marked.parseInline(opt)}</span>
                   ${correctBadge}
               </div>
           `;
       }).join('');
    
       const answerBadge = (question.solved || this.answersRevealed) ? 
           `<span class="correct-answer-badge">Answer: ${String.fromCharCode(65 + question.correct_option_id)}</span>` : '';
    
       card.innerHTML = `
           <div class="card-header">
               <div class="card-meta">
                   ${checkbox}
                   <span class="question-id">#${question.id}</span>
                   ${question.solved ? 
                       `<span class="status-badge ${question.correct ? 'correct' : 'incorrect'}">${question.correct ? 'Correct' : 'Incorrect'}</span>` 
                       : '<span class="status-badge">Unsolved</span>'}
               </div>
               <div class="card-actions">
                   <button class="icon-btn favorite-btn" title="Toggle Favorite (F)">❤️</button>
                   ${question.solved ? '<button class="icon-btn reset-btn" title="Reset Progress">🔄</button>' : ''}
               </div>
           </div>
           <div class="card-body ${this.currentView === 'solve' && index === 0 ? 'expanded' : ''}">
               <div class="question-text markdown-content">${marked.parse(question.question)}</div>
               <div class="options-list">
                   ${optionsHtml}
               </div>
               <div class="explanation" style="${question.solved || this.answersRevealed ? 'display: block;' : 'display: none;'}">
                   <div class="explanation-header">
                       Explanation 
                       ${answerBadge}
                   </div>
                   <div class="markdown-content">${marked.parse(question.explanation || 'No explanation provided.')}</div>
               </div>
           </div>
       `;
    
       // Event listeners (rest of the method remains the same)
       const header = card.querySelector('.card-header');
       const body = card.querySelector('.card-body');
    
       header.addEventListener('click', (e) => {
           if (e.target.tagName === 'INPUT' || e.target.closest('.icon-btn')) return;
           body.classList.toggle('expanded');
           document.querySelectorAll('.question-card').forEach(c => c.classList.remove('focused'));
           card.classList.add('focused');
           this.focusedCardIndex = parseInt(card.dataset.index);
       });
    
       card.addEventListener('focus', () => {
           card.classList.add('focused');
           this.focusedCardIndex = parseInt(card.dataset.index);
       });
    
       card.addEventListener('blur', () => card.classList.remove('focused'));
    
       const checkboxEl = card.querySelector('.select-checkbox');
       if (checkboxEl) {
           checkboxEl.addEventListener('change', (e) => {
               if (e.target.checked) {
                   this.selectedCards.add(String(question.id));
                   card.classList.add('selected');
               } else {
                   this.selectedCards.delete(String(question.id));
                   card.classList.remove('selected');
               }
           });
       }
    
       const favBtn = card.querySelector('.favorite-btn');
       favBtn.addEventListener('click', (e) => {
           e.stopPropagation();
           this.app.toggleFavorite(question.id);
       });
    
       const resetBtn = card.querySelector('.reset-btn');
       if (resetBtn) {
           resetBtn.addEventListener('click', (e) => {
               e.stopPropagation();
               this.app.resetQuestion(question.id);
           });
       }
    
       if (this.currentView === 'solve' && !question.solved) {
           card.querySelectorAll('.option').forEach(opt => {
               opt.addEventListener('click', () => {
                   if (opt.classList.contains('disabled')) return;
                   const optionIndex = parseInt(opt.dataset.index);
                   this.app.answerQuestion(question.id, optionIndex, question.correct_option_id);
               });
           });
       }
    
       return card;
   }
    renderDashboard() {
        const container = document.getElementById('content-area');
        container.innerHTML = '';
        
        const viewContainer = document.createElement('div');
        viewContainer.className = 'view-container';
        
        const allQuestions = this.app.hierarchyManager.getAllQuestions();
        const stats = this.calculateGroupStats(allQuestions);
        const accuracy = stats.solved > 0 ? Math.round((stats.correct / stats.solved) * 100) : 0;
        
        // Calculate subject stats
        const subjectStats = {};
        Object.values(this.app.hierarchyManager.hierarchy).forEach(term => {
            Object.values(term.children).forEach(subject => {
                subjectStats[subject.name] = subject.stats;
            });
        });
        
        const sortedSubjects = Object.entries(subjectStats).sort((a, b) => {
            const accA = a[1].solved > 0 ? a[1].correct / a[1].solved : 0;
            const accB = b[1].solved > 0 ? b[1].correct / b[1].solved : 0;
            return accB - accA;
        });
        
        const strongest = sortedSubjects[0];
        const weakest = sortedSubjects[sortedSubjects.length - 1];
        
        viewContainer.innerHTML = `
            <div class="view-header">
                <h2 class="view-title">📊 Dashboard Overview</h2>
                <p class="view-subtitle">Track your progress across all content</p>
            </div>
            
            <div class="dashboard-grid">
                <div class="dashboard-card">
                    <h3>Overall Progress</h3>
                    <div class="chart-container">
                        <canvas id="progress-chart"></canvas>
                    </div>
                    <div style="text-align: center; margin-top: 10px;">
                        <span style="font-size: 1.5rem; font-weight: bold; color: var(--accent-primary);">${Math.round((stats.solved / stats.total) * 100) || 0}%</span>
                        <span style="color: var(--text-muted);"> Complete</span>
                    </div>
                </div>
                
                <div class="dashboard-card">
                    <h3>Performance by Subject</h3>
                    <div class="chart-container">
                        <canvas id="subject-chart"></canvas>
                    </div>
                </div>
                
                <div class="dashboard-card">
                    <h3>Statistics Summary</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value">${stats.total}</div>
                            <div class="stat-label">Total Questions</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${stats.solved}</div>
                            <div class="stat-label">Answered</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${accuracy}%</div>
                            <div class="stat-label">Accuracy</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${this.app.hierarchyManager.favoritesCache.size}</div>
                            <div class="stat-label">Favorites</div>
                        </div>
                    </div>
                    ${strongest ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color);">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                <span>Strongest:</span>
                                <strong style="color: var(--success);">${strongest[0]} (${strongest[1].solved > 0 ? Math.round((strongest[1].correct/strongest[1].solved)*100) : 0}%)</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Needs Work:</span>
                                <strong style="color: var(--error);">${weakest[0]} (${weakest[1].solved > 0 ? Math.round((weakest[1].correct/weakest[1].solved)*100) : 0}%)</strong>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <div class="dashboard-card">
                    <h3>Quick Actions</h3>
                    <div class="quick-actions">
                        ${weakest ? `<button class="btn primary" id="practice-weakest">Practice Weakest Subject</button>` : ''}
                        <button class="btn secondary" id="mixed-quiz">Mixed Review Quiz</button>
                        <button class="btn secondary" id="continue-study">Continue Studying</button>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(viewContainer);
        
        // Add event listeners for quick actions
        document.getElementById('practice-weakest')?.addEventListener('click', () => {
            if (weakest) {
                this.app.switchView('mistakes');
                this.selectedPath = [weakest[0]];
                this.render();
            }
        });
        
        document.getElementById('mixed-quiz')?.addEventListener('click', () => {
            this.app.startQuiz('all');
        });
        
        document.getElementById('continue-study')?.addEventListener('click', () => {
            this.app.switchView('solve');
        });
        
        // Render charts
        this.renderCharts(stats, subjectStats);
    }

    renderCharts(overallStats, subjectStats) {
        // Progress Donut Chart
        const progressCtx = document.getElementById('progress-chart');
        if (progressCtx) {
            new Chart(progressCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Solved', 'Unsolved'],
                    datasets: [{
                        data: [overallStats.solved, overallStats.total - overallStats.solved],
                        backgroundColor: [
                            getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim(),
                            getComputedStyle(document.documentElement).getPropertyValue('--bg-tertiary').trim()
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
        
        // Subject Bar Chart
        const subjectCtx = document.getElementById('subject-chart');
        if (subjectCtx && Object.keys(subjectStats).length > 0) {
            const labels = Object.keys(subjectStats);
            const data = labels.map(sub => {
                const s = subjectStats[sub];
                return s.solved > 0 ? Math.round((s.correct / s.solved) * 100) : 0;
            });
            
            new Chart(subjectCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Accuracy %',
                        data: data,
                        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim(),
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() }
                        },
                        x: {
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false }
                    },
                    onClick: (e, elements) => {
                        if (elements.length > 0) {
                            const idx = elements[0].index;
                            const subject = labels[idx];
                            this.app.switchView('mistakes');
                            this.selectedPath = [subject];
                            this.render();
                        }
                    }
                }
            });
        }
    }

    updateGlobalProgress() {
        const all = this.app.hierarchyManager.getAllQuestions();
        const stats = this.calculateGroupStats(all);
        const pct = stats.total > 0 ? (stats.solved / stats.total) * 100 : 0;
        
        document.getElementById('global-progress').style.width = `${pct}%`;
        document.getElementById('global-progress-text').textContent = `${stats.solved}/${stats.total}`;
    }

    getBreadcrumbText() {
        if (this.selectedPath.length === 0) return 'All Content';
        return this.selectedPath.join(' → ');
    }

    navigateCards(direction) {
        const cards = document.querySelectorAll('.question-card');
        if (cards.length === 0) return;
        
        let idx = this.focusedCardIndex + direction;
        if (idx < 0) idx = 0;
        if (idx >= cards.length) idx = cards.length - 1;
        
        this.focusedCardIndex = idx;
        
        if (cards[idx]) {
            cards[idx].focus();
            cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.querySelectorAll('.question-card').forEach(c => c.classList.remove('focused'));
            cards[idx].classList.add('focused');
        }
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        this.app.db.saveSetting('theme', theme);
    }

    applyTheme() {
        const saved = localStorage.getItem('theme') || 'light';
        const select = document.getElementById('theme-select');
        if (select) select.value = saved;
        document.documentElement.setAttribute('data-theme', saved);
        
        const fontSize = localStorage.getItem('fontSize') || 16;
        const fontSlider = document.getElementById('font-size');
        if (fontSlider) {
            fontSlider.value = fontSize;
            document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);
            const fontValue = document.getElementById('font-size-value');
            if (fontValue) fontValue.textContent = fontSize;
        }
    }

    openSettings() {
        document.getElementById('settings-modal').classList.remove('hidden');
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    escapeId(str) {
        return str.replace(/[^a-zA-Z0-9]/g, '_');
    }
}

// Main Application Class
class MCQProApp {
    constructor() {
        this.db = new DatabaseManager();
        this.hierarchyManager = new HierarchyManager();
        this.ui = new UIManager(this);
        this.quizManager = new QuizManager(this);
        this.currentFiles = [];
        this.manifest = [];
    }

    async init() {
        try {
            await this.db.init();
            this.ui.init();
            await this.discoverFiles();
            
            document.getElementById('loading-screen').classList.add('hidden');
        } catch (error) {
            console.error('Initialization error:', error);
            document.getElementById('loading-text').textContent = 'Error initializing app. Please refresh.';
        }
    }

    async discoverFiles() {
        try {
            const response = await fetch('questions/manifest.json');
            if (!response.ok) throw new Error('Manifest not found');
            
            this.manifest = await response.json();
            const selector = document.getElementById('file-selector');
            selector.innerHTML = '<option value="">Select Question Sets...</option>';
            
            this.manifest.forEach(file => {
                const opt = document.createElement('option');
                opt.value = file;
                opt.textContent = file.replace('.json', '').replace(/_/g, ' ');
                selector.appendChild(opt);
            });
            
            selector.disabled = false;
            
            // Auto-load last used files
            const lastFiles = await this.db.getSetting('lastFiles');
            if (lastFiles && Array.isArray(lastFiles)) {
                Array.from(selector.options).forEach(opt => {
                    if (lastFiles.includes(opt.value)) opt.selected = true;
                });
                if (lastFiles.length > 0) {
                    document.getElementById('load-selected').style.display = 'inline-flex';
                    await this.loadFiles(lastFiles);
                }
            }
        } catch (error) {
            this.ui.showToast('Error loading manifest. Ensure questions/manifest.json exists.', 'error');
            console.error(error);
        }
    }

    async loadFiles(filenames) {
        document.getElementById('loading-screen').classList.remove('hidden');
        document.getElementById('loading-text').textContent = `Loading ${filenames.length} file(s)...`;
        
        try {
            const filesData = [];
            
            for (const filename of filenames) {
                // Check cache first
                let data = await this.db.getFile(filename);
                
                if (!data) {
                    const response = await fetch(`questions/${filename}`);
                    if (!response.ok) {
                        console.warn(`File not found: ${filename}`);
                        continue;
                    }
                    
                    const responseData = await response.json();
                    let questions;
                    if (Array.isArray(responseData)) {
                        questions = responseData;
                    } else if (responseData && Array.isArray(responseData.questions)) {
                        questions = responseData.questions;
                    } else {
                        console.warn(`Invalid format in ${filename}`);
                        continue;
                    }
                    
                    data = { filename, data: questions, timestamp: Date.now() };
                    await this.db.saveFile(filename, data.data);
                }
                
                filesData.push({ filename, data: data.data });
            }
            
            if (filesData.length === 0) {
                throw new Error('No valid files to load');
            }
            
            await this.hierarchyManager.loadMultipleFiles(filesData, this.db);
            this.currentFiles = filenames;
            await this.db.saveSetting('lastFiles', filenames);
            
            this.ui.selectedPath = [];
            this.ui.render();
            
            this.ui.showToast(`Loaded ${filesData.length} file(s) with ${this.hierarchyManager.flatQuestions.length} questions`, 'success');
        } catch (error) {
            this.ui.showToast(`Error loading files: ${error.message}`, 'error');
            console.error(error);
        } finally {
            document.getElementById('loading-screen').classList.add('hidden');
        }
    }

    async loadCurrentFiles() {
        if (this.currentFiles.length > 0) {
            await this.loadFiles(this.currentFiles);
        }
    }

    async answerQuestion(questionId, selectedOption, correctOption) {
        const isCorrect = selectedOption === correctOption;
        
        await this.db.saveProgress(questionId, this.currentFiles[0], {
            correct: isCorrect,
            selectedOption: selectedOption
        });
        
        this.hierarchyManager.updateQuestionStatus(questionId, isCorrect);
        this.ui.render();
    }

    async toggleFavorite(questionId) {
       try {
           // Find the question to get its correct fileId
           const question = this.hierarchyManager.flatQuestions.find(q => q.id === questionId);
           if (!question) {
               console.error('Question not found:', questionId);
               return;
           }
        
           // Use the question's actual fileId, not just the first file
           const fileId = question.fileId || this.currentFiles[0];
        
           // Save to database
           const isFav = await this.db.toggleFavorite(questionId, fileId);
        
           // Update hierarchy cache
           this.hierarchyManager.toggleFavoriteStatus(questionId);
        
           // Update UI immediately for responsiveness
           const card = document.querySelector(`[data-question-id="${questionId}"]`);
           if (card) {
               if (isFav) {
                   card.classList.add('favorited');
               } else {
                   card.classList.remove('favorited');
               }
           }
        
           // Update sidebar to refresh favorite counts
           this.ui.renderSidebar();
        
           // Optional: Show feedback
           this.ui.showToast(isFav ? 'Added to favorites' : 'Removed from favorites', 'success');
        
       } catch (error) {
           console.error('Error toggling favorite:', error);
           this.ui.showToast('Failed to save favorite', 'error');
       }
   }

    async resetQuestion(questionId) {
        const transaction = this.db.db.transaction(['progress'], 'readwrite');
        const store = transaction.objectStore('progress');
        await store.delete(questionId);
        
        this.hierarchyManager.updateQuestionStatus(questionId, false);
        this.ui.render();
    }

    startQuiz(source) {
        let questions;
        
        if (source === 'all') {
            questions = this.hierarchyManager.getAllQuestions();
        } else {
            const all = this.hierarchyManager.getQuestionsForSelection(this.ui.selectedPath);
            questions = all.filter(q => {
                return (q.term === source) || 
                       (q.subject === source) || 
                       (q.lesson === source) || 
                       (q.chapter === source);
            });
        }
        
        if (!questions || questions.length === 0) {
            this.ui.showToast('No questions available for quiz', 'error');
            return;
        }
        
        document.getElementById('quiz-setup-modal').classList.remove('hidden');
        document.getElementById('quiz-source').textContent = source === 'all' ? 'All Questions' : source;
        
        document.getElementById('quiz-start').onclick = () => {
            const count = parseInt(document.getElementById('quiz-count').value) || 20;
            const time = parseInt(document.getElementById('quiz-time').value) || 30;
            this.quizManager.start(questions, { count, time });
        };
        
        document.getElementById('quiz-cancel').onclick = () => {
            document.getElementById('quiz-setup-modal').classList.add('hidden');
        };
    }
    
    switchView(view) {
        this.ui.switchView(view);
    }
}

// Initialize app and expose globally
window.app = new MCQProApp();

// Setup quiz modal listeners after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
    
    document.getElementById('quiz-prev')?.addEventListener('click', () => window.app.quizManager.prev());
    document.getElementById('quiz-next')?.addEventListener('click', () => window.app.quizManager.next());
    document.getElementById('quiz-submit')?.addEventListener('click', () => window.app.quizManager.submit());
    document.getElementById('quiz-close')?.addEventListener('click', () => window.app.quizManager.close());
});


