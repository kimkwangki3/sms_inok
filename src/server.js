const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
const db = require('./db');
const matcher = require('./matcher');

function createServer(configPath, config, updateConfigCallback) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  
  // 대시보드 정적 웹 리소스 폴더 서빙
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

  // 2. 등록된 업체 설정 목록 조회
  app.get('/api/companies', (req, res) => {
    res.json(config.companies || []);
  });

  // 3. 업체 정보 추가 또는 기존 업체 수정
  app.post('/api/companies', async (req, res) => {
    const company = req.body;
    if (!company.id || !company.name || !company.db_server || !company.db_database) {
      return res.status(400).json({ error: '필수 입력 항목이 누락되었습니다.' });
    }

    try {
      const existingIdx = config.companies.findIndex(c => c.id === company.id);
      
      if (existingIdx > -1) {
        config.companies[existingIdx] = { ...config.companies[existingIdx], ...company };
      } else {
        config.companies.push(company);
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      await db.addCompanyPool(company);
      updateConfigCallback(config);

      res.json({ success: true, company });
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

  // 5. 공통 시스템 설정 조회 API (SMS DB, BANK DB)
  app.get('/api/config/system', (req, res) => {
    res.json({
      sms_db: config.sms_db,
      bank_db: config.bank_db,
      web_port: config.web_port
    });
  });

  // 6. 공통 시스템 설정 수정 및 실시간 풀 반영 API
  app.post('/api/config/system', async (req, res) => {
    const { sms_db, bank_db, web_port } = req.body;
    if (!sms_db || !bank_db) {
      return res.status(400).json({ error: 'SMS DB 및 BANK DB 설정 데이터가 누락되었습니다.' });
    }

    try {
      config.sms_db = sms_db;
      config.bank_db = bank_db;
      if (web_port) config.web_port = parseInt(web_port);

      // 설정 파일 저장
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

      // 실시간으로 시스템 DB 커넥션 풀 재구성
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
