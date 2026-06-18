const sql = require('mssql');

let smsPool = null;
let bankPool = null;
const companyPools = new Map();

async function createPool(config) {
  const sqlConfig = {
    server: config.server || config.db_server,
    port: parseInt(config.port || config.db_port),
    user: config.user || config.db_user,
    password: config.password || config.db_password,
    database: config.database || config.db_database,
    options: {
      encrypt: config.options ? config.options.encrypt : false,
      trustServerCertificate: config.options ? config.options.trustServerCertificate : true,
      enableArithAbort: true
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
  
  const pool = new sql.ConnectionPool(sqlConfig);
  await pool.connect();
  return pool;
}

async function initPools(config) {
  console.log('DB 커넥션 풀 초기화 중...');
  try {
    if (config.sms_db) {
      smsPool = await createPool(config.sms_db);
      console.log('SMS DB 커넥션 풀 생성 완료');
    }
    if (config.bank_db) {
      bankPool = await createPool(config.bank_db);
      console.log('BANK DB 커넥션 풀 생성 완료');
    }
    
    if (config.companies) {
      for (const comp of config.companies) {
        if (comp.enabled !== false) {
          try {
            const pool = await createPool(comp);
            companyPools.set(comp.id, pool);
            console.log(`업체 [${comp.name}] DB 커넥션 풀 생성 완료`);
          } catch (err) {
            console.error(`업체 [${comp.name}] DB 연결 실패:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('기본 DB 풀 초기화 실패:', err);
    throw err;
  }
}

function getSmsPool() {
  return smsPool;
}

function getBankPool() {
  return bankPool;
}

function getCompanyPool(companyId) {
  return companyPools.get(companyId);
}

async function addCompanyPool(company) {
  if (companyPools.has(company.id)) {
    await removeCompanyPool(company.id);
  }
  
  if (company.enabled !== false) {
    const pool = await createPool(company);
    companyPools.set(company.id, pool);
    console.log(`업체 [${company.name}] DB 커넥션 풀 추가/갱신 완료`);
  }
}

async function removeCompanyPool(companyId) {
  const pool = companyPools.get(companyId);
  if (pool) {
    try {
      await pool.close();
      console.log(`업체 ID [${companyId}] DB 커넥션 풀 해제 완료`);
    } catch (err) {
      console.error(`업체 ID [${companyId}] DB 풀 닫기 오류:`, err.message);
    }
    companyPools.delete(companyId);
  }
}

// SMS DB 및 BANK DB의 설정을 실시간 변경 시 커넥션 재구축 함수
async function updateSystemPools(smsConfig, bankConfig) {
  console.log('[SYSTEM] SMS/BANK DB 커넥션 풀 재구성 중...');
  if (smsPool) {
    try { await smsPool.close(); } catch (e) {}
  }
  if (bankPool) {
    try { await bankPool.close(); } catch (e) {}
  }
  
  smsPool = await createPool(smsConfig);
  bankPool = await createPool(bankConfig);
  console.log('[SYSTEM] SMS/BANK DB 커넥션 풀 재구성 완료');
}

async function closeAllPools() {
  console.log('모든 DB 커넥션 풀을 해제합니다...');
  if (smsPool) {
    try { await smsPool.close(); } catch(e) {}
  }
  if (bankPool) {
    try { await bankPool.close(); } catch(e) {}
  }
  for (const [id, pool] of companyPools.entries()) {
    try { await pool.close(); } catch(e) {}
  }
  companyPools.clear();
}

module.exports = {
  initPools,
  getSmsPool,
  getBankPool,
  getCompanyPool,
  addCompanyPool,
  removeCompanyPool,
  updateSystemPools,
  closeAllPools,
  companyPools
};
