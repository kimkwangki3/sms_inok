const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
const db = require('./db');
const matcher = require('./matcher');

// 대시보드 로그인 정보 고정
const AUTH_USER = 'admin';
const AUTH_PASS = 'dkfvkrh123';
// 간단한 토큰 관리 (서버 메모리 보관)
const ACTIVE_TOKENS = new Set();

function createServer(configPath, config, updateConfigCallback) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  
  // 1. 인증 미들웨어 (Static Resource 제외, API 보호)
  function requireAuth(req, res, next) {
    // 로그인 API는 인증 체크 통과
    if (req.path === '/api/login') {
      return next();
    }
    
    const token = req.headers['x-auth-token'];
    if (token && ACTIVE_TOKENS.has(token)) {
      return next();
    }
    
    res.status(401).json({ error: '인증되지 않은 요청입니다. 로그인이 필요합니다.' });
  }

  // API 라우트에 미들웨어 적용
  app.use('/api', requireAuth);

  // 대시보드 정적 웹 리소스 폴더 서빙 (Static HTML/CSS/JS는 인증 전에도 브라우저가 읽어야 하므로 미들웨어 보호 제외)
  app.use(express.static(path.join(__dirname, '../public')));

  // TCP 포트 응답 대기 테스트 (소켓 체크용)
  function checkPort(host, port) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      client.setTimeout(1500);
      
      client.connect(port, host, () => {
        client.destroy();
        resolve(true);
      });
      
      client.on('error', () => {
        client.destroy();
        resolve(false);
      });
      
      client.on('timeout', () => {
        client.destroy();
        resolve(false);
      });
    });
  }

  // 0. 로그인 API
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === AUTH_USER && password === AUTH_PASS) {
      // 심플한 토큰 발급
      const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      ACTIVE_TOKENS.add(token);
      
      // 만료 방지를 위해 최대 100개 토큰만 보존
      if (ACTIVE_TOKENS.size > 100) {
        const first = ACTIVE_TOKENS.values().next().value;
        ACTIVE_TOKENS.delete(first);
      }
      
      res.json({ success: true, token });
    } else {
      res.status(400).json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
  });

  // 1. 전체 시스템 실시간 연결 상태 조회
  app.get('/api/status', async (req, res) => {
    try {
      const smsPool = db.getSmsPool();
      const bankPool = db.getBankPool();
      
      const smsDbOk = smsPool ? smsPool.connected : false;
      const bankDbOk = bankPool ? bankPool.connected : false;
      
      const companyStatus = [];
      for (const comp of config.companies) {
        const pool = db.getCompanyPool(comp.id);
        const dbConnected = pool ? pool.connected : false;
        
        const socketOk = await checkPort(comp.socket_host, comp.socket_port);
        
        companyStatus.push({
          id: comp.id,
          name: comp.name,
          enabled: comp.enabled,
          db_connected: dbConnected,
          socket_online: socketOk
        });
      }

      res.json({
        sms_db: smsDbOk,
        bank_db: bankDbOk,
        companies: companyStatus
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper: 업체 리스트 중요 비밀번호 마스킹 반환
  function maskCompanies(companies) {
    return companies.map(c => ({
      ...c,
      db_password: c.db_password ? '********' : ''
    }));
  }

  // 2. 등록된 업체 설정 목록 조회 (비밀번호 마스킹)
  app.get('/api/companies', (req, res) => {
    res.json(maskCompanies(config.companies || []));
  });

  // 3. 업체 정보 추가 또는 기존 업체 수정 (마스킹 비밀번호 보존 로직 포함)
  app.post('/api/companies', async (req, res) => {
    const company = req.body;
    if (!company.id || !company.name || !company.db_server || !company.db_database) {
      return res.status(400).json({ error: '필수 입력 항목이 누락되었습니다.' });
    }

    try {
      const existingIdx = config.companies.findIndex(c => c.id === company.id);
      
      if (existingIdx > -1) {
        // 기존 비밀번호 로드 (마스킹 상태로 유입 시 이전 패스워드 복원)
        if (company.db_password === '********') {
          company.db_password = config.companies[existingIdx].db_password;
        }
        config.companies[existingIdx] = { ...config.companies[existingIdx], ...company };
      } else {
        // 신규 등록 시 패스워드가 마스킹이면 안 됨
        if (company.db_password === '********' || !company.db_password) {
          return res.status(400).json({ error: '유효한 데이터베이스 비밀번호를 입력해주세요.' });
        }
        config.companies.push(company);
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      await db.addCompanyPool(company);
      updateConfigCallback(config);

      res.json({ success: true, company: maskCompanies([company])[0] });
    } catch (err) {
      matcher.addErrorLog(`업체 정보 저장 실패 (${company.name})`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. 업체 삭제
  app.delete('/api/companies/:id', async (req, res) => {
    const compId = req.params.id;
    try {
      const idx = config.companies.findIndex(c => c.id === compId);
      if (idx === -1) {
        return res.status(404).json({ error: '존재하지 않는 업체입니다.' });
      }

      const compName = config.companies[idx].name;
      config.companies.splice(idx, 1);

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      await db.removeCompanyPool(compId);
      updateConfigCallback(config);

      console.log(`[대시보드] 업체 삭제 완료: ${compName} (${compId})`);
      res.json({ success: true, message: '업체가 삭제되었습니다.' });
    } catch (err) {
      matcher.addErrorLog(`업체 삭제 처리 중 오류 (${compId})`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // Helper: 시스템 설정 비밀번호 마스킹 반환
  function maskSystemConfig(conf) {
    const copy = JSON.parse(JSON.stringify(conf));
    if (copy.sms_db && copy.sms_db.password) copy.sms_db.password = '********';
    if (copy.bank_db && copy.bank_db.password) copy.bank_db.password = '********';
    return copy;
  }

  // 5. 공통 시스템 설정 조회 API (비밀번호 마스킹)
  app.get('/api/config/system', (req, res) => {
    res.json(maskSystemConfig({
      sms_db: config.sms_db,
      bank_db: config.bank_db,
      web_port: config.web_port
    }));
  });

  // 6. 공통 시스템 설정 수정 및 실시간 풀 반영 API (마스킹 패스워드 복원 포함)
  app.post('/api/config/system', async (req, res) => {
    const { sms_db, bank_db, web_port } = req.body;
    if (!sms_db || !bank_db) {
      return res.status(400).json({ error: 'SMS DB 및 BANK DB 설정 데이터가 누락되었습니다.' });
    }

    try {
      // 마스킹 패스워드 복원
      if (sms_db.password === '********') {
        sms_db.password = config.sms_db.password;
      }
      if (bank_db.password === '********') {
        bank_db.password = config.bank_db.password;
      }

      config.sms_db = sms_db;
      config.bank_db = bank_db;
      if (web_port) config.web_port = parseInt(web_port);

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      await db.updateSystemPools(sms_db, bank_db);
      updateConfigCallback(config);

      console.log('[대시보드] 공통 시스템 설정 수정 완료 및 실시간 반영 완료');
      res.json({ success: true, message: '시스템 설정이 변경 및 실시간 반영되었습니다.' });
    } catch (err) {
      matcher.addErrorLog('시스템 설정 수정 및 커넥션 갱신 실패', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 7. 처리 로그 조회 API
  app.get('/api/logs', (req, res) => {
    res.json({
      success: matcher.successLogs,
      errors: matcher.errorLogs
    });
  });

  return app;
}

module.exports = {
  createServer
};
