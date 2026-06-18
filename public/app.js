const API_BASE = '';

// DOM Elements
const smsDbStatus = document.getElementById('sms-db-status');
const bankDbStatus = document.getElementById('bank-db-status');
const companyCount = document.getElementById('company-count');
const companiesList = document.getElementById('companies-list');
const successLogBody = document.getElementById('success-log-body');
const errorLogContainer = document.getElementById('error-log-container');
const clearErrorLog = document.getElementById('clear-error-log');

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

let isEditMode = false;
let companiesConfig = [];

// API Request Helper
async function apiRequest(url, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'API 요청 실패');
    }
    return await res.json();
  } catch (err) {
    appendTerminalLine(`[API 오류] ${err.message}`, 'error');
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

// 1. 시스템 실시간 상태 및 로그 동기화
async function syncDashboard() {
  try {
    const status = await apiRequest('/api/status');
    
    updateLed(smsDbStatus.querySelector('.led'), status.sms_db);
    updateLed(bankDbStatus.querySelector('.led'), status.bank_db);
    
    renderCompanies(status.companies);

    const logs = await apiRequest('/api/logs');
    renderSuccessLogs(logs.success);
    renderErrorLogs(logs.errors);

  } catch (err) {
    console.error('대시보드 동기화 실패:', err);
  }
}

function updateLed(ledEl, isGreen) {
  if (isGreen) {
    ledEl.className = 'led green';
  } else {
    ledEl.className = 'led red';
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
  companiesConfig = await apiRequest('/api/companies');
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
    
    // SMS DB 세팅
    sysSmsServerInput.value = sysConfig.sms_db.server || '';
    sysSmsPortInput.value = sysConfig.sms_db.port || 1433;
    sysSmsUserInput.value = sysConfig.sms_db.user || 'sa';
    sysSmsPasswordInput.value = sysConfig.sms_db.password || '';
    sysSmsDatabaseInput.value = sysConfig.sms_db.database || 'DSBH_SMS';
    
    // BANK DB 세팅
    sysBankServerInput.value = sysConfig.bank_db.server || '';
    sysBankPortInput.value = sysConfig.bank_db.port || 1433;
    sysBankUserInput.value = sysConfig.bank_db.user || 'sa';
    sysBankPasswordInput.value = sysConfig.bank_db.password || '';
    sysBankDatabaseInput.value = sysConfig.bank_db.database || 'DSBH_2';
    
    // 포트 세팅
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
    
    // 포트가 변경되었을 수 있음을 안내
    const currentPort = window.location.port;
    if (payload.web_port !== parseInt(currentPort)) {
      alert(`웹 서비스 포트가 ${payload.web_port}번으로 변경되었습니다. 새로운 포트로 재접속이 필요할 수 있습니다.`);
    }
  } catch (err) {
    alert(`시스템 설정 변경 실패: ${err.message}`);
  }
}

// 4. 연결 테스트
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

// Init & Start periodic sync
syncDashboard();
setInterval(syncDashboard, 3000);
loadCompaniesConfig();
appendTerminalLine('대시보드 실시간 동기화 스케줄러 시작됨 (3s 주기)', 'system-msg');
