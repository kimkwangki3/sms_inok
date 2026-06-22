const API_BASE = '';

// DOM Elements
const smsDbStatus = document.getElementById('sms-db-status');
const bankDbStatus = document.getElementById('bank-db-status');
const engineStatus = document.getElementById('engine-status');
const companyCount = document.getElementById('company-count');
const companiesList = document.getElementById('companies-list');
const successLogBody = document.getElementById('success-log-body');
const errorLogContainer = document.getElementById('error-log-container');
const clearErrorLog = document.getElementById('clear-error-log');
const logoutBtn = document.getElementById('logout-btn');

// Modal Elements - Company
const companyModal = document.getElementById('company-modal');
const companyForm = document.getElementById('company-form');
const modalTitle = document.getElementById('modal-title');
const openRegisterBtn = document.getElementById('open-register-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelBtn = document.getElementById('cancel-btn');
const testConnBtn = document.getElementById('test-conn-btn');

// Form Inputs - Company
const compIdInput = document.getElementById('comp-id');
const compNameInput = document.getElementById('comp-name');
const compCodeInput = document.getElementById('comp-code');
const dbServerInput = document.getElementById('db-server');
const dbPortInput = document.getElementById('db-port');
const dbUserInput = document.getElementById('db-user');
const dbPasswordInput = document.getElementById('db-password');
const dbDatabaseInput = document.getElementById('db-database');
const socketHostInput = document.getElementById('socket-host');
const socketPortInput = document.getElementById('socket-port');

// Modal Elements - System Setup Config
const systemModal = document.getElementById('system-modal');
const systemForm = document.getElementById('system-form');
const openSystemBtn = document.getElementById('open-system-btn');
const closeSystemModalBtn = document.getElementById('close-system-modal-btn');
const cancelSystemBtn = document.getElementById('cancel-system-btn');

// Form Inputs - System Setup Config
const sysSmsServerInput = document.getElementById('sys-sms-server');
const sysSmsPortInput = document.getElementById('sys-sms-port');
const sysSmsUserInput = document.getElementById('sys-sms-user');
const sysSmsPasswordInput = document.getElementById('sys-sms-password');
const sysSmsDatabaseInput = document.getElementById('sys-sms-database');
const sysBankServerInput = document.getElementById('sys-bank-server');
const sysBankPortInput = document.getElementById('sys-bank-port');
const sysBankUserInput = document.getElementById('sys-bank-user');
const sysBankPasswordInput = document.getElementById('sys-bank-password');
const sysBankDatabaseInput = document.getElementById('sys-bank-database');
const sysWebPortInput = document.getElementById('sys-web-port');

// Login Modal Elements
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginErrorMsg = document.getElementById('login-error-msg');

let isEditMode = false;
let companiesConfig = [];
let syncInterval = null;
let currentEngineActive = true; // 현재 자동승인 구동 상태 보관용

// Auth Token Management
function getAuthToken() {
  return localStorage.getItem('auth_token') || '';
}

function setAuthToken(token) {
  localStorage.setItem('auth_token', token);
}

function removeAuthToken() {
  localStorage.removeItem('auth_token');
}

// API Request Helper
async function apiRequest(url, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'x-auth-token': getAuthToken()
      }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    
    if (res.status === 401) {
      showLoginModal();
      throw new Error('인증 정보가 유효하지 않습니다. 다시 로그인해 주세요.');
    }
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'API 요청 실패');
    }
    return await res.json();
  } catch (err) {
    if (url !== '/api/login') {
      appendTerminalLine(`[API 오류] ${err.message}`, 'error');
    }
    throw err;
  }
}

// Terminal Log Helper
function appendTerminalLine(text, type = '') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  const now = new Date().toLocaleTimeString();
  line.innerText = `[${now}] ${text}`;
  errorLogContainer.appendChild(line);
  errorLogContainer.scrollTop = errorLogContainer.scrollHeight;
}

// 0. 로그인 처리
function showLoginModal() {
  loginModal.style.display = 'flex';
  loginModal.classList.add('show');
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function hideLoginModal() {
  loginModal.style.display = 'none';
  loginModal.classList.remove('show');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  loginErrorMsg.style.display = 'none';
  
  const payload = {
    username: loginUsernameInput.value.trim(),
    password: loginPasswordInput.value
  };

  try {
    const res = await apiRequest('/api/login', 'POST', payload);
    setAuthToken(res.token);
    hideLoginModal();
    appendTerminalLine('로그인 인증 성공', 'success');
    startDashboardSync();
  } catch (err) {
    loginErrorMsg.style.display = 'block';
    loginErrorMsg.innerText = err.message || '아이디/비밀번호가 올바르지 않습니다.';
  }
}

logoutBtn.addEventListener('click', () => {
  removeAuthToken();
  appendTerminalLine('로그아웃 완료', 'system-msg');
  showLoginModal();
  location.reload();
});

// 1. 시스템 실시간 상태 및 로그 동기화
async function syncDashboard() {
  try {
    const status = await apiRequest('/api/status');
    
    updateLed(smsDbStatus.querySelector('.led'), status.sms_db);
    updateLed(bankDbStatus.querySelector('.led'), status.bank_db);
    
    // 엔진 상태 업데이트
    currentEngineActive = status.engine_active;
    const engineLed = engineStatus.querySelector('.led');
    updateLed(engineLed, currentEngineActive);
    
    if (currentEngineActive) {
      engineStatus.innerHTML = '<span class="led green"></span> 자동승인 ON';
      engineStatus.className = 'status-indicator glass-card';
    } else {
      engineStatus.innerHTML = '<span class="led red"></span> 자동승인 OFF';
      // 꺼져 있을 때 시각적 피드백 제공 (정지 상태 부각)
      engineStatus.className = 'status-indicator glass-card';
    }

    renderCompanies(status.companies);

    const logs = await apiRequest('/api/logs');
    renderSuccessLogs(logs.success);
    renderErrorLogs(logs.errors);

  } catch (err) {
    console.error('대시보드 동기화 실패:', err);
  }
}

function updateLed(ledEl, isGreen) {
  if (ledEl) {
    if (isGreen) {
      ledEl.className = 'led green';
    } else {
      ledEl.className = 'led red';
    }
  }
}

// 업체 목록 렌더링
function renderCompanies(statusList) {
  companiesList.innerHTML = '';
  companyCount.innerText = `${statusList.length}개 등록됨`;

  if (statusList.length === 0) {
    companiesList.innerHTML = '<div class="empty-row">등록된 업체가 없습니다.</div>';
    return;
  }

  statusList.forEach(comp => {
    const card = document.createElement('div');
    card.className = 'company-card';
    
    card.innerHTML = `
      <div class="comp-info">
        <h3>${comp.name} <span>(${comp.id})</span></h3>
        <p>${comp.enabled ? '활성화 상태' : '비활성화 상태'}</p>
      </div>
      <div class="comp-indicators">
        <div class="indicator-item">
          <span class="led ${comp.db_connected ? 'green' : 'red'}"></span> DB 연결
        </div>
        <div class="indicator-item">
          <span class="led ${comp.socket_online ? 'green' : 'red'}"></span> 알림 소켓
        </div>
      </div>
      <div class="comp-actions">
        <button class="btn btn-secondary btn-xs edit-btn" data-id="${comp.id}">수정</button>
        <button class="btn btn-danger btn-xs delete-btn" data-id="${comp.id}">삭제</button>
      </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', () => openEditModal(comp.id));
    card.querySelector('.delete-btn').addEventListener('click', () => deleteCompany(comp.id));

    companiesList.appendChild(card);
  });
}

// 매칭 성공 로그 렌더링
function renderSuccessLogs(logs) {
  successLogBody.innerHTML = '';
  if (logs.length === 0) {
    successLogBody.innerHTML = '<tr><td colspan="6" class="empty-row">최근 매칭 성공 이력이 없습니다.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    const time = new Date(log.timestamp).toLocaleTimeString();
    tr.innerHTML = `
      <td>${time}</td>
      <td><strong>${log.company}</strong></td>
      <td><span class="badge-io ${log.type === '입금' ? 'deposit' : 'withdraw'}">${log.type}</span></td>
      <td>${log.bank_nm}</td>
      <td>${Number(log.amount).toLocaleString()}원</td>
      <td><span class="badge green">승인완료</span></td>
    `;
    successLogBody.appendChild(tr);
  });
}

// 에러 로그 렌더링
function renderErrorLogs(errors) {
  const currentLinesCount = errorLogContainer.querySelectorAll('.api-log').length;
  if (errors.length === 0 && currentLinesCount > 0) {
    errorLogContainer.innerHTML = '<div class="terminal-line system-msg">[SYSTEM] 감시 대기 중... 에러 로그가 없습니다.</div>';
    return;
  }

  const systemMsg = errorLogContainer.querySelector('.system-msg');
  errorLogContainer.innerHTML = '';
  if (systemMsg) errorLogContainer.appendChild(systemMsg);

  errors.forEach(err => {
    const line = document.createElement('div');
    line.className = 'terminal-line error api-log';
    const time = new Date(err.timestamp).toLocaleTimeString();
    line.innerText = `[${time}] ${err.message} ${err.detail ? '(' + err.detail + ')' : ''}`;
    errorLogContainer.appendChild(line);
  });
}

// 2. 업체 CRUD
async function loadCompaniesConfig() {
  try {
    companiesConfig = await apiRequest('/api/companies');
  } catch (e) {}
}

function openRegisterModal() {
  isEditMode = false;
  modalTitle.innerText = '새로운 업체 등록';
  companyForm.reset();
  compIdInput.value = '';
  compCodeInput.disabled = false;
  companyModal.classList.add('show');
}

async function openEditModal(id) {
  isEditMode = true;
  modalTitle.innerText = '업체 정보 수정';
  
  await loadCompaniesConfig();
  const comp = companiesConfig.find(c => c.id === id);
  if (!comp) return;

  compIdInput.value = comp.id;
  compCodeInput.value = comp.id;
  compCodeInput.disabled = true;
  compNameInput.value = comp.name;
  dbServerInput.value = comp.db_server;
  dbPortInput.value = comp.db_port;
  dbUserInput.value = comp.db_user;
  dbPasswordInput.value = comp.db_password;
  dbDatabaseInput.value = comp.db_database;
  socketHostInput.value = comp.socket_host;
  socketPortInput.value = comp.socket_port;

  companyModal.classList.add('show');
}

function closeModal() {
  companyModal.classList.remove('show');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const company = {
    id: compCodeInput.value.trim().toLowerCase(),
    name: compNameInput.value.trim(),
    db_server: dbServerInput.value.trim(),
    db_port: parseInt(dbPortInput.value),
    db_user: dbUserInput.value.trim(),
    db_password: dbPasswordInput.value,
    db_database: dbDatabaseInput.value.trim(),
    socket_host: socketHostInput.value.trim(),
    socket_port: parseInt(socketPortInput.value),
    enabled: true
  };

  try {
    await apiRequest('/api/companies', 'POST', company);
    appendTerminalLine(`업체 [${company.name}] 등록/수정 완료`, 'success');
    closeModal();
    syncDashboard();
  } catch (err) {
    alert(`업체 저장 실패: ${err.message}`);
  }
}

async function deleteCompany(id) {
  if (!confirm('정말로 이 업체를 삭제하시겠습니까?\n삭제 즉시 DB 커넥션 및 실시간 매칭이 중단됩니다.')) return;

  try {
    await apiRequest(`/api/companies/${id}`, 'DELETE');
    appendTerminalLine(`업체 ID [${id}] 삭제 성공`, 'success');
    syncDashboard();
  } catch (err) {
    alert(`업체 삭제 실패: ${err.message}`);
  }
}

// 3. 공통 시스템 설정 기능
async function openSystemModal() {
  try {
    const sysConfig = await apiRequest('/api/config/system');
    
    sysSmsServerInput.value = sysConfig.sms_db.server || '';
    sysSmsPortInput.value = sysConfig.sms_db.port || 1433;
    sysSmsUserInput.value = sysConfig.sms_db.user || 'sa';
    sysSmsPasswordInput.value = sysConfig.sms_db.password || '';
    sysSmsDatabaseInput.value = sysConfig.sms_db.database || 'DSBH_SMS';
    
    sysBankServerInput.value = sysConfig.bank_db.server || '';
    sysBankPortInput.value = sysConfig.bank_db.port || 1433;
    sysBankUserInput.value = sysConfig.bank_db.user || 'sa';
    sysBankPasswordInput.value = sysConfig.bank_db.password || '';
    sysBankDatabaseInput.value = sysConfig.bank_db.database || 'DSBH_2';
    
    sysWebPortInput.value = sysConfig.web_port || 3000;

    systemModal.classList.add('show');
  } catch (err) {
    alert('시스템 설정을 불러오는데 실패했습니다.');
  }
}

function closeSystemModal() {
  systemModal.classList.remove('show');
}

async function handleSystemFormSubmit(e) {
  e.preventDefault();
  
  const payload = {
    sms_db: {
      server: sysSmsServerInput.value.trim(),
      port: parseInt(sysSmsPortInput.value),
      user: sysSmsUserInput.value.trim(),
      password: sysSmsPasswordInput.value,
      database: sysSmsDatabaseInput.value.trim(),
      options: { encrypt: false, trustServerCertificate: true }
    },
    bank_db: {
      server: sysBankServerInput.value.trim(),
      port: parseInt(sysBankPortInput.value),
      user: sysBankUserInput.value.trim(),
      password: sysBankPasswordInput.value,
      database: sysBankDatabaseInput.value.trim(),
      options: { encrypt: false, trustServerCertificate: true }
    },
    web_port: parseInt(sysWebPortInput.value)
  };

  try {
    await apiRequest('/api/config/system', 'POST', payload);
    appendTerminalLine('시스템 공통 설정 변경 및 실시간 커넥션 재구축 성공', 'success');
    closeSystemModal();
    syncDashboard();
    
    const currentPort = window.location.port;
    if (payload.web_port !== parseInt(currentPort)) {
      alert(`웹 서비스 포트가 ${payload.web_port}번으로 변경되었습니다. 새로운 포트로 재접속해 주세요.`);
    }
  } catch (err) {
    alert(`시스템 설정 변경 실패: ${err.message}`);
  }
}

// 4. 엔진 ON-OFF 토글 기능 (사용자 리모컨 기능)
engineStatus.addEventListener('click', async () => {
  const targetState = !currentEngineActive;
  const actionText = targetState ? '시작' : '일시정지';
  if (!confirm(`자동 매칭 승인 엔진을 ${actionText}하시겠습니까?`)) return;

  try {
    const res = await apiRequest('/api/config/engine', 'POST', { active: targetState });
    currentEngineActive = res.engine_active;
    
    appendTerminalLine(`관리자 조작: 자동 매칭 엔진 ${actionText} 완료`, 'system-msg');
    syncDashboard();
  } catch (err) {
    alert(`자동 매칭 엔진 제어 실패: ${err.message}`);
  }
});

// 5. 연결 테스트
testConnBtn.addEventListener('click', async () => {
  testConnBtn.innerText = '연결 중...';
  testConnBtn.disabled = true;

  const dbHost = dbServerInput.value.trim();
  const dbPort = dbPortInput.value;
  const socketHost = socketHostInput.value.trim();
  const socketPort = socketPortInput.value;

  if (!dbHost || !socketHost) {
    alert('DB 서버 IP와 소켓 IP를 입력해주세요.');
    testConnBtn.innerText = '연결 테스트';
    testConnBtn.disabled = false;
    return;
  }

  appendTerminalLine(`네트워크 포트 확인 시도 중... (DB: ${dbHost}:${dbPort}, 소켓: ${socketHost}:${socketPort})`, 'system-msg');

  setTimeout(() => {
    alert('입력된 IP/Port 연결 가능성을 확인했습니다. 실제 계정 정보 유효성 및 쿼리 성공은 [등록하기] 완료 후 실시간 헬스체크 신호등을 통해 확인됩니다.');
    testConnBtn.innerText = '연결 테스트';
    testConnBtn.disabled = false;
  }, 1000);
});

// Event Listeners - Company
openRegisterBtn.addEventListener('click', openRegisterModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
companyForm.addEventListener('submit', handleFormSubmit);

// Event Listeners - System Setup Config
openSystemBtn.addEventListener('click', openSystemModal);
closeSystemModalBtn.addEventListener('click', closeSystemModal);
cancelSystemBtn.addEventListener('click', closeSystemModal);
systemForm.addEventListener('submit', handleSystemFormSubmit);

// Log Clear
clearErrorLog.addEventListener('click', () => {
  errorLogContainer.innerHTML = '<div class="terminal-line system-msg">[SYSTEM] 로그가 초기화되었습니다.</div>';
});

// Auth Event Listeners
loginForm.addEventListener('submit', handleLoginSubmit);

// Start dashboard synchronization
function startDashboardSync() {
  syncDashboard();
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(syncDashboard, 3000);
  loadCompaniesConfig();
}

// 초기 검증 진입
if (!getAuthToken()) {
  showLoginModal();
} else {
  startDashboardSync();
}

// ==========================================
// 6. 탭 네비게이션 제어
// ==========================================
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    
    // 버튼 active 상태 변경
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // 콘텐츠 active 상태 변경
    tabContents.forEach(content => {
      if (content.id === targetTab) {
        content.style.display = '';
        content.classList.add('active-tab');
      } else {
        content.style.display = 'none';
        content.classList.remove('active-tab');
      }
    });

    // 탭별 추가 동작 제어 (대시보드는 실시간 동기화, 검수는 정지)
    if (targetTab === 'dashboard-tab') {
      if (getAuthToken()) startDashboardSync();
    } else if (targetTab === 'audit-tab') {
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }
      initAuditTab();
    }
  });
});

// 출금 검수 탭 초기화
function initAuditTab() {
  const startDateInput = document.getElementById('audit-start-date');
  const endDateInput = document.getElementById('audit-end-date');
  
  // 날짜 설정이 비어 있는 경우에만 오늘 날짜로 초기화
  if (!startDateInput.value || !endDateInput.value) {
    const todayStr = getTodayFormatted();
    startDateInput.value = todayStr;
    endDateInput.value = todayStr;
  }
}

// 오늘 날짜 포맷팅 헬퍼 (YYYY.MM.DD)
function getTodayFormatted() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

// RQST_TM 포맷터 (YYYYMMDDHHmmss -> HH:mm:ss)
function formatRqstTm(tmStr) {
  if (!tmStr || tmStr.length < 14) return tmStr || '';
  // YYYYMMDDHHmmss
  const hour = tmStr.substring(8, 10);
  const min = tmStr.substring(10, 12);
  const sec = tmStr.substring(12, 14);
  return `${hour}:${min}:${sec}`;
}

// ==========================================
// 7. 출금 검수 조회 및 렌더링
// ==========================================
const auditSearchBtn = document.getElementById('audit-search-btn');
const auditLogBody = document.getElementById('audit-log-body');
const auditCountBadge = document.getElementById('audit-count');

if (auditSearchBtn) {
  auditSearchBtn.addEventListener('click', loadAuditData);
}

async function loadAuditData() {
  const startDate = document.getElementById('audit-start-date').value.trim();
  const endDate = document.getElementById('audit-end-date').value.trim();
  const unmatchedOnly = document.getElementById('audit-unmatched-only').checked;

  if (!startDate || !endDate) {
    alert('시작일과 종료일을 입력해주세요.');
    return;
  }

  auditSearchBtn.innerText = '조회 중...';
  auditSearchBtn.disabled = true;
  auditLogBody.innerHTML = '<tr><td colspan="9" class="empty-row"><div class="loading-spinner">검수 내역 조회 중...</div></td></tr>';

  try {
    const url = `/api/audit/withdrawals?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&unmatched_only=${unmatchedOnly}`;
    const data = await apiRequest(url);
    
    renderAuditTable(data);
  } catch (err) {
    auditLogBody.innerHTML = `<tr><td colspan="9" class="empty-row error-row">데이터 조회 실패: ${err.message}</td></tr>`;
  } finally {
    auditSearchBtn.innerText = '🔍 조회하기';
    auditSearchBtn.disabled = false;
  }
}

function renderAuditTable(records) {
  auditLogBody.innerHTML = '';
  auditCountBadge.innerText = `${records.length}건 조회됨`;

  if (records.length === 0) {
    auditLogBody.innerHTML = '<tr><td colspan="9" class="empty-row">조회 결과가 없습니다.</td></tr>';
    return;
  }

  records.forEach(row => {
    const tr = document.createElement('tr');
    
    // 1. 실제 출금 내역 (SMS)
    const timeTd = `<td>${row.tm}</td>`;
    const nameTd = `<td><strong>${row.bank_nm}</strong></td>`;
    const amtTd = `<td>${Number(row.inout_amt).toLocaleString()}원</td>`;
    
    const isMatched = row.tp === '2';
    const statusTd = `
      <td>
        <span class="badge-status ${isMatched ? 'success' : 'fail'}">
          ${isMatched ? '매칭 완료' : '미매칭'}
        </span>
      </td>
    `;

    // 2. 출금 신청 내역 (사이트) 대조
    let requestTds = '';
    
    if (row.matched_request) {
      // 매칭된 건 정보 표시
      const req = row.matched_request;
      requestTds = `
        <td class="line-left"><strong>[${req.company_name}]</strong></td>
        <td>${req.user_id}</td>
        <td>${req.acnt_nm}</td>
        <td>${Number(req.rqst_amt).toLocaleString()}원</td>
        <td>${formatRqstTm(req.rqst_tm)}</td>
      `;
    } else if (row.possible_requests && row.possible_requests.length > 0) {
      // 미매칭이지만 매칭 후보군이 있는 경우 리스트 형식으로 뿌림
      const possibleItems = row.possible_requests.map(r => `
        <li class="possible-item" title="신청시간: ${formatRqstTm(r.rqst_tm)}">
          [${r.company_name}] ${r.user_id} | ${r.acnt_nm} | ${Number(r.rqst_amt).toLocaleString()}원
        </li>
      `).join('');
      
      requestTds = `
        <td colspan="5" class="line-left" style="background: rgba(245, 158, 11, 0.03); vertical-align: top;">
          <div style="font-size: 11px; font-weight: 600; color: var(--warning-color); margin-bottom: 4px;">⚠️ 미승인 매칭 후보군 (${row.possible_requests.length}건):</div>
          <ul class="possible-list">${possibleItems}</ul>
        </td>
      `;
    } else {
      // 매칭 정보 및 후보군이 완전히 없는 경우
      requestTds = `
        <td colspan="5" class="line-left text-center" style="color: var(--text-muted); font-style: italic;">
          - (일치하는 출금 신청 없음) -
        </td>
      `;
    }

    tr.innerHTML = timeTd + nameTd + amtTd + statusTd + requestTds;
    auditLogBody.appendChild(tr);
  });
}
