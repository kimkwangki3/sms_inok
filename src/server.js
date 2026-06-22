const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
const sql = require('mssql');
const db = require('./db');
const watcher = require('./watcher');
const matcher = require('./matcher');
const parser = require('./parser');

// 대시보드 로그인 정보 고정
const AUTH_USER = 'admin';
const AUTH_PASS = 'dkfvkrh123';
const ACTIVE_TOKENS = new Set();

// 실시간 감시 및 매칭 엔진 가동 상태 플래그 (기본: 가동상태)
let isEngineActive = true;

function createServer(configPath, config, updateConfigCallback) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  
  // 1. 인증 미들웨어 (Static Resource 제외, API 보호)
  function requireAuth(req, res, next) {
    if (req.path === '/login' || req.path === '/api/login') {
      return next();
    }
    
    const token = req.headers['x-auth-token'];
    if (token && ACTIVE_TOKENS.has(token)) {
      return next();
    }
    
    res.status(401).json({ error: '인증되지 않은 요청입니다. 로그인이 필요합니다.' });
  }

  app.use('/api', requireAuth);
  app.use(express.static(path.join(__dirname, '../public')));

  // TCP 포트 응답 대기 테스트
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
      const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      ACTIVE_TOKENS.add(token);
      
      if (ACTIVE_TOKENS.size > 100) {
        const first = ACTIVE_TOKENS.values().next().value;
        ACTIVE_TOKENS.delete(first);
      }
      
      res.json({ success: true, token });
    } else {
      res.status(400).json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
  });

  // 1. 전체 시스템 실시간 연결 상태 조회 (엔진 가동 플래그 포함)
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
        companies: companyStatus,
        engine_active: isEngineActive // 엔진 구동 여부 추가
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. 등록된 업체 설정 목록 조회
  function maskCompanies(companies) {
    return companies.map(c => ({
      ...c,
      db_password: c.db_password ? '********' : ''
    }));
  }

  app.get('/api/companies', (req, res) => {
    res.json(maskCompanies(config.companies || []));
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
        if (company.db_password === '********') {
          company.db_password = config.companies[existingIdx].db_password;
        }
        config.companies[existingIdx] = { ...config.companies[existingIdx], ...company };
      } else {
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

  // 5. 공통 시스템 설정 조회 API
  function maskSystemConfig(conf) {
    const copy = JSON.parse(JSON.stringify(conf));
    if (copy.sms_db && copy.sms_db.password) copy.sms_db.password = '********';
    if (copy.bank_db && copy.bank_db.password) copy.bank_db.password = '********';
    return copy;
  }

  app.get('/api/config/system', (req, res) => {
    res.json(maskSystemConfig({
      sms_db: config.sms_db,
      bank_db: config.bank_db,
      web_port: config.web_port
    }));
  });

  // 6. 공통 시스템 설정 수정 및 실시간 풀 반영 API
  app.post('/api/config/system', async (req, res) => {
    const { sms_db, bank_db, web_port } = req.body;
    if (!sms_db || !bank_db) {
      return res.status(400).json({ error: 'SMS DB 및 BANK DB 설정 데이터가 누락되었습니다.' });
    }

    try {
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

  // 7. 실시간 매칭/수집 엔진 ON-OFF 제어 API (서버 스톱/시작 기능 요청 대응)
  app.post('/api/config/engine', async (req, res) => {
    const { active } = req.body;
    if (active === undefined) {
      return res.status(400).json({ error: 'active 플래그(true/false)가 필요합니다.' });
    }

    try {
      if (active === true && !isEngineActive) {
        // 엔진 가동 시작
        await watcher.start();
        matcher.startPeriodicScheduler(() => config.companies, 3000);
        isEngineActive = true;
        console.log('[대시보드] 관리자에 의해 자동 매칭 엔진이 가동되었습니다.');
        matcher.addSuccessLog({ seqno: 'SYSTEM', company: 'ENGINE', user_id: 'SYSTEM', bank_nm: '엔진 구동 시작', amount: 0, type: '입금' });
      } else if (active === false && isEngineActive) {
        // 엔진 가동 중지
        watcher.stop();
        matcher.stopPeriodicScheduler();
        isEngineActive = false;
        console.log('[대시보드] 관리자에 의해 자동 매칭 엔진이 일시 정지되었습니다.');
        matcher.addErrorLog('자동 입출금 매칭 엔진이 관리자에 의해 일시 정지되었습니다.');
      }
      
      res.json({ success: true, engine_active: isEngineActive });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. 처리 로그 조회 API
  app.get('/api/logs', (req, res) => {
    res.json({
      success: matcher.successLogs,
      errors: matcher.errorLogs
    });
  });

  // 9. 출금 검수 조회 API (출금 신청 INOUT 기준 대조)
  app.get('/api/audit/withdrawals', async (req, res) => {
    const { start_date, end_date, unmatched_only } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: '시작 날짜와 종료 날짜를 지정해야 합니다.' });
    }

    try {
      const bankPool = db.getBankPool();
      if (!bankPool) {
        return res.status(500).json({ error: 'BANK DB 연결이 활성화되지 않았습니다.' });
      }

      // 날짜 포맷 변환 (YYYY.MM.DD -> YYYYMMDD)
      const startDateRaw = start_date.replace(/[^0-9]/g, '');
      const endDateRaw = end_date.replace(/[^0-9]/g, '');
      
      const startTm = `${startDateRaw}000000`;
      const endTm = `${endDateRaw}235959`;

      // 시차 및 날짜 경계선 오류 방지를 위한 BANK 조회 기간 +-1일 여유 계산
      const sParts = start_date.split('.');
      const eParts = end_date.split('.');
      const sDateObj = new Date(parseInt(sParts[0]), parseInt(sParts[1]) - 1, parseInt(sParts[2]));
      const eDateObj = new Date(parseInt(eParts[0]), parseInt(eParts[1]) - 1, parseInt(eParts[2]));
      
      const marginSDate = new Date(sDateObj.getTime() - 24 * 60 * 60 * 1000);
      const marginEDate = new Date(eDateObj.getTime() + 24 * 60 * 60 * 1000);
      
      const pad = (n) => String(n).padStart(2, '0');
      const bankStartDate = `${marginSDate.getFullYear()}.${pad(marginSDate.getMonth() + 1)}.${pad(marginSDate.getDate())}`;
      const bankEndDate = `${marginEDate.getFullYear()}.${pad(marginEDate.getMonth() + 1)}.${pad(marginEDate.getDate())}`;

      // 1. BANK 테이블에서 앞뒤 1일 여유를 둔 실제 출금 내역 조회 (공백 제거 매칭 적용)
      const bankResult = await bankPool.request()
        .input('bankStartDate', sql.VarChar, bankStartDate)
        .input('bankEndDate', sql.VarChar, bankEndDate)
        .query(`
          SELECT DT, TM, BANK_NO, INOUT_AMT, BANK_NM, TP 
          FROM BANK 
          WHERE INOUT_TP = '출금' 
            AND LTRIM(RTRIM(DT)) BETWEEN @bankStartDate AND @bankEndDate 
          ORDER BY DT DESC, TM DESC
        `);
      const bankSmsList = bankResult.recordset.map(sms => ({
        dt: (sms.DT || '').trim(),
        tm: (sms.TM || '').trim(),
        bank_no: (sms.BANK_NO || '').trim(),
        inout_amt: parseFloat(sms.INOUT_AMT) || 0,
        bank_nm: parser.cleanBankName((sms.BANK_NM || '').trim()),
        tp: sms.TP
      }));

      const auditData = [];

      // 2. 각 업체 DB의 INOUT 테이블에서 출금 신청 내역 조회
      for (const company of config.companies) {
        if (!company.enabled) continue;

        const compPool = db.getCompanyPool(company.id);
        if (!compPool) continue;

        try {
          const inoutResult = await compPool.request()
            .input('startDateRaw', sql.VarChar, startDateRaw)
            .input('endDateRaw', sql.VarChar, endDateRaw)
            .query(`
              SELECT USER_ID, RQST_TM, RQST_AMT, USER_BANK_ACNT_NM, RSLT_TP 
              FROM INOUT 
              WHERE IO_TP = '2' 
                AND RQST_TRADE_DT BETWEEN @startDateRaw AND @endDateRaw 
              ORDER BY RQST_TM DESC
            `);

          const requests = inoutResult.recordset;

          for (const req of requests) {
            const rqstAmt = parseFloat(req.RQST_AMT) || 0;
            const acntNm = (req.USER_BANK_ACNT_NM || '').trim();
            const rqstTm = req.RQST_TM;

            let matchedSms = null;
            const possibleSmsList = [];

            // 3. 실제 출금 SMS 목록에서 매칭 대상 검색
            for (const sms of bankSmsList) {
              // 업체명 정합성 비교 (예: sms.bank_no = "금메달", company.name = "금메달")
              const isCompanyMatched = sms.bank_no.toLowerCase().replace(/\s/g, '') === company.name.toLowerCase().replace(/\s/g, '');
              if (!isCompanyMatched) continue;

              // 출금 매칭 기준: 실제출금액(inout_amt)은 신청액(rqstAmt) 이상, 신청액 + 1000 이하이어야 함
              const isAmtValid = sms.inout_amt >= rqstAmt && sms.inout_amt <= rqstAmt + 1000;
              const isNameMatched = sms.bank_nm === acntNm;

              if (isAmtValid && isNameMatched) {
                // 이름과 금액이 모두 맞으면 유력 매칭
                if (req.RSLT_TP === '1' && sms.tp === '2') {
                  matchedSms = sms;
                  break;
                } else if (req.RSLT_TP === '0' && sms.tp === '1') {
                  matchedSms = sms;
                  break;
                } else if (!matchedSms) {
                  matchedSms = sms;
                }
              } else if (isAmtValid && !isNameMatched) {
                // 금액은 맞는데 이름이 다른 경우 -> 이름 불일치 매칭 불가 후보군
                possibleSmsList.push({
                  ...sms,
                  reason: '이름 불일치'
                });
              } else if (!isAmtValid && isNameMatched) {
                // 이름은 맞는데 금액이 다른 경우 -> 금액 불일치 매칭 불가 후보군
                possibleSmsList.push({
                  ...sms,
                  reason: '금액 불일치'
                });
              }
            }

            const item = {
              company_name: company.name,
              user_id: req.USER_ID.trim(),
              rqst_tm: rqstTm.trim(),
              rqst_amt: rqstAmt,
              acnt_nm: acntNm,
              rslt_tp: req.RSLT_TP,
              matched_sms: matchedSms,
              possible_sms_list: possibleSmsList
            };

            if (unmatched_only === 'true') {
              // 매칭이 안 된 건(matched_sms가 없거나, 미승인 상태)만 필터링
              if (!matchedSms || req.RSLT_TP === '0') {
                auditData.push(item);
              }
            } else {
              auditData.push(item);
            }
          }
        } catch (companyErr) {
          console.error(`출금 검수 중 업체 [${company.name}] INOUT 조회 실패:`, companyErr.message);
        }
      }

      // 신청 시간 순으로 전체 데이터 정렬 (최신순)
      auditData.sort((a, b) => b.rqst_tm.localeCompare(a.rqst_tm));

      res.json(auditData);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = {
  createServer
};
