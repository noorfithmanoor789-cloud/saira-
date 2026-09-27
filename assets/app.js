import { db } from './firebase.js';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { EXAM_STUDENTS, EXAM_QUESTIONS, CURRENT_TEST, ACTIVE_TEST_ID, getAllTests } from './data.js';

// ==================== CHECK INTERNET CONNECTION ====================
const isOnline = navigator.onLine;

// ==================== STATE MANAGEMENT ====================
let currentUser = null;
let currentQuestionIndex = 0;
let userAnswers = new Array(EXAM_QUESTIONS.length).fill(null);
let timer = null;
let timeLeft = CURRENT_TEST.timeLimit * 60;
let examStartTime = null;
let examEndTime = null;
let examSubmitted = false;

// ==================== OFFLINE RESULTS STORAGE ====================
let offlineResults = JSON.parse(localStorage.getItem('offlineResults')) || [];

// ==================== DOM REFERENCES ====================
const loginSection = document.getElementById('loginSection');
const instructionsSection = document.getElementById('instructionsSection');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const startExamBtn = document.getElementById('startExamBtn');

// ==================== LOGIN FUNCTIONALITY ====================
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        // Admin Login
        if (username === 'admin' && password === 'admin123') {
            localStorage.setItem('adminLoggedIn', 'true');
            window.location.href = 'admin/dashboard.html';
            return;
        }

        const student = EXAM_STUDENTS.find(s => s.username === username && s.password === password);

        if (student) {
            currentUser = student;
            localStorage.setItem('examUser', JSON.stringify(student));
            loginSection.style.display = 'none';
            instructionsSection.style.display = 'block';
            loginError.style.display = 'none';
            
            const welcomeMsg = document.getElementById('welcomeMessage');
            if (welcomeMsg) welcomeMsg.textContent = `Welcome, ${student.name}!`;
            
            const testInfo = document.getElementById('testInfo');
            if (testInfo) {
                testInfo.innerHTML = `
                    <strong>Test:</strong> ${CURRENT_TEST.name} 
                    | <strong>Questions:</strong> ${CURRENT_TEST.totalQuestions} 
                    | <strong>Time:</strong> ${CURRENT_TEST.timeLimit} minutes
                `;
            }
            
            const statusMsg = document.getElementById('connectionStatus');
            if (statusMsg) {
                if (navigator.onLine) {
                    statusMsg.textContent = '✅ Online - Results will be saved to Firebase';
                    statusMsg.style.background = '#d4edda';
                    statusMsg.style.color = '#155724';
                } else {
                    statusMsg.textContent = '📱 Offline - Results will be saved locally';
                    statusMsg.style.background = '#fff3cd';
                    statusMsg.style.color = '#856404';
                }
            }
        } else {
            loginError.textContent = 'Invalid username or password. Please try again.';
            loginError.style.display = 'block';
        }
    });
}

// ==================== START EXAM ====================
if (startExamBtn) {
    startExamBtn.addEventListener('click', () => {
        localStorage.setItem('examStarted', 'true');
        localStorage.setItem('currentTestId', ACTIVE_TEST_ID);
        window.location.href = 'student/test.html';
    });
}

// ==================== EXAM LOGIC ====================
if (window.location.pathname.includes('test.html')) {
    const userData = JSON.parse(localStorage.getItem('examUser'));
    if (!userData) {
        window.location.href = '../index.html';
    }

    currentUser = userData;
    document.getElementById('studentNameDisplay').textContent = currentUser.name;
    document.getElementById('totalQNum').textContent = EXAM_QUESTIONS.length;
    document.getElementById('testNameDisplay').textContent = CURRENT_TEST.name;

    displayQuestion(0);
    startTimer();

    document.getElementById('prevBtn')?.addEventListener('click', () => navigateQuestion(-1));
    document.getElementById('nextBtn')?.addEventListener('click', () => navigateQuestion(1));
    document.getElementById('submitBtn')?.addEventListener('click', submitExam);
}

// ==================== DISPLAY QUESTION ====================
function displayQuestion(index) {
    if (index < 0 || index >= EXAM_QUESTIONS.length) return;

    const question = EXAM_QUESTIONS[index];
    document.getElementById('currentQNum').textContent = index + 1;
    document.getElementById('questionText').textContent = question.question;
    document.getElementById('progressFill').style.width = `${((index + 1) / EXAM_QUESTIONS.length) * 100}%`;

    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';

    const optionKeys = ['A', 'B', 'C', 'D', 'E'];
    optionKeys.forEach((key) => {
        if (question.options[key]) {
            const div = document.createElement('div');
            div.className = 'option-item';
            if (userAnswers[index] === key) div.classList.add('selected');
            div.textContent = `${key}. ${question.options[key]}`;
            div.addEventListener('click', () => selectOption(index, key));
            optionsContainer.appendChild(div);
        }
    });

    currentQuestionIndex = index;
    updateButtons();
}

// ==================== SELECT OPTION ====================
function selectOption(questionIndex, optionKey) {
    userAnswers[questionIndex] = optionKey;
    displayQuestion(questionIndex);
}

// ==================== NAVIGATE QUESTION ====================
function navigateQuestion(direction) {
    const newIndex = currentQuestionIndex + direction;
    if (newIndex >= 0 && newIndex < EXAM_QUESTIONS.length) {
        displayQuestion(newIndex);
    }
}

// ==================== UPDATE BUTTONS ====================
function updateButtons() {
    document.getElementById('prevBtn').disabled = currentQuestionIndex === 0;
    document.getElementById('nextBtn').disabled = currentQuestionIndex === EXAM_QUESTIONS.length - 1;
}

// ==================== START TIMER ====================
function startTimer() {
    const timerDisplay = document.getElementById('timerDisplay');
    examStartTime = new Date();

    timer = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (timeLeft <= 0) {
            clearInterval(timer);
            alert('Time is up! Your exam will be submitted automatically.');
            submitExam();
        }
    }, 1000);
}

// ==================== SUBMIT EXAM ====================
async function submitExam() {
    if (examSubmitted) return;
    
    const unanswered = userAnswers.filter(a => a === null).length;
    if (unanswered > 0) {
        if (!confirm(`You have ${unanswered} unanswered questions. Are you sure you want to submit?`)) {
            return;
        }
    }

    examSubmitted = true;
    clearInterval(timer);
    examEndTime = new Date();
    const timeTaken = Math.floor((examEndTime - examStartTime) / 1000);

    let correct = 0;
    EXAM_QUESTIONS.forEach((q, index) => {
        if (userAnswers[index] === q.correct) correct++;
    });

    const total = EXAM_QUESTIONS.length;
    const percentage = ((correct / total) * 100).toFixed(2);
    const passFail = percentage >= 50 ? 'Pass' : 'Fail';

    const resultData = {
        studentName: currentUser.name,
        username: currentUser.username,
        testId: ACTIVE_TEST_ID,
        testName: CURRENT_TEST.name,
        score: correct,
        totalQuestions: total,
        percentage: parseFloat(percentage),
        passFail: passFail,
        examDate: new Date().toLocaleDateString(),
        timeTaken: timeTaken,
        submittedAt: new Date().toISOString(),
        synced: false
    };

    localStorage.setItem('examResult', JSON.stringify(resultData));

    if (navigator.onLine) {
        try {
            await saveExamResult(resultData);
            resultData.synced = true;
            localStorage.setItem('examResult', JSON.stringify(resultData));
            alert('✅ Result Saved Successfully to Firebase!');
            window.location.href = 'result.html';
        } catch (error) {
            console.error('Error saving result:', error);
            saveOfflineResult(resultData);
            alert('⚠️ Could not save to Firebase. Result saved locally.');
            window.location.href = 'result.html';
        }
    } else {
        saveOfflineResult(resultData);
        alert('📱 Offline Mode: Result saved locally.');
        window.location.href = 'result.html';
    }
}

// ==================== OFFLINE RESULT ====================
function saveOfflineResult(resultData) {
    const exists = offlineResults.some(r => 
        r.username === resultData.username && r.submittedAt === resultData.submittedAt
    );
    if (!exists) {
        offlineResults.push(resultData);
        localStorage.setItem('offlineResults', JSON.stringify(offlineResults));
        saveToGlobalOfflineCollection(resultData);
    }
}

function saveToGlobalOfflineCollection(resultData) {
    let allOfflineResults = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
    const exists = allOfflineResults.some(r => 
        r.username === resultData.username && r.submittedAt === resultData.submittedAt
    );
    if (!exists) {
        allOfflineResults.push(resultData);
        localStorage.setItem('allOfflineResults', JSON.stringify(allOfflineResults));
    }
}

async function syncOfflineResults() {
    if (navigator.onLine) {
        let allOfflineResults = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
        if (allOfflineResults.length === 0) return true;
        
        let syncedCount = 0;
        let failedResults = [];
        
        for (const result of allOfflineResults) {
            try {
                await saveExamResult(result);
                syncedCount++;
            } catch (error) {
                failedResults.push(result);
            }
        }
        
        if (failedResults.length === 0) {
            localStorage.setItem('allOfflineResults', JSON.stringify([]));
            localStorage.setItem('offlineResults', JSON.stringify([]));
            return true;
        } else {
            localStorage.setItem('allOfflineResults', JSON.stringify(failedResults));
            return false;
        }
    }
    return false;
}

// ==================== FIREBASE FUNCTIONS ====================
async function saveExamResult(resultData) {
    try {
        const docRef = await addDoc(collection(db, 'exam-results'), {
            ...resultData,
            submittedAt: serverTimestamp()
        });
        console.log('Result saved with ID:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Firebase save error:', error);
        throw error;
    }
}

async function getAllResults() {
    try {
        const q = query(collection(db, 'exam-results'), orderBy('submittedAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const results = [];
        querySnapshot.forEach((doc) => {
            results.push({ id: doc.id, ...doc.data() });
        });
        return results;
    } catch (error) {
        console.error('Error fetching results:', error);
        return [];
    }
}

// ==================== RESULT PAGE ====================
if (window.location.pathname.includes('result.html')) {
    const resultData = JSON.parse(localStorage.getItem('examResult'));
    if (!resultData) {
        window.location.href = '../index.html';
    }

    if (navigator.onLine) syncOfflineResults();

    const resultContainer = document.getElementById('resultContent');
    const isSynced = resultData.synced || false;
    
    resultContainer.innerHTML = `
        <h2>📊 Your Exam Results</h2>
        <div class="result-item">
            <span class="label">Student Name:</span>
            <span class="value">${resultData.studentName}</span>
        </div>
        <div class="result-item">
            <span class="label">Username:</span>
            <span class="value">${resultData.username}</span>
        </div>
        <div class="result-item">
            <span class="label">Test:</span>
            <span class="value">${resultData.testName || 'N/A'}</span>
        </div>
        <div class="result-item">
            <span class="label">Score:</span>
            <span class="value">${resultData.score} / ${resultData.totalQuestions}</span>
        </div>
        <div class="result-item">
            <span class="label">Percentage:</span>
            <span class="value">${resultData.percentage}%</span>
        </div>
        <div class="result-item">
            <span class="label">Status:</span>
            <span class="value ${resultData.passFail === 'Pass' ? 'pass' : 'fail'}">
                ${resultData.passFail === 'Pass' ? '✅ PASS' : '❌ FAIL'}
            </span>
        </div>
        <div class="result-item">
            <span class="label">Time Taken:</span>
            <span class="value">${Math.floor(resultData.timeTaken / 60)}m ${resultData.timeTaken % 60}s</span>
        </div>
        <div class="result-item">
            <span class="label">Date:</span>
            <span class="value">${resultData.examDate}</span>
        </div>
        <div class="result-item" style="background: ${isSynced ? '#d4edda' : '#fff3cd'};">
            <span class="label">Status:</span>
            <span class="value" style="font-size:1rem; color: ${isSynced ? '#155724' : '#856404'};">
                ${isSynced ? '✅ Saved to Firebase' : '📱 Saved Locally'}
            </span>
        </div>
    `;

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../index.html';
    });
}

// ==================== ADMIN DASHBOARD ====================
if (window.location.pathname.includes('dashboard.html')) {
    console.log('✅ Admin Dashboard Loading...');

    const adminLoggedIn = localStorage.getItem('adminLoggedIn');
    if (!adminLoggedIn) {
        const password = prompt('Enter admin password:');
        if (password === 'admin123') {
            localStorage.setItem('adminLoggedIn', 'true');
        } else {
            alert('Invalid admin password!');
            window.location.href = '../index.html';
        }
    }

    loadAdminResults();
    loadTestManagement();

    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        syncOfflineResults().then(() => loadAdminResults());
    });
    
    document.getElementById('searchInput')?.addEventListener('input', filterResults);
    document.getElementById('sortSelect')?.addEventListener('change', sortResults);
    document.getElementById('testFilterSelect')?.addEventListener('change', filterByTest);
    document.getElementById('adminLogoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('adminLoggedIn');
        window.location.href = '../index.html';
    });
}

let allResults = [];

// ==================== LOAD TEST MANAGEMENT ====================
function loadTestManagement() {
    const select = document.getElementById('activeTestSelect');
    const filterSelect = document.getElementById('testFilterSelect');
    
    if (select) {
        const tests = getAllTests();
        select.innerHTML = '';
        tests.forEach(test => {
            const option = document.createElement('option');
            option.value = test.id;
            const activeStatus = test.isCurrent ? ' ✅ (Active)' : '';
            option.textContent = `${test.name} (${test.totalQuestions} Qs, ${test.timeLimit} min)${activeStatus}`;
            if (test.isCurrent) option.selected = true;
            select.appendChild(option);
        });
    }
    
    if (filterSelect) {
        const tests = getAllTests();
        filterSelect.innerHTML = '<option value="all">📊 All Tests</option>';
        tests.forEach(test => {
            const option = document.createElement('option');
            option.value = test.id;
            option.textContent = test.name;
            filterSelect.appendChild(option);
        });
    }
    
    const statusEl = document.getElementById('testStatus');
    if (statusEl) {
        statusEl.textContent = `✅ ${CURRENT_TEST.name} Active`;
        statusEl.style.background = '#d4edda';
        statusEl.style.color = '#155724';
    }
}

// ==================== SWITCH TEST ====================
document.getElementById('updateTestBtn')?.addEventListener('click', () => {
    const select = document.getElementById('activeTestSelect');
    const testId = select.value;
    const testName = select.options[select.selectedIndex].text;
    
    if (confirm(`Switch to "${testName}"?`)) {
        localStorage.setItem('activeTestId', testId);
        alert(`✅ Test switched! Please refresh the page.`);
        window.location.reload();
    }
});

// ==================== LOAD ADMIN RESULTS ====================
async function loadAdminResults() {
    const tbody = document.getElementById('resultsBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px;">Loading results...</td></tr>';

    try {
        const allFirebaseResults = await getAllResults();
        const testFilter = document.getElementById('testFilterSelect')?.value || 'all';
        
        let filteredResults = allFirebaseResults;
        if (testFilter !== 'all') {
            filteredResults = allFirebaseResults.filter(r => r.testId === testFilter);
        }
        
        allResults = filteredResults;
        displayResults(allResults);
        
        const countMsg = document.getElementById('resultCount');
        if (countMsg) {
            const total = allFirebaseResults.length;
            const filtered = filteredResults.length;
            countMsg.innerHTML = `📊 Total Results: <strong>${filtered}</strong> ${filtered !== total ? `(filtered from ${total})` : ''}`;
            countMsg.style.background = '#d4edda';
            countMsg.style.padding = '10px';
            countMsg.style.borderRadius = '8px';
            countMsg.style.color = '#155724';
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:red;">Error loading results</td></tr>';
    }
}

// ==================== DISPLAY RESULTS ====================
function displayResults(results) {
    const tbody = document.getElementById('resultsBody');
    if (!tbody) return;
    
    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px;">No results found</td></tr>';
        return;
    }

    tbody.innerHTML = results.map(result => `
        <tr>
            <td>${result.studentName || 'N/A'}</td>
            <td>${result.username || 'N/A'}</td>
            <td>${result.testName || 'N/A'}</td>
            <td>${result.score || 0}/${result.totalQuestions || 0}</td>
            <td>${result.percentage || 0}%</td>
            <td>
                <span class="status-badge ${result.passFail === 'Pass' ? 'status-pass' : 'status-fail'}">
                    ${result.passFail || 'N/A'}
                </span>
            </td>
            <td>${result.examDate || 'N/A'}</td>
            <td>${result.timeTaken ? `${Math.floor(result.timeTaken / 60)}m ${result.timeTaken % 60}s` : 'N/A'}</td>
        </tr>
    `).join('');
}

// ==================== FILTER & SORT ====================
function filterResults() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const filtered = allResults.filter(r => 
        (r.studentName?.toLowerCase().includes(searchTerm) || 
         r.username?.toLowerCase().includes(searchTerm))
    );
    displayResults(filtered);
}

function filterByTest() {
    loadAdminResults();
}

function sortResults() {
    const sortType = document.getElementById('sortSelect').value;
    let sorted = [...allResults];

    switch(sortType) {
        case 'highest':
            sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
            break;
        case 'lowest':
            sorted.sort((a, b) => (a.score || 0) - (b.score || 0));
            break;
        case 'latest':
            sorted.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
            break;
    }

    displayResults(sorted);
}

// ==================== AUTO REDIRECT ====================
if (window.location.pathname === '/' || window.location.pathname.includes('index.html')) {
    const userData = JSON.parse(localStorage.getItem('examUser'));
    const examStarted = localStorage.getItem('examStarted');
    
    if (userData && examStarted === 'true') {
        window.location.href = 'student/test.html';
    }
}

// ==================== ONLINE/OFFLINE EVENTS ====================
window.addEventListener('online', async () => {
    const synced = await syncOfflineResults();
    if (synced) alert('✅ All offline results synced!');
    if (window.location.pathname.includes('dashboard.html')) {
        loadAdminResults();
    }
});

window.addEventListener('offline', () => {
    console.log('🔴 Offline mode');
});

const pendingResults = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
if (pendingResults.length > 0 && navigator.onLine) {
    syncOfflineResults();
}

export { saveExamResult, getAllResults, syncOfflineResults };
